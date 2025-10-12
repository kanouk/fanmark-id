import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

// Helper utilities shared across return-related edge functions

const GRACE_PERIOD_SETTING_KEY = 'grace_period_days';

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

export function roundUpToNextUtcMidnight(input: Date): Date {
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

export interface ReturnContext {
  supabase: SupabaseClient;
  userId: string;
}

export interface ReturnResult {
  licenseId: string;
  fanmarkId: string;
  fanmark: string;
  graceExpiresAt: string;
}

async function fetchGracePeriodDays(ctx: ReturnContext): Promise<number> {
  const { data, error } = await ctx.supabase
    .from('system_settings')
    .select('setting_value')
    .eq('setting_key', GRACE_PERIOD_SETTING_KEY)
    .maybeSingle();

  if (error) {
    console.error('Failed to fetch grace period setting:', error);
    throw new Error('Failed to fetch grace period setting');
  }

  const gracePeriodDaysRaw = data?.setting_value ? parseInt(data.setting_value, 10) : NaN;
  return Number.isFinite(gracePeriodDaysRaw) && gracePeriodDaysRaw > 0 ? gracePeriodDaysRaw : 1;
}

async function logReturnAction(
  ctx: ReturnContext,
  fanmarkId: string,
  fanmark: string,
  graceExpiresAt: string,
  nowIso: string,
): Promise<void> {
  const { error: auditError } = await ctx.supabase
    .from('audit_logs')
    .insert({
      user_id: ctx.userId,
      action: 'return_fanmark',
      resource_type: 'fanmark',
      resource_id: fanmarkId,
      metadata: {
        user_input_fanmark: fanmark,
        returned_at: nowIso,
        grace_expires_at: graceExpiresAt,
      },
    });

  if (auditError) {
    console.warn('Audit log insert failed:', auditError);
  }
}

async function transitionLicenseToGrace(
  ctx: ReturnContext,
  licenseId: string,
  nowIso: string,
  graceExpiresAtIso: string,
): Promise<void> {
  const { error: updateError } = await ctx.supabase
    .from('fanmark_licenses')
    .update({
      status: 'grace',
      license_end: nowIso,
      grace_expires_at: graceExpiresAtIso,
      is_returned: true,
      excluded_at: null,
    })
    .eq('id', licenseId);

  if (updateError) {
    console.error('Failed to update license to grace:', updateError);
    throw new Error('Failed to update license status');
  }
}

async function fetchLicenseWithFanmark(
  ctx: ReturnContext,
  licenseId: string,
) {
  const { data, error } = await ctx.supabase
    .from('fanmark_licenses')
    .select(
      `id, fanmark_id, user_id, status, license_end,
       fanmarks ( id, user_input_fanmark )`
    )
    .eq('id', licenseId)
    .maybeSingle();

  if (error) {
    console.error('Failed to fetch license:', error);
    throw new Error('Failed to fetch license');
  }

  return data as
    | ({
        id: string;
        fanmark_id: string;
        user_id: string;
        status: string;
        license_end: string;
        fanmarks: { id: string; user_input_fanmark: string } | null;
      })
    | null;
}

export async function returnFanmarkByLicenseId(
  ctx: ReturnContext,
  licenseId: string,
): Promise<ReturnResult> {
  const license = await fetchLicenseWithFanmark(ctx, licenseId);

  if (!license || license.user_id !== ctx.userId) {
    throw new Error('License not found');
  }

  if (license.status !== 'active') {
    throw new Error('License is not active');
  }

  const now = new Date();
  const nowIso = now.toISOString();
  const gracePeriodDays = await fetchGracePeriodDays(ctx);

  const graceBase = new Date(now);
  graceBase.setDate(graceBase.getDate() + gracePeriodDays);
  const graceExpiresAt = roundUpToNextUtcMidnight(graceBase);
  const graceExpiresAtIso = graceExpiresAt.toISOString();

  await transitionLicenseToGrace(ctx, license.id, nowIso, graceExpiresAtIso);

  const fanmark = license.fanmarks?.user_input_fanmark ?? '';
  await logReturnAction(ctx, license.fanmark_id, fanmark, graceExpiresAtIso, nowIso);

  return {
    licenseId: license.id,
    fanmarkId: license.fanmark_id,
    fanmark,
    graceExpiresAt: graceExpiresAtIso,
  };
}

export async function returnFanmarkByFanmarkId(
  ctx: ReturnContext,
  fanmarkId: string,
): Promise<ReturnResult> {
  const { data: license, error: licenseError } = await ctx.supabase
    .from('fanmark_licenses')
    .select('id')
    .eq('fanmark_id', fanmarkId)
    .eq('user_id', ctx.userId)
    .eq('status', 'active')
    .gt('license_end', new Date().toISOString())
    .maybeSingle();

  if (licenseError) {
    console.error('Failed to fetch license by fanmark:', licenseError);
    throw new Error('Failed to fetch license');
  }

  if (!license) {
    throw new Error('No active license found for this fanmark');
  }

  return returnFanmarkByLicenseId(ctx, license.id);
}

export function createSupabaseClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  return createClient(url, key);
}
