export type SocialProviderName = "google" | "github" | "discord" | "apple";

export interface ConfiguredSocialProvider {
  clientId: string;
  clientSecret: string;
  disableSignUp: true;
}

export type ConfiguredSocialProviders = Partial<Record<SocialProviderName, ConfiguredSocialProvider>>;

export interface SocialAuthEnvironment {
  AUTH_SOCIAL_BACKEND?: string;
  GOOGLE_OAUTH_CLIENT_ID?: string;
  GOOGLE_OAUTH_CLIENT_SECRET?: string;
  GITHUB_OAUTH_CLIENT_ID?: string;
  GITHUB_OAUTH_CLIENT_SECRET?: string;
  DISCORD_OAUTH_CLIENT_ID?: string;
  DISCORD_OAUTH_CLIENT_SECRET?: string;
  APPLE_OAUTH_CLIENT_ID?: string;
  APPLE_OAUTH_CLIENT_SECRET?: string;
}

export function configuredSocialProviders(env: SocialAuthEnvironment): ConfiguredSocialProviders;
