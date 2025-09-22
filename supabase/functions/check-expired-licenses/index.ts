import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    console.log('Starting expired license check...');

    // Find all expired licenses that are still active
    const { data: expiredLicenses, error: fetchError } = await supabase
      .from('fanmark_licenses')
      .select(`
        id,
        fanmark_id,
        user_id,
        license_end,
        fanmarks!inner(
          id,
          emoji_combination,
          status
        )
      `)
      .eq('status', 'active')
      .lt('license_end', new Date().toISOString())
      .eq('fanmarks.status', 'active');

    if (fetchError) {
      console.error('Error fetching expired licenses:', fetchError);
      throw fetchError;
    }

    if (!expiredLicenses || expiredLicenses.length === 0) {
      console.log('No expired licenses found');
      return new Response(
        JSON.stringify({ 
          message: 'No expired licenses found',
          processed: 0 
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Found ${expiredLicenses.length} expired licenses to process`);

    let processedCount = 0;

    // Process each expired license
    for (const license of expiredLicenses) {
      try {
        // Mark license as expired
        const { error: licenseUpdateError } = await supabase
          .from('fanmark_licenses')
          .update({ status: 'expired' })
          .eq('id', license.id);

        if (licenseUpdateError) {
          console.error(`Error updating license ${license.id}:`, licenseUpdateError);
          continue;
        }

        // Update fanmark status to inactive and clear current_license_id
        const { error: fanmarkUpdateError } = await supabase
          .from('fanmarks')
          .update({ 
            status: 'inactive',
            current_license_id: null,
            access_type: 'inactive'
          })
          .eq('id', license.fanmark_id);

        if (fanmarkUpdateError) {
          console.error(`Error updating fanmark ${license.fanmark_id}:`, fanmarkUpdateError);
          continue;
        }

        // Log the expiration event
        await supabase
          .from('audit_logs')
          .insert({
            user_id: license.user_id,
            action: 'license_expired',
            resource_type: 'fanmark_license',
            resource_id: license.id,
            metadata: {
              fanmark_id: license.fanmark_id,
              expired_at: new Date().toISOString(),
              license_end: license.license_end
            }
          });

        processedCount++;
        console.log(`Processed expired license for fanmark: ${license.fanmarks?.emoji_combination}`);

      } catch (error) {
        console.error(`Error processing license ${license.id}:`, error);
      }
    }

    console.log(`Processed ${processedCount} expired licenses`);

    return new Response(
      JSON.stringify({ 
        message: `Successfully processed ${processedCount} expired licenses`,
        processed: processedCount,
        total_found: expiredLicenses.length
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in check-expired-licenses function:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});