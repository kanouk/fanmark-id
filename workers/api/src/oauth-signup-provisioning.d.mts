import type { ConfiguredSocialProvider, ConfiguredSocialProviders, SocialProviderName } from "./auth-social.mjs";

interface ProvisioningProvider extends Omit<ConfiguredSocialProvider, "disableSignUp"> {
  disableSignUp: boolean;
  getUserInfo?: (tokens: unknown) => Promise<unknown>;
}

export function isOAuthSignupSchemaReady(
  authDatabase: D1Database | undefined,
  businessDatabase: D1Database | undefined,
): Promise<boolean>;

export function createOAuthSignupIntegration(
  env: { AUTH_DB: D1Database; FANMARK_DB?: D1Database },
  socialProviders: ConfiguredSocialProviders,
  provisioningEnabled?: boolean,
): { plugin: unknown; socialProviders: Partial<Record<SocialProviderName, ProvisioningProvider>> };
