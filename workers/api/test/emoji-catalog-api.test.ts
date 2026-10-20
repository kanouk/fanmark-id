import { env, exports as workerExports } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import schemaSql from "./fixtures/d1-emoji-catalog-api.sql?raw";
import { handleRequest } from "../src";
import { createEmojiMasterD1Repository } from "../src/emoji-master-d1-repository";
import type { Env } from "../src/repository";

const runtimeEnv = env as unknown as Env;
const database = runtimeEnv.MASTER_DB;
const API_URL = "https://api.example.test/api/emoji/catalog";
const ALLOWED_ORIGIN = "https://app.example.test";
const VERSION = "a".repeat(64);

const configuredWorker = workerExports as unknown as {
  default: { fetch(request: Request): Promise<Response> };
};

const ITEMS = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    emoji: "😀",
    short_name: "grinning face",
    keywords: ["face", "smile"],
    category: "Smileys & Emotion",
    subcategory: "face-smiling",
    codepoints: ["1F600"],
    sort_order: 1,
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    emoji: "👩‍💻",
    short_name: "woman technologist",
    keywords: ["coder", "developer"],
    category: "People & Body",
    subcategory: "person-role",
    codepoints: ["1F469", "200D", "1F4BB"],
    sort_order: 2,
  },
] as const;

function statementsFrom(sql: string): string[] {
  return sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((statement) => statement.trim())
    .filter(Boolean);
}

function d1Environment(overrides: Partial<Env> = {}): Env {
  return {
    ...runtimeEnv,
    D1_TOPOLOGY: "split",
    MASTER_DB: database,
    EMOJI_CATALOG_BACKEND: "d1",
    ...overrides,
  };
}

function request(path = "", requestEnv = d1Environment(), method = "GET"): Promise<Response> {
  return handleRequest(
    new Request(`${API_URL}${path}`, {
      method,
      headers: { Origin: ALLOWED_ORIGIN },
    }),
    requestEnv,
  );
}

async function executeFixtureSchema(): Promise<void> {
  if (!database) throw new Error("MASTER_DB binding is unavailable");
  await database.batch(statementsFrom(schemaSql).map((statement) => database.prepare(statement)));
}

async function resetFixture(): Promise<void> {
  if (!database) throw new Error("MASTER_DB binding is unavailable");
  await database.batch([
    database.prepare("DELETE FROM fanmark_emoji_master_active_release"),
    database.prepare("DELETE FROM fanmark_emoji_master_release_staging"),
    database.prepare("DELETE FROM fanmark_emoji_master_release_imports"),
  ]);
}

async function seedActiveRelease(): Promise<void> {
  if (!database) throw new Error("MASTER_DB binding is unavailable");
  await database.batch([
    database
      .prepare(
        "INSERT INTO fanmark_emoji_master_release_imports (release_version, manifest_json, row_count, status) VALUES (?, ?, ?, ?)",
      )
      .bind(VERSION, JSON.stringify({ version: VERSION }), ITEMS.length, "ready"),
    ...ITEMS.map((item, index) =>
      database
        .prepare(
          "INSERT INTO fanmark_emoji_master_release_staging (release_version, ordinal, id, emoji, short_name, keywords_json, category, subcategory, codepoints_json, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(
          VERSION,
          index + 1,
          item.id,
          item.emoji,
          item.short_name,
          JSON.stringify(item.keywords),
          item.category,
          item.subcategory,
          JSON.stringify(item.codepoints),
          item.sort_order,
        ),
    ),
    database
      .prepare(
        "INSERT INTO fanmark_emoji_master_active_release (singleton_id, release_version, previous_release_version, activation_id, action, generation) VALUES (1, ?, NULL, ?, 'promotion', 1)",
      )
      .bind(VERSION, "fixture-activation"),
  ]);
}

beforeAll(async () => {
  await executeFixtureSchema();
});

beforeEach(async () => {
  await resetFixture();
});

describe("emoji catalog D1 API", () => {
  it("keeps deep-page D1 reads proportional to the returned immutable ordinal range", async () => {
    if (!database) throw new Error("MASTER_DB binding is unavailable");
    await database.batch([
      database.prepare("INSERT INTO fanmark_emoji_master_release_imports VALUES (?, '{}', 10000, 'ready')").bind(VERSION),
      database.prepare(`WITH RECURSIVE ordinals(n) AS (
        SELECT 1 UNION ALL SELECT n + 1 FROM ordinals WHERE n < 10000
      ) INSERT INTO fanmark_emoji_master_release_staging
        (release_version, ordinal, id, emoji, short_name, keywords_json, category, subcategory, codepoints_json, sort_order)
      SELECT ?, n, printf('00000000-0000-4000-8000-%012d', n), char(128511 + n), 'synthetic symbol',
        '[]', NULL, NULL, printf('["%X"]', 128511 + n), n FROM ordinals`).bind(VERSION),
    ]);
    const reads: number[] = [];
    function measuredStatement(statement: D1PreparedStatement): D1PreparedStatement {
      return new Proxy(statement, {
        get(target, key) {
          if (key === "bind") return (...values: unknown[]) => measuredStatement(target.bind(...values));
          if (key === "all") return async () => {
            const result = await target.all();
            reads.push(result.meta.rows_read);
            return result;
          };
          const member = Reflect.get(target, key);
          return typeof member === "function" ? member.bind(target) : member;
        },
      });
    }
    const measured = new Proxy(database, {
      get(target, key) {
        if (key === "prepare") return (sql: string) => measuredStatement(target.prepare(sql));
        const member = Reflect.get(target, key);
        return typeof member === "function" ? member.bind(target) : member;
      },
    });
    const repository = createEmojiMasterD1Repository(d1Environment({ MASTER_DB: measured }));
    const page = await repository.readPage({ version: VERSION, offset: 9500, limit: 500 });
    expect(page.total).toBe(10000);
    expect(page.nextOffset).toBeNull();
    expect(page.items).toHaveLength(500);
    expect(page.items[0].sortOrder).toBe(9501);
    expect(page.items[499].sortOrder).toBe(10000);
    expect(reads).toHaveLength(1);
    console.log(JSON.stringify({ catalogPage: "9500/500", rowsRead: reads[0], rowsReturned: page.items.length }));
    expect(reads[0]).toBeLessThanOrEqual(1000);
  });

  it("serves the active immutable catalog through the Worker entrypoint", async () => {
    await seedActiveRelease();

    const response = await configuredWorker.default.fetch(
      new Request(`${API_URL}?limit=1`, { headers: { Origin: ALLOWED_ORIGIN } }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe(ALLOWED_ORIGIN);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      schemaVersion: 1,
      version: VERSION,
      total: 2,
      offset: 0,
      limit: 1,
      nextOffset: 1,
      items: [{
        id: ITEMS[0].id,
        emoji: ITEMS[0].emoji,
        shortName: ITEMS[0].short_name,
        keywords: ITEMS[0].keywords,
        category: ITEMS[0].category,
        subcategory: ITEMS[0].subcategory,
        codepoints: ITEMS[0].codepoints,
        sortOrder: ITEMS[0].sort_order,
      }],
    });
  });

  it("preserves zero-based offsets, final partial pages and empty pages past the end", async () => {
    await seedActiveRelease();
    for (const offset of [0, 1, 2, 10000]) {
      const response = await request(`?version=${VERSION}&offset=${offset}&limit=1`);
      expect(response.status).toBe(200);
      const body = await response.json() as { offset: number; nextOffset: number | null; items: { id: string }[] };
      expect(body.offset).toBe(offset);
      expect(body.nextOffset).toBe(offset === 0 ? 1 : null);
      expect(body.items.map(item => item.id)).toEqual(offset < 2 ? [ITEMS[offset].id] : []);
    }
    const finalPartial = await request(`?version=${VERSION}&offset=1&limit=500`);
    expect(finalPartial.status).toBe(200);
    expect(await finalPartial.json()).toMatchObject({ nextOffset: null, items: [{ id: ITEMS[1].id }] });
  });

  it("keeps later pages pinned to the selected version after the active pointer changes", async () => {
    await seedActiveRelease();
    const otherVersion = "b".repeat(64);
    await database?.batch([
      database.prepare("INSERT INTO fanmark_emoji_master_release_imports VALUES (?, '{}', 2, 'ready')").bind(otherVersion),
      database.prepare(`INSERT INTO fanmark_emoji_master_release_staging
        SELECT ?, ordinal, id, emoji, 'new release name', keywords_json, category, subcategory, codepoints_json, sort_order
        FROM fanmark_emoji_master_release_staging WHERE release_version = ?`).bind(otherVersion, VERSION),
      database.prepare("UPDATE fanmark_emoji_master_active_release SET release_version = ? WHERE singleton_id = 1").bind(otherVersion),
    ]);
    const pinned = await request(`?version=${VERSION}&offset=1&limit=1`);
    expect(pinned.status).toBe(200);
    expect(await pinned.json()).toMatchObject({ version: VERSION, items: [{ id: ITEMS[1].id, shortName: ITEMS[1].short_name }] });
    const active = await request("?offset=1&limit=1");
    expect(active.status).toBe(200);
    expect(await active.json()).toMatchObject({ version: otherVersion, items: [{ shortName: "new release name" }] });
  });

  it("fails closed for a missing requested ordinal or rows beyond the declared catalog size", async () => {
    await seedActiveRelease();
    // The API fixture deliberately allows corruption that deployed immutable-release
    // triggers reject, so read-time integrity refusal can be exercised independently.
    await database?.prepare("DELETE FROM fanmark_emoji_master_release_staging WHERE ordinal = 2").run();
    const missing = await request(`?version=${VERSION}&offset=1&limit=1`);
    expect(missing.status).toBe(502);
    expect(await missing.json()).toEqual({ error: "upstream_unavailable" });
    await database?.prepare("UPDATE fanmark_emoji_master_release_imports SET row_count = 1 WHERE release_version = ?").bind(VERSION).run();
    await database?.prepare("UPDATE fanmark_emoji_master_release_staging SET ordinal = 2").run();
    const beyondMetadata = await request(`?version=${VERSION}&offset=1&limit=1`);
    expect(beyondMetadata.status).toBe(502);
    expect(await beyondMetadata.json()).toEqual({ error: "upstream_unavailable" });
  });

  it("rejects malformed query parameters and non-GET methods", async () => {
    const invalid = await request("?offset=-1");
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ error: "invalid_request" });

    const duplicate = await request("?limit=1&limit=2");
    expect(duplicate.status).toBe(400);

    const post = await request("", d1Environment(), "POST");
    expect(post.status).toBe(405);
    expect(post.headers.get("allow")).toBe("GET, OPTIONS");
  });

  it("fails closed when there is no active release or D1 is not explicitly selected", async () => {
    const noActiveRelease = await request();
    expect(noActiveRelease.status).toBe(503);
    expect(await noActiveRelease.json()).toEqual({ error: "emoji_catalog_unavailable" });

    const noBackend = await request("", d1Environment({ EMOJI_CATALOG_BACKEND: undefined }));
    expect(noBackend.status).toBe(503);
    expect(await noBackend.json()).toEqual({ error: "emoji_catalog_unavailable" });

    const unknownBackend = await request("", d1Environment({ EMOJI_CATALOG_BACKEND: "supabase" }));
    expect(unknownBackend.status).toBe(500);
    expect(await unknownBackend.json()).toEqual({ error: "server_misconfigured" });
  });
});
