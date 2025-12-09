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

    const userId = authData.user.id;
    const body = await req.json();
    const { transfer_code_id } = body;

    console.log('Cancel transfer code:', { transfer_code_id, userId });

    if (!transfer_code_id) {
      return new Response(JSON.stringify({ error: 'transfer_code_id is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const now = new Date();

    // Fetch the transfer code
    const { data: code, error: codeError } = await supabase
      .from('fanmark_transfer_codes')
      .select('id, issuer_user_id, status, license_id, fanmark_id')
      .eq('id', transfer_code_id)
      .maybeSingle();

    if (codeError) {
      console.error('Code fetch error:', codeError);
      return new Response(JSON.stringify({ error: 'Failed to fetch transfer code' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!code) {
      return new Response(JSON.stringify({ error: 'code_not_found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Verify ownership
    if (code.issuer_user_id !== userId) {
      return new Response(JSON.stringify({ error: 'not_authorized' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Check status - can only cancel active codes (not applied)
    if (code.status !== 'active') {
      return new Response(JSON.stringify({ 
        error: 'cannot_cancel',
        status: code.status,
        message: code.status === 'applied' 
          ? 'Cannot cancel code with pending application. Please reject the application first.'
          : 'Code is no longer active'
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Cancel the code
    const { error: updateError } = await supabase
      .from('fanmark_transfer_codes')
      .update({ status: 'cancelled', updated_at: now.toISOString() })
      .eq('id', transfer_code_id);

    if (updateError) {
      console.error('Update error:', updateError);
      return new Response(JSON.stringify({ error: 'Failed to cancel transfer code' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Audit log
    await supabase.from('audit_logs').insert({
      user_id: userId,
      action: 'TRANSFER_CODE_CANCELLED',
      resource_type: 'fanmark_transfer_code',
      resource_id: transfer_code_id,
      metadata: {
        license_id: code.license_id,
        fanmark_id: code.fanmark_id,
      },
    });

    console.log('Transfer code cancelled:', { codeId: transfer_code_id });

    return new Response(JSON.stringify({
      success: true,
      message: 'Transfer code cancelled',
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
