import { env } from "cloudflare:workers";
import worker from "../src/index";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  handleEmojiPaletteRequest,
  DAILY_SEARCH_LIMIT,
} from "../src/emoji-palette-api";
import {
  findWithJev,
  makeGroups,
  makeJevCatalog,
  JEV_MODEL,
} from "../src/emoji-palette-jev";
import { DICTIONARY_VERSION } from "../../../shared/emoji-palette/version";
import { type Env } from "../src/repository";
import schema from "./fixtures/d1-emoji-catalog-api.sql?raw";
import budgetSchema from "../migrations-business/0027_emoji_palette_budget.sql?raw";

const runtime = env as unknown as Env,
  master = runtime.MASTER_DB!,
  business = runtime.FANMARK_DB!;
const VERSION = "a".repeat(64),
  ID = "11111111-1111-4111-8111-111111111111";
let scope = 0;
const configured = (): Env => ({
  ...runtime,
  D1_TOPOLOGY: "split",
  EMOJI_CATALOG_BACKEND: "d1",
  BETTER_AUTH_URL: "https://palette" + ++scope + ".example.test",
  TYPESAFE_API_KEY: "synthetic-only",
  FANMARK_SEARCH_LIMITER: { limit: async () => ({ success: true }) },
});
const body = (overrides = {}) => ({
  query: "美容室",
  category: "",
  variants: false,
  catalogVersion: VERSION,
  dictionaryVersion: DICTIONARY_VERSION,
  schemaVersion: 1,
  normalizationVersion: 1,
  ...overrides,
});
function req(
  value: unknown = body(),
  headers: Record<string, string> = {},
  method = "POST",
) {
  return new Request("https://palette.example.test/api/emoji/palette/search", {
    method,
    headers: {
      origin: "https://palette.example.test",
      "x-fanmark-palette": "1",
      "content-type": "application/json",
      ...headers,
    },
    ...(method === "POST" ? { body: JSON.stringify(value) } : {}),
  });
}
let calls = 0;
const provider: typeof fetch = async (_url, init) => {
  calls++;
  const data = JSON.parse(String(init?.body));
  expect(data.model).toBe(JEV_MODEL);
  expect(data.state).toEqual({ search_text: expect.any(String) });
  const answers = Object.fromEntries(
    Object.entries(data.questions).map(([name, q]: [string, unknown]) => {
      const criteria = (q as { criteria: Record<string, string> }).criteria;
      expect(Object.keys(criteria).length).toBeLessThanOrEqual(255);
      const choice = name === "subject" ? "0" : "none";
      return [
        name,
        {
          type: "choice",
          choice,
          probabilities: Object.fromEntries(
            Object.keys(criteria).map((k) => [k, k === choice ? 1 : 0]),
          ),
        },
      ];
    }),
  );
  return Response.json({
    model: JEV_MODEL,
    answers,
    usage: { input_tokens: 100, output_tokens: 20 },
  });
};
async function send(request: Request, config: Env, fetcher = provider) {
  const response = await handleEmojiPaletteRequest(request, config, fetcher);
  expect(response).not.toBeNull();
  return response!;
}
beforeAll(async () => {
  for (const [db, sql] of [
    [master, schema],
    [business, budgetSchema],
  ] as const)
    for (const s of sql
      .split(/;\s*(?:\r?\n|$)/)
      .map((v) => v.trim())
      .filter(Boolean))
      await db.prepare(s).run();
});
beforeEach(async () => {
  calls = 0;
  await business.prepare("DELETE FROM emoji_palette_daily_budget").run();
  await master.batch(
    [
      "DELETE FROM fanmark_emoji_master_active_release",
      "DELETE FROM fanmark_emoji_master_release_staging",
      "DELETE FROM fanmark_emoji_master_release_imports",
    ].map((s) => master.prepare(s)),
  );
  await master
    .prepare(
      "INSERT INTO fanmark_emoji_master_release_imports (release_version,manifest_json,status,row_count) VALUES (?,'{}','ready',1)",
    )
    .bind(VERSION)
    .run();
  await master
    .prepare(
      "INSERT INTO fanmark_emoji_master_active_release (singleton_id,release_version,activation_id,action,generation) VALUES (1,?,'test','activate',1)",
    )
    .bind(VERSION)
    .run();
  await master
    .prepare(
      `INSERT INTO fanmark_emoji_master_release_staging (release_version,ordinal,id,emoji,short_name,keywords_json,category,subcategory,codepoints_json,sort_order) VALUES (?,1,?,'✂️','scissors','["cut"]','Objects','tool','["2702","FE0F"]',1)`,
    )
    .bind(VERSION, ID)
    .run();
});
describe("public palette on actual D1", () => {
  it("does not flush unrelated notification wakes on a refused palette request", async () => {
    let databaseReads = 0;
    const config = {
      ...configured(),
      TYPESAFE_API_KEY: undefined,
      NOTIFICATION_WAKE_BACKEND: "durable-object",
      NOTIFICATION_PROCESSOR_BACKEND: "d1",
      FANMARK_DB: { prepare() { databaseReads++; throw new Error("unexpected notification read"); } },
      NOTIFICATION_WAKE: {},
    } as unknown as Env;
    const response = await worker.fetch(req(), config);
    expect(response.status).toBe(503);
    expect(databaseReads).toBe(0);
  });

  it("rejects cross-origin, absent marker, wrong method, oversized and extra fields before inference", async () => {
    const config = configured();
    for (const [request, status] of [
      [req(body(), { origin: "https://other.test" }), 403],
      [req(body(), { "x-fanmark-palette": "" }), 403],
      [req(undefined, {}, "GET"), 405],
      [req({ ...body(), query: "x".repeat(3000) }), 413],
      [req(body({ history: ["private"] })), 400],
      [req(body({ dictionaryVersion: "old" })), 409],
    ] as const)
      expect((await send(request, config)).status).toBe(status);
    expect(calls).toBe(0);
    expect(
      await business
        .prepare("SELECT count(*) n FROM emoji_palette_daily_budget")
        .first("n"),
    ).toBe(0);
  });
  it("uses current IDs, coalesces and caches one search, and records only aggregate usage", async () => {
    const config = configured();
    const responses = await Promise.all([
      send(req(), config),
      send(req(), config),
    ]);
    for (const r of responses) {
      expect(r.status).toBe(200);
      expect(r.headers.get("cache-control")).toBe("no-store");
      expect(await r.json()).toMatchObject({
        ids: [ID],
        catalogVersion: VERSION,
        dictionaryVersion: DICTIONARY_VERSION,
      });
    }
    expect(calls).toBe(4);
    expect(await (await send(req(), config)).json()).toMatchObject({
      cached: true,
      ids: [ID],
    });
    expect(calls).toBe(4);
    expect(
      await business
        .prepare(
          "SELECT searches,input_tokens,output_tokens,calls FROM emoji_palette_daily_budget",
        )
        .first(),
    ).toEqual({ searches: 1, input_tokens: 400, output_tokens: 80, calls: 4 });
    expect(
      await business
        .prepare("PRAGMA table_info(emoji_palette_daily_budget)")
        .all(),
    ).toMatchObject({ success: true });
  });
  it("rejects stale catalog before returning cached candidates", async () => {
    const config = configured();
    await send(req(), config);
    await master
      .prepare(
        "UPDATE fanmark_emoji_master_active_release SET release_version=?",
      )
      .bind("b".repeat(64))
      .run();
    await master
      .prepare(
        "INSERT INTO fanmark_emoji_master_release_imports (release_version,manifest_json,status,row_count) VALUES (?,'{}','ready',1)",
      )
      .bind("b".repeat(64))
      .run();
    await master
      .prepare(
        "INSERT INTO fanmark_emoji_master_release_staging SELECT ?, ordinal,id,emoji,short_name,keywords_json,category,subcategory,codepoints_json,sort_order FROM fanmark_emoji_master_release_staging WHERE release_version=?",
      )
      .bind("b".repeat(64), VERSION)
      .run();
    const r = await send(req(), config);
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ error: "catalog_changed" });
    expect(calls).toBe(4);
  });
  it("atomically refuses admissions after the global daily allowance, including simultaneous calls", async () => {
    const day = new Date().toISOString().slice(0, 10);
    await business
      .prepare(
        "INSERT INTO emoji_palette_daily_budget(day,searches)VALUES(?,?)",
      )
      .bind(day, DAILY_SEARCH_LIMIT - 1)
      .run();
    const config = configured(),
      responses = await Promise.all(
        ["美容室1", "美容室2", "美容室3"].map((query) =>
          send(req(body({ query })), config),
        ),
      );
    expect(responses.map((r) => r.status).sort()).toEqual([200, 429, 429]);
    expect(
      await business
        .prepare("SELECT searches FROM emoji_palette_daily_budget WHERE day=?")
        .bind(day)
        .first("searches"),
    ).toBe(DAILY_SEARCH_LIMIT);
    expect(calls).toBe(4);
  });
  it("fails closed for missing secrets or limiter and does not retry provider failures", async () => {
    expect(
      (await send(req(), { ...configured(), TYPESAFE_API_KEY: "" })).status,
    ).toBe(503);
    expect(
      (
        await send(req(), {
          ...configured(),
          FANMARK_SEARCH_LIMITER: undefined,
        })
      ).status,
    ).toBe(503);
    expect(
      (
        await send(req(), {
          ...configured(),
          FANMARK_SEARCH_LIMITER: { limit: async () => ({ success: false }) },
        })
      ).status,
    ).toBe(429);
    let failures = 0;
    const r = await send(req(), configured(), async () => {
      failures++;
      return new Response("private-provider-detail", { status: 401 });
    });
    expect(r.status).toBe(502);
    expect(await r.text()).not.toContain("private-provider-detail");
    expect(failures).toBe(3);
    expect(
      await business
        .prepare("SELECT searches FROM emoji_palette_daily_budget")
        .first("searches"),
    ).toBe(1);
  });
  it("keeps every actual master entry reachable within the choice limit and rejects malformed probabilities", async () => {
    const entries = makeJevCatalog(
      Array.from({ length: 3944 }, (_, i) => ({
        id: String(i),
        emoji: "😀",
        shortName: "face " + i,
        keywords: [],
        category: "Smileys & Emotion",
        subcategory: "face",
      })),
    );
    const groups = makeGroups(
      { query: "hello", category: "", variants: true },
      entries,
    );
    expect(groups.flatMap((g) => g.items).length).toBe(3944);
    expect(groups.every((g) => g.items.length <= 125)).toBe(true);
    await expect(
      findWithJev(
        { query: "hello", category: "", variants: true },
        "synthetic",
        new AbortController().signal,
        async () =>
          Response.json({
            model: JEV_MODEL,
            usage: { input_tokens: 1, output_tokens: 1 },
            answers: {},
          }),
        entries,
      ),
    ).rejects.toMatchObject({ code: "invalid_response" });
  });
});
