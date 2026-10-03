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

function booleanSetting(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/^"([\s\S]*)"$/u, "$1").toLowerCase();
  if (["true", "1", "on"].includes(normalized)) return true;
  if (["false", "0", "off"].includes(normalized)) return false;
  return null;
}

// This policy belongs to Business D1, independently of email/signup readiness.
// Do not cache it with the Auth instance: settings can change during OAuth.
export async function isSocialLoginAllowed(database) {
  if (!database) return false;
  try {
    const result = await database.prepare(`SELECT setting_key, setting_value
      FROM system_settings
      WHERE setting_key IN ('social_login_enabled', 'invitation_mode')`).all();
    if (result.success !== true || !Array.isArray(result.results) || result.results.length !== 2) return false;
    const values = new Map(result.results.map(row => [row.setting_key, booleanSetting(row.setting_value)]));
    return values.get("social_login_enabled") === true && values.get("invitation_mode") === false;
  } catch {
    return false;
  }
}
