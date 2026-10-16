import { createServer } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QRCodeSVG } from "qrcode.react";

const equal = (a, b) => typeof a === "string" && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export async function startReenrollmentServer(session) {
  const nonce = randomBytes(24).toString("base64"), access = randomBytes(32).toString("hex"), cookie = randomBytes(32).toString("hex");
  const html = (await readFile(new URL("./admin-reenrollment.html", import.meta.url), "utf8")).replaceAll("NONCE", nonce);
  let origin, consumed = false, enrollmentDisplay = null;
  const server = createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store"); res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Content-Type-Options", "nosniff"); res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Content-Security-Policy", `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`);
    const reply = (status, data) => { res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify(data)); };
    try {
      if (req.headers.host !== new URL(origin).host || req.socket.remoteAddress !== "127.0.0.1") return reply(403, { error: "local_only" });
      if (req.method === "GET" && req.url === "/") { res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); return res.end(html); }
      if (req.method !== "POST" || req.headers.origin !== origin || req.headers["content-type"] !== "application/json") return reply(403, { error: "request_rejected" });
      let body = "";
      for await (const chunk of req) { body += chunk.toString(); if (Buffer.byteLength(body) > 4096) return reply(413, { error: "body_too_large" }); }
      const input = JSON.parse(body);
      if (!input || typeof input !== "object" || Array.isArray(input)) return reply(400, { error: "request_rejected" });
      if (req.url === "/bootstrap") {
        if (consumed || !equal(req.headers.authorization, `Bearer ${access}`)) return reply(403, { error: "request_rejected" });
        consumed = true; res.setHeader("Set-Cookie", `reenrollment=${cookie}; HttpOnly; SameSite=Strict; Path=/; Max-Age=1200`);
        return reply(200, session.status());
      }
      const credential = req.headers.cookie?.split(";").map(c => c.trim()).find(c => c.startsWith("reenrollment="));
      if (!consumed || !equal(credential, `reenrollment=${cookie}`)) return reply(403, { error: "request_rejected" });
      if (req.url === "/status") {
        const status = session.status();
        if (status.stage !== "new-totp") enrollmentDisplay = null;
        return reply(200, { ...status, ...enrollmentDisplay });
      }
      if (req.url === "/close") { enrollmentDisplay = null; await session.close(); return reply(200, { stage: "closed" }); }
      if (req.url !== "/step") return reply(404, { error: "not_found" });
      const result = await session.step(input);
      if (result.totpURI) {
        result.qrSvg = renderToStaticMarkup(React.createElement(QRCodeSVG, { value: result.totpURI, size: 220, level: "M" }));
        enrollmentDisplay = { totpURI: result.totpURI, backupCodes: result.backupCodes, qrSvg: result.qrSvg };
      } else if (result.stage !== "new-totp") enrollmentDisplay = null;
      reply(200, result);
    } catch { reply(400, { error: "step_failed" }); }
  });
  server.requestTimeout = 120000; server.headersTimeout = 10000;
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  return { url: `${origin}/#${access}`, origin, close: async () => { enrollmentDisplay = null; await session.close(); await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); } };
}
