import { env, exports as workerExports } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import schemaSql from "./fixtures/d1-public-access-contract.sql?raw";
import { handleRequest } from "../src";
import { createD1PublicAccessRepository } from "../src/public-access-d1-repository";
import type { Env } from "../src/repository";

const database = (env as unknown as Env).FANMARK_DB;
const masterDatabase = (env as unknown as Env).MASTER_DB;
const NOW = "2026-09-21T00:00:00.000000Z";
const CLOCK = () => new Date("2026-09-21T00:00:00.000Z");
const API_ORIGIN = "https://api.example.test";
const ALLOWED_ORIGIN = "https://app.example.test";
const configuredWorker = workerExports as unknown as {
  default: { fetch(request: Request): Promise<Response> };
};

const IDS = {
  emojiBase: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  emojiTone: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  emojiRocket: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  emojiFlower: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  emojiStar: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  emojiBulb: "ffffffff-ffff-4fff-8fff-ffffffffffff",
  emojiCloud: "12121212-1212-4121-8121-121212121212",
  emojiMoon: "13131313-1313-4131-8131-131313131313",
  emojiSun: "14141414-1414-4141-8141-141414141414",
  emojiLeaf: "15151515-1515-4151-8151-151515151515",
  emojiHeart: "16161616-1616-4161-8161-161616161616",
  emojiCheck: "17171717-1717-4171-8171-171717171717",
  emojiPair: "18181818-1818-4181-8181-181818181818",
  emojiLong: "19191919-1919-4191-8191-191919191919",
  fanmarkEmoji: "21111111-1111-4111-8111-111111111111",
  fanmarkText: "22222222-2222-4222-8222-222222222222",
  fanmarkShort: "23333333-3333-4333-8333-333333333333",
  fanmarkUnclaimed: "24444444-4444-4444-8444-444444444444",
  fanmarkGrace: "25555555-5555-4555-8555-555555555555",
  fanmarkIndefinite: "26666666-6666-4666-8666-666666666666",
  fanmarkProtectedText: "27777777-7777-4777-8777-777777777777",
  fanmarkProtectedProfile: "28888888-8888-4888-8888-888888888888",
  fanmarkPrivateProfile: "29999999-9999-4999-8999-999999999999",
  fanmarkInvalidUrl: "2a2a2a2a-2a2a-4a2a-8a2a-2a2a2a2a2a2a",
  fanmarkOversize: "2b2b2b2b-2b2b-4b2b-8b2b-2b2b2b2b2b2b",
};

const LICENSE = {
  emoji: "31111111-1111-4111-8111-111111111111",
  text: "32222222-2222-4222-8222-222222222222",
  shortFuture: "33333333-3333-4333-8333-333333333333",
  shortExpired: "34444444-4444-4444-8444-444444444444",
  shortIndefinite: "35555555-5555-4555-8555-555555555555",
  grace: "36666666-6666-4666-8666-666666666666",
  indefinite: "37777777-7777-4777-8777-777777777777",
  protectedText: "38888888-8888-4888-8888-888888888888",
  protectedProfile: "39999999-9999-4999-8999-999999999999",
  privateProfile: "3a3a3a3a-3a3a-4a3a-8a3a-3a3a3a3a3a3a",
  invalidUrl: "3b3b3b3b-3b3b-4b3b-8b3b-3b3b3b3b3b3b",
  oversize: "3c3c3c3c-3c3c-4c3c-8c3c-3c3c3c3c3c3c",
};

function statementsFrom(sql: string): string[] {
  return sql
    .split(/;\s*(?:\r?\n|$)/u)
    .map((statement) => statement.trim())
    .filter(Boolean);
}

function d1Environment(overrides: Partial<Env> = {}): Env {
  return {
    ...(env as unknown as Env),
    D1_TOPOLOGY: "split",
    FANMARK_DB: database,
    MASTER_DB: masterDatabase,
    PUBLIC_ACCESS_BACKEND: "d1",
    CORS_ALLOWED_ORIGINS: ALLOWED_ORIGIN,
    ...overrides,
  };
}

function request(
  path: string,
  init: RequestInit = {},
  requestEnv: Env = d1Environment(),
): Promise<Response> {
  return handleRequest(
    new Request(`${API_ORIGIN}${path}`, init),
    requestEnv,
    fetch,
    CLOCK,
    CLOCK,
  );
}

function jsonRequest(path: string, body: unknown, requestEnv?: Env): Promise<Response> {
  return request(
    path,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Origin: ALLOWED_ORIGIN,
      },
      body: JSON.stringify(body),
    },
    requestEnv,
  );
}

async function run(statement: string, ...bindings: unknown[]): Promise<void> {
  if (!database) throw new Error("FANMARK_DB binding is unavailable");
  await database.prepare(statement).bind(...bindings).run();
}

async function runMaster(statement: string, ...bindings: unknown[]): Promise<void> {
  if (!masterDatabase) throw new Error("MASTER_DB binding is unavailable");
  await masterDatabase.prepare(statement).bind(...bindings).run();
}

async function batch(statements: Array<{ sql: string; bindings: unknown[] }>): Promise<void> {
  if (!database) throw new Error("FANMARK_DB binding is unavailable");
  await database.batch(statements.map(({ sql, bindings }) => database.prepare(sql).bind(...bindings)));
}

async function seedFixture(): Promise<void> {
  await batch([
    { sql: "DELETE FROM fanmark_profiles", bindings: [] },
    { sql: "DELETE FROM fanmark_password_configs", bindings: [] },
    { sql: "DELETE FROM fanmark_messageboard_configs", bindings: [] },
    { sql: "DELETE FROM fanmark_redirect_configs", bindings: [] },
    { sql: "DELETE FROM fanmark_basic_configs", bindings: [] },
    { sql: "DELETE FROM fanmark_licenses", bindings: [] },
    { sql: "DELETE FROM fanmarks", bindings: [] },
    { sql: "DELETE FROM emoji_master", bindings: [] },
  ]);

  const masters = [
    [IDS.emojiBase, "😀", ["1F600"]],
    [IDS.emojiTone, "😀🏻", ["1F600", "1F3FB"]],
    [IDS.emojiRocket, "🚀", ["1F680"]],
    [IDS.emojiFlower, "🌸", ["1F338"]],
    [IDS.emojiStar, "⭐", ["2B50"]],
    [IDS.emojiBulb, "💡", ["1F4A1"]],
    [IDS.emojiCloud, "☁️", ["2601", "FE0F"]],
    [IDS.emojiMoon, "🌙", ["1F319"]],
    [IDS.emojiSun, "☀️", ["2600", "FE0F"]],
    [IDS.emojiLeaf, "🍃", ["1F343"]],
    [IDS.emojiHeart, "❤️", ["2764", "FE0F"]],
    [IDS.emojiCheck, "✅", ["2705"]],
    [IDS.emojiPair, "🧪", ["1F9EA"]],
    [IDS.emojiLong, "👩‍❤️‍💋‍👩", ["1F469", "200D", "2764", "FE0F", "200D", "1F48B", "200D", "1F469"]],
  ];
  if (!masterDatabase) throw new Error("MASTER_DB binding is unavailable");
  await masterDatabase.prepare("DELETE FROM emoji_master").run();
  const fanmarks = [
    [IDS.fanmarkEmoji, "emoji-short", "😀🏻", [IDS.emojiTone], [IDS.emojiBase]],
    [IDS.fanmarkText, "text-short", "🚀", [IDS.emojiRocket], [IDS.emojiRocket]],
    [IDS.fanmarkShort, "short-latest", "🌸", [IDS.emojiFlower], [IDS.emojiFlower]],
    [IDS.fanmarkUnclaimed, "unclaimed", "⭐", [IDS.emojiStar], [IDS.emojiStar]],
    [IDS.fanmarkGrace, "grace-only", "💡", [IDS.emojiBulb], [IDS.emojiBulb]],
    [IDS.fanmarkIndefinite, "indefinite", "☁️", [IDS.emojiCloud], [IDS.emojiCloud]],
    [IDS.fanmarkProtectedText, "protected-text", "🌙", [IDS.emojiMoon], [IDS.emojiMoon]],
    [IDS.fanmarkProtectedProfile, "protected-profile", "☀️", [IDS.emojiSun], [IDS.emojiSun]],
    [IDS.fanmarkPrivateProfile, "private-profile", "🍃", [IDS.emojiLeaf], [IDS.emojiLeaf]],
    [IDS.fanmarkInvalidUrl, "invalid-url", "❤️", [IDS.emojiHeart], [IDS.emojiHeart]],
    [IDS.fanmarkOversize, "oversize-text", "✅", [IDS.emojiCheck], [IDS.emojiCheck]],
  ];
  const licenses = [
    [LICENSE.emoji, IDS.fanmarkEmoji, "😀-display", "active", "2026-09-22T00:00:00.000000Z", null, 0],
    [LICENSE.text, IDS.fanmarkText, "🚀-display", "active", "2026-09-22T00:00:00.000000Z", null, 0],
    [LICENSE.shortFuture, IDS.fanmarkShort, "🌸-future", "active", "2026-09-22T00:00:00.000000Z", null, 0],
    [LICENSE.shortExpired, IDS.fanmarkShort, "🌸-expired", "active", "2020-01-01T00:00:00.000000Z", null, 0],
    [LICENSE.shortIndefinite, IDS.fanmarkShort, "🌸-indefinite", "active", null, null, 0],
    [LICENSE.grace, IDS.fanmarkGrace, "💡-grace", "grace", "2026-09-22T00:00:00.000000Z", "2026-09-23T00:00:00.000000Z", 0],
    [LICENSE.indefinite, IDS.fanmarkIndefinite, "☁️-indefinite", "active", null, null, 0],
    [LICENSE.protectedText, IDS.fanmarkProtectedText, "🌙-private", "active", "2026-09-22T00:00:00.000000Z", null, 0],
    [LICENSE.protectedProfile, IDS.fanmarkProtectedProfile, "☀️-private", "active", "2026-09-22T00:00:00.000000Z", null, 0],
    [LICENSE.privateProfile, IDS.fanmarkPrivateProfile, "🍃-private", "active", "2026-09-22T00:00:00.000000Z", null, 0],
    [LICENSE.invalidUrl, IDS.fanmarkInvalidUrl, "❤️-display", "active", "2026-09-22T00:00:00.000000Z", null, 0],
    [LICENSE.oversize, IDS.fanmarkOversize, "✅-display", "active", "2026-09-22T00:00:00.000000Z", null, 0],
  ];
  await masterDatabase.batch(masters.map(([id, emoji, codepoints]) =>
    masterDatabase.prepare("INSERT INTO emoji_master (id, emoji, codepoints) VALUES (?, ?, ?)")
      .bind(id, emoji, JSON.stringify(codepoints))));
  await batch([
    ...fanmarks.map(([id, shortId, input, emojiIds, normalizedIds]) => ({
      sql: "INSERT INTO fanmarks (id, short_id, user_input_fanmark, normalized_emoji, emoji_ids, normalized_emoji_ids, status) VALUES (?, ?, ?, ?, ?, ?, 'active')",
      bindings: [id, shortId, input, input, JSON.stringify(emojiIds), JSON.stringify(normalizedIds)],
    })),
    ...licenses.map(([id, fanmarkId, display, status, licenseEnd, graceExpiresAt, isReturned]) => ({
      sql: "INSERT INTO fanmark_licenses (id, fanmark_id, display_fanmark, status, license_end, grace_expires_at, is_returned) VALUES (?, ?, ?, ?, ?, ?, ?)",
      bindings: [id, fanmarkId, display, status, licenseEnd, graceExpiresAt, isReturned],
    })),
  ]);

  await batch([
    { sql: "INSERT INTO fanmark_basic_configs (id, license_id, fanmark_name, access_type) VALUES (?, ?, ?, ?)", bindings: ["41111111-1111-4111-8111-111111111111", LICENSE.emoji, "Open Emoji", "profile"] },
    { sql: "INSERT INTO fanmark_basic_configs (id, license_id, fanmark_name, access_type) VALUES (?, ?, ?, ?)", bindings: ["42222222-2222-4222-8222-222222222222", LICENSE.text, "Text Fanmark", "text"] },
    { sql: "INSERT INTO fanmark_messageboard_configs (id, license_id, content) VALUES (?, ?, ?)", bindings: ["43111111-1111-4111-8111-111111111111", LICENSE.text, "hello from D1"] },
    { sql: "INSERT INTO fanmark_basic_configs (id, license_id, fanmark_name, access_type) VALUES (?, ?, ?, ?)", bindings: ["43333333-3333-4333-8333-333333333333", LICENSE.shortFuture, "Short Redirect", "redirect"] },
    { sql: "INSERT INTO fanmark_redirect_configs (id, license_id, target_url) VALUES (?, ?, ?)", bindings: ["43444444-4444-4444-8444-444444444444", LICENSE.shortFuture, "https://example.test/target"] },
    { sql: "INSERT INTO fanmark_basic_configs (id, license_id, fanmark_name, access_type) VALUES (?, ?, ?, ?)", bindings: ["43555555-5555-4555-8555-555555555555", LICENSE.indefinite, "Indefinite", "profile"] },
    { sql: "INSERT INTO fanmark_basic_configs (id, license_id, fanmark_name, access_type) VALUES (?, ?, ?, ?)", bindings: ["43666666-6666-4666-8666-666666666666", LICENSE.protectedText, "Secret Text", "text"] },
    { sql: "INSERT INTO fanmark_messageboard_configs (id, license_id, content) VALUES (?, ?, ?)", bindings: ["43777777-7777-4777-8777-777777777777", LICENSE.protectedText, "secret message"] },
    { sql: "INSERT INTO fanmark_password_configs (id, license_id, is_enabled) VALUES (?, ?, ?)", bindings: ["43888888-8888-4888-8888-888888888888", LICENSE.protectedText, 1] },
    { sql: "INSERT INTO fanmark_basic_configs (id, license_id, fanmark_name, access_type) VALUES (?, ?, ?, ?)", bindings: ["43999999-9999-4999-8999-999999999999", LICENSE.protectedProfile, "Secret Profile", "profile"] },
    { sql: "INSERT INTO fanmark_password_configs (id, license_id, is_enabled) VALUES (?, ?, ?)", bindings: ["43aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", LICENSE.protectedProfile, 1] },
    { sql: "INSERT INTO fanmark_basic_configs (id, license_id, fanmark_name, access_type) VALUES (?, ?, ?, ?)", bindings: ["43bbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", LICENSE.privateProfile, "Private Profile", "profile"] },
    { sql: "INSERT INTO fanmark_basic_configs (id, license_id, fanmark_name, access_type) VALUES (?, ?, ?, ?)", bindings: ["43cccccc-cccc-4ccc-8ccc-cccccccccccc", LICENSE.invalidUrl, "Bad URL", "redirect"] },
    { sql: "INSERT INTO fanmark_redirect_configs (id, license_id, target_url) VALUES (?, ?, ?)", bindings: ["43dddddd-dddd-4ddd-8ddd-dddddddddddd", LICENSE.invalidUrl, "javascript:alert(1)"] },
    { sql: "INSERT INTO fanmark_basic_configs (id, license_id, fanmark_name, access_type) VALUES (?, ?, ?, ?)", bindings: ["43eeeeee-eeee-4eee-8eee-eeeeeeeeeeee", LICENSE.oversize, "Too Long", "text"] },
    { sql: "INSERT INTO fanmark_messageboard_configs (id, license_id, content) VALUES (?, ?, ?)", bindings: ["43ffffff-ffff-4fff-8fff-ffffffffffff", LICENSE.oversize, "x".repeat(16 * 1024 + 1)] },
    { sql: "INSERT INTO fanmark_profiles (id, license_id, display_name, bio, social_links, theme_settings, is_public, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", bindings: ["45111111-1111-4111-8111-111111111111", LICENSE.emoji, "Open Name", "A public bio", JSON.stringify({ website: "https://example.test/profile", instagram: "" }), JSON.stringify({ cover_image_url: "", profile_image_url: "", theme_color: "#123456", button_style: "rounded" }), 1, NOW, NOW] },
    { sql: "INSERT INTO fanmark_profiles (id, license_id, display_name, bio, social_links, theme_settings, is_public, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", bindings: ["45222222-2222-4222-8222-222222222222", LICENSE.protectedProfile, "Secret Name", "Secret Bio", "{}", "{}", 1, NOW, NOW] },
    { sql: "INSERT INTO fanmark_profiles (id, license_id, display_name, bio, social_links, theme_settings, is_public, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", bindings: ["45333333-3333-4333-8333-333333333333", LICENSE.privateProfile, "Private Name", "Private Bio", "{}", "{}", 0, NOW, NOW] },
  ]);
}

beforeAll(async () => {
  if (!database || !masterDatabase) throw new Error("split D1 bindings are unavailable");
  await database.batch(statementsFrom(schemaSql).map((statement) => database.prepare(statement)));
  await masterDatabase.prepare(`
    CREATE TABLE IF NOT EXISTS emoji_master (
      id TEXT PRIMARY KEY,
      emoji TEXT NOT NULL,
      codepoints TEXT NOT NULL
    )
  `).run();
});

beforeEach(async () => {
  await seedFixture();
});

describe("public fanmark access D1 contract", () => {
  it("serves crawler OGP from public D1 projections and hides protected profile metadata", async () => {
    const crawlerEnv = d1Environment({ ASSETS: undefined, STAGING_NO_INDEX: "true" });
    await run(
      "UPDATE fanmark_profiles SET display_name = ? WHERE license_id = ?",
      'Open <Name & Friends> "preview"',
      LICENSE.emoji,
    );
    const open = await request("/a/emoji-short", {
      headers: { "user-agent": "Twitterbot/1.0" },
    }, crawlerEnv);
    const openHtml = await open.text();
    expect(open.status).toBe(200);
    expect(open.headers.get("content-type")).toContain("text/html");
    expect(open.headers.get("cache-control")).toBe("no-store");
    expect(open.headers.get("vary")).toBe("user-agent");
    expect(open.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(openHtml).toContain("😀🏻 | fanmark.id");
    expect(openHtml).toContain("Open &lt;Name &amp; Friends&gt; &quot;preview&quot;");
    expect(openHtml).not.toContain('Open <Name & Friends> "preview"');
    expect(openHtml).toContain("https://api.example.test/a/emoji-short");
    expect(openHtml).toContain("https://api.example.test/api/ogp-image?");

    const browserAssets = {
      fetch: async (assetRequest: Request) => new URL(assetRequest.url).pathname === "/index.html"
        ? new Response("spa app shell", { status: 200 })
        : new Response(null, { status: 404 }),
    } as unknown as NonNullable<Env["ASSETS"]>;
    const emojiPath = `/${encodeURIComponent("😀🏻")}`;
    const emojiCrawler = await request(emojiPath, {
      headers: { "user-agent": "Twitterbot/1.0" },
    }, crawlerEnv);
    const emojiHtml = await emojiCrawler.text();
    expect(emojiCrawler.status).toBe(200);
    expect(emojiHtml).toContain("😀🏻 | fanmark.id");
    expect(emojiHtml).toContain("https://api.example.test/a/emoji-short");

    const emojiBrowser = await request(emojiPath, {
      headers: {
        "user-agent": "Mozilla/5.0",
        accept: "text/html,application/xhtml+xml",
        "sec-fetch-mode": "navigate",
      },
    }, d1Environment({ ASSETS: browserAssets }));
    expect(emojiBrowser.status).toBe(200);
    expect(await emojiBrowser.text()).toBe("spa app shell");

    await run(
      "INSERT INTO fanmarks (id, short_id, user_input_fanmark, normalized_emoji, emoji_ids, normalized_emoji_ids, status) VALUES (?, ?, ?, ?, ?, ?, 'active')",
      "2e2e2e2e-2e2e-4e2e-8e2e-2e2e2e2e2e2e",
      "emoji-duplicate",
      "😀🏻",
      "😀🏻",
      JSON.stringify([IDS.emojiTone]),
      JSON.stringify([IDS.emojiBase]),
    );
    const duplicateEmoji = await request(emojiPath, {
      headers: { "user-agent": "Twitterbot/1.0" },
    }, crawlerEnv);
    const duplicateHtml = await duplicateEmoji.text();
    expect(duplicateEmoji.status).toBe(200);
    expect(duplicateHtml).toContain("<title>fanmark.id</title>");
    expect(duplicateHtml).not.toContain("/a/emoji-short");
    expect(duplicateHtml).not.toContain("/a/emoji-duplicate");

    const protectedProfile = await request("/a/protected-profile", {
      headers: { "user-agent": "facebookexternalhit/1.1" },
    }, crawlerEnv);
    const protectedHtml = await protectedProfile.text();
    expect(protectedProfile.status).toBe(200);
    expect(protectedHtml).toContain("☀️ | fanmark.id");
    expect(protectedHtml).not.toContain("Secret Name");
    expect(protectedHtml).not.toContain("Secret Bio");

    const missing = await request("/a/absent-ogp-test", {
      headers: { "user-agent": "Googlebot/2.1" },
    }, crawlerEnv);
    expect(missing.status).toBe(200);
    expect(missing.headers.get("cache-control")).toBe("no-store");
    expect(await missing.text()).toContain("fanmark.id");

    const browser = await request("/a/emoji-short", {
      headers: {
        "user-agent": "Mozilla/5.0",
        accept: "text/html,application/xhtml+xml",
        "sec-fetch-mode": "navigate",
      },
    }, d1Environment({ ASSETS: browserAssets }));
    expect(browser.status).toBe(200);
    expect(await browser.text()).toBe("spa app shell");
  });

  it("generates bounded, escaped SVG OGP images without a database read", async () => {
    const imageUrl = new URL("/api/ogp-image", API_ORIGIN);
    imageUrl.searchParams.set("emoji", "🌸&");
    imageUrl.searchParams.set("display_name", "<img src=x onerror=alert(1)>");
    const response = await request(`${imageUrl.pathname}${imageUrl.search}`, { method: "GET" });
    const svg = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("image/svg+xml");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(svg).toContain("🌸&amp;");
    expect(svg).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(svg).not.toContain("<img src=x");

    const tooMany = new URL("/api/ogp-image", API_ORIGIN);
    tooMany.searchParams.set("emoji", "123456");
    const rejected = await request(`${tooMany.pathname}${tooMany.search}`);
    expect(rejected.status).toBe(400);
    expect(rejected.headers.get("cache-control")).toBe("no-store");
  });

  it("serves the actual D1 entrypoint with CORS, no-store, and no auth forwarding", async () => {
    const response = await configuredWorker.default.fetch(new Request(`${API_ORIGIN}/api/fanmarks/access/short/short-latest`, {
      headers: {
        Origin: ALLOWED_ORIGIN,
        Authorization: "Bearer private-session",
        Cookie: "session=private",
      },
    }));
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe(ALLOWED_ORIGIN);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({
      schemaVersion: 1,
      id: IDS.fanmarkShort,
      shortId: "short-latest",
      displayFanmark: "🌸-future",
      accessState: "open",
      targetUrl: "https://example.test/target",
    });
  });

  it("preserves live emoji normalization order/repetition and display spelling", async () => {
    const response = await jsonRequest("/api/fanmarks/access/emoji", { emojiIds: [IDS.emojiTone] });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      schemaVersion: 1,
      id: IDS.fanmarkEmoji,
      userInputFanmark: "😀🏻",
      displayFanmark: "😀-display",
      emojiIds: [IDS.emojiTone],
      accessState: "open",
    });

    await run(
      "INSERT INTO fanmarks (id, short_id, user_input_fanmark, normalized_emoji, emoji_ids, normalized_emoji_ids, status) VALUES (?, ?, ?, ?, ?, ?, 'active')",
      "2c2c2c2c-2c2c-4c2c-8c2c-2c2c2c2c2c2c",
      "pair-short",
      "😀😀",
      "😀😀",
      JSON.stringify([IDS.emojiBase, IDS.emojiBase]),
      JSON.stringify([IDS.emojiBase, IDS.emojiBase]),
    );
    const repeated = await jsonRequest("/api/fanmarks/access/emoji", { emojiIds: [IDS.emojiTone, IDS.emojiTone] });
    expect(repeated.status).toBe(200);
    const repeatedBody = await repeated.json() as { emojiIds?: unknown };
    expect(repeatedBody.emojiIds).toEqual([IDS.emojiBase, IDS.emojiBase]);

    const longDisplay = "👩‍❤️‍💋‍👩".repeat(5);
    const longIds = [IDS.emojiLong, IDS.emojiLong, IDS.emojiLong, IDS.emojiLong, IDS.emojiLong];
    await batch([
      {
        sql: "INSERT INTO fanmarks (id, short_id, user_input_fanmark, normalized_emoji, emoji_ids, normalized_emoji_ids, status) VALUES (?, ?, ?, ?, ?, ?, 'active')",
        bindings: [
          "2d2d2d2d-2d2d-4d2d-8d2d-2d2d2d2d2d2d",
          "long-emoji-short",
          longDisplay,
          longDisplay,
          JSON.stringify(longIds),
          JSON.stringify(longIds),
        ],
      },
      {
        sql: "INSERT INTO fanmark_licenses (id, fanmark_id, display_fanmark, status, license_end, grace_expires_at, is_returned) VALUES (?, ?, ?, 'active', ?, NULL, 0)",
        bindings: ["3f3f3f3f-3f3f-4f3f-8f3f-3f3f3f3f3f3f", "2d2d2d2d-2d2d-4d2d-8d2d-2d2d2d2d2d2d", longDisplay, "2026-09-22T00:00:00.000000Z"],
      },
      {
        sql: "INSERT INTO fanmark_basic_configs (id, license_id, fanmark_name, access_type) VALUES (?, ?, ?, 'text')",
        bindings: ["44dddddd-dddd-4ddd-8ddd-ddddddddddde", "3f3f3f3f-3f3f-4f3f-8f3f-3f3f3f3f3f3f", "Long emoji"],
      },
      {
        sql: "INSERT INTO fanmark_messageboard_configs (id, license_id, content) VALUES (?, ?, ?)",
        bindings: ["45dddddd-dddd-4ddd-8ddd-ddddddddddde", "3f3f3f3f-3f3f-4f3f-8f3f-3f3f3f3f3f3f", "long emoji content"],
      },
    ]);
    const longResponse = await jsonRequest("/api/fanmarks/access/emoji", { emojiIds: longIds });
    expect(longResponse.status).toBe(200);
    const longBody = await longResponse.json() as { userInputFanmark?: unknown };
    expect(longBody.userInputFanmark).toBe(longDisplay);
  });

  it("keeps unlicensed and grace rows unavailable while short lookup preserves indefinite licenses", async () => {
    for (const [path, expectedId] of [
      ["/api/fanmarks/access/short/unclaimed", IDS.fanmarkUnclaimed],
      ["/api/fanmarks/access/short/grace-only", IDS.fanmarkGrace],
    ] as const) {
      const response = await request(path);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ id: expectedId, accessState: "unavailable", licenseId: null });
    }
    const indefiniteByShort = await request("/api/fanmarks/access/short/indefinite");
    expect(indefiniteByShort.status).toBe(200);
    expect(await indefiniteByShort.json()).toMatchObject({
      id: IDS.fanmarkIndefinite,
      accessState: "open",
      licenseId: LICENSE.indefinite,
    });
    const indefiniteByEmoji = await jsonRequest("/api/fanmarks/access/emoji", { emojiIds: [IDS.emojiCloud] });
    expect(indefiniteByEmoji.status).toBe(200);
    const indefiniteBody = await indefiniteByEmoji.json() as { accessState?: unknown };
    expect(indefiniteBody.accessState).toBe("unavailable");
  });

  it("returns the minimal locked response and never protected content", async () => {
    const response = await request("/api/fanmarks/access/short/protected-text");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      accessState: "locked",
      isPasswordProtected: true,
      fanmarkName: null,
      targetUrl: null,
      textContent: null,
    });
    expect(JSON.stringify(body)).not.toContain("secret message");
    expect(JSON.stringify(body)).not.toContain("access_password");
  });

  it("requires a published, eligible, unprotected license for public profiles", async () => {
    const open = await request(`/api/fanmarks/public-profile/${LICENSE.emoji}`);
    expect(open.status).toBe(200);
    expect(await open.json()).toMatchObject({
      schemaVersion: 1,
      licenseId: LICENSE.emoji,
      displayName: "Open Name",
      bio: "A public bio",
      socialLinks: { website: "https://example.test/profile" },
      themeSettings: { theme_color: "#123456", button_style: "rounded" },
    });
    const uppercase = await request(`/api/fanmarks/public-profile/${LICENSE.emoji.toUpperCase()}`);
    expect(uppercase.status).toBe(200);
    for (const licenseId of [LICENSE.protectedProfile, LICENSE.privateProfile]) {
      const response = await request(`/api/fanmarks/public-profile/${licenseId}`);
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "not_found" });
    }

    await run(
      "INSERT INTO fanmark_profiles (id, license_id, display_name, bio, social_links, theme_settings, is_public, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      "45444444-4444-4444-8444-444444444444",
      LICENSE.shortExpired,
      "Expired",
      "Expired",
      "{}",
      "{}",
      1,
      NOW,
      NOW,
    );
    const expired = await request(`/api/fanmarks/public-profile/${LICENSE.shortExpired}`);
    expect(expired.status).toBe(404);

    await run(
      "INSERT INTO fanmark_profiles (id, license_id, display_name, bio, social_links, theme_settings, is_public, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      "45555555-5555-4555-8555-555555555555",
      LICENSE.shortIndefinite,
      "名".repeat(50),
      "語".repeat(500),
      JSON.stringify({}),
      JSON.stringify({ cover_image_url: "", profile_image_url: "" }),
      1,
      NOW,
      NOW,
    );
    const unicodeProfile = await request(`/api/fanmarks/public-profile/${LICENSE.shortIndefinite}`);
    expect(unicodeProfile.status).toBe(200);
    const unicodeBody = await unicodeProfile.json() as { displayName?: unknown; bio?: unknown; themeSettings?: unknown };
    expect(unicodeBody.displayName).toBe("名".repeat(50));
    expect(unicodeBody.bio).toBe("語".repeat(500));
    expect(unicodeBody.themeSettings).toEqual({});

    await run("UPDATE fanmark_licenses SET is_returned = 1 WHERE id = ?", LICENSE.shortIndefinite);
    const returned = await request(`/api/fanmarks/public-profile/${LICENSE.shortIndefinite}`);
    expect(returned.status).toBe(404);
  });

  it("rejects invalid stored access types, URLs, and oversized text", async () => {
    for (const shortId of ["invalid-url", "oversize-text"]) {
      const response = await request(`/api/fanmarks/access/short/${shortId}`);
      expect(response.status).toBe(502);
      expect(await response.json()).toEqual({ error: "upstream_unavailable" });
    }
    await run(
      "INSERT INTO fanmark_redirect_configs (id, license_id, target_url) VALUES (?, ?, ?)",
      "43ababab-abab-4aba-8aba-abababababac",
      LICENSE.text,
      "https://stale.example.test/ignored",
    );
    const staleMode = await request("/api/fanmarks/access/short/text-short");
    expect(staleMode.status).toBe(200);
    expect(await staleMode.json()).toMatchObject({ targetUrl: null, textContent: "hello from D1" });
    await run(
      "INSERT INTO fanmark_basic_configs (id, license_id, fanmark_name, access_type) VALUES (?, ?, ?, ?)",
      "43ababab-abab-4aba-8aba-abababababab",
      LICENSE.text,
      "Bad Type",
      "unknown",
    );
    const duplicateType = await request("/api/fanmarks/access/short/text-short");
    expect(duplicateType.status).toBe(502);
  });

  it("fails closed on multiple eligible licenses, tied short-id licenses, and duplicate configs", async () => {
    await run(
      "INSERT INTO fanmark_licenses (id, fanmark_id, display_fanmark, status, license_end, grace_expires_at, is_returned) VALUES (?, ?, ?, 'active', ?, NULL, 0)",
      "3d3d3d3d-3d3d-4d3d-8d3d-3d3d3d3d3d3d",
      IDS.fanmarkEmoji,
      "duplicate",
      "2026-09-23T00:00:00.000000Z",
    );
    const duplicateEmoji = await jsonRequest("/api/fanmarks/access/emoji", { emojiIds: [IDS.emojiTone] });
    expect(duplicateEmoji.status).toBe(502);

    await run(
      "INSERT INTO fanmark_licenses (id, fanmark_id, display_fanmark, status, license_end, grace_expires_at, is_returned) VALUES (?, ?, ?, 'active', ?, NULL, 0)",
      "3e3e3e3e-3e3e-4e3e-8e3e-3e3e3e3e3e3e",
      IDS.fanmarkShort,
      "tie",
      "2026-09-22T00:00:00.000000Z",
    );
    const tie = await request("/api/fanmarks/access/short/short-latest");
    expect(tie.status).toBe(502);

    await run(
      "INSERT INTO fanmark_basic_configs (id, license_id, fanmark_name, access_type) VALUES (?, ?, ?, ?)",
      "43cccccc-cccc-4ccc-8ccc-cccccccccccd",
      LICENSE.text,
      "Duplicate",
      "text",
    );
    const duplicateConfig = await request("/api/fanmarks/access/short/text-short");
    expect(duplicateConfig.status).toBe(502);
  });

  it("fails closed for malformed or ambiguous emoji master mappings", async () => {
    const missing = await jsonRequest("/api/fanmarks/access/emoji", { emojiIds: ["deadbeef-dead-4eef-8eef-deadbeefdead"] });
    expect(missing.status).toBe(404);
    await runMaster(
      "INSERT INTO emoji_master (id, emoji, codepoints) VALUES (?, ?, ?)",
      "1a1a1a1a-1a1a-41a1-81a1-1a1a1a1a1a1a",
      "duplicate base",
      JSON.stringify(["1F600"]),
    );
    const ambiguous = await jsonRequest("/api/fanmarks/access/emoji", { emojiIds: [IDS.emojiTone] });
    expect(ambiguous.status).toBe(502);
  });

  it("uses one atomic projection at the repository boundary when password state changes at the barrier", async () => {
    if (!database) throw new Error("FANMARK_DB binding is unavailable");
    let projectionPrepareCount = 0;
    let barrierMutationApplied = false;
    const adversarialDatabase = {
      prepare(statement: string) {
        projectionPrepareCount += 1;
        const prepared = database.prepare(statement);
        return {
          bind(...bindings: unknown[]) {
            const bound = prepared.bind(...bindings);
            return {
              async all<T>() {
                if (!barrierMutationApplied && statement.includes("WITH matching_fanmarks")) {
                  barrierMutationApplied = true;
                  await run(
                    "INSERT INTO fanmark_password_configs (id, license_id, is_enabled) VALUES (?, ?, 1)",
                    "43dddddd-dddd-4ddd-8ddd-ddddddddddde",
                    LICENSE.text,
                  );
                }
                return bound.all<T>();
              },
            };
          },
        };
      },
    } as unknown as D1Database;
    const repository = createD1PublicAccessRepository(d1Environment({ FANMARK_DB: adversarialDatabase }));
    const row = await repository.getByShortId("text-short");
    expect(barrierMutationApplied).toBe(true);
    expect(projectionPrepareCount).toBe(1);
    expect(row).toMatchObject({
      licenseId: LICENSE.text,
      isPasswordProtected: true,
      fanmarkName: null,
      targetUrl: null,
      textContent: null,
    });

    let profilePrepareCount = 0;
    const profileDatabase = {
      prepare(statement: string) {
        profilePrepareCount += 1;
        const prepared = database.prepare(statement);
        return {
          bind(...bindings: unknown[]) {
            const bound = prepared.bind(...bindings);
            return { all: <T>() => bound.all<T>() };
          },
        };
      },
    } as unknown as D1Database;
    const profileRepository = createD1PublicAccessRepository(d1Environment({ FANMARK_DB: profileDatabase }));
    const profile = await profileRepository.getPublicProfile(LICENSE.emoji, CLOCK());
    expect(profilePrepareCount).toBe(1);
    expect(profile).toMatchObject({ licenseId: LICENSE.emoji, displayName: "Open Name" });
  });

  it("bounds requests, methods, CORS, source selection, and responses", async () => {
    const malformed = await jsonRequest("/api/fanmarks/access/emoji", { emojiIds: [] });
    expect(malformed.status).toBe(400);
    const oversized = await jsonRequest("/api/fanmarks/access/emoji", { emojiIds: [IDS.emojiTone], padding: "x".repeat(4_100) });
    expect(oversized.status).toBe(400);
    const wrongMethod = await request("/api/fanmarks/access/short/text-short", { method: "POST" });
    expect(wrongMethod.status).toBe(405);
    expect(wrongMethod.headers.get("allow")).toBe("GET, OPTIONS");
    const forbidden = await request("/api/fanmarks/access/short/text-short", { headers: { Origin: "https://evil.example.test" } });
    expect(forbidden.status).toBe(403);
    const options = await request("/api/fanmarks/access/emoji", { method: "OPTIONS", headers: { Origin: ALLOWED_ORIGIN } });
    expect(options.status).toBe(204);
    expect(options.headers.get("access-control-allow-methods")).toBe("POST, OPTIONS");

    const unavailable = await request("/api/fanmarks/access/short/text-short", {}, d1Environment({ PUBLIC_ACCESS_BACKEND: undefined }));
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toEqual({ error: "public_access_unavailable" });
    const unknown = await request("/api/fanmarks/access/short/text-short", {}, d1Environment({ PUBLIC_ACCESS_BACKEND: "supabase" }));
    expect(unknown.status).toBe(500);
    expect(await unknown.json()).toEqual({ error: "server_misconfigured" });
    const missingBinding = await request("/api/fanmarks/access/short/text-short", {}, d1Environment({ FANMARK_DB: undefined }));
    expect(missingBinding.status).toBe(500);
    expect(await missingBinding.json()).toEqual({ error: "server_misconfigured" });
  });

  it("returns sanitized SQL failures and no owner/history/lottery fields", async () => {
    const brokenEnv = d1Environment({ FANMARK_DB: undefined, PUBLIC_ACCESS_BACKEND: "d1" });
    const response = await request("/api/fanmarks/access/short/text-short", {}, brokenEnv);
    expect(response.status).toBe(500);
    const body = await response.text();
    expect(body).toBe(JSON.stringify({ error: "server_misconfigured" }));
    expect(body).not.toMatch(/owner|lottery|history|user_id/i);
  });
});
