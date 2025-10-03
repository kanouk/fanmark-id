import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ReturnRequestBody {
  fanmark_id: string;
}

serve(async (req) => {
  // Handle CORS preflight
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

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

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

    const { fanmark_id }: ReturnRequestBody = await req.json();
    if (!fanmark_id) {
      return new Response(JSON.stringify({ error: 'fanmark_id is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const userId = authData.user.id;

    // Fetch the fanmark
    const { data: fanmark, error: fetchError } = await supabase
      .from('fanmarks')
      .select('id, emoji_combination')
      .eq('id', fanmark_id)
      .maybeSingle();

    if (fetchError) {
      console.error('Error fetching fanmark:', fetchError);
      return new Response(JSON.stringify({ error: 'Failed to fetch fanmark' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!fanmark) {
      return new Response(JSON.stringify({ error: 'Fanmark not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Find active license for this fanmark owned by current user
    const { data: activeLicense, error: licenseError } = await supabase
      .from('fanmark_licenses')
      .select('id, user_id')
      .eq('fanmark_id', fanmark_id)
      .eq('user_id', userId)
      .eq('status', 'active')
      .gt('license_end', new Date().toISOString())
      .maybeSingle();

    if (licenseError) {
      console.error('Error fetching license:', licenseError);
      return new Response(JSON.stringify({ error: 'Failed to fetch license' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!activeLicense) {
      return new Response(JSON.stringify({ error: 'No active license found for this fanmark' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Expire the license and record the actual exclusion time
    const now = new Date().toISOString();
    const { error: expireLicenseError } = await supabase
      .from('fanmark_licenses')
      .update({ 
        status: 'expired',
        excluded_at: now
      })
      .eq('id', activeLicense.id);

    if (expireLicenseError) {
      console.error('Failed to expire license:', expireLicenseError);
      return new Response(JSON.stringify({ error: 'Failed to expire license' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Set access_type to inactive in basic config
    const { error: basicConfigError } = await supabase
      .from('fanmark_basic_configs')
      .update({ access_type: 'inactive' })
      .eq('fanmark_id', fanmark_id);

    if (basicConfigError) {
      console.warn('Failed to update basic config:', basicConfigError);
    }

    // Clean up configuration tables using license_id
    const deleteOperations = [
      supabase.from('fanmark_redirect_configs').delete().eq('license_id', activeLicense.id),
      supabase.from('fanmark_messageboard_configs').delete().eq('license_id', activeLicense.id),
      supabase.from('fanmark_password_configs').delete().eq('license_id', activeLicense.id)
    ];

    const deleteResults = await Promise.allSettled(deleteOperations);
    deleteResults.forEach((result, index) => {
      if (result.status === 'rejected') {
        console.warn(`Failed to delete config ${index}:`, result.reason);
      }
    });

    // Log the return action
    const { error: auditError } = await supabase
      .from('audit_logs')
      .insert({
        user_id: userId,
        action: 'return_fanmark',
        resource_type: 'fanmark',
        resource_id: fanmark_id,
        metadata: {
          fanmark_emoji: fanmark.emoji_combination,
          returned_at: new Date().toISOString(),
        },
      });

    if (auditError) {
      console.warn('Audit log insert failed:', auditError);
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Unexpected error in return-fanmark:', error);
    const message = error instanceof Error ? error.message : 'Internal error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});