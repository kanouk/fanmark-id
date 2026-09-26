const SOCIAL_PROVIDER_ENV = {
  google: ["GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET"],
  github: ["GITHUB_OAUTH_CLIENT_ID", "GITHUB_OAUTH_CLIENT_SECRET"],
  discord: ["DISCORD_OAUTH_CLIENT_ID", "DISCORD_OAUTH_CLIENT_SECRET"],
  apple: ["APPLE_OAUTH_CLIENT_ID", "APPLE_OAUTH_CLIENT_SECRET"],
};

export function configuredSocialProviders(env) {
  if (env.AUTH_SOCIAL_BACKEND?.trim() !== "better-auth") return {};
  const providers = {};
  for (const [provider, [clientIdKey, clientSecretKey]] of Object.entries(SOCIAL_PROVIDER_ENV)) {
    const clientId = typeof env[clientIdKey] === "string" ? env[clientIdKey].trim() : "";
    const clientSecret = typeof env[clientSecretKey] === "string" ? env[clientSecretKey].trim() : "";
    if (clientId.length < 3 || clientSecret.length < 8) continue;
    providers[provider] = {
      clientId,
      clientSecret,
      disableSignUp: true,
    };
  }
  return providers;
}
