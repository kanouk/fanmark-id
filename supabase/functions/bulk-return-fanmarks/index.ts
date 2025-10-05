import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import {
  corsHeaders,
  createSupabaseClient,
  returnFanmarkByLicenseId,
  type ReturnContext,
  type ReturnResult,
} from "../_shared/return-helpers.ts";

interface BulkReturnRequestBody {
  license_ids: string[];
}

interface BulkReturnResponse {
  success: boolean;
  results: ReturnResult[];
  failed?: Array<{ licenseId: string; error: string }>;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
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

    const body: BulkReturnRequestBody = await req.json();
    const licenseIds = Array.isArray(body.license_ids) ? body.license_ids : [];

    if (licenseIds.length === 0) {
      return new Response(JSON.stringify({ error: 'license_ids must be a non-empty array' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const ctx: ReturnContext = {
      supabase,
      userId: authData.user.id,
    };

    const results: ReturnResult[] = [];
    const failed: Array<{ licenseId: string; error: string }> = [];

    for (const licenseId of licenseIds) {
      try {
        const result = await returnFanmarkByLicenseId(ctx, licenseId);
        results.push(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        failed.push({ licenseId, error: message });
      }
    }

    const responsePayload: BulkReturnResponse = {
      success: failed.length === 0,
      results,
      failed: failed.length > 0 ? failed : undefined,
    };

    return new Response(JSON.stringify(responsePayload), {
      status: failed.length === 0 ? 200 : 207, // 207 Multi-Status for partial success
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Unexpected error in bulk-return-fanmarks:', error);
    const message = error instanceof Error ? error.message : 'Internal error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

