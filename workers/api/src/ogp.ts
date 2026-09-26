import {
  createD1PublicAccessRepository,
  getActiveShortIdByEmojiPath,
} from "./public-access-d1-repository";
import {
  mapPublicAccessRow,
  mapPublicProfileRow,
  parsePublicAccessPathValue,
} from "./public-access";
import type { Env } from "./repository";

const OGP_PATH = /^\/a\/([^/]+)\/?$/u;
const IMAGE_PATH = "/api/ogp-image";
const MAX_EMOJI_CODEPOINTS = 5;
const MAX_EMOJI_BYTES = 128;
const MAX_DISPLAY_NAME_UNITS = 50;
const MAX_DISPLAY_NAME_BYTES = 200;
const CRAWLER_PATTERN = /facebookexternalhit|Facebot|Twitterbot|LinkedInBot|Pinterest|Slackbot|Discordbot|TelegramBot|WhatsApp|Line|Viber|Skype|Googlebot|bingbot|Yahoo|DuckDuckBot|Baiduspider|YandexBot|developers\.google\.com|redditbot|Embedly|Quora|outbrain|vkShare|W3C_Validator|Google-PageRenderer/iu;
const EMOJI_PATH_PATTERN = /[\p{Extended_Pictographic}\p{Regional_Indicator}\u20e3]/u;

export function isOgpCrawler(userAgent: string | null): boolean {
  return userAgent !== null && CRAWLER_PATTERN.test(userAgent);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[character] ?? character);
}

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/gu, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&apos;",
  })[character] ?? character);
}

function htmlDocument({ title, description, imageUrl, pageUrl }: {
  title: string;
  description: string;
  imageUrl: string;
  pageUrl: string;
}): string {
  const safeTitle = escapeHtml(title);
  const safeDescription = escapeHtml(description);
  const safeImage = escapeHtml(imageUrl);
  const safeUrl = escapeHtml(pageUrl);
  return `<!doctype html>
<html lang="ja" prefix="og: https://ogp.me/ns#">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${safeTitle}</title>
  <meta name="title" content="${safeTitle}">
  <meta name="description" content="${safeDescription}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${safeUrl}">
  <meta property="og:title" content="${safeTitle}">
  <meta property="og:description" content="${safeDescription}">
  <meta property="og:image" content="${safeImage}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:site_name" content="fanmark.id">
  <meta property="og:locale" content="ja_JP">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:url" content="${safeUrl}">
  <meta name="twitter:title" content="${safeTitle}">
  <meta name="twitter:description" content="${safeDescription}">
  <meta name="twitter:image" content="${safeImage}">
</head>
<body><main><h1>${safeTitle}</h1><p>${safeDescription}</p><a href="${safeUrl}">fanmark.id</a></main></body>
</html>`;
}

function fallbackDocument(origin: string): string {
  return htmlDocument({
    title: "fanmark.id",
    description: "あなただけのファンマークを見つけよう | 絵文字であなたを表現",
    imageUrl: new URL("/og-image.png", origin).toString(),
    pageUrl: new URL("/", origin).toString(),
  });
}

function htmlResponse(
  body: string,
  request: Request,
  env: Env,
  cacheControl: string,
): Response {
  const headers = new Headers({
    "cache-control": cacheControl,
    "content-type": "text/html; charset=utf-8",
    vary: "user-agent",
    "x-content-type-options": "nosniff",
  });
  if (env.STAGING_NO_INDEX?.trim().toLowerCase() === "true") {
    headers.set("x-robots-tag", "noindex, nofollow");
  }
  return new Response(request.method === "HEAD" ? null : body, { status: 200, headers });
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function parseEmojiPath(pathname: string): string | null {
  if (!pathname.startsWith("/") || pathname === "/" || pathname.slice(1).includes("/")) return null;
  const value = parsePublicAccessPathValue(pathname.slice(1));
  if (!value || [...value].length > 40 || !EMOJI_PATH_PATTERN.test(value)) return null;
  return value;
}

function hasControlCharacters(value: string): boolean {
  return [...value].some((character) => {
    const codepoint = character.codePointAt(0) ?? 0;
    return codepoint <= 0x1f || codepoint === 0x7f;
  });
}

export function generateOgpSvg(emoji: string, displayName = ""): string {
  const safeEmoji = escapeXml(emoji || "✨");
  const safeDisplayName = escapeXml(displayName);
  const emojiCount = [...emoji].length;
  const emojiFontSize = emojiCount > 3 ? 140 : emojiCount > 2 ? 160 : 180;
  const emojiY = displayName ? 280 : 340;
  const nameSection = displayName
    ? `<text x="600" y="420" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="36" font-weight="600" fill="#333333" text-anchor="middle" dominant-baseline="central">${safeDisplayName}</text>`
    : "";
  const siteY = displayName ? 500 : 480;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bgGradient" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#FFE5E5"/><stop offset="50%" style="stop-color:#FFF5E5"/><stop offset="100%" style="stop-color:#E5F0FF"/>
    </linearGradient>
    <radialGradient id="circleGlow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" style="stop-color:#ffffff;stop-opacity:0.8"/><stop offset="100%" style="stop-color:#ffffff;stop-opacity:0"/>
    </radialGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="4" stdDeviation="8" flood-color="#000000" flood-opacity="0.1"/></filter>
    <filter id="textShadow" x="-10%" y="-10%" width="120%" height="120%"><feDropShadow dx="0" dy="2" stdDeviation="4" flood-color="#000000" flood-opacity="0.15"/></filter>
  </defs>
  <rect width="1200" height="630" fill="url(#bgGradient)"/>
  <circle cx="100" cy="100" r="200" fill="url(#circleGlow)" opacity="0.5"/><circle cx="1100" cy="530" r="250" fill="url(#circleGlow)" opacity="0.4"/><circle cx="900" cy="80" r="120" fill="url(#circleGlow)" opacity="0.3"/>
  <rect x="100" y="80" width="1000" height="470" rx="32" ry="32" fill="white" filter="url(#shadow)"/>
  <text x="600" y="${emojiY}" font-family="Apple Color Emoji, Segoe UI Emoji, Noto Color Emoji, sans-serif" font-size="${emojiFontSize}" text-anchor="middle" dominant-baseline="central" filter="url(#textShadow)">${safeEmoji}</text>
  ${nameSection}
  <text x="600" y="${siteY}" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="24" font-weight="500" fill="#888888" text-anchor="middle">fanmark.id</text>
  <g fill="#FFD700" opacity="0.6"><polygon points="180,180 185,195 200,195 188,205 193,220 180,210 167,220 172,205 160,195 175,195" transform="scale(0.8)"/><polygon points="1020,150 1025,165 1040,165 1028,175 1033,190 1020,180 1007,190 1012,175 1000,165 1015,165" transform="scale(0.7)"/><polygon points="950,450 955,465 970,465 958,475 963,490 950,480 937,490 942,475 930,465 945,465" transform="scale(0.6)"/></g>
</svg>`;
}

function imageResponse(request: Request, url: URL): Response {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response(null, {
      status: 405,
      headers: { allow: "GET, HEAD", "cache-control": "no-store" },
    });
  }
  const emoji = url.searchParams.get("emoji") ?? "✨";
  const displayName = url.searchParams.get("display_name") ?? "";
  if (
    [...emoji].length < 1 || [...emoji].length > MAX_EMOJI_CODEPOINTS ||
    byteLength(emoji) > MAX_EMOJI_BYTES || hasControlCharacters(emoji) ||
    displayName.length > MAX_DISPLAY_NAME_UNITS || byteLength(displayName) > MAX_DISPLAY_NAME_BYTES ||
    hasControlCharacters(displayName)
  ) {
    return new Response(request.method === "HEAD" ? null : "invalid_image_input", {
      status: 400,
      headers: { "cache-control": "no-store", "content-type": "text/plain; charset=utf-8" },
    });
  }
  return new Response(request.method === "HEAD" ? null : generateOgpSvg(emoji, displayName), {
    status: 200,
    headers: {
      "cache-control": "public, max-age=3600, s-maxage=86400",
      "content-type": "image/svg+xml; charset=utf-8",
      "x-content-type-options": "nosniff",
    },
  });
}

export async function handleOgpRequest(
  request: Request,
  env: Env,
  clock: () => Date = () => new Date(),
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname === IMAGE_PATH) return imageResponse(request, url);

  const match = OGP_PATH.exec(url.pathname);
  const emojiPath = match ? null : parseEmojiPath(url.pathname);
  if ((!match && emojiPath === null) || !isOgpCrawler(request.headers.get("user-agent"))) return null;
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  if (env.PUBLIC_ACCESS_BACKEND?.trim() !== "d1") return null;

  const requestedShortId = match ? parsePublicAccessPathValue(match[1]) : null;
  if (match && !requestedShortId) {
    return htmlResponse(fallbackDocument(url.origin), request, env, "no-store");
  }

  try {
    const repository = createD1PublicAccessRepository(env, clock);
    const shortId = requestedShortId ?? await getActiveShortIdByEmojiPath(env, emojiPath ?? "");
    if (!shortId) return htmlResponse(fallbackDocument(url.origin), request, env, "no-store");
    const raw = await repository.getByShortId(shortId);
    if (!raw) return htmlResponse(fallbackDocument(url.origin), request, env, "no-store");

    const fanmark = mapPublicAccessRow(raw);
    let displayName = "";
    if (
      fanmark.accessType === "profile" && !fanmark.isPasswordProtected &&
      fanmark.licenseId !== null
    ) {
      const rawProfile = await repository.getPublicProfile(fanmark.licenseId, clock());
      const profile = rawProfile ? mapPublicProfileRow(rawProfile) : null;
      if (profile?.displayName) displayName = profile.displayName;
    }

    const title = `${fanmark.userInputFanmark} | fanmark.id`;
    const description = displayName
      ? `${fanmark.userInputFanmark} は ${displayName} さんのファンマークです`
      : fanmark.accessState === "unavailable"
        ? `${fanmark.userInputFanmark} は取得可能です！あなただけのファンマークを今すぐゲット`
        : `${fanmark.userInputFanmark} のファンマークページ | fanmark.id`;
    const pageUrl = new URL(`/a/${encodeURIComponent(fanmark.shortId)}`, url.origin).toString();
    const imageUrl = new URL(IMAGE_PATH, url.origin);
    imageUrl.searchParams.set("emoji", fanmark.userInputFanmark);
    imageUrl.searchParams.set("display_name", displayName);
    // This URL serves the SPA to browsers and crawler metadata to bots. Do not
    // let shared caches reuse one User-Agent's representation for the other.
    return htmlResponse(htmlDocument({ title, description, imageUrl: imageUrl.toString(), pageUrl }), request, env, "no-store");
  } catch {
    return htmlResponse(fallbackDocument(url.origin), request, env, "no-store");
  }
}
