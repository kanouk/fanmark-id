export type SiteLocation = Pick<Location, "hostname" | "protocol" | "port">;

export function getMainSiteUrl(location: SiteLocation): string {
  const hostname = location.hostname.toLowerCase();
  const origin = `${location.protocol}//${location.hostname}${location.port ? `:${location.port}` : ""}`;

  if (hostname === "localhost" || hostname.includes("127.0.0.1") || hostname === "[::1]") {
    return `${origin}/`;
  }

  // Cloudflare preview hostnames identify individual deployments, not an admin subdomain.
  if (hostname.endsWith(".workers.dev") || hostname.endsWith(".pages.dev")) {
    return `${origin}/`;
  }

  // The production admin host is a subdomain of the user-facing site.
  const parts = location.hostname.split(".");
  if (parts.length > 2) {
    return `${location.protocol}//${parts.slice(1).join(".")}${location.port ? `:${location.port}` : ""}/`;
  }

  return `${origin}/`;
}
