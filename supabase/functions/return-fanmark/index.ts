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

    // Fetch the fanmark and verify ownership
    const { data: fanmark, error: fetchError } = await supabase
      .from('fanmarks')
      .select('id, user_id, emoji_combination, current_license_id')
      .eq('id', fanmark_id)
      .maybeSingle();

    if (fetchError) {
      console.error('Error fetching fanmark:', fetchError);
      return new Response(JSON.stringify({ error: 'Failed to fetch fanmark' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!fanmark || fanmark.user_id !== userId) {
      return new Response(JSON.stringify({ error: 'Fanmark not found or not owned by user' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Expire current license if exists
    if (fanmark.current_license_id) {
      const { error: licenseError } = await supabase
        .from('fanmark_licenses')
        .update({ status: 'expired' })
        .eq('id', fanmark.current_license_id);

      if (licenseError) {
        console.warn('Failed to expire license:', licenseError);
        // continue anyway
      }
    }

    // Update the fanmark to inactive and clear license
    const { error: fanmarkUpdateError } = await supabase
      .from('fanmarks')
      .update({ status: 'inactive', access_type: 'inactive', current_license_id: null })
      .eq('id', fanmark_id);

    if (fanmarkUpdateError) {
      console.error('Fanmark update error:', fanmarkUpdateError);
      return new Response(JSON.stringify({ error: 'Failed to update fanmark' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

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