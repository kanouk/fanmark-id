import { exports as workerExports } from "cloudflare:workers";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { network } from "./network";

const RPC_URL = "https://synthetic-project.supabase.co/rest/v1/rpc/list_recent_fanmarks";
const configuredWorker = workerExports as unknown as {
  default: { fetch(request: Request): Promise<Response> };
};

function request(path: string, init: RequestInit = {}): Promise<Response> {
  return configuredWorker.default.fetch(
    new Request(`https://app.example.test${path}`, init),
  );
}

function navigate(path: string): Promise<Response> {
  return request(path, {
    headers: {
      Accept: "text/html",
      "Sec-Fetch-Mode": "navigate",
    },
  });
}

describe("local Workers Static Assets routing", () => {
  it.each(["/", "/a/example-short-id", "/pwa", "/auth", "/plans?checkout=success"])(
    "serves the SPA shell for navigation %s",
    async (path) => {
      const response = await navigate(path);

      expect(response.status).toBe(200);
      expect(response.headers.get("location")).toBeNull();
      expect(response.headers.get("content-type")).toMatch(/text\/html/i);
      expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
      expect(await response.text()).toContain('<div id="root"></div>');
    },
    15_000,
  );

  it("serves the precached index directly without an HTML canonical redirect", async () => {
    const response = await request("/index.html", { redirect: "manual" });
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(await response.text()).toContain('<div id="root"></div>');
  });

  it.each(["GET", "HEAD"])("serves the root document for a plain %s request", async (method) => {
    const response = await request("/", { method, redirect: "manual" });
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("content-type")).toMatch(/text\/html/i);
    if (method === "HEAD") expect(await response.text()).toBe("");
  });

  it("blocks indexing and the production sitemap on staging", async () => {
    const robots = await request("/robots.txt");
    expect(robots.status).toBe(200);
    expect(robots.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(await robots.text()).toBe("User-agent: *\nDisallow: /\n");

    const sitemap = await request("/sitemap.xml");
    expect(sitemap.status).toBe(404);
    expect(sitemap.headers.get("x-robots-tag")).toBe("noindex, nofollow");
  });

  it("serves a known static asset with its non-HTML MIME type", async () => {
    const response = await request("/favicon.ico");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/image\/x-icon|image\/vnd\.microsoft\.icon/i);
    expect(response.headers.get("content-type")).not.toMatch(/text\/html/i);
  });

  it("serves the PWA manifest and both correctly sized install icons", async () => {
    const response = await request("/manifest.webmanifest");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/application\/manifest\+json/i);
    const manifest = await response.json() as {
      start_url: string;
      display: string;
      icons: Array<{ src: string; sizes: string; type: string; purpose: string }>;
    };
    expect(manifest.start_url).toBe("/pwa");
    expect(manifest.display).toBe("standalone");

    for (const [size, dimension] of [["192x192", 192], ["512x512", 512]] as const) {
      const icon = manifest.icons.find((entry) => entry.sizes.split(/\s+/).includes(size));
      expect(icon).toBeDefined();
      expect(icon?.purpose.split(/\s+/)).toEqual(expect.arrayContaining(["any", "maskable"]));
      const iconResponse = await request(icon!.src);
      expect(iconResponse.status).toBe(200);
      expect(iconResponse.headers.get("content-type")).toMatch(/image\/png/i);
      const bytes = Buffer.from(await iconResponse.arrayBuffer());
      expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
      expect(bytes.readUInt32BE(16)).toBe(dimension);
      expect(bytes.readUInt32BE(20)).toBe(dimension);
    }
  });

  it("uses the configured SPA fallback for a missing navigation path", async () => {
    const response = await navigate("/missing-static-route");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/text\/html/i);
    expect(await response.text()).toContain('<div id="root"></div>');
  });

  it("keeps a missing non-navigation asset as a non-HTML 404", async () => {
    const response = await request("/assets/does-not-exist.js");
    const body = await response.text();
    const contentType = response.headers.get("content-type") ?? "";

    expect(response.status).toBe(404);
    expect(contentType).not.toMatch(/text\/html/i);
    expect(body).not.toMatch(/<html/i);
  });

  it.each(["/api", "/api?x=1", "/api/unknown", "/api/auth/session"])(
    "keeps unknown API path %s as JSON instead of SPA HTML",
    async (path) => {
      const response = await navigate(path);

      expect(response.status).toBe(404);
      expect(response.headers.get("content-type")).toMatch(/application\/json/i);
      expect(await response.json()).toEqual({ error: "not_found" });
    },
  );

  it("routes the known public API through the Worker", async () => {
    network.use(
      http.get(RPC_URL, () =>
        HttpResponse.json([
          {
            fanmark_id: "static-route-fanmark",
            display_emoji: "🧪",
            license_created_at: "2026-09-21T00:00:00.000Z",
          },
        ]),
      ),
    );

    const response = await request("/api/fanmarks/recent?limit=1", {
      headers: { Origin: "https://app.example.test" },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/application\/json/i);
    expect(await response.json()).toEqual({
      schemaVersion: 1,
      items: [
        {
          id: "static-route-fanmark",
          fanmarkId: "static-route-fanmark",
          shortId: null,
          emoji: "🧪",
          createdAt: "2026-09-21T00:00:00.000Z",
        },
      ],
    });
  });

  it("keeps a known API upstream failure as JSON instead of SPA HTML", async () => {
    network.use(
      http.get(RPC_URL, () =>
        new HttpResponse("upstream private detail", { status: 500 }),
      ),
    );

    const response = await request("/api/fanmarks/recent?limit=1");
    const body = await response.text();

    expect(response.status).toBe(502);
    expect(response.headers.get("content-type")).toMatch(/application\/json/i);
    expect(body).toBe(JSON.stringify({ error: "upstream_unavailable" }));
    expect(body).not.toMatch(/<html/i);
  });
});
