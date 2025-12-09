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

    const requesterId = authData.user.id;
    const body = await req.json();
    const { transfer_code, disclaimer_agreed } = body;

    console.log('Apply transfer code request:', { transfer_code, disclaimer_agreed, requesterId });

    // Validate disclaimer agreement
    if (disclaimer_agreed !== true) {
      return new Response(JSON.stringify({ error: 'disclaimer_required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!transfer_code || typeof transfer_code !== 'string') {
      return new Response(JSON.stringify({ error: 'transfer_code is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const normalizedCode = transfer_code.trim().toUpperCase();
    const now = new Date();

    // Find the transfer code
    const { data: codeData, error: codeError } = await supabase
      .from('fanmark_transfer_codes')
      .select(`
        id,
        license_id,
        fanmark_id,
        issuer_user_id,
        status,
        expires_at,
        fanmarks!inner (
          id,
          user_input_fanmark,
          short_id,
          tier_level
        )
      `)
      .eq('transfer_code', normalizedCode)
      .maybeSingle();

    if (codeError) {
      console.error('Code fetch error:', codeError);
      return new Response(JSON.stringify({ error: 'Failed to verify transfer code' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!codeData) {
      return new Response(JSON.stringify({ error: 'invalid_code' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Check code status
    if (codeData.status !== 'active') {
      return new Response(JSON.stringify({ error: 'code_not_active', status: codeData.status }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Check expiration
    if (new Date(codeData.expires_at) <= now) {
      // Update code status to expired
      await supabase
        .from('fanmark_transfer_codes')
        .update({ status: 'expired' })
        .eq('id', codeData.id);

      return new Response(JSON.stringify({ error: 'code_expired' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Check self-transfer
    if (codeData.issuer_user_id === requesterId) {
      return new Response(JSON.stringify({ error: 'self_transfer_not_allowed' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get requester display name first (needed for both limit check and insert)
    const { data: requesterSettings, error: requesterError } = await supabase
      .from('user_settings')
      .select('display_name, username, plan_type')
      .eq('user_id', requesterId)
      .maybeSingle();

    if (requesterError) {
      console.error('Requester settings fetch error:', requesterError);
    }

    const requesterUsername = requesterSettings?.username || 'unknown';
    const requesterName = requesterSettings?.display_name || requesterUsername;

    // Check fanmark limit for requester
    const planType = requesterSettings?.plan_type || 'free';
    const settingKeyMap: Record<string, string> = {
      free: 'max_fanmarks_per_user',
      creator: 'creator_fanmarks_limit',
      business: 'business_fanmarks_limit',
      enterprise: 'enterprise_fanmarks_limit',
      admin: 'max_fanmarks_limit',
      max: 'max_fanmarks_limit',
    };
    const settingKey = settingKeyMap[planType] || 'max_fanmarks_per_user';

    const { data: planSetting, error: planError } = await supabase
      .from('system_settings')
      .select('setting_value')
      .eq('setting_key', settingKey)
      .maybeSingle();

    // Default limits matching database configuration
    const defaultLimits: Record<string, number> = {
      free: 3,
      creator: 10,
      business: 50,
      enterprise: 100,
      admin: 500,
      max: 500,
    };

    const fanmarkLimit = planSetting?.setting_value 
      ? parseInt(planSetting.setting_value, 10) 
      : (defaultLimits[planType] || 3);

    console.log('Fanmark limit check:', { planType, settingKey, settingValue: planSetting?.setting_value, fanmarkLimit });

    // Count current fanmarks
    const { count: currentCount, error: countError } = await supabase
      .from('fanmark_licenses')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', requesterId)
      .eq('status', 'active')
      .or('license_end.is.null,license_end.gt.' + now.toISOString());

    if (countError) {
      console.error('Count error:', countError);
    }

    if ((currentCount || 0) >= fanmarkLimit) {
      return new Response(JSON.stringify({ 
        error: 'fanmark_limit_exceeded',
        current: currentCount,
        limit: fanmarkLimit
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Verify license is still active
    const { data: license, error: licenseError } = await supabase
      .from('fanmark_licenses')
      .select('id, status, license_end')
      .eq('id', codeData.license_id)
      .maybeSingle();

    if (licenseError || !license) {
      return new Response(JSON.stringify({ error: 'license_not_found' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (license.status !== 'active') {
      return new Response(JSON.stringify({ error: 'license_not_active' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Create transfer request with requester_username and display_name
    const { data: request, error: requestError } = await supabase
      .from('fanmark_transfer_requests')
      .insert({
        transfer_code_id: codeData.id,
        license_id: codeData.license_id,
        fanmark_id: codeData.fanmark_id,
        requester_user_id: requesterId,
        requester_username: requesterUsername,
        requester_display_name: requesterSettings?.display_name || null,
        status: 'pending',
        disclaimer_agreed_at: now.toISOString(),
        applied_at: now.toISOString(),
      })
      .select()
      .single();

    if (requestError) {
      console.error('Request insert error:', requestError);
      return new Response(JSON.stringify({ error: 'Failed to create transfer request' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Update code status to applied
    await supabase
      .from('fanmark_transfer_codes')
      .update({ status: 'applied', updated_at: now.toISOString() })
      .eq('id', codeData.id);

    // Audit log
    await supabase.from('audit_logs').insert({
      user_id: requesterId,
      action: 'TRANSFER_REQUESTED',
      resource_type: 'fanmark_transfer_request',
      resource_id: request.id,
      metadata: {
        transfer_code_id: codeData.id,
        license_id: codeData.license_id,
        fanmark_id: codeData.fanmark_id,
        issuer_user_id: codeData.issuer_user_id,
      },
    });

    // Send notification to issuer
    const fanmark = (codeData.fanmarks as any)?.[0] || codeData.fanmarks;

    await supabase.rpc('create_notification_event', {
      event_type_param: 'transfer_requested',
      payload_param: {
        user_id: codeData.issuer_user_id,
        fanmark_id: codeData.fanmark_id,
        fanmark_name: fanmark?.user_input_fanmark,
        requester_user_id: requesterId,
        requester_name: requesterName,
        request_id: request.id,
      },
      source_param: 'edge_function',
      dedupe_key_param: `transfer_requested_${request.id}`,
    });

    console.log('Transfer request created:', { requestId: request.id });

    return new Response(JSON.stringify({
      success: true,
      request_id: request.id,
      fanmark_name: fanmark?.user_input_fanmark,
      fanmark_short_id: fanmark?.short_id,
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
