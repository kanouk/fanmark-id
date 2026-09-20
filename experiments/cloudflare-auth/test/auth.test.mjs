import { beforeAll, describe, expect, it } from "vitest";
import { env, exports } from "cloudflare:workers";
import schemaSql from "../migrations/0001_better_auth_core.sql?raw";

const userId = "11111111-1111-4111-8111-111111111111";

async function request(path, init = {}) {
  const headers = new Headers(init.headers);
  headers.set("Origin", "http://example.test");
  return exports.default.fetch(
    new Request(`http://example.test${path}`, { ...init, headers }),
  );
}

function cookieFrom(response) {
  const setCookie = response.headers.get("set-cookie");
  expect(setCookie).toBeTruthy();
  return setCookie.split(";")[0];
}

beforeAll(async () => {
  const statements = schemaSql
    .split(/;\s*(?:\r?\n|$)/)
    .map((statement) => statement.trim())
    .filter(Boolean)
    .map((statement) => env.AUTH_DB.prepare(statement));
  await env.AUTH_DB.batch(statements);
});

describe("Better Auth on a local Workers + D1 runtime", () => {
  it("verifies a synthetic legacy bcrypt hash and preserves the UUID in the session relationship", async () => {
    const response = await request("/api/auth/sign-in/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "legacy@example.invalid",
        password: "synthetic-correct-password",
      }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.user.id).toBe(userId);
    expect(body.user.email).toBe("legacy@example.invalid");

    const sessionRow = await env.AUTH_DB.prepare(
      'select "userId", "token" from "session" where "userId" = ? order by "createdAt" desc limit 1',
    )
      .bind(userId)
      .first();
    expect(sessionRow?.userId).toBe(userId);
    expect(typeof sessionRow?.token).toBe("string");

    const sessionResponse = await request("/api/auth/get-session", {
      headers: { Cookie: cookieFrom(response) },
    });
    expect(sessionResponse.status).toBe(200);
    const sessionBody = await sessionResponse.json();
    expect(sessionBody.user.id).toBe(userId);
  });

  it("rejects the wrong password without creating a session", async () => {
    const before = await env.AUTH_DB.prepare(
      'select count(*) as count from "session" where "userId" = ?',
    )
      .bind(userId)
      .first();

    const response = await request("/api/auth/sign-in/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "legacy@example.invalid",
        password: "synthetic-wrong-password",
      }),
    });

    expect(response.status).toBe(401);
    const after = await env.AUTH_DB.prepare(
      'select count(*) as count from "session" where "userId" = ?',
    )
      .bind(userId)
      .first();
    expect(after?.count).toBe(before?.count);
  });

  it("keeps the UUID relationship when several sign-ins run concurrently", async () => {
    const before = await env.AUTH_DB.prepare(
      'select count(*) as count from "session" where "userId" = ?',
    )
      .bind(userId)
      .first();
    const started = performance.now();

    const responses = await Promise.all(
      Array.from({ length: 4 }, () =>
        request("/api/auth/sign-in/email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: "legacy@example.invalid",
            password: "synthetic-correct-password",
          }),
        }),
      ),
    );
    await Promise.all(responses.map((response) => response.text()));
    const elapsedMs = Math.round(performance.now() - started);
    console.info(`[auth-feasibility] concurrent_sign_ins=4 elapsed_ms=${elapsedMs}`);

    expect(responses.map((response) => response.status)).toEqual([200, 200, 200, 200]);
    const after = await env.AUTH_DB.prepare(
      'select count(*) as count from "session" where "userId" = ?',
    )
      .bind(userId)
      .first();
    expect(Number(after?.count) - Number(before?.count)).toBe(4);
  });
});
