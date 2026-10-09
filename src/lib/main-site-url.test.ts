import assert from "node:assert/strict";
import { test } from "node:test";
import { getMainSiteUrl } from "./main-site-url.ts";

const location = (hostname: string, protocol = "https:", port = "") => ({ hostname, protocol, port });

test("development origins retain their host and port", () => {
  assert.equal(getMainSiteUrl(location("localhost", "http:", "5173")), "http://localhost:5173/");
  assert.equal(getMainSiteUrl(location("127.0.0.1", "http:", "4173")), "http://127.0.0.1:4173/");
  assert.equal(getMainSiteUrl(location("[::1]", "http:", "5173")), "http://[::1]:5173/");
});

test("Cloudflare preview sites return to the same deployment origin", () => {
  assert.equal(
    getMainSiteUrl(location("fanmark-app-staging.fanmark-id.workers.dev")),
    "https://fanmark-app-staging.fanmark-id.workers.dev/",
  );
  assert.equal(
    getMainSiteUrl(location("feature-branch.fanmark.pages.dev")),
    "https://feature-branch.fanmark.pages.dev/",
  );
});

test("production admin subdomains return to the user-facing domain", () => {
  assert.equal(getMainSiteUrl(location("admin.fanmark.id")), "https://fanmark.id/");
  assert.equal(getMainSiteUrl(location("fanmark.id")), "https://fanmark.id/");
});
