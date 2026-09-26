import { env } from "cloudflare:workers";
import bcrypt from "bcryptjs";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import schemaSql from "../migrations/0003_better_auth_core.sql?raw";
import { handleRequest } from "../src";
import type { Env } from "../src/repository";

const runtimeEnv = env as unknown as Env;
const database = runtimeEnv.AUTH_DB;
const avatarBucket = runtimeEnv.AVATARS_BUCKET;
const coverBucket = runtimeEnv.COVER_IMAGES_BUCKET;
const apiBase = "https://api.example.test";
const appOrigin = "https://app.example.test";
const firstUserId = "5c5f9001-449c-4b7f-a01d-284302a71ea1";
const secondUserId = "ad06c38f-c004-4e87-a442-17e35c59187b";
const firstEmail = "storage-owner@example.invalid";
const secondEmail = "storage-other@example.invalid";
const password = "Synthetic-Storage-Only!2026";
const passwordHash = bcrypt.hashSync(password, 10);
const pngBytes = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);

function splitMigrationStatements(sql: string): string[] {
  const statements: string[] = [];
  let start = 0;
  let singleQuoted = false;
  let doubleQuoted = false;
  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index];
    const next = sql[index + 1];
    if (character === "'" && !doubleQuoted) {
      if (singleQuoted && next === "'") index += 1;
      else singleQuoted = !singleQuoted;
      continue;
    }
    if (character === '"' && !singleQuoted) {
      if (doubleQuoted && next === '"') index += 1;
      else doubleQuoted = !doubleQuoted;
      continue;
    }
    if (character !== ";" || singleQuoted || doubleQuoted) continue;
    const candidate = sql.slice(start, index).trim();
    if (/^create\s+trigger\b/iu.test(candidate) && !/\bend\s*$/iu.test(candidate)) continue;
    if (candidate) statements.push(candidate);
    start = index + 1;
  }
  const finalStatement = sql.slice(start).trim();
  if (finalStatement) statements.push(finalStatement);
  return statements;
}

async function workerRequest(path: string, init: RequestInit = {}, overrides: Partial<Env> = {}) {
  const headers = new Headers(init.headers);
  if (!headers.has("Origin")) headers.set("Origin", appOrigin);
  return handleRequest(
    new Request(`${apiBase}${path}`, { ...init, headers }),
    { ...runtimeEnv, STORAGE_BACKEND: "r2", ...overrides },
  );
}

async function resetFixture(): Promise<void> {
  if (!database) throw new Error("AUTH_DB binding is unavailable");
  await database.prepare('DELETE FROM "user" WHERE "id" IN (?, ?)').bind(firstUserId, secondUserId).run();
  const now = new Date().toISOString();
  for (const [id, email, name] of [
    [firstUserId, firstEmail, "Synthetic Storage Owner"],
    [secondUserId, secondEmail, "Synthetic Storage Other"],
  ]) {
    await database.prepare(
      'INSERT INTO "user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt") VALUES (?, ?, ?, 1, ?, ?)',
    ).bind(id, name, email, now, now).run();
    await database.prepare(
      'INSERT INTO "account" ("id", "accountId", "providerId", "userId", "password", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).bind(`${id}-account`, id, "credential", id, passwordHash, now, now).run();
  }
}

async function removeSyntheticObjects(bucket: R2Bucket | undefined): Promise<void> {
  if (!bucket) throw new Error("R2 binding is unavailable");
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ cursor, prefix: `${firstUserId}/` });
    keys.push(...page.objects.map((object) => object.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  for (const key of keys) await bucket.delete(key);
}

async function signIn(email: string): Promise<string> {
  const response = await workerRequest("/api/auth/sign-in/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (response.status !== 200) throw new Error(`Synthetic sign-in failed: ${response.status}`);
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("Synthetic sign-in did not issue a session cookie");
  return cookie;
}

async function uploadAvatar(cookie: string, bytes: Uint8Array = pngBytes): Promise<Response> {
  return workerRequest("/api/storage/object/avatars", {
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "image/png" },
    body: bytes,
  });
}

beforeAll(async () => {
  if (!database || !avatarBucket || !coverBucket) throw new Error("D1/R2 bindings are unavailable");
  await database.batch(splitMigrationStatements(schemaSql).map((statement) => database.prepare(statement)));
});

beforeEach(async () => {
  await resetFixture();
  await removeSyntheticObjects(avatarBucket);
  await removeSyntheticObjects(coverBucket);
});

describe("Better Auth protected R2 image API", () => {
  it("stores a synthetic avatar, serves it publicly, and only lets its owner delete it", async () => {
    const ownerCookie = await signIn(firstEmail);
    const otherCookie = await signIn(secondEmail);
    const uploaded = await uploadAvatar(ownerCookie);
    expect(uploaded.status).toBe(201);
    expect(uploaded.headers.get("access-control-allow-credentials")).toBe("true");

    const result = await uploaded.json() as { path: string; publicUrl: string };
    expect(result.path).toMatch(new RegExp(`^${firstUserId}/[0-9a-f-]+\\.png$`, "iu"));
    expect(result.publicUrl).toContain(`/api/storage/public/avatars/${firstUserId}/`);

    const publicResponse = await workerRequest(new URL(result.publicUrl).pathname);
    expect(publicResponse.status).toBe(200);
    expect(publicResponse.headers.get("content-type")).toBe("image/png");
    expect(publicResponse.headers.get("cache-control")).toBe("public, max-age=3600");
    expect(publicResponse.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await publicResponse.arrayBuffer())).toEqual(pngBytes);

    const deniedDelete = await workerRequest(`/api/storage/object/avatars/${result.path}`, {
      method: "DELETE",
      headers: { Cookie: otherCookie },
    });
    expect(deniedDelete.status).toBe(403);
    expect(await avatarBucket?.head(result.path)).not.toBeNull();

    const deleted = await workerRequest(`/api/storage/object/avatars/${result.path}`, {
      method: "DELETE",
      headers: { Cookie: ownerCookie },
    });
    expect(deleted.status).toBe(204);
    expect(await workerRequest(new URL(result.publicUrl).pathname).then((response) => response.status)).toBe(404);
  });

  it("uses the separate 2 MB cover limit and returns a public cover URL", async () => {
    const cookie = await signIn(firstEmail);
    const response = await workerRequest("/api/storage/object/cover-images", {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "image/png" },
      body: pngBytes,
    });
    expect(response.status).toBe(201);
    const result = await response.json() as { path: string; publicUrl: string };
    expect(result.publicUrl).toContain(`/api/storage/public/cover-images/${firstUserId}/`);
    expect(await coverBucket?.head(result.path)).not.toBeNull();

    const tooLarge = new Uint8Array(2 * 1024 * 1024 + 1);
    tooLarge.set(pngBytes);
    const oversized = await workerRequest("/api/storage/object/cover-images", {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "image/png" },
      body: tooLarge,
    });
    expect(oversized.status).toBe(413);
  });

  it("enforces the 1 MB avatar limit", async () => {
    const cookie = await signIn(firstEmail);
    const tooLarge = new Uint8Array(1024 * 1024 + 1);
    tooLarge.set(pngBytes);
    const oversized = await uploadAvatar(cookie, tooLarge);
    expect(oversized.status).toBe(413);
  });

  it("rejects unauthenticated, untrusted-origin, unsupported, malformed, and non-image writes", async () => {
    const unauthenticated = await uploadAvatar("");
    expect(unauthenticated.status).toBe(401);

    const untrusted = await workerRequest("/api/storage/object/avatars", {
      method: "POST",
      headers: { Origin: "https://attacker.example.test", "Content-Type": "image/png" },
      body: pngBytes,
    });
    expect(untrusted.status).toBe(403);

    const cookie = await signIn(firstEmail);
    const unsupported = await workerRequest("/api/storage/object/avatars", {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "image/svg+xml" },
      body: "<svg></svg>",
    });
    expect(unsupported.status).toBe(415);

    const invalidImage = await workerRequest("/api/storage/object/avatars", {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "image/png" },
      body: "not an image",
    });
    expect(invalidImage.status).toBe(400);

    const missingOrigin = await handleRequest(
      new Request(`${apiBase}/api/storage/object/avatars`, {
        method: "POST",
        headers: { Cookie: cookie, "Content-Type": "image/png" },
        body: pngBytes,
      }),
      { ...runtimeEnv, STORAGE_BACKEND: "r2" },
    );
    expect(missingOrigin.status).toBe(403);

    const invalidPath = await workerRequest("/api/storage/object/avatars/%2Fsecret/key", {
      method: "DELETE",
      headers: { Cookie: cookie },
    });
    expect(invalidPath.status).toBe(400);
  });

  it("answers credentialed preflight and fails closed when R2 is not configured", async () => {
    const preflight = await workerRequest("/api/storage/object/avatars", {
      method: "OPTIONS",
      headers: { "access-control-request-method": "POST" },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-credentials")).toBe("true");

    const unavailable = await workerRequest("/api/storage/object/avatars", {
      method: "POST",
      headers: { "Content-Type": "image/png" },
      body: pngBytes,
    }, { STORAGE_BACKEND: "supabase", AVATARS_BUCKET: undefined });
    expect(unavailable.status).toBe(503);
  });
});
