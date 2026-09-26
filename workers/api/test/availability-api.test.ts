import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../src";
import type { Env } from "../src/repository";
import { network } from "./network";

const ALLOWED_ORIGIN = "https://app.example.test";
const RPC_URL = "https://synthetic-project.supabase.co/rest/v1/rpc/check_fanmark_availability";
const runtimeEnv: Env = {
  SUPABASE_URL: "https://synthetic-project.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_fixture_only",
  CORS_ALLOWED_ORIGINS: ALLOWED_ORIGIN,
};
const IDS = [
  "abcdef01-0000-4000-8000-000000000001",
  "00000000-0000-4000-8000-000000000002",
];

let upstreamCalls: Array<{ headers: Headers; body: unknown; signal: AbortSignal }> = [];

function upstreamJson(body: unknown, status = 200): Response {
  return HttpResponse.json(body as Record<string, unknown> | null, { status });
}

function request(init: RequestInit = {}, requestEnv: Env = runtimeEnv): Promise<Response> {
  return worker.fetch(
    new Request("https://api.example.test/api/fanmarks/availability", init),
    requestEnv,
  );
}

function mockRpc(handler: Parameters<typeof http.post>[1]): void {
  network.use(http.post(RPC_URL, handler));
}

describe("availability API contract", () => {
  beforeEach(() => {
    upstreamCalls = [];
  });

  it("uses the public RPC with ordered repeated IDs and no incoming credentials", async () => {
    mockRpc(async ({ request }) => {
      upstreamCalls.push({
        headers: new Headers(request.headers as unknown as HeadersInit),
        body: await request.json(),
        signal: request.signal,
      });
      return upstreamJson({
        available: true,
        tier_level: 3,
        tier_display_name: "Two",
        price: 2.5,
        license_days: 30,
        private_owner_id: "must-not-escape",
      });
    });

    const response = await request({
      method: "POST",
      headers: {
        Origin: ALLOWED_ORIGIN,
        "Content-Type": "application/json",
        Authorization: "Bearer private-session",
        Cookie: "session=private-cookie",
      },
      body: JSON.stringify({ emojiIds: [IDS[0].toUpperCase(), IDS[1], IDS[0]] }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("access-control-allow-origin")).toBe(ALLOWED_ORIGIN);
    expect(await response.json()).toEqual({
      schemaVersion: 1,
      result: {
        available: true,
        tier_level: 3,
        tier_display_name: "Two",
        price: 2.5,
        license_days: 30,
      },
    });
    expect(upstreamCalls).toHaveLength(1);
    expect(upstreamCalls[0].body).toEqual({ input_emoji_ids: [IDS[0], IDS[1], IDS[0]] });
    expect(upstreamCalls[0].headers.get("apikey")).toBe("sb_publishable_fixture_only");
    expect(upstreamCalls[0].headers.get("authorization")).toBeNull();
    expect(upstreamCalls[0].headers.get("cookie")).toBeNull();
  });

  it("passes a documented blocked result and invalid-domain result as HTTP 200", async () => {
    mockRpc(async ({ request }) => {
      const body = (await request.json()) as { input_emoji_ids: string[] };
      upstreamCalls.push({
        headers: new Headers(request.headers as unknown as HeadersInit),
        body,
        signal: request.signal,
      });
      return upstreamJson(
        body.input_emoji_ids[0] === IDS[0]
          ? {
              available: false,
              fanmark_id: "10000000-0000-4000-8000-000000000001",
              reason: "grace_period",
              available_at: "2026-09-22T00:00:00.123456Z",
              blocking_status: "grace",
            }
          : { available: false, reason: "invalid_emoji_ids" },
      );
    });

    const blocked = await request({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ emojiIds: [IDS[0]] }),
    });
    expect(blocked.status).toBe(200);
    expect(await blocked.json()).toEqual({
      schemaVersion: 1,
      result: {
        available: false,
        fanmark_id: "10000000-0000-4000-8000-000000000001",
        reason: "grace_period",
        available_at: "2026-09-22T00:00:00.123456Z",
        blocking_status: "grace",
      },
    });

    const invalid = await request({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ emojiIds: [IDS[1]] }),
    });
    expect(invalid.status).toBe(200);
    expect(await invalid.json()).toEqual({
      schemaVersion: 1,
      result: { available: false, reason: "invalid_emoji_ids" },
    });
  });

  it("rejects malformed, oversized, and non-JSON requests before Supabase", async () => {
    const cases: RequestInit[] = [
      { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" },
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emojiIds: IDS, extra: true }),
      },
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emojiIds: [] }),
      },
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emojiIds: [...IDS, ...IDS, ...IDS] }),
      },
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emojiIds: ["not-a-uuid"] }),
      },
      {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: JSON.stringify({ emojiIds: IDS }),
      },
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "x".repeat(4_097),
      },
    ];

    for (const init of cases) {
      const response = await request(init);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "invalid_request" });
    }
    expect(upstreamCalls).toHaveLength(0);
  });

  it("answers CORS preflight and rejects methods and origins", async () => {
    const options = await request({ method: "OPTIONS", headers: { Origin: ALLOWED_ORIGIN } });
    expect(options.status).toBe(204);
    expect(options.headers.get("allow")).toBe("POST, OPTIONS");
    expect(options.headers.get("access-control-allow-methods")).toBe("POST, OPTIONS");
    expect(options.headers.get("access-control-allow-headers")).toBe("content-type");

    const get = await request({ method: "GET" });
    expect(get.status).toBe(405);
    expect(get.headers.get("allow")).toBe("POST, OPTIONS");

    const origin = await request({
      method: "POST",
      headers: { Origin: "https://evil.example.test", "Content-Type": "application/json" },
      body: JSON.stringify({ emojiIds: IDS }),
    });
    expect(origin.status).toBe(403);
    expect(await origin.json()).toEqual({ error: "forbidden_origin" });
    expect(upstreamCalls).toHaveLength(0);
  });

  it("fails closed for explicit source misconfiguration and missing D1", async () => {
    const unknown = await request(
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emojiIds: IDS }),
      },
      { ...runtimeEnv, AVAILABILITY_BACKEND: "postgres" },
    );
    expect(unknown.status).toBe(500);
    expect(await unknown.json()).toEqual({ error: "server_misconfigured" });

    const missingD1 = await request(
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emojiIds: IDS }),
      },
      { ...runtimeEnv, AVAILABILITY_BACKEND: "d1", FANMARK_DB: undefined },
    );
    expect(missingD1.status).toBe(500);
    expect(await missingD1.json()).toEqual({ error: "server_misconfigured" });
    expect(upstreamCalls).toHaveLength(0);
  });

  it("sanitizes malformed, oversized, failed, and stalled upstream bodies", async () => {
    mockRpc(() => upstreamJson({ available: true }));
    const malformed = await request({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ emojiIds: IDS }),
    });
    expect(malformed.status).toBe(502);
    expect(await malformed.json()).toEqual({ error: "upstream_unavailable" });

    mockRpc(() => new Response("x".repeat(16_385), { status: 200 }));
    const oversized = await request({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ emojiIds: IDS }),
    });
    expect(oversized.status).toBe(502);
    expect(await oversized.json()).toEqual({ error: "upstream_unavailable" });

    mockRpc(() => new Response("private upstream failure", { status: 500 }));
    const failed = await request({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ emojiIds: IDS }),
    });
    expect(failed.status).toBe(502);
    expect(await failed.json()).toEqual({ error: "upstream_unavailable" });

    mockRpc(({ request }) =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("{"));
            request.signal.addEventListener("abort", () => controller.error(new DOMException("aborted", "AbortError")));
          },
        }),
        { headers: { "content-type": "application/json" } },
      ),
    );
    const stalled = await request(
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emojiIds: IDS }),
      },
      { ...runtimeEnv, SUPABASE_REQUEST_TIMEOUT_MS: "20" },
    );
    expect(stalled.status).toBe(504);
    expect(await stalled.json()).toEqual({ error: "upstream_timeout" });
  });

  it("times out a request body that stalls after its first chunk", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"emojiIds":['));
      },
      cancel() {
        return new Promise<void>(() => undefined);
      },
    });
    const response = await request({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      // The Workers Request implementation accepts streaming bodies.
      duplex: "half",
    } as RequestInit);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_request" });
    expect(upstreamCalls).toHaveLength(0);
  });
});
