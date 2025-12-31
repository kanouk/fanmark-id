import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MIN_REMAINING_HOURS = 48;
const TRANSFER_CODE_EXPIRATION_HOURS = 48;

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

    const userId = authData.user.id;
    const body = await req.json();
    const { license_id, disclaimer_agreed } = body;

    console.log('Generate transfer code request:', { license_id, disclaimer_agreed, userId });

    // Validate disclaimer agreement
    if (disclaimer_agreed !== true) {
      return new Response(JSON.stringify({ error: 'disclaimer_required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!license_id) {
      return new Response(JSON.stringify({ error: 'license_id is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Fetch license with fanmark info
    const { data: license, error: licenseError } = await supabase
      .from('fanmark_licenses')
      .select(`
        id,
        fanmark_id,
        user_id,
        status,
        license_end,
        transfer_locked_until,
        display_fanmark,
        fanmarks!inner (
          id,
          user_input_fanmark,
          short_id,
          tier_level
        )
      `)
      .eq('id', license_id)
      .eq('user_id', userId)
      .eq('status', 'active')
      .maybeSingle();

    if (licenseError) {
      console.error('License fetch error:', licenseError);
      return new Response(JSON.stringify({ error: 'Failed to fetch license' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!license) {
      return new Response(JSON.stringify({ error: 'license_not_found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const fanmark = (license.fanmarks as any)?.[0] || license.fanmarks;
    const displayFanmark = license.display_fanmark ?? '';
    const now = new Date();

    if (license.transfer_locked_until) {
      const lockedUntil = new Date(license.transfer_locked_until);
      if (!Number.isNaN(lockedUntil.getTime()) && lockedUntil > now) {
        return new Response(JSON.stringify({
          error: 'transfer_locked',
          locked_until: license.transfer_locked_until,
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // Check remaining license period (at least 48 hours)
    // For Tier C (unlimited), license_end is null
    if (license.license_end) {
      const licenseEnd = new Date(license.license_end);
      const remainingHours = (licenseEnd.getTime() - now.getTime()) / (1000 * 60 * 60);
      
      if (remainingHours < MIN_REMAINING_HOURS) {
        return new Response(JSON.stringify({ 
          error: 'insufficient_remaining_time',
          message: `License must have at least ${MIN_REMAINING_HOURS} hours remaining`
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // Check for existing applied status code (cannot issue new code)
    const { data: appliedCode, error: appliedError } = await supabase
      .from('fanmark_transfer_codes')
      .select('id')
      .eq('license_id', license_id)
      .eq('status', 'applied')
      .maybeSingle();

    if (appliedError) {
      console.error('Applied code check error:', appliedError);
    }

    if (appliedCode) {
      return new Response(JSON.stringify({ error: 'transfer_pending_approval' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Cancel any existing active codes
    const { error: cancelError } = await supabase
      .from('fanmark_transfer_codes')
      .update({ status: 'cancelled', updated_at: now.toISOString() })
      .eq('license_id', license_id)
      .eq('status', 'active');

    if (cancelError) {
      console.warn('Failed to cancel existing codes:', cancelError);
    }

    // Calculate expiration
    const maxExpiresAt = new Date(now);
    maxExpiresAt.setHours(maxExpiresAt.getHours() + TRANSFER_CODE_EXPIRATION_HOURS);

    let expiresAt: Date;
    if (license.license_end) {
      const licenseEnd = new Date(license.license_end);
      expiresAt = new Date(Math.min(licenseEnd.getTime(), maxExpiresAt.getTime()));
    } else {
      // Tier C (unlimited) - cap at transfer window only
      expiresAt = maxExpiresAt;
    }

    // Generate transfer code
    const { data: codeString, error: codeGenError } = await supabase.rpc('generate_transfer_code_string');
    
    if (codeGenError || !codeString) {
      console.error('Code generation error:', codeGenError);
      return new Response(JSON.stringify({ error: 'Failed to generate transfer code' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Insert new transfer code
    const { data: newCode, error: insertError } = await supabase
      .from('fanmark_transfer_codes')
      .insert({
        license_id: license_id,
        fanmark_id: license.fanmark_id,
        issuer_user_id: userId,
        transfer_code: codeString,
        status: 'active',
        expires_at: expiresAt.toISOString(),
        disclaimer_agreed_at: now.toISOString(),
      })
      .select()
      .single();

    if (insertError) {
      console.error('Insert error:', insertError);
      return new Response(JSON.stringify({ error: 'Failed to create transfer code' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Audit log
    await supabase.from('audit_logs').insert({
      user_id: userId,
      action: 'TRANSFER_CODE_ISSUED',
      resource_type: 'fanmark_transfer_code',
      resource_id: newCode.id,
      metadata: {
        license_id,
        fanmark_id: license.fanmark_id,
        fanmark_name: displayFanmark,
        expires_at: expiresAt.toISOString(),
      },
    });

    console.log('Transfer code generated:', { codeId: newCode.id, code: codeString });

    return new Response(JSON.stringify({
      success: true,
      transfer_code: codeString,
      transfer_code_id: newCode.id,
      expires_at: expiresAt.toISOString(),
      fanmark_name: displayFanmark,
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
