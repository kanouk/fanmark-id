import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import {
  corsHeaders,
  createSupabaseClient,
  roundUpToNextUtcMidnight,
} from "../_shared/return-helpers.ts";
import {
  validateUuid,
  logSafeError,
  createGenericErrorResponse,
  createValidationErrorResponse,
} from "../_shared/validation.ts";

interface FanmarkInfo {
  id: string;
  user_input_fanmark: string;
  short_id: string;
  status: string;
  tier_level: number | null;
}

interface LicenseWithFanmark {
  id: string;
  fanmark_id: string;
  user_id: string;
  status: string;
  license_end: string | null;
  grace_expires_at: string | null;
  is_returned: boolean | null;
  fanmarks: FanmarkInfo[] | null;
}

interface CouponInfo {
  id: string;
  code: string;
  months: number;
  allowed_tier_levels: number[] | null;
  max_uses: number;
  used_count: number;
  expires_at: string | null;
  is_active: boolean;
}

interface ApplyCouponRequestBody {
  license_id?: string;
  coupon_code?: string;
}

const ALLOWED_MONTHS = new Set([1, 2, 3, 6]);

function addMonths(base: Date, months: number): Date {
  const result = new Date(base.getTime());
  const originalDate = result.getDate();
  result.setMonth(result.getMonth() + months);
  if (result.getDate() !== originalDate) {
    result.setDate(0);
  }
  return result;
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

    const supabase = createSupabaseClient();
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

    const body = (await req.json()) as ApplyCouponRequestBody | null;
    
    // Validate license_id (license is the true target of extension)
    const licenseIdResult = validateUuid(body?.license_id, 'license_id');
    if (!licenseIdResult.success) {
      return createValidationErrorResponse(corsHeaders, licenseIdResult.errors || []);
    }
    const licenseId = licenseIdResult.data!;
    
    // Validate coupon_code
    const couponCode = body?.coupon_code?.trim().toUpperCase();
    if (!couponCode || couponCode.length < 3) {
      return new Response(JSON.stringify({ error: 'invalid_coupon_code' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Fetch coupon (using service role to bypass RLS for atomic operations)
    const { data: coupon, error: couponError } = await supabase
      .from('extension_coupons')
      .select('*')
      .eq('code', couponCode)
      .eq('is_active', true)
      .maybeSingle();

    if (couponError) {
      logSafeError('fetch_coupon', couponError);
      return createGenericErrorResponse(corsHeaders, 500);
    }

    if (!coupon) {
      return new Response(JSON.stringify({ error: 'coupon_not_found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const couponInfo = coupon as CouponInfo;

    // Validate coupon expiration
    if (couponInfo.expires_at && new Date(couponInfo.expires_at) < new Date()) {
      return new Response(JSON.stringify({ error: 'coupon_expired' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Validate usage limit
    if (couponInfo.used_count >= couponInfo.max_uses) {
      return new Response(JSON.stringify({ error: 'coupon_usage_exceeded' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Validate months
    if (!ALLOWED_MONTHS.has(couponInfo.months)) {
      return new Response(JSON.stringify({ error: 'invalid_coupon_configuration' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Fetch the license by ID for the authenticated user
    const { data: license, error: licenseError } = await supabase
      .from('fanmark_licenses')
      .select(`
        id,
        fanmark_id,
        user_id,
        status,
        license_end,
        grace_expires_at,
        is_returned,
        fanmarks!inner (
          id,
          user_input_fanmark,
          short_id,
          status,
          tier_level
        )
      `)
      .eq('id', licenseId)
      .eq('user_id', authData.user.id)
      .in('status', ['active', 'grace'])
      .maybeSingle();

    if (licenseError) {
      logSafeError('fetch_license_for_coupon_extension', licenseError);
      return createGenericErrorResponse(corsHeaders, 500);
    }

    if (!license) {
      return new Response(JSON.stringify({ error: 'no_eligible_license' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const licenseRecord = license as unknown as LicenseWithFanmark;
    const fanmarkData = licenseRecord.fanmarks?.[0] ?? null;

    const tierLevel = fanmarkData?.tier_level ?? null;
    if (!tierLevel) {
      return new Response(JSON.stringify({ error: 'tier_not_found' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Validate tier restriction
    if (couponInfo.allowed_tier_levels && couponInfo.allowed_tier_levels.length > 0) {
      if (!couponInfo.allowed_tier_levels.includes(tierLevel)) {
        return new Response(JSON.stringify({ error: 'tier_not_allowed' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // Check if user already used this coupon on this fanmark
    const { data: existingUsage, error: usageCheckError } = await supabase
      .from('extension_coupon_usages')
      .select('id')
      .eq('coupon_id', couponInfo.id)
      .eq('user_id', authData.user.id)
      .eq('fanmark_id', licenseRecord.fanmark_id)
      .maybeSingle();

    if (usageCheckError) {
      logSafeError('check_existing_usage', usageCheckError);
    }

    if (existingUsage) {
      return new Response(JSON.stringify({ error: 'coupon_already_used_on_fanmark' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Check for active transfer
    const { data: hasTransfer } = await supabase.rpc('has_active_transfer', {
      license_uuid: licenseRecord.id
    });

    if (hasTransfer) {
      return new Response(JSON.stringify({ error: 'transfer_in_progress' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Perpetual licenses cannot be extended
    if (!licenseRecord.license_end) {
      return new Response(JSON.stringify({ error: 'perpetual_license' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Calculate new license end date
    const now = new Date();
    const licenseEnd = new Date(licenseRecord.license_end);
    const baseDate = licenseEnd > now ? licenseEnd : now;
    const extendedDate = addMonths(baseDate, couponInfo.months);
    const roundedDate = roundUpToNextUtcMidnight(extendedDate);
    const newLicenseEndIso = roundedDate.toISOString();

    // Update coupon used_count (atomically)
    const { error: couponUpdateError } = await supabase
      .from('extension_coupons')
      .update({ used_count: couponInfo.used_count + 1 })
      .eq('id', couponInfo.id)
      .eq('used_count', couponInfo.used_count); // Optimistic locking

    if (couponUpdateError) {
      logSafeError('update_coupon_count', couponUpdateError);
      return new Response(JSON.stringify({ error: 'coupon_update_failed' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Record usage
    const { error: usageInsertError } = await supabase
      .from('extension_coupon_usages')
      .insert({
        coupon_id: couponInfo.id,
        user_id: authData.user.id,
        fanmark_id: licenseRecord.fanmark_id,
        license_id: licenseRecord.id,
      });

    if (usageInsertError) {
      logSafeError('insert_coupon_usage', usageInsertError);
      // Rollback coupon count
      await supabase
        .from('extension_coupons')
        .update({ used_count: couponInfo.used_count })
        .eq('id', couponInfo.id);
      return new Response(JSON.stringify({ error: 'usage_record_failed' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Update license
    const { data: updated, error: updateError } = await supabase
      .from('fanmark_licenses')
      .update({
        status: 'active',
        license_end: newLicenseEndIso,
        grace_expires_at: null,
        is_returned: false,
        excluded_at: null,
        excluded_from_plan: null,
      })
      .eq('id', licenseRecord.id)
      .select('id, license_end, grace_expires_at, status')
      .maybeSingle();

    if (updateError) {
      console.error('Failed to update license during coupon extension:', updateError);
      return new Response(JSON.stringify({ error: 'license_update_failed' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Audit log
    const { error: auditError } = await supabase
      .from('audit_logs')
      .insert({
        user_id: authData.user.id,
        action: 'extend_fanmark_license_by_coupon',
        resource_type: 'fanmark_license',
        resource_id: licenseRecord.id,
        metadata: {
          fanmark_id: licenseRecord.fanmark_id,
          coupon_id: couponInfo.id,
          coupon_code: couponInfo.code,
          months: couponInfo.months,
          previous_license_end: licenseRecord.license_end,
          new_license_end: newLicenseEndIso,
        },
      });

    if (auditError) {
      console.warn('Failed to insert audit log for coupon extension:', auditError);
    }

    // Cancel all pending lottery entries for this license (if any)
    const { data: pendingEntries, error: entriesError } = await supabase
      .from('fanmark_lottery_entries')
      .select('id, user_id')
      .eq('license_id', licenseRecord.id)
      .eq('entry_status', 'pending');

    if (entriesError) {
      console.warn('Failed to fetch pending lottery entries:', entriesError);
    }

    if (pendingEntries && pendingEntries.length > 0) {
      console.log(`Cancelling ${pendingEntries.length} pending lottery entries due to coupon extension`);

      const { error: cancelError } = await supabase
        .from('fanmark_lottery_entries')
        .update({
          entry_status: 'cancelled_by_extension',
          cancelled_at: new Date().toISOString(),
          cancellation_reason: 'license_extended_by_coupon',
        })
        .eq('license_id', licenseRecord.id)
        .eq('entry_status', 'pending');

      if (cancelError) {
        console.error('Failed to cancel lottery entries:', cancelError);
      } else {
        console.log('✓ Lottery entries cancelled successfully');

        // Send notifications to each applicant
        for (const entry of pendingEntries) {
          const { error: notificationError } = await supabase.rpc('create_notification_event', {
            event_type_param: 'lottery_cancelled_by_extension',
            payload_param: {
              user_id: entry.user_id,
              fanmark_id: licenseRecord.fanmark_id,
              fanmark_name: fanmarkData?.user_input_fanmark,
              extended_by_user_id: authData.user.id,
            },
            source_param: 'edge_function',
          });

          if (notificationError) {
            console.warn(`Failed to create notification for user ${entry.user_id}:`, notificationError);
          }
        }
      }

      // Log the lottery cancellation
      const { error: lotteryAuditError } = await supabase
        .from('audit_logs')
        .insert({
          user_id: authData.user.id,
          action: 'COUPON_EXTENSION_LOTTERY_CANCELLED',
          resource_type: 'fanmark_license',
          resource_id: licenseRecord.id,
          metadata: {
            fanmark_id: licenseRecord.fanmark_id,
            cancelled_entries_count: pendingEntries.length,
            coupon_code: couponInfo.code,
          },
        });

      if (lotteryAuditError) {
        console.warn('Failed to insert lottery cancellation audit log:', lotteryAuditError);
      }
    }

    return new Response(JSON.stringify({
      success: true,
      license: updated,
      months: couponInfo.months,
      tier_level: tierLevel,
      cancelled_lottery_entries: pendingEntries?.length || 0,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    logSafeError('apply_extension_coupon', error);
    return createGenericErrorResponse(corsHeaders, 500);
  }
});
