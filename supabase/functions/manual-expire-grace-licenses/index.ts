import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    console.log('Starting manual grace license expiration check');

    // Get all grace licenses that should be expired
    const { data: expiredGraceLicenses, error: fetchError } = await supabaseClient
      .from('fanmark_licenses')
      .select('id, fanmark_id, user_id, grace_expires_at')
      .eq('status', 'grace')
      .lt('grace_expires_at', new Date().toISOString());

    if (fetchError) {
      console.error('Error fetching expired grace licenses:', fetchError);
      throw fetchError;
    }

    console.log(`Found ${expiredGraceLicenses?.length || 0} expired grace licenses`);

    if (!expiredGraceLicenses || expiredGraceLicenses.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          message: 'No expired grace licenses found',
          count: 0,
        }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        }
      );
    }

    const results = [];

    for (const license of expiredGraceLicenses) {
      console.log(`Processing license ${license.id} for fanmark ${license.fanmark_id}`);

      // Update license to expired
      const { error: updateError } = await supabaseClient
        .from('fanmark_licenses')
        .update({
          status: 'expired',
          updated_at: new Date().toISOString(),
        })
        .eq('id', license.id);

      if (updateError) {
        console.error(`Failed to update license ${license.id}:`, updateError);
        results.push({
          license_id: license.id,
          success: false,
          error: updateError.message,
        });
        continue;
      }

      // Delete associated configs
      await supabaseClient.from('fanmark_basic_configs').delete().eq('license_id', license.id);
      await supabaseClient.from('fanmark_redirect_configs').delete().eq('license_id', license.id);
      await supabaseClient.from('fanmark_messageboard_configs').delete().eq('license_id', license.id);
      await supabaseClient.from('fanmark_password_configs').delete().eq('license_id', license.id);

      // Log audit event
      await supabaseClient.from('audit_logs').insert({
        user_id: license.user_id,
        action: 'MANUAL_LICENSE_EXPIRATION',
        resource_type: 'fanmark_license',
        resource_id: license.id,
        metadata: {
          fanmark_id: license.fanmark_id,
          grace_expires_at: license.grace_expires_at,
          expired_by: 'manual_admin_action',
        },
      });

      results.push({
        license_id: license.id,
        fanmark_id: license.fanmark_id,
        success: true,
      });

      console.log(`Successfully expired license ${license.id}`);
    }

    const successCount = results.filter(r => r.success).length;
    const failureCount = results.filter(r => !r.success).length;

    return new Response(
      JSON.stringify({
        success: true,
        message: `Processed ${expiredGraceLicenses.length} licenses`,
        successCount,
        failureCount,
        results,
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (error) {
    console.error('Fatal error in manual-expire-grace-licenses:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
});
