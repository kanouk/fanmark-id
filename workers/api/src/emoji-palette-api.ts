import {
  createEmojiMasterD1Repository,
  type EmojiCatalogRecord,
} from "./emoji-master-d1-repository";
import { selectD1Database, type Env } from "./repository";
import type { SearchInput, JevResult } from "./emoji-palette-jev";
import {
  DICTIONARY_VERSION,
  PALETTE_SCHEMA_VERSION,
  NORMALIZATION_VERSION,
} from "../../../shared/emoji-palette/version";

export const BUDGET_PREFIX = "internal.emoji_palette.budget.";
export const PALETTE_PATH = "/api/emoji/palette/search";
export const DAILY_SEARCH_LIMIT = 100;
const TTL = 600_000;
const resultCache = new Map<string, { at: number; result: JevResult }>();
const catalogs = new Map<string, { at: number; items: EmojiCatalogRecord[] }>();
const pending = new Map<string, Promise<JevResult>>();
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      vary: "Origin",
      ...(status === 429 ? { "retry-after": "60" } : {}),
    },
  });
async function readBody(
  request: Request,
  failure: (code: string, status: number) => Error,
): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw failure("invalid_request", 400);
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 2048) {
        await reader.cancel();
        throw failure("request_too_large", 413);
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } finally {
    reader.releaseLock();
  }
}
export async function handleEmojiPaletteRequest(
  request: Request,
  env: Env,
  fetcher: typeof fetch = fetch,
): Promise<Response | null> {
  if (new URL(request.url).pathname !== PALETTE_PATH) return null;
  if (request.method !== "POST")
    return json({ error: "method_not_allowed" }, 405);
  const origin = request.headers.get("origin");
  if (
    origin !== new URL(request.url).origin ||
    request.headers.get("x-fanmark-palette") !== "1"
  )
    return json({ error: "forbidden_origin" }, 403);
  if (
    !/^application\/json(?:;|$)/i.test(
      request.headers.get("content-type") ?? "",
    )
  )
    return json({ error: "invalid_content_type" }, 415);
  // Keep annotation data and inference setup out of ordinary HTML/API startup.
  const { findWithJev, validateInput, JevError, JEV_MODEL, makeJevCatalog } =
    await import("./emoji-palette-jev");
  let input: SearchInput, version: string;
  try {
    const raw = (await readBody(
      request,
      (code, status) => new JevError(code, status),
    )) as Record<string, unknown>;
    input = validateInput(raw);
    if (
      Object.keys(raw).some(
        (k) =>
          ![
            "query",
            "category",
            "variants",
            "catalogVersion",
            "dictionaryVersion",
            "schemaVersion",
            "normalizationVersion",
          ].includes(k),
      )
    )
      throw new JevError("invalid_request", 400);
    if (
      typeof raw.catalogVersion !== "string" ||
      !/^[a-f0-9]{64}$/.test(raw.catalogVersion)
    )
      throw new JevError("invalid_catalog", 400);
    if (
      raw.dictionaryVersion !== DICTIONARY_VERSION ||
      raw.schemaVersion !== PALETTE_SCHEMA_VERSION ||
      raw.normalizationVersion !== NORMALIZATION_VERSION
    )
      throw new JevError("dictionary_changed", 409);
    version = raw.catalogVersion;
  } catch (error) {
    return json(
      { error: error instanceof JevError ? error.code : "invalid_request" },
      error instanceof JevError ? error.status : 400,
    );
  }
  if (!env.TYPESAFE_API_KEY?.trim())
    return json({ error: "not_configured" }, 503);
  const database = selectD1Database(env, "business");
  if (!database || !env.FANMARK_SEARCH_LIMITER)
    return json({ error: "unavailable" }, 503);
  const scope = env.BETTER_AUTH_URL ?? new URL(request.url).origin;
  const rawKey = JSON.stringify([
    scope,
    version,
    DICTIONARY_VERSION,
    JEV_MODEL,
    input,
  ]);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(rawKey),
  );
  const key = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  try {
    const rate = await env.FANMARK_SEARCH_LIMITER.limit({
      key: "emoji-palette:" + request.headers.get("cf-connecting-ip"),
    });
    if (!rate.success) return json({ error: "rate_limit" }, 429);
    const repository = createEmojiMasterD1Repository(env);
    const first = await repository.readPage({
      version: null,
      offset: 0,
      limit: 1,
    });
    if (first.version !== version)
      return json({ error: "catalog_changed" }, 409);
    const envelope = {
      catalogVersion: version,
      dictionaryVersion: DICTIONARY_VERSION,
      schemaVersion: PALETTE_SCHEMA_VERSION,
      normalizationVersion: NORMALIZATION_VERSION,
    };
    const cached = resultCache.get(key);
    if (cached && Date.now() - cached.at < TTL)
      return json({ ...envelope, ids: cached.result.ids, cached: true });
    const existing = pending.get(key);
    if (existing)
      return json({ ...envelope, ids: (await existing).ids, cached: true });
    const run = (async () => {
      const now = new Date().toISOString(),
        day = now.slice(0, 10),
        budgetKey = BUDGET_PREFIX + day;
      const admitted = await database
        .prepare(
          `INSERT INTO system_settings (setting_key,setting_value,description,is_public,created_at,updated_at)
        VALUES (?,json_object('searches',1,'input_tokens',0,'output_tokens',0,'calls',0),'Internal emoji search aggregate',0,?,?)
        ON CONFLICT(setting_key) DO UPDATE SET
          setting_value=json_set(setting_value,'$.searches',json_extract(setting_value,'$.searches')+1),
          updated_at=excluded.updated_at
        WHERE is_public=0 AND json_valid(setting_value)
          AND json_type(setting_value,'$.searches')='integer'
          AND json_extract(setting_value,'$.searches') BETWEEN 1 AND ?
          AND json_type(setting_value,'$.input_tokens')='integer' AND json_extract(setting_value,'$.input_tokens')>=0
          AND json_type(setting_value,'$.output_tokens')='integer' AND json_extract(setting_value,'$.output_tokens')>=0
          AND json_type(setting_value,'$.calls')='integer' AND json_extract(setting_value,'$.calls')>=0
        RETURNING setting_key`,
        )
        .bind(budgetKey, now, now, DAILY_SEARCH_LIMIT - 1)
        .first();
      if (!admitted) throw new JevError("daily_limit", 429);
      let release = catalogs.get(scope + version);
      if (!release || Date.now() - release.at >= TTL) {
        const page = await repository.readPage({
          version,
          offset: 0,
          limit: 500,
        });
        const items = [...page.items];
        for (let offset = items.length; offset < page.total; offset += 500) {
          const next = await repository.readPage({
            version,
            offset,
            limit: 500,
          });
          if (next.version !== version || next.total !== page.total)
            throw new JevError("catalog_changed", 409);
          items.push(...next.items);
        }
        if (
          items.length !== first.total ||
          new Set(items.map((i) => i.id)).size !== items.length
        )
          throw new JevError("catalog_changed", 409);
        if (catalogs.size >= 2) catalogs.delete(catalogs.keys().next().value!);
        release = { at: Date.now(), items };
        catalogs.set(scope + version, release);
      }
      const controller = new AbortController(),
        timer = setTimeout(() => controller.abort(), 12000);
      const abort = () => controller.abort();
      request.signal.addEventListener("abort", abort, { once: true });
      if (request.signal.aborted) controller.abort();
      try {
        const result = await findWithJev(
          input,
          env.TYPESAFE_API_KEY!.trim(),
          controller.signal,
          fetcher,
          makeJevCatalog(release.items),
        );
        await database
          .prepare(
            `UPDATE system_settings SET setting_value=json_set(setting_value,
              '$.input_tokens',json_extract(setting_value,'$.input_tokens')+CAST(? AS INTEGER),
              '$.output_tokens',json_extract(setting_value,'$.output_tokens')+CAST(? AS INTEGER),
              '$.calls',json_extract(setting_value,'$.calls')+CAST(? AS INTEGER)),updated_at=? WHERE setting_key=? AND is_public=0`,
          )
          .bind(
            result.inputTokens,
            result.outputTokens,
            result.calls,
            new Date().toISOString(),
            budgetKey,
          )
          .run();
        if (resultCache.size >= 128)
          resultCache.delete(resultCache.keys().next().value!);
        resultCache.set(key, { at: Date.now(), result });
        return result;
      } finally {
        controller.abort();
        clearTimeout(timer);
        request.signal.removeEventListener("abort", abort);
      }
    })();
    pending.set(key, run);
    try {
      return json({ ...envelope, ids: (await run).ids, cached: false });
    } finally {
      pending.delete(key);
    }
  } catch (error) {
    return json(
      { error: error instanceof JevError ? error.code : "unavailable" },
      error instanceof JevError ? error.status : 503,
    );
  }
}
