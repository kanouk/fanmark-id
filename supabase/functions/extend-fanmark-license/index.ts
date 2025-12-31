import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import {
  corsHeaders,
  createSupabaseClient,
  roundUpToNextUtcMidnight,
} from "../_shared/return-helpers.ts";
import {
  validateUuid,
  validatePositiveInt,
  logSafeError,
  createGenericErrorResponse,
  createValidationErrorResponse,
} from "../_shared/validation.ts";

interface FanmarkInfo {
  id: string;
  user_input_fanmark: string;
  short_id: string;
  status: string;
  tier_level: number | null;
}

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
  display_fanmark: string | null;
  fanmarks: FanmarkInfo[] | null;
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
    
    // Validate inputs using shared validation
    const fanmarkIdResult = validateUuid(body?.fanmark_id, 'fanmark_id');
    if (!fanmarkIdResult.success) {
      return createValidationErrorResponse(corsHeaders, fanmarkIdResult.errors || []);
    }
    const fanmarkId = fanmarkIdResult.data!;
    
    const monthsResult = validatePositiveInt(body?.months, 'months', { min: 1, max: 12 });
    if (!monthsResult.success) {
      return createValidationErrorResponse(corsHeaders, monthsResult.errors || []);
    }
    const months = monthsResult.data!;

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
        display_fanmark,
        fanmarks!inner (
          id,
          user_input_fanmark,
          short_id,
          status,
          tier_level
        )
      `)
      .eq('fanmark_id', fanmarkId)
      .eq('user_id', authData.user.id)
      .in('status', ['active', 'grace'])
      .order('license_end', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (licenseError) {
      logSafeError('fetch_license_for_extension', licenseError);
      return createGenericErrorResponse(corsHeaders, 500);
    }

    if (!license) {
      return new Response(JSON.stringify({ error: 'No eligible license found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const licenseRecord: LicenseWithFanmark = license as unknown as LicenseWithFanmark;
    const fanmarkData = licenseRecord.fanmarks?.[0] ?? null;
    const displayFanmark = licenseRecord.display_fanmark ?? '';

    if (fanmarkData?.status !== 'active') {
      return new Response(JSON.stringify({ error: 'Fanmark is not active' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const tierLevel = fanmarkData?.tier_level ?? null;
    if (!tierLevel) {
      return new Response(JSON.stringify({ error: 'Tier information not found for this fanmark' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: pricing, error: pricingError } = await supabase
      .from('fanmark_tier_extension_prices')
      .select('price_yen, is_active')
      .eq('tier_level', tierLevel)
      .eq('months', months)
      .maybeSingle();

    if (pricingError) {
      logSafeError('fetch_tier_pricing', pricingError);
      return createGenericErrorResponse(corsHeaders, 500);
    }

    if (!pricing || pricing.is_active === false) {
      return new Response(JSON.stringify({ error: 'Selected plan is not available' }), {
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

    if (!licenseRecord.license_end) {
      return new Response(JSON.stringify({ error: 'Perpetual licenses do not require extension' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Check for active transfer
    const { data: hasTransfer } = await supabase.rpc('has_active_transfer', {
      license_uuid: licenseRecord.id
    });

    if (hasTransfer) {
      return new Response(JSON.stringify({ 
        error: 'transfer_in_progress' 
      }), {
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
    const roundedDate = roundUpToNextUtcMidnight(extendedDate);
    const newLicenseEndIso = roundedDate.toISOString();

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

    // Cancel all pending lottery entries for this license (if any)
    const { data: pendingEntries, error: entriesError } = await supabase
      .from('fanmark_lottery_entries')
      .select('id, user_id')
      .eq('license_id', licenseRecord.id)
      .eq('entry_status', 'pending');

    if (entriesError) {
      console.warn('Failed to fetch pending lottery entries:', entriesError);
    }

    if (pendingEntries && pendingEntries.length > 0) {
      console.log(`Cancelling ${pendingEntries.length} pending lottery entries due to license extension`);

      // Cancel all pending entries
      const { error: cancelError } = await supabase
        .from('fanmark_lottery_entries')
        .update({
          entry_status: 'cancelled_by_extension',
          cancelled_at: new Date().toISOString(),
          cancellation_reason: 'license_extended',
        })
        .eq('license_id', licenseRecord.id)
        .eq('entry_status', 'pending');

      if (cancelError) {
        console.error('Failed to cancel lottery entries:', cancelError);
      } else {
        console.log('✓ Lottery entries cancelled successfully');

        // Send notifications to each applicant
        for (const entry of pendingEntries) {
          const { error: notificationError } = await supabase.rpc('create_notification_event', {
            event_type_param: 'lottery_cancelled_by_extension',
            payload_param: {
              user_id: entry.user_id,
              fanmark_id: licenseRecord.fanmark_id,
              fanmark_name: displayFanmark,
              extended_by_user_id: authData.user.id,
            },
            source_param: 'edge_function',
          });

          if (notificationError) {
            console.warn(`Failed to create notification for user ${entry.user_id}:`, notificationError);
          }
        }
      }

      // Log the lottery cancellation
      const { error: lotteryAuditError } = await supabase
        .from('audit_logs')
        .insert({
          user_id: authData.user.id,
          action: 'LICENSE_EXTENDED_LOTTERY_CANCELLED',
          resource_type: 'fanmark_license',
          resource_id: licenseRecord.id,
          metadata: {
            fanmark_id: licenseRecord.fanmark_id,
            cancelled_entries_count: pendingEntries.length,
          },
        });

      if (lotteryAuditError) {
        console.warn('Failed to insert lottery cancellation audit log:', lotteryAuditError);
      }
    }

    return new Response(JSON.stringify({
      success: true,
      license: updated,
      price_yen: pricing.price_yen,
      tier_level: tierLevel,
      cancelled_lottery_entries: pendingEntries?.length || 0,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    logSafeError('extend_fanmark_license', error);
    return createGenericErrorResponse(corsHeaders, 500);
  }
});
