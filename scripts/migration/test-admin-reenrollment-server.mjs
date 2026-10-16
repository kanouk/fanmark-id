import test from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { startReenrollmentServer } from "./admin-reenrollment-server.mjs";

test("loopback HTTP requires a one-use capability, strict Origin, exact Host and HttpOnly session", async () => {
  let calls = 0;
  const session = { status: () => ({ stage: "password" }), close: async () => {}, step: async () => { calls++; return { stage: "old-totp" }; } };
  const server = await startReenrollmentServer(session);
  try {
    const post = (path, extra = {}, body = "{}") => fetch(server.origin+path, { method: "POST", headers: { origin: server.origin, "content-type": "application/json", ...extra }, body });
    const page = await fetch(server.origin);
    assert.equal(page.status, 200); assert.equal(page.headers.get("cache-control"), "no-store");
    assert.match(page.headers.get("content-security-policy"), /frame-ancestors 'none'/);
    assert.equal((await post("/step")).status, 403);
    const auth = { authorization: `Bearer ${new URL(server.url).hash.slice(1)}` };
    assert.equal((await post("/bootstrap", { ...auth, origin: "https://evil.example" })).status, 403);
    const wrongHostStatus = await new Promise(resolve => {
      const req = request(server.origin+"/bootstrap", { method: "POST", headers: { ...auth, host: "evil.example", origin: server.origin, "content-type": "application/json" } }, res => { res.resume(); resolve(res.statusCode); });
      req.end("{}");
    });
    assert.equal(wrongHostStatus, 403);
    const boot = await post("/bootstrap", auth); assert.equal(boot.status, 200);
    const set = boot.headers.get("set-cookie"); assert.match(set, /HttpOnly/); assert.match(set, /SameSite=Strict/);
    const cookie = set.split(";", 1)[0];
    assert.equal((await post("/bootstrap", auth)).status, 403);
    assert.equal((await post("/step", { cookie, origin: "null" })).status, 403);
    assert.equal((await post("/step", { cookie, "content-type": "text/plain" })).status, 403);
    assert.equal((await post("/step", { cookie }, JSON.stringify({ password: "X".repeat(5000) }))).status, 413);
    assert.equal((await post("/step", { cookie }, "null")).status, 400);
    assert.equal((await post("/api/auth/sign-in/email", { cookie })).status, 404);
    assert.equal(calls, 0);
    assert.equal((await post("/step", { cookie })).status, 200); assert.equal(calls, 1);
  } finally { await server.close(); }
});
