import assert from "node:assert/strict";
import test from "node:test";
import { configuredSocialProviders } from "../src/auth-social.mjs";

const credentials = {
  GOOGLE_OAUTH_CLIENT_ID: "synthetic-google-client-id",
  GOOGLE_OAUTH_CLIENT_SECRET: "synthetic-google-client-secret",
  GITHUB_OAUTH_CLIENT_ID: "synthetic-github-client-id",
  GITHUB_OAUTH_CLIENT_SECRET: "synthetic-github-client-secret",
  DISCORD_OAUTH_CLIENT_ID: "synthetic-discord-client-id",
  DISCORD_OAUTH_CLIENT_SECRET: "synthetic-discord-client-secret",
  APPLE_OAUTH_CLIENT_ID: "synthetic-apple-client-id",
  APPLE_OAUTH_CLIENT_SECRET: "synthetic-apple-client-secret",
};

test("social login stays disabled unless the Better Auth selector is explicit", () => {
  assert.deepEqual(configuredSocialProviders(credentials), {});
});

test("only complete provider credentials are exposed and signup stays disabled", () => {
  assert.deepEqual(configuredSocialProviders({
    AUTH_SOCIAL_BACKEND: "better-auth",
    ...credentials,
    DISCORD_OAUTH_CLIENT_SECRET: undefined,
  }), {
    google: {
      clientId: credentials.GOOGLE_OAUTH_CLIENT_ID,
      clientSecret: credentials.GOOGLE_OAUTH_CLIENT_SECRET,
      disableSignUp: true,
    },
    github: {
      clientId: credentials.GITHUB_OAUTH_CLIENT_ID,
      clientSecret: credentials.GITHUB_OAUTH_CLIENT_SECRET,
      disableSignUp: true,
    },
    apple: {
      clientId: credentials.APPLE_OAUTH_CLIENT_ID,
      clientSecret: credentials.APPLE_OAUTH_CLIENT_SECRET,
      disableSignUp: true,
    },
  });
});

test("all four providers become available only with the explicit selector and complete pairs", () => {
  const providers = configuredSocialProviders({ AUTH_SOCIAL_BACKEND: "better-auth", ...credentials });
  assert.deepEqual(Object.keys(providers).sort(), ["apple", "discord", "github", "google"]);
  assert.ok(Object.values(providers).every((provider) => provider.disableSignUp === true));
});
