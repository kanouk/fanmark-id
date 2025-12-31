import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Round up to next UTC midnight for consistent license expiration
function roundUpToNextUtcMidnight(input: Date): Date {
  const d = new Date(input);
  d.setUTCHours(0, 0, 0, 0);
  if (d.getTime() < input.getTime()) {
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return d;
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

    const approverId = authData.user.id;
    const body = await req.json();
    const { request_id, transferredFanmarkName } = body;

    console.log('Approve transfer request:', { request_id, approverId });

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
        fanmark_transfer_codes!inner (
          id,
          issuer_user_id,
          status,
          expires_at
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

    // Verify approver is the issuer
    if (transferCode.issuer_user_id !== approverId) {
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

    // Verify license is still active
    const { data: oldLicense, error: licenseError } = await supabase
      .from('fanmark_licenses')
      .select(`
        id,
        fanmark_id,
        user_id,
        status,
        license_end,
        fanmarks!inner (
          id,
          user_input_fanmark,
          normalized_emoji,
          short_id,
          tier_level
        )
      `)
      .eq('id', request.license_id)
      .maybeSingle();

    if (licenseError || !oldLicense) {
      return new Response(JSON.stringify({ error: 'license_not_found' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (oldLicense.status !== 'active') {
      // Cancel the request since license is no longer active
      await supabase
        .from('fanmark_transfer_requests')
        .update({ status: 'cancelled', resolved_at: now.toISOString() })
        .eq('id', request_id);

      await supabase
        .from('fanmark_transfer_codes')
        .update({ status: 'expired' })
        .eq('id', request.transfer_code_id);

      return new Response(JSON.stringify({ error: 'license_no_longer_active' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const fanmark = (oldLicense.fanmarks as any)?.[0] || oldLicense.fanmarks;
    const tierLevel = fanmark?.tier_level || 1;
    const normalizedDisplayFanmark = fanmark?.normalized_emoji ?? null;

    // Fetch license duration from fanmark_tiers table
    const { data: tierData, error: tierError } = await supabase
      .from('fanmark_tiers')
      .select('initial_license_days')
      .eq('tier_level', tierLevel)
      .maybeSingle();

    if (tierError) {
      console.error('Failed to fetch tier data:', tierError);
      return new Response(JSON.stringify({ error: 'Failed to determine license duration' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const licenseDays = tierData?.initial_license_days;
    let newLicenseEnd: string | null = null;
    if (licenseDays !== null && licenseDays !== undefined) {
      const endDate = new Date(now);
      endDate.setDate(endDate.getDate() + licenseDays);
      const roundedDate = roundUpToNextUtcMidnight(endDate);
      newLicenseEnd = roundedDate.toISOString();
    }

    console.log('License duration:', { tierLevel, licenseDays, newLicenseEnd });

    // === BEGIN TRANSFER TRANSACTION ===

    // 1. Expire old license
    const { error: expireError } = await supabase
      .from('fanmark_licenses')
      .update({
        status: 'expired',
        is_returned: true,
        license_end: now.toISOString(),
        excluded_at: now.toISOString(),
      })
      .eq('id', oldLicense.id);

    if (expireError) {
      console.error('Failed to expire old license:', expireError);
      return new Response(JSON.stringify({ error: 'Failed to process transfer' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const transferLockedUntil = new Date(now);
    transferLockedUntil.setDate(transferLockedUntil.getDate() + 30);

    // 2. Create new license for recipient (no config copy - new acquisition state)
    const { data: newLicense, error: newLicenseError } = await supabase
      .from('fanmark_licenses')
      .insert({
        fanmark_id: oldLicense.fanmark_id,
        user_id: request.requester_user_id,
        license_start: now.toISOString(),
        license_end: newLicenseEnd,
        display_fanmark: normalizedDisplayFanmark,
        status: 'active',
        is_initial_license: false,
        is_transferred: true,
        transfer_locked_until: transferLockedUntil.toISOString(),
      })
      .select()
      .single();

    if (newLicenseError) {
      console.error('Failed to create new license:', newLicenseError);
      // Rollback old license
      await supabase
        .from('fanmark_licenses')
        .update({ status: 'active', is_returned: false, license_end: oldLicense.license_end, excluded_at: null })
        .eq('id', oldLicense.id);

      return new Response(JSON.stringify({ error: 'Failed to create new license' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 3. Delete old config data (no copy - recipient starts fresh)
    await supabase.from('fanmark_basic_configs').delete().eq('license_id', oldLicense.id);
    await supabase.from('fanmark_redirect_configs').delete().eq('license_id', oldLicense.id);
    await supabase.from('fanmark_messageboard_configs').delete().eq('license_id', oldLicense.id);
    await supabase.from('fanmark_password_configs').delete().eq('license_id', oldLicense.id);
    await supabase.from('fanmark_profiles').delete().eq('license_id', oldLicense.id);

    // 3.5. Create initial config for new license with default transferred name
    await supabase.from('fanmark_basic_configs').insert({
      license_id: newLicense.id,
      fanmark_name: transferredFanmarkName || null,
      access_type: 'inactive',
    });

    // 4. Update transfer code and request status
    await supabase
      .from('fanmark_transfer_codes')
      .update({ status: 'completed', updated_at: now.toISOString() })
      .eq('id', request.transfer_code_id);

    await supabase
      .from('fanmark_transfer_requests')
      .update({ status: 'approved', resolved_at: now.toISOString() })
      .eq('id', request_id);

    // 5. Cancel any pending lottery entries
    await supabase
      .from('fanmark_lottery_entries')
      .update({
        entry_status: 'cancelled',
        cancelled_at: now.toISOString(),
        cancellation_reason: 'license_transferred',
      })
      .eq('license_id', oldLicense.id)
      .eq('entry_status', 'pending');

    // === END TRANSFER TRANSACTION ===

    // Audit log
    await supabase.from('audit_logs').insert({
      user_id: approverId,
      action: 'LICENSE_TRANSFERRED',
      resource_type: 'fanmark_license',
      resource_id: newLicense.id,
      metadata: {
        old_license_id: oldLicense.id,
        new_license_id: newLicense.id,
        from_user_id: approverId,
        to_user_id: request.requester_user_id,
        fanmark_id: oldLicense.fanmark_id,
        fanmark_name: normalizedDisplayFanmark,
        tier_level: tierLevel,
        new_license_end: newLicenseEnd,
        request_id: request_id,
      },
    });

    // Send notification to recipient
    await supabase.rpc('create_notification_event', {
      event_type_param: 'transfer_approved',
      payload_param: {
        user_id: request.requester_user_id,
        fanmark_id: oldLicense.fanmark_id,
        fanmark_name: normalizedDisplayFanmark,
        fanmark_short_id: fanmark?.short_id,
        license_id: newLicense.id,
        license_end: newLicenseEnd,
      },
      source_param: 'edge_function',
      dedupe_key_param: `transfer_approved_${request_id}`,
    });

    console.log('Transfer completed:', {
      oldLicenseId: oldLicense.id,
      newLicenseId: newLicense.id,
      recipientId: request.requester_user_id,
    });

    return new Response(JSON.stringify({
      success: true,
      new_license_id: newLicense.id,
      new_license_end: newLicenseEnd,
      fanmark_name: normalizedDisplayFanmark,
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
