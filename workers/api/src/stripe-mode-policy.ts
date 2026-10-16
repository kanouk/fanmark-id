import type { Env } from "./repository.ts";

export type StripeModePolicy = "dual" | "test_only";

export function readStripeModePolicy(env: Pick<Env, "STRIPE_MODE_POLICY">): StripeModePolicy {
  const value = env.STRIPE_MODE_POLICY?.trim();
  if (!value) return "dual";
  if (value === "test_only") return value;
  throw new Error("stripe_mode_policy_invalid");
}

export interface StripeBillingCredential {
  secret: string;
  livemode: boolean;
}

/**
 * Resolve the key selected by the billing APIs. The unset policy preserves
 * the existing dual-mode behavior; test-only requires the generic key to be
 * the configured test key and refuses any live key in the environment.
 */
export function resolveStripeBillingCredential(env: Env): StripeBillingCredential | null {
  const policy = readStripeModePolicy(env);
  const secret = env.STRIPE_SECRET_KEY?.trim() ?? "";
  const testSecret = env.STRIPE_SECRET_KEY_TEST?.trim() ?? "";
  const liveSecret = env.STRIPE_SECRET_KEY_LIVE?.trim() ?? "";

  if (policy === "test_only") {
    if (liveSecret || !testSecret.startsWith("sk_test_") || secret !== testSecret) return null;
    return { secret, livemode: false };
  }

  const livemode = secret.startsWith("sk_live_");
  const matchesMode = livemode
    ? secret === liveSecret
    : secret.startsWith("sk_test_") && secret === testSecret;
  if (!matchesMode || !testSecret.startsWith("sk_test_") || !liveSecret.startsWith("sk_live_")) return null;
  return { secret, livemode };
}

/** Check the policy for Stripe paths that select their mode from a key/row. */
export function stripeSecretAllowedByModePolicy(
  env: Env,
  secret: string,
  livemode: boolean,
): boolean {
  const policy = readStripeModePolicy(env);
  if (policy !== "test_only") return true;
  const testSecret = env.STRIPE_SECRET_KEY_TEST?.trim() ?? "";
  const liveSecret = env.STRIPE_SECRET_KEY_LIVE?.trim() ?? "";
  return !livemode && !liveSecret && secret === testSecret && testSecret.startsWith("sk_test_");
}

export function stripeModeAllowedByPolicy(env: Env, livemode: boolean): boolean {
  const policy = readStripeModePolicy(env);
  if (policy !== "test_only") return true;
  return !livemode && !(env.STRIPE_SECRET_KEY_LIVE?.trim());
}
