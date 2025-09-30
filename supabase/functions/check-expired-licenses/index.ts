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

    // Get grace period from system settings (should be 1 day = 24 hours for cooldown)
    const { data: gracePeriodData } = await supabase
      .from('system_settings')
      .select('setting_value')
      .eq('setting_key', 'grace_period_days')
      .single();
    
    const gracePeriodDays = parseInt(gracePeriodData?.setting_value || '1', 10);
    const gracePeriodHours = gracePeriodDays * 24; // Convert to hours for precise control
    const gracePeriodMs = gracePeriodHours * 60 * 60 * 1000;
    const now = new Date();
    
    console.log(`Grace period set to ${gracePeriodDays} days (${gracePeriodHours} hours)`);
    
    // For licenses that are in grace status, check if they've exceeded the grace period
    // Grace period starts from license_end date
    const graceDeadlineTime = now.getTime();

    // Find licenses that just expired (need to go to grace)
    const { data: justExpiredLicenses, error: justExpiredError } = await supabase
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
      .lt('license_end', now.toISOString())
      .eq('fanmarks.status', 'active') as { 
        data: Array<{
          id: string;
          fanmark_id: string;
          user_id: string;
          license_end: string;
          fanmarks: {
            id: string;
            emoji_combination: string;
            status: string;
          };
        }> | null;
        error: any;
      };

    // Find licenses in grace period that need to be fully expired
    // Grace period is 24 hours from the license_end date
    const { data: graceExpiredLicenses, error: graceExpiredError } = await supabase
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
      .eq('status', 'grace')
      .eq('fanmarks.status', 'active') as {
        data: Array<{
          id: string;
          fanmark_id: string;
          user_id: string;
          license_end: string;
          fanmarks: {
            id: string;
            emoji_combination: string;
            status: string;
          };
        }> | null;
        error: any;
      };

    if (justExpiredError || graceExpiredError) {
      console.error('Error fetching expired licenses:', justExpiredError || graceExpiredError);
      throw justExpiredError || graceExpiredError;
    }

    // Filter grace expired licenses - check if grace period (24 hours from license_end) has passed
    const filteredGraceExpiredLicenses = graceExpiredLicenses?.filter(license => {
      const licenseEndTime = new Date(license.license_end).getTime();
      const graceEndTime = licenseEndTime + gracePeriodMs;
      return graceDeadlineTime >= graceEndTime;
    }) || [];

    const totalLicenses = (justExpiredLicenses?.length || 0) + filteredGraceExpiredLicenses.length;
    
    if (totalLicenses === 0) {
      console.log('No expired licenses found');
      return new Response(
        JSON.stringify({ 
          message: 'No expired licenses found',
          processed: 0,
          grace_period_hours: gracePeriodHours
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Found ${justExpiredLicenses?.length || 0} licenses to move to grace and ${filteredGraceExpiredLicenses.length} grace licenses to expire`);

    let processedCount = 0;

    // Process licenses that just expired (move to grace)
    if (justExpiredLicenses) {
      for (const license of justExpiredLicenses) {
        try {
          // Mark license as in grace period
          const { error: licenseUpdateError } = await supabase
            .from('fanmark_licenses')
            .update({ status: 'grace' })
            .eq('id', license.id);

          if (licenseUpdateError) {
            console.error(`Error updating license ${license.id} to grace:`, licenseUpdateError);
            continue;
          }

          // Log the grace period start
          await supabase
            .from('audit_logs')
            .insert({
              user_id: license.user_id,
              action: 'license_grace_started',
              resource_type: 'fanmark_license',
              resource_id: license.id,
              metadata: {
                fanmark_id: license.fanmark_id,
                grace_started_at: new Date().toISOString(),
                license_end: license.license_end
              }
            });

          processedCount++;
          console.log(`Moved license to grace period for fanmark: ${license.fanmarks?.emoji_combination}`);

        } catch (error) {
          console.error(`Error processing license ${license.id} for grace:`, error);
        }
      }
    }

    // Process licenses whose grace period has expired
    if (filteredGraceExpiredLicenses.length > 0) {
      for (const license of filteredGraceExpiredLicenses) {
        try {
          // Mark license as fully expired and set excluded_at to current time
          const { error: licenseUpdateError } = await supabase
            .from('fanmark_licenses')
            .update({ 
              status: 'expired',
              excluded_at: new Date().toISOString()
            })
            .eq('id', license.id);

          if (licenseUpdateError) {
            console.error(`Error updating license ${license.id} to expired:`, licenseUpdateError);
            continue;
          }

          // Delete all config data for expired licenses
          const { error: basicConfigDeleteError } = await supabase
            .from('fanmark_basic_configs')
            .delete()
            .eq('license_id', license.id);

          const { error: redirectConfigDeleteError } = await supabase
            .from('fanmark_redirect_configs')
            .delete()
            .eq('license_id', license.id);

          const { error: messageConfigDeleteError } = await supabase
            .from('fanmark_messageboard_configs')
            .delete()
            .eq('license_id', license.id);

          const { error: passwordConfigDeleteError } = await supabase
            .from('fanmark_password_configs')
            .delete()
            .eq('license_id', license.id);

          // Note: Keep fanmark record but configs are now deleted
          if (basicConfigDeleteError || redirectConfigDeleteError || messageConfigDeleteError || passwordConfigDeleteError) {
            console.error(`Error deleting configs for license ${license.id}:`, {
              basicConfigDeleteError,
              redirectConfigDeleteError, 
              messageConfigDeleteError,
              passwordConfigDeleteError
            });
          }


          // Log the full expiration event
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
          console.log(`Fully expired license for fanmark: ${license.fanmarks?.emoji_combination}`);

        } catch (error) {
          console.error(`Error processing license ${license.id} for expiration:`, error);
        }
      }
    }

    console.log(`Processed ${processedCount} expired licenses`);

    return new Response(
      JSON.stringify({ 
        message: `Successfully processed ${processedCount} licenses`,
        processed: processedCount,
        licenses_to_grace: justExpiredLicenses?.length || 0,
        licenses_to_expired: filteredGraceExpiredLicenses.length,
        total_found: totalLicenses,
        grace_period_hours: gracePeriodHours
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