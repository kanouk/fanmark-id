import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Auth check
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

    const rejecterId = authData.user.id;
    const body = await req.json();
    const { request_id, reason } = body;

    console.log('Reject transfer request:', { request_id, rejecterId });

    if (!request_id) {
      return new Response(JSON.stringify({ error: 'request_id is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const now = new Date();

    // Fetch the request with related data
    const { data: request, error: requestError } = await supabase
      .from('fanmark_transfer_requests')
      .select(`
        id,
        transfer_code_id,
        license_id,
        fanmark_id,
        requester_user_id,
        status,
        fanmark_licenses!inner (
          id,
          fanmarks!inner (
            id,
            user_input_fanmark,
            short_id
          )
        ),
        fanmark_transfer_codes!inner (
          id,
          issuer_user_id,
          status
        )
      `)
      .eq('id', request_id)
      .maybeSingle();

    if (requestError) {
      console.error('Request fetch error:', requestError);
      return new Response(JSON.stringify({ error: 'Failed to fetch request' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!request) {
      return new Response(JSON.stringify({ error: 'request_not_found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const transferCode = (request.fanmark_transfer_codes as any)?.[0] || request.fanmark_transfer_codes;

    // Verify rejecter is the issuer
    if (transferCode.issuer_user_id !== rejecterId) {
      return new Response(JSON.stringify({ error: 'not_authorized' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Check request status
    if (request.status !== 'pending') {
      return new Response(JSON.stringify({ error: 'request_not_pending', status: request.status }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Update request status to rejected
    const { error: updateRequestError } = await supabase
      .from('fanmark_transfer_requests')
      .update({ 
        status: 'rejected', 
        resolved_at: now.toISOString(),
        rejection_reason: reason || null,
      })
      .eq('id', request_id);

    if (updateRequestError) {
      console.error('Request update error:', updateRequestError);
      return new Response(JSON.stringify({ error: 'Failed to reject request' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Revert code status to active (can be reused)
    await supabase
      .from('fanmark_transfer_codes')
      .update({ status: 'active', updated_at: now.toISOString() })
      .eq('id', request.transfer_code_id);

    // Audit log
    await supabase.from('audit_logs').insert({
      user_id: rejecterId,
      action: 'TRANSFER_REJECTED',
      resource_type: 'fanmark_transfer_request',
      resource_id: request_id,
      metadata: {
        transfer_code_id: request.transfer_code_id,
        license_id: request.license_id,
        fanmark_id: request.fanmark_id,
        requester_user_id: request.requester_user_id,
        reason: reason || null,
      },
    });

    // Get fanmark info for notification (aligned with approval flow)
    const license = (request.fanmark_licenses as any)?.[0] || request.fanmark_licenses;
    const fanmark = (license?.fanmarks as any)?.[0] || license?.fanmarks;

    // Send notification to requester
    await supabase.rpc('create_notification_event', {
      event_type_param: 'transfer_rejected',
      payload_param: {
        user_id: request.requester_user_id,
        fanmark_id: request.fanmark_id,
        fanmark_name: fanmark?.user_input_fanmark,
        fanmark_short_id: fanmark?.short_id,
        reason: reason || null,
      },
      source_param: 'edge_function',
      dedupe_key_param: `transfer_rejected_${request_id}`,
    });

    console.log('Transfer request rejected:', { requestId: request_id });

    return new Response(JSON.stringify({
      success: true,
      message: 'Transfer request rejected',
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Unexpected error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
