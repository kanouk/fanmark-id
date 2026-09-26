import { env, exports as workerExports } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import schemaSql from "./fixtures/d1-recent-contract.sql?raw";
import worker from "../src";
import type { Env } from "../src/repository";

const runtimeEnv = env as unknown as Env;
const database = runtimeEnv.FANMARK_DB;
const API_URL = "https://api.example.test/api/fanmarks/recent";
const configuredWorker = workerExports as unknown as {
  default: { fetch(request: Request): Promise<Response> };
};

const FIXTURE_FANMARKS = [
  ["fanmark-precision", "precision", "NORMALIZED-PRECISION", "USER-PRECISION", "active"],
  ["fanmark-latest", "latest", "NORMALIZED-LATEST", "USER-LATEST", "active"],
  ["fanmark-inactive", "inactive", "NORMALIZED-INACTIVE", "USER-INACTIVE", "inactive"],
  ["fanmark-null-display", "null-display", "NORMALIZED-NULL", "USER-NULL", "active"],
  ["fanmark-tie-a", "tie-a", "NORMALIZED-TIE-A", "USER-TIE-A", "banned"],
  ["fanmark-tie-b", "tie-b", "NORMALIZED-TIE-B", "USER-TIE-B", "active"],
  ["fanmark-grace", "grace", "NORMALIZED-GRACE", "USER-GRACE", "active"],
  ["fanmark-expired", "expired", "NORMALIZED-EXPIRED", "USER-EXPIRED", "active"],
] as const;

const FIXTURE_LICENSES = [
  [
    "99999999-9999-4999-8999-999999999999",
    "fanmark-precision",
    "✨-from-license",
    "active",
    "2020-01-01T00:00:00.000000Z",
    "2026-09-21T00:00:00.123457Z",
  ],
  [
    "11111111-1111-4111-8111-111111111111",
    "fanmark-latest",
    "🌿-from-license",
    "active",
    "2020-01-01T00:00:00.000000Z",
    "2026-09-21T00:00:00.123456Z",
  ],
  [
    "22222222-2222-4222-8222-222222222222",
    "fanmark-inactive",
    "🧊-from-license",
    "active",
    "2020-01-01T00:00:00.000000Z",
    "2026-09-20T00:00:00.000000Z",
  ],
  [
    "33333333-3333-4333-8333-333333333333",
    "fanmark-null-display",
    null,
    "active",
    null,
    "2026-09-19T00:00:00.000000Z",
  ],
  [
    "44444444-4444-4444-8444-444444444444",
    "fanmark-tie-a",
    "🧪-tie-a",
    "active",
    "2020-01-01T00:00:00.000000Z",
    "2026-09-18T00:00:00.000000Z",
  ],
  [
    "55555555-5555-4555-8555-555555555555",
    "fanmark-tie-b",
    "🧬-tie-b",
    "active",
    "2020-01-01T00:00:00.000000Z",
    "2026-09-18T00:00:00.000000Z",
  ],
  [
    "66666666-6666-4666-8666-666666666666",
    "fanmark-grace",
    "skip-grace",
    "grace",
    "2099-01-01T00:00:00.000000Z",
    "2026-09-23T00:00:00.000000Z",
  ],
  [
    "77777777-7777-4777-8777-777777777777",
    "fanmark-expired",
    "skip-expired",
    "expired",
    "2099-01-01T00:00:00.000000Z",
    "2026-09-22T00:00:00.000000Z",
  ],
  [
    "88888888-8888-4888-8888-888888888888",
    "missing-fanmark",
    "skip-orphan",
    "active",
    "2099-01-01T00:00:00.000000Z",
    "2026-09-24T00:00:00.000000Z",
  ],
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
    FANMARK_DB: database,
    RECENT_FANMARKS_BACKEND: "d1",
    ...overrides,
  };
}

function request(path = "", requestEnv = d1Environment()): Promise<Response> {
  return worker.fetch(new Request(`${API_URL}${path}`), requestEnv);
}

function configuredRequest(path = ""): Promise<Response> {
  return configuredWorker.default.fetch(new Request(`${API_URL}${path}`));
}

async function executeFixtureSchema(): Promise<void> {
  if (!database) throw new Error("FANMARK_DB binding is unavailable");
  await database.batch(
    statementsFrom(schemaSql).map((statement) => database.prepare(statement)),
  );
}

async function resetFixture(): Promise<void> {
  if (!database) throw new Error("FANMARK_DB binding is unavailable");
  await database.batch([
    database.prepare("DELETE FROM fanmark_licenses"),
    database.prepare("DELETE FROM fanmarks"),
  ]);
  await database.batch([
    ...FIXTURE_FANMARKS.map(([id, shortId, normalized, input, status]) =>
      database
        .prepare(
          "INSERT INTO fanmarks (id, short_id, normalized_emoji, user_input_fanmark, status) VALUES (?, ?, ?, ?, ?)",
        )
        .bind(id, shortId, normalized, input, status),
    ),
    ...FIXTURE_LICENSES.map(([id, fanmarkId, display, status, licenseEnd, createdAt]) =>
      database
        .prepare(
          "INSERT INTO fanmark_licenses (id, fanmark_id, display_fanmark, status, license_end, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(id, fanmarkId, display, status, licenseEnd, createdAt),
    ),
  ]);
}

beforeAll(async () => {
  await executeFixtureSchema();
});

beforeEach(async () => {
  await resetFixture();
});

describe("D1 recent fanmarks repository", () => {
  it("supports the generated UUID v4 default in the D1 runtime", async () => {
    if (!database) throw new Error("FANMARK_DB binding is unavailable");
    const table = "migration_uuid_default_probe";
    const defaultExpression = `lower(
      hex(randomblob(4)) || '-' ||
      hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2, 3) || '-' ||
      substr('89ab', (random() & 3) + 1, 1) || substr(hex(randomblob(2)), 2, 3) || '-' ||
      hex(randomblob(6))
    )`;

    await database.prepare(`DROP TABLE IF EXISTS ${table}`).run();
    try {
      await database.prepare(
        `CREATE TABLE ${table} (id TEXT PRIMARY KEY NOT NULL DEFAULT (${defaultExpression}))`,
      ).run();
      await database.batch(Array.from({ length: 256 }, () =>
        database.prepare(`INSERT INTO ${table} DEFAULT VALUES`),
      ));

      const { results = [] } = await database.prepare(`SELECT id FROM ${table}`).all<{ id: string }>();
      expect(results).toHaveLength(256);
      const ids = results.map(({ id }) => id);
      expect(new Set(ids).size).toBe(256);
      expect(ids.every((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id))).toBe(true);
    } finally {
      await database.prepare(`DROP TABLE IF EXISTS ${table}`).run();
    }
  });

  it("preserves monotonic sequence allocation with a D1 AUTOINCREMENT key", async () => {
    if (!database) throw new Error("FANMARK_DB binding is unavailable");
    const table = "migration_sequence_default_probe";
    await database.prepare(`DROP TABLE IF EXISTS ${table}`).run();
    try {
      await database.prepare(
        `CREATE TABLE ${table} (id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL)`,
      ).run();
      await database.batch([
        database.prepare(`INSERT INTO ${table} DEFAULT VALUES`),
        database.prepare(`INSERT INTO ${table} DEFAULT VALUES`),
        database.prepare(`INSERT INTO ${table} (id) VALUES (50)`),
        database.prepare(`INSERT INTO ${table} DEFAULT VALUES`),
        database.prepare(`DELETE FROM ${table} WHERE id = 51`),
        database.prepare(`INSERT INTO ${table} DEFAULT VALUES`),
      ]);

      const { results = [] } = await database.prepare(`SELECT id FROM ${table} ORDER BY id`).all<{ id: number }>();
      expect(results.map(({ id }) => id)).toEqual([1, 2, 50, 52]);
    } finally {
      await database.prepare(`DROP TABLE IF EXISTS ${table}`).run();
    }
  });

  it("serves real local D1 rows with active-license and join semantics", async () => {
    const response = await configuredRequest("?limit=20");

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      schemaVersion: number;
      items: Array<{ id: string; emoji: string; createdAt: string | null; shortId: string | null; fanmarkId: string | null }>;
    };
    expect(body.schemaVersion).toBe(1);
    expect(body.items.slice(0, 4)).toEqual([
      {
        id: "99999999-9999-4999-8999-999999999999",
        emoji: "✨-from-license",
        createdAt: "2026-09-21T00:00:00.123457Z",
        shortId: "precision",
        fanmarkId: "fanmark-precision",
      },
      {
        id: "11111111-1111-4111-8111-111111111111",
        emoji: "🌿-from-license",
        createdAt: "2026-09-21T00:00:00.123456Z",
        shortId: "latest",
        fanmarkId: "fanmark-latest",
      },
      {
        id: "22222222-2222-4222-8222-222222222222",
        emoji: "🧊-from-license",
        createdAt: "2026-09-20T00:00:00.000000Z",
        shortId: "inactive",
        fanmarkId: "fanmark-inactive",
      },
      {
        id: "33333333-3333-4333-8333-333333333333",
        emoji: "❓",
        createdAt: "2026-09-19T00:00:00.000000Z",
        shortId: "null-display",
        fanmarkId: "fanmark-null-display",
      },
    ]);
    expect(new Set(body.items.slice(4).map((item) => item.id))).toEqual(
      new Set([
        "44444444-4444-4444-8444-444444444444",
        "55555555-5555-4555-8555-555555555555",
      ]),
    );
    expect(body.items).toHaveLength(6);
  });

  it("binds API limits while leaving equal-timestamp order unspecified", async () => {
    const response = await request("?limit=2");

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      items: Array<{ id: string; emoji: string; createdAt: string | null; shortId: string | null; fanmarkId: string | null }>;
    };
    expect(body.items).toEqual([
      {
        id: "99999999-9999-4999-8999-999999999999",
        emoji: "✨-from-license",
        createdAt: "2026-09-21T00:00:00.123457Z",
        shortId: "precision",
        fanmarkId: "fanmark-precision",
      },
      {
        id: "11111111-1111-4111-8111-111111111111",
        emoji: "🌿-from-license",
        createdAt: "2026-09-21T00:00:00.123456Z",
        shortId: "latest",
        fanmarkId: "fanmark-latest",
      },
    ]);
  });

  it("fails closed for an explicit missing or unknown backend", async () => {
    const missingD1 = await request("", d1Environment({
      FANMARK_DB: undefined,
      SUPABASE_URL: "https://synthetic-project.supabase.co",
      SUPABASE_PUBLISHABLE_KEY: "sb_publishable_fixture_only",
    }));
    expect(missingD1.status).toBe(500);
    expect(await missingD1.json()).toEqual({ error: "server_misconfigured" });

    const unknownBackend = await request("", d1Environment({
      RECENT_FANMARKS_BACKEND: "postgres",
    }));
    expect(unknownBackend.status).toBe(500);
    expect(await unknownBackend.json()).toEqual({ error: "server_misconfigured" });

    const blankBackend = await request("", d1Environment({
      RECENT_FANMARKS_BACKEND: "  ",
      SUPABASE_URL: undefined,
      SUPABASE_PUBLISHABLE_KEY: undefined,
      SUPABASE_ANON_KEY: undefined,
    }));
    expect(blankBackend.status).toBe(500);
    expect(await blankBackend.json()).toEqual({ error: "server_misconfigured" });
  });

  it("sanitizes a local D1 SQL failure", async () => {
    if (!database) throw new Error("FANMARK_DB binding is unavailable");
    await database.prepare("DROP TABLE fanmark_licenses").run();

    const response = await request();
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "upstream_unavailable" });

    await executeFixtureSchema();
    await resetFixture();
  });
});
