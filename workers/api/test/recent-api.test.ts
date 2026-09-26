import { env, exports as workerExports } from "cloudflare:workers";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../src";
import type { Env } from "../src/repository";
import { network } from "./network";

const ALLOWED_ORIGIN = "https://app.example.test";
const RPC_URL = "https://synthetic-project.supabase.co/rest/v1/rpc/list_recent_fanmarks";
const runtimeEnv = { ...(env as unknown as Env) };
const configuredWorker = workerExports as unknown as {
  default: { fetch(request: Request): Promise<Response> };
};
let upstreamCalls: Array<{ url: string; headers: Headers; signal: AbortSignal }> = [];

function legacyJwt(role: string): string {
  const encode = (value: unknown) => btoa(JSON.stringify(value)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  return `${encode({ alg: "none", typ: "JWT" })}.${encode({ role, sub: "fixture" })}.fixture-signature`;
}

function upstreamJson(body: unknown, status = 200): Response {
  return HttpResponse.json(body as Record<string, unknown> | unknown[] | null, { status });
}

function request(path: string, init: RequestInit = {}, requestEnv: Env = runtimeEnv): Promise<Response> {
  return worker.fetch(new Request(`https://api.example.test${path}`, init), requestEnv);
}

function mockRpc(handler: Parameters<typeof http.get>[1]): void {
  network.use(http.get(RPC_URL, handler));
}

describe("recent fanmarks API contract on a local Worker", () => {
  beforeEach(() => {
    upstreamCalls = [];
  });

  it("routes through the configured Worker entrypoint and runtime bindings", async () => {
    mockRpc(({ request }) => {
      upstreamCalls.push({
        url: request.url,
        headers: new Headers(request.headers as unknown as HeadersInit),
        signal: request.signal,
      });
      return upstreamJson([
        {
          fanmark_id: "configured-fanmark",
          fanmark_short_id: "SYNTHETIC1",
          display_emoji: "🧪",
          license_created_at: "2026-09-21T00:00:00.000Z",
        },
      ]);
    });

    const response = await configuredWorker.default.fetch(
      new Request("https://api.example.test/api/fanmarks/recent?limit=1", {
        headers: { Origin: ALLOWED_ORIGIN },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe(ALLOWED_ORIGIN);
    expect(await response.json()).toEqual({
      schemaVersion: 1,
      items: [
        {
          id: "configured-fanmark",
          emoji: "🧪",
          createdAt: "2026-09-21T00:00:00.000Z",
          shortId: "SYNTHETIC1",
          fanmarkId: "configured-fanmark",
        },
      ],
    });
    expect(upstreamCalls).toHaveLength(1);
    expect(new URL(upstreamCalls[0].url).searchParams.get("p_limit")).toBe("1");
  });

  it("maps the public RPC and strips upstream fields with the documented fallbacks", async () => {
    mockRpc(({ request }) => {
      upstreamCalls.push({
        url: request.url,
        headers: new Headers(request.headers as unknown as HeadersInit),
        signal: request.signal,
      });
      return upstreamJson([
        {
          license_id: "license-1",
          fanmark_id: "fanmark-1",
          fanmark_short_id: "PUBLIC01",
          display_emoji: "🌿",
          license_created_at: "2026-09-21T00:00:00.000Z",
          user_id: "private-user-id",
          email: "private@example.invalid",
        },
        {
          license_id: null,
          fanmark_id: "fanmark-2",
          display_emoji: null,
          license_created_at: "2026-09-20T00:00:00.000Z",
          service_role_secret: "must-not-escape",
        },
      ]);
    });

    const response = await request("/api/fanmarks/recent?limit=2", {
      headers: {
        Origin: ALLOWED_ORIGIN,
        Authorization: "Bearer user-session-jwt",
        Cookie: "sb-session=private-cookie",
      },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("access-control-allow-origin")).toBe(ALLOWED_ORIGIN);
    expect(await response.json()).toEqual({
      schemaVersion: 1,
      items: [
        {
          id: "license-1",
          emoji: "🌿",
          createdAt: "2026-09-21T00:00:00.000Z",
          shortId: "PUBLIC01",
          fanmarkId: "fanmark-1",
        },
        {
          id: "fanmark-2",
          emoji: "❓",
          createdAt: "2026-09-20T00:00:00.000Z",
          shortId: null,
          fanmarkId: "fanmark-2",
        },
      ],
    });

    expect(upstreamCalls).toHaveLength(1);
    expect(new URL(upstreamCalls[0].url).searchParams.get("p_limit")).toBe("2");
    expect(upstreamCalls[0].headers.get("apikey")).toBe("sb_publishable_fixture_only");
    expect(upstreamCalls[0].headers.get("authorization")).toBeNull();
    expect(upstreamCalls[0].headers.get("cookie")).toBeNull();
  });

  it("uses the default limit for a server request without Origin", async () => {
    mockRpc(({ request }) => {
      upstreamCalls.push({
        url: request.url,
        headers: new Headers(request.headers as unknown as HeadersInit),
        signal: request.signal,
      });
      return upstreamJson([]);
    });

    const response = await request("/api/fanmarks/recent");

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(new URL(upstreamCalls[0].url).searchParams.get("p_limit")).toBe("20");
  });

  it("bounds the public response when an upstream returns more rows than requested", async () => {
    mockRpc(({ request }) => {
      upstreamCalls.push({
        url: request.url,
        headers: new Headers(request.headers as unknown as HeadersInit),
        signal: request.signal,
      });
      return upstreamJson(
        Array.from({ length: 5 }, (_, index) => ({
          license_id: `license-${index + 1}`,
          display_emoji: "🌿",
          license_created_at: `2026-09-${String(21 - index).padStart(2, "0")}T00:00:00.000Z`,
        })),
      );
    });

    const response = await request("/api/fanmarks/recent?limit=2");

    expect(response.status).toBe(200);
    const body = (await response.json()) as { items: unknown[] };
    expect(body.items).toHaveLength(2);
    expect(upstreamCalls).toHaveLength(1);
  });

  it("rejects invalid limits without calling Supabase", async () => {
    for (const limit of ["0", "21", "1.5", "abc", ""]) {
      const response = await request(`/api/fanmarks/recent?limit=${encodeURIComponent(limit)}`);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "invalid_limit" });
    }

    expect(upstreamCalls).toHaveLength(0);
  });

  it("rejects an unlisted Origin before the upstream call", async () => {
    const response = await request("/api/fanmarks/recent", {
      headers: { Origin: "https://evil.example.test" },
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "forbidden_origin" });
    expect(upstreamCalls).toHaveLength(0);
  });

  it("answers OPTIONS with the explicit method allowlist", async () => {
    const response = await request("/api/fanmarks/recent", {
      method: "OPTIONS",
      headers: { Origin: ALLOWED_ORIGIN },
    });

    expect(response.status).toBe(204);
    expect(response.headers.get("allow")).toBe("GET, OPTIONS");
    expect(response.headers.get("access-control-allow-methods")).toBe("GET, OPTIONS");
    expect(upstreamCalls).toHaveLength(0);
  });

  it("rejects unsupported methods without an upstream call", async () => {
    const response = await request("/api/fanmarks/recent", { method: "POST" });

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET, OPTIONS");
    expect(await response.json()).toEqual({ error: "method_not_allowed" });
    expect(upstreamCalls).toHaveLength(0);
  });

  it("sanitizes upstream HTTP and network failures", async () => {
    mockRpc(({ request }) => {
      upstreamCalls.push({
        url: request.url,
        headers: new Headers(request.headers as unknown as HeadersInit),
        signal: request.signal,
      });
      return new Response("upstream private detail", { status: 500 });
    });
    const failedResponse = await request("/api/fanmarks/recent");
    expect(failedResponse.status).toBe(502);
    expect(await failedResponse.json()).toEqual({ error: "upstream_unavailable" });

    mockRpc(({ request }) => {
      upstreamCalls.push({
        url: request.url,
        headers: new Headers(request.headers as unknown as HeadersInit),
        signal: request.signal,
      });
      return HttpResponse.error();
    });
    const networkResponse = await request("/api/fanmarks/recent");
    expect(networkResponse.status).toBe(502);
    const networkBody = await networkResponse.text();
    expect(networkBody).toBe(JSON.stringify({ error: "upstream_unavailable" }));
  });

  it("maps a slow upstream body to a sanitized 504", async () => {
    const shortTimeoutEnv: Env = {
      ...runtimeEnv,
      SUPABASE_REQUEST_TIMEOUT_MS: "1",
    };
    mockRpc(({ request }) => {
      upstreamCalls.push({
        url: request.url,
        headers: new Headers(request.headers as unknown as HeadersInit),
        signal: request.signal,
      });
      return new Response(
        new ReadableStream({
          start(streamController) {
            request.signal.addEventListener("abort", () => {
              streamController.error(new DOMException("timed out", "AbortError"));
            });
          },
        }),
        { headers: { "content-type": "application/json" } },
      );
    });

    const response = await request("/api/fanmarks/recent", {}, shortTimeoutEnv);

    expect(response.status).toBe(504);
    expect(await response.json()).toEqual({ error: "upstream_timeout" });
  });

  it("rejects redirects instead of following them to another host", async () => {
    let redirectedCalls = 0;
    mockRpc(({ request }) => {
      upstreamCalls.push({
        url: request.url,
        headers: new Headers(request.headers as unknown as HeadersInit),
        signal: request.signal,
      });
      return Response.redirect("https://evil.example.test/private", 302);
    });
    network.use(
      http.get("https://evil.example.test/private", () => {
        redirectedCalls += 1;
        return upstreamJson({ secret: "must-not-be-requested" });
      }),
    );

    const response = await request("/api/fanmarks/recent");

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "upstream_unavailable" });
    expect(redirectedCalls).toBe(0);
  });

  it("does not use a missing service-role environment as a public key", async () => {
    const missingPublicKeyEnv = {
      ...runtimeEnv,
      SUPABASE_PUBLISHABLE_KEY: undefined,
      SUPABASE_ANON_KEY: undefined,
      SUPABASE_SERVICE_ROLE_KEY: "service_role_fixture_only",
    } as Env;

    const response = await request("/api/fanmarks/recent", {}, missingPublicKeyEnv);

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "server_misconfigured" });
    expect(upstreamCalls).toHaveLength(0);
  });

  it("accepts a legacy anon JWT only through the explicit anon fallback", async () => {
    mockRpc(({ request }) => {
      upstreamCalls.push({
        url: request.url,
        headers: new Headers(request.headers as unknown as HeadersInit),
        signal: request.signal,
      });
      return upstreamJson([]);
    });

    const response = await request("/api/fanmarks/recent", {}, {
      ...runtimeEnv,
      SUPABASE_PUBLISHABLE_KEY: undefined,
      SUPABASE_ANON_KEY: legacyJwt("anon"),
    });

    expect(response.status).toBe(200);
    expect(upstreamCalls[0].headers.get("apikey")).toBe(legacyJwt("anon"));
  });

  it("rejects a secret, service-role, or arbitrary value in an allowed key variable", async () => {
    for (const forbiddenKey of [
      "sb_secret_fixture_only",
      "sb_publishable_service_role_fixture_only",
      "service_role_fixture_only",
      legacyJwt("service_role"),
      "arbitrary_fixture_only",
    ]) {
      const response = await request("/api/fanmarks/recent", {}, {
        ...runtimeEnv,
        SUPABASE_PUBLISHABLE_KEY: forbiddenKey,
      });

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: "server_misconfigured" });
    }

    expect(upstreamCalls).toHaveLength(0);
  });
});
