import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import {
  corsHeaders,
  createSupabaseClient,
  returnFanmarkByLicenseId,
  type ReturnContext,
  type ReturnResult,
} from "../_shared/return-helpers.ts";
import {
  validateUuidArray,
  logSafeError,
  createGenericErrorResponse,
  createValidationErrorResponse,
} from "../_shared/validation.ts";

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
    
    // Validate license_ids using shared validation
    const licenseIdsResult = validateUuidArray(body.license_ids, 'license_ids', { minLength: 1, maxLength: 50 });
    if (!licenseIdsResult.success) {
      return createValidationErrorResponse(corsHeaders, licenseIdsResult.errors || []);
    }
    const licenseIds = licenseIdsResult.data!;

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
    logSafeError('bulk_return_fanmarks', error);
    return createGenericErrorResponse(corsHeaders, 500);
  }
});

