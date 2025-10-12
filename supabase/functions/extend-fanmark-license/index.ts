import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import {
  corsHeaders,
  createSupabaseClient,
} from "../_shared/return-helpers.ts";

interface LicenseWithFanmark {
  id: string;
  fanmark_id: string;
  user_id: string;
  status: string;
  license_end: string | null;
  grace_expires_at: string | null;
  is_returned: boolean | null;
  excluded_at: string | null;
  excluded_from_plan: string | null;
  fanmarks: {
    id: string;
    user_input_fanmark: string;
    short_id: string;
    status: string;
  } | null;
}

interface ExtendRequestBody {
  fanmark_id?: string;
  months?: number;
}

const ALLOWED_MONTHS = new Set([1, 2, 3, 6]);

function addMonths(base: Date, months: number): Date {
  const result = new Date(base.getTime());
  const originalDate = result.getDate();
  result.setMonth(result.getMonth() + months);
  if (result.getDate() !== originalDate) {
    result.setDate(0);
  }
  return result;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createSupabaseClient();
    const authHeader = req.headers.get('Authorization');

    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Authentication required' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: authData, error: authError } = await supabase.auth.getUser(token);

    if (authError || !authData?.user) {
      return new Response(JSON.stringify({ error: 'Invalid authentication' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = (await req.json()) as ExtendRequestBody | null;
    const fanmarkId = body?.fanmark_id;
    const months = body?.months;

    if (!fanmarkId || typeof fanmarkId !== 'string') {
      return new Response(JSON.stringify({ error: 'fanmark_id is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (typeof months !== 'number' || !Number.isInteger(months) || months <= 0) {
      return new Response(JSON.stringify({ error: 'months must be a positive integer' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!ALLOWED_MONTHS.has(months)) {
      return new Response(JSON.stringify({ error: 'Unsupported plan length' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: license, error: licenseError } = await supabase
      .from('fanmark_licenses')
      .select(`
        id,
        fanmark_id,
        user_id,
        status,
        license_end,
        grace_expires_at,
        is_returned,
        excluded_at,
        excluded_from_plan,
        fanmarks!inner (
          id,
          user_input_fanmark,
          short_id,
          status
        )
      `)
      .eq('fanmark_id', fanmarkId)
      .eq('user_id', authData.user.id)
      .in('status', ['active', 'grace'])
      .order('license_end', { ascending: false, nullsLast: true })
      .limit(1)
      .maybeSingle();

    if (licenseError) {
      console.error('Failed to fetch license for extension:', licenseError);
      return new Response(JSON.stringify({ error: 'Failed to fetch license information' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!license) {
      return new Response(JSON.stringify({ error: 'No eligible license found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const licenseRecord: LicenseWithFanmark = license as LicenseWithFanmark;

    if (licenseRecord.fanmarks?.status !== 'active') {
      return new Response(JSON.stringify({ error: 'Fanmark is not active' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (licenseRecord.is_returned && licenseRecord.status !== 'grace') {
      return new Response(JSON.stringify({ error: 'Returned licenses cannot be extended' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const now = new Date();
    const licenseEnd = licenseRecord.license_end ? new Date(licenseRecord.license_end) : null;
    const baseDate = licenseEnd && !Number.isNaN(licenseEnd.getTime()) && licenseEnd > now
      ? licenseEnd
      : now;
    const extendedDate = addMonths(baseDate, months);
    const newLicenseEndIso = extendedDate.toISOString();

    const { data: updated, error: updateError } = await supabase
      .from('fanmark_licenses')
      .update({
        status: 'active',
        license_end: newLicenseEndIso,
        grace_expires_at: null,
        is_returned: false,
        excluded_at: null,
        excluded_from_plan: null,
      })
      .eq('id', licenseRecord.id)
      .select('id, license_end, grace_expires_at, status')
      .maybeSingle();

    if (updateError) {
      console.error('Failed to update license during extension:', updateError);
      return new Response(JSON.stringify({ error: 'Failed to extend license' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { error: auditError } = await supabase
      .from('audit_logs')
      .insert({
        user_id: authData.user.id,
        action: 'extend_fanmark_license',
        resource_type: 'fanmark_license',
        resource_id: licenseRecord.id,
        metadata: {
          fanmark_id: licenseRecord.fanmark_id,
          months,
          previous_license_end: licenseRecord.license_end,
          new_license_end: newLicenseEndIso,
        },
      });

    if (auditError) {
      console.warn('Failed to insert audit log for extension:', auditError);
    }

    return new Response(JSON.stringify({
      success: true,
      license: updated,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Unexpected error in extend-fanmark-license:', error);
    const message = error instanceof Error ? error.message : 'Internal error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
