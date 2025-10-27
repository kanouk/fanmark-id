import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Round up to next UTC midnight (0:00:00.000)
function roundUpToNextUtcMidnight(input: Date): Date {
  const d = new Date(input);
  if (
    d.getUTCHours() === 0 &&
    d.getUTCMinutes() === 0 &&
    d.getUTCSeconds() === 0 &&
    d.getUTCMilliseconds() === 0
  ) {
    return d; // Already at UTC midnight
  }
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

serve(async (req) => {
  const startTime = Date.now();
  console.log('=== LICENSE EXPIRATION CHECK STARTED ===', new Date().toISOString());
  
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Environment check
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    
    console.log('Environment check:', {
      hasUrl: !!supabaseUrl,
      hasKey: !!supabaseKey,
      urlPrefix: supabaseUrl.substring(0, 30)
    });

    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Missing required environment variables');
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    console.log('✓ Supabase client initialized');

    // Get grace period from system settings (should be 1 day = 24 hours for cooldown)
    console.log('Fetching grace period setting...');
    const { data: gracePeriodData, error: gracePeriodError } = await supabase
      .from('system_settings')
      .select('setting_value')
      .eq('setting_key', 'grace_period_days')
      .single();
    
    if (gracePeriodError) {
      console.error('ERROR fetching grace period:', gracePeriodError);
      throw new Error(`Failed to fetch grace period: ${gracePeriodError.message}`);
    }

    const gracePeriodDaysRaw = gracePeriodData?.setting_value ? parseInt(gracePeriodData.setting_value, 10) : NaN;
    const gracePeriodDays = Number.isFinite(gracePeriodDaysRaw) && gracePeriodDaysRaw > 0 ? gracePeriodDaysRaw : 1;
    const gracePeriodHours = gracePeriodDays * 24; // Convert to hours for precise control
    const gracePeriodMs = gracePeriodHours * 60 * 60 * 1000;
    const now = new Date();
    
    console.log(`✓ Grace period: ${gracePeriodDays} days (${gracePeriodHours} hours)`);
    
    // For licenses that are in grace status, check if they've exceeded the grace period
    // Grace period starts from license_end date
    const graceDeadlineTime = now.getTime();

    console.log('Querying for expired licenses...');
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
          user_input_fanmark,
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
            user_input_fanmark: string;
            status: string;
          };
        }> | null;
        error: any;
      };

    // Find licenses in grace period that need to be fully expired
    // Use grace_expires_at for direct comparison (no calculation needed)
    const { data: graceExpiredLicenses, error: graceExpiredError } = await supabase
      .from('fanmark_licenses')
      .select(`
        id,
        fanmark_id,
        user_id,
        license_end,
        grace_expires_at,
        fanmarks!inner(
          id,
          user_input_fanmark,
          status
        )
      `)
      .eq('status', 'grace')
      .lte('grace_expires_at', now.toISOString())
      .eq('fanmarks.status', 'active') as {
        data: Array<{
          id: string;
          fanmark_id: string;
          user_id: string;
          license_end: string;
          grace_expires_at: string;
          fanmarks: {
            id: string;
            user_input_fanmark: string;
            status: string;
          };
        }> | null;
        error: any;
      };

    if (justExpiredError || graceExpiredError) {
      console.error('❌ ERROR fetching expired licenses:', justExpiredError || graceExpiredError);
      throw justExpiredError || graceExpiredError;
    }

    console.log(`✓ Query results: ${justExpiredLicenses?.length || 0} active->grace, ${graceExpiredLicenses?.length || 0} grace->expired ready`);

    // No filtering needed - grace_expires_at query already filtered correctly
    const filteredGraceExpiredLicenses = graceExpiredLicenses || [];

    const totalLicenses = (justExpiredLicenses?.length || 0) + filteredGraceExpiredLicenses.length;
    
    console.log(`✓ Total to process: ${totalLicenses} licenses`);
    
    if (totalLicenses === 0) {
      const elapsed = Date.now() - startTime;
      console.log(`✓ No expired licenses found (${elapsed}ms)`);
      return new Response(
        JSON.stringify({ 
          message: 'No expired licenses found',
          processed: 0,
          grace_period_hours: gracePeriodHours
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Processing: ${justExpiredLicenses?.length || 0} active->grace, ${filteredGraceExpiredLicenses.length} grace->expired`);

    let processedCount = 0;
    let graceSuccessCount = 0;
    let expiredSuccessCount = 0;
    const errors: Array<{type: string; id: string; error: string}> = [];

    // Process licenses that just expired (move to grace)
    if (justExpiredLicenses && justExpiredLicenses.length > 0) {
      console.log(`\n--- Processing ${justExpiredLicenses.length} licenses: active -> grace ---`);
      
      for (const license of justExpiredLicenses) {
        try {
          // Calculate grace_expires_at (license_end + grace_period_days)
          // Round up to next UTC midnight for consistent batch processing
          const licenseEndDate = new Date(license.license_end);
          const base = new Date(licenseEndDate);
          base.setDate(base.getDate() + gracePeriodDays);
          const graceExpiresAt = roundUpToNextUtcMidnight(base);

          // Mark license as in grace period with grace_expires_at
          const { error: licenseUpdateError } = await supabase
            .from('fanmark_licenses')
            .update({ 
              status: 'grace',
              grace_expires_at: graceExpiresAt.toISOString(),
              is_returned: false
            })
            .eq('id', license.id);

          if (licenseUpdateError) {
            const errMsg = licenseUpdateError.message || 'Unknown error';
            console.error(`  ❌ Failed ${license.id}: ${errMsg}`);
            errors.push({type: 'grace_update', id: license.id, error: errMsg});
            continue;
          }

          // Log the grace period start
          const { error: auditError } = await supabase
            .from('audit_logs')
            .insert({
              user_id: license.user_id,
              action: 'license_grace_started',
              resource_type: 'fanmark_license',
              resource_id: license.id,
              metadata: {
                fanmark_id: license.fanmark_id,
                grace_started_at: now.toISOString(),
                license_end: license.license_end,
                grace_expires_at: graceExpiresAt.toISOString()
              }
            });

          if (auditError) {
            console.warn(`  ⚠️ Audit log failed for ${license.id}: ${auditError.message}`);
          }

          // Create notification event for grace period start
          const { error: notificationError } = await supabase.rpc('create_notification_event', {
            event_type_param: 'license_grace_started',
            payload_param: {
              user_id: license.user_id,
              fanmark_id: license.fanmark_id,
              fanmark_name: license.fanmarks?.user_input_fanmark,
              license_end: license.license_end,
              grace_expires_at: graceExpiresAt.toISOString()
            },
            source_param: 'cron_job',
            dedupe_key_param: `grace_${license.id}_${licenseEndDate.getTime()}`
          });

          if (notificationError) {
            console.warn(`  ⚠️ Notification event failed for ${license.id}: ${notificationError.message}`);
          }

          processedCount++;
          graceSuccessCount++;
        console.log(`  ✓ ${license.fanmarks?.user_input_fanmark} -> grace`);

        } catch (error) {
          const errMsg = error instanceof Error ? error.message : 'Unknown error';
          console.error(`  ❌ Exception processing ${license.id}: ${errMsg}`);
          errors.push({type: 'grace_exception', id: license.id, error: errMsg});
        }
      }
    }

    // Process licenses whose grace period has expired
    if (filteredGraceExpiredLicenses.length > 0) {
      console.log(`\n--- Processing ${filteredGraceExpiredLicenses.length} licenses: grace -> expired ---`);
      
      for (const license of filteredGraceExpiredLicenses) {
        try {
          // Check for pending lottery entries
          const { data: pendingEntries, error: entriesError } = await supabase
            .from('fanmark_lottery_entries')
            .select('id, user_id, lottery_probability')
            .eq('license_id', license.id)
            .eq('entry_status', 'pending');

          if (entriesError) {
            console.error(`  ❌ Failed to fetch lottery entries for ${license.id}:`, entriesError);
            errors.push({type: 'lottery_fetch_error', id: license.id, error: entriesError.message});
            continue;
          }

          const entryCount = pendingEntries?.length || 0;
          console.log(`  ${license.fanmarks?.user_input_fanmark}: ${entryCount} lottery entries`);

          if (entryCount === 0) {
            // No lottery entries - proceed with normal expiration
            const { error: licenseUpdateError } = await supabase
              .from('fanmark_licenses')
              .update({ 
                status: 'expired',
                excluded_at: new Date().toISOString()
              })
              .eq('id', license.id);

            if (licenseUpdateError) {
              const errMsg = licenseUpdateError.message || 'Unknown error';
              console.error(`  ❌ Failed ${license.id}: ${errMsg}`);
              errors.push({type: 'expired_update', id: license.id, error: errMsg});
              continue;
            }

            console.log(`  ✓ ${license.fanmarks?.user_input_fanmark} marked as expired (no lottery)`);

          } else if (entryCount === 1) {
            // Single entry - automatic winner
            const winner = pendingEntries[0];
            console.log(`  → Single applicant, automatic winner: ${winner.user_id}`);

            // Get tier info for license duration
            const { data: fanmarkData } = await supabase
              .from('fanmarks')
              .select('tier_level')
              .eq('id', license.fanmark_id)
              .single();

            const { data: tierData } = await supabase
              .from('fanmark_tiers')
              .select('initial_license_days')
              .eq('tier_level', fanmarkData?.tier_level || 1)
              .single();

            const licenseDays = tierData?.initial_license_days || 30;
            const newLicenseEnd = new Date();
            newLicenseEnd.setDate(newLicenseEnd.getDate() + licenseDays);

            // Create new license for winner
            const { data: newLicense, error: newLicenseError } = await supabase
              .from('fanmark_licenses')
              .insert({
                fanmark_id: license.fanmark_id,
                user_id: winner.user_id,
                license_start: new Date().toISOString(),
                license_end: newLicenseEnd.toISOString(),
                status: 'active',
                is_initial_license: false,
              })
              .select()
              .single();

            if (newLicenseError) {
              console.error(`  ❌ Failed to create new license:`, newLicenseError);
              errors.push({type: 'new_license_error', id: license.id, error: newLicenseError.message});
              continue;
            }

            // Update winner entry
            await supabase
              .from('fanmark_lottery_entries')
              .update({ 
                entry_status: 'won',
                won_at: new Date().toISOString(),
                lottery_executed_at: new Date().toISOString()
              })
              .eq('id', winner.id);

            // Create lottery history
            await supabase
              .from('fanmark_lottery_history')
              .insert({
                fanmark_id: license.fanmark_id,
                license_id: license.id,
                total_entries: 1,
                winner_user_id: winner.user_id,
                winner_entry_id: winner.id,
                probability_distribution: [{ user_id: winner.user_id, lottery_probability: winner.lottery_probability }],
                execution_method: 'automatic',
              });

            // Send winner notification
            await supabase.rpc('create_notification_event', {
              event_type_param: 'lottery_won',
              payload_param: {
                user_id: winner.user_id,
                fanmark_id: license.fanmark_id,
                fanmark_name: license.fanmarks?.user_input_fanmark,
                license_id: newLicense.id,
                license_end: newLicenseEnd.toISOString(),
              },
              source_param: 'cron_job',
            });

            // Mark old license as expired
            await supabase
              .from('fanmark_licenses')
              .update({ 
                status: 'expired',
                excluded_at: new Date().toISOString()
              })
              .eq('id', license.id);

            console.log(`  ✓ ${license.fanmarks?.user_input_fanmark} awarded to ${winner.user_id}`);

          } else {
            // Multiple entries - run weighted random lottery
            console.log(`  → Running weighted lottery for ${entryCount} applicants`);

            // Calculate weighted random selection
            const totalWeight = pendingEntries.reduce((sum, e) => sum + Number(e.lottery_probability), 0);
            const random = Math.random() * totalWeight;
            
            let累積 = 0;
            let winnerId = pendingEntries[pendingEntries.length - 1].user_id;
            let winnerEntryId = pendingEntries[pendingEntries.length - 1].id;
            
            for (const entry of pendingEntries) {
              累積 += Number(entry.lottery_probability);
              if (random <= 累積) {
                winnerId = entry.user_id;
                winnerEntryId = entry.id;
                break;
              }
            }

            console.log(`  → Winner selected: ${winnerId} (random: ${random.toFixed(4)}, total: ${totalWeight})`);

            // Get tier info
            const { data: fanmarkData } = await supabase
              .from('fanmarks')
              .select('tier_level')
              .eq('id', license.fanmark_id)
              .single();

            const { data: tierData } = await supabase
              .from('fanmark_tiers')
              .select('initial_license_days')
              .eq('tier_level', fanmarkData?.tier_level || 1)
              .single();

            const licenseDays = tierData?.initial_license_days || 30;
            const newLicenseEnd = new Date();
            newLicenseEnd.setDate(newLicenseEnd.getDate() + licenseDays);

            // Create new license for winner
            const { data: newLicense, error: newLicenseError } = await supabase
              .from('fanmark_licenses')
              .insert({
                fanmark_id: license.fanmark_id,
                user_id: winnerId,
                license_start: new Date().toISOString(),
                license_end: newLicenseEnd.toISOString(),
                status: 'active',
                is_initial_license: false,
              })
              .select()
              .single();

            if (newLicenseError) {
              console.error(`  ❌ Failed to create new license:`, newLicenseError);
              errors.push({type: 'new_license_error', id: license.id, error: newLicenseError.message});
              continue;
            }

            // Update winner entry
            await supabase
              .from('fanmark_lottery_entries')
              .update({ 
                entry_status: 'won',
                won_at: new Date().toISOString(),
                lottery_executed_at: new Date().toISOString()
              })
              .eq('id', winnerEntryId);

            // Update loser entries
            await supabase
              .from('fanmark_lottery_entries')
              .update({ 
                entry_status: 'lost',
                lottery_executed_at: new Date().toISOString()
              })
              .eq('license_id', license.id)
              .eq('entry_status', 'pending')
              .neq('id', winnerEntryId);

            // Create lottery history
            const probabilityDist = pendingEntries.map(e => ({
              user_id: e.user_id,
              lottery_probability: Number(e.lottery_probability),
            }));

            await supabase
              .from('fanmark_lottery_history')
              .insert({
                fanmark_id: license.fanmark_id,
                license_id: license.id,
                total_entries: entryCount,
                winner_user_id: winnerId,
                winner_entry_id: winnerEntryId,
                probability_distribution: probabilityDist,
                random_seed: crypto.randomUUID(),
                execution_method: 'automatic',
              });

            // Send notifications
            for (const entry of pendingEntries) {
              const isWinner = entry.user_id === winnerId;
              await supabase.rpc('create_notification_event', {
                event_type_param: isWinner ? 'lottery_won' : 'lottery_lost',
                payload_param: {
                  user_id: entry.user_id,
                  fanmark_id: license.fanmark_id,
                  fanmark_name: license.fanmarks?.user_input_fanmark,
                  license_id: isWinner ? newLicense.id : undefined,
                  license_end: isWinner ? newLicenseEnd.toISOString() : undefined,
                  total_applicants: entryCount,
                },
                source_param: 'cron_job',
              });
            }

            // Mark old license as expired
            await supabase
              .from('fanmark_licenses')
              .update({ 
                status: 'expired',
                excluded_at: new Date().toISOString()
              })
              .eq('id', license.id);

            console.log(`  ✓ ${license.fanmarks?.user_input_fanmark} lottery completed, winner: ${winnerId}`);
          }

          // Delete all config data for expired licenses
          let configDeleteErrors = 0;
          
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
            configDeleteErrors++;
            console.warn(`  ⚠️ Config deletion errors for ${license.id}:`, {
              basic: basicConfigDeleteError?.message,
              redirect: redirectConfigDeleteError?.message,
              message: messageConfigDeleteError?.message,
              password: passwordConfigDeleteError?.message
            });
          } else {
            console.log(`  ✓ Configs deleted`);
          }

          // Log the full expiration event
          const { error: auditError } = await supabase
            .from('audit_logs')
            .insert({
              user_id: license.user_id,
              action: 'license_expired',
              resource_type: 'fanmark_license',
              resource_id: license.id,
              metadata: {
                fanmark_id: license.fanmark_id,
                expired_at: new Date().toISOString(),
                license_end: license.license_end,
                config_deletion_errors: configDeleteErrors
              }
            });

          if (auditError) {
            console.warn(`  ⚠️ Audit log failed for ${license.id}: ${auditError.message}`);
          }

          // Create notification event for license expiration
          const { error: notificationError } = await supabase.rpc('create_notification_event', {
            event_type_param: 'license_expired',
            payload_param: {
              user_id: license.user_id,
              fanmark_id: license.fanmark_id,
              fanmark_name: license.fanmarks?.user_input_fanmark,
              expired_at: new Date().toISOString(),
              license_end: license.license_end
            },
            source_param: 'cron_job',
            dedupe_key_param: `expired_${license.id}_${new Date(license.license_end).getTime()}`
          });

          if (notificationError) {
            console.warn(`  ⚠️ Notification event failed for ${license.id}: ${notificationError.message}`);
          }

          processedCount++;
          expiredSuccessCount++;

        } catch (error) {
          const errMsg = error instanceof Error ? error.message : 'Unknown error';
          console.error(`  ❌ Exception processing ${license.id}: ${errMsg}`);
          errors.push({type: 'expired_exception', id: license.id, error: errMsg});
        }
      }
    }

    const elapsed = Date.now() - startTime;
    
    console.log('\n=== PROCESSING COMPLETE ===');
    console.log(`Total processed: ${processedCount}`);
    console.log(`  Active -> Grace: ${graceSuccessCount}`);
    console.log(`  Grace -> Expired: ${expiredSuccessCount}`);
    console.log(`  Errors: ${errors.length}`);
    console.log(`Elapsed time: ${elapsed}ms`);
    
    if (errors.length > 0) {
      console.log('\nErrors encountered:');
      errors.forEach(err => console.log(`  ${err.type} [${err.id}]: ${err.error}`));
    }

    return new Response(
      JSON.stringify({ 
        success: true,
        message: `Successfully processed ${processedCount} licenses`,
        processed: processedCount,
        details: {
          active_to_grace: graceSuccessCount,
          grace_to_expired: expiredSuccessCount,
          found: {
            active_expired: justExpiredLicenses?.length || 0,
            grace_expired: filteredGraceExpiredLicenses.length,
            total: totalLicenses
          }
        },
        grace_period_hours: gracePeriodHours,
        elapsed_ms: elapsed,
        errors: errors.length > 0 ? errors : undefined
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    const elapsed = Date.now() - startTime;
    console.error('\n=== FATAL ERROR ===');
    console.error('Error in check-expired-licenses function:', error);
    console.error(`Elapsed time: ${elapsed}ms`);
    
    const message = error instanceof Error ? error.message : 'Internal server error';
    const stack = error instanceof Error ? error.stack : undefined;
    
    return new Response(
      JSON.stringify({ 
        success: false,
        error: message,
        stack: stack,
        elapsed_ms: elapsed
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
