/** Run with Node 22 and --private-dir <existing 0700 directory outside Git>.
 * It reads source Auth metadata, but only the human's form submission signs in.
 * Output is a local one-use URL, never credentials or provider errors.
 */
import { readFile, writeFile, lstat, realpath, access } from "node:fs/promises";
import { resolve, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createClient } from "@supabase/supabase-js";
import { createReenrollmentSession } from "./admin-reenrollment-session.mjs";
import { startReenrollmentServer } from "./admin-reenrollment-server.mjs";
import { SOURCE_PROJECT, openAdminReenrollment } from "./admin-reenrollment-capsule.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
try {
  if (process.versions.node.split(".")[0] !== "22" || process.argv.length !== 4 || process.argv[2] !== "--private-dir") throw Error();
  const dir = await realpath(resolve(process.argv[3])), info = await lstat(dir), within = relative(await realpath(root), dir);
  if (!info.isDirectory() || info.mode & 0o077 || info.uid !== process.getuid() || (!within.startsWith("..") && !isAbsolute(within))) throw Error();
  const capsulePath = resolve(dir, "admin-reenrollment.aesgcm.json"), keyPath = resolve(dir, "admin-reenrollment.key");
  try { await access(capsulePath); throw Error("existing_capsule"); } catch (e) { if (e.code !== "ENOENT") throw Error(); }
  try { await writeFile(keyPath, randomBytes(32), { mode: 0o600, flag: "wx" }); } catch (e) { if (e.code !== "EEXIST") throw Error(); }
  const keyInfo = await lstat(keyPath);
  if (!keyInfo.isFile() || keyInfo.isSymbolicLink() || keyInfo.mode & 0o077 || keyInfo.uid !== process.getuid()) throw Error();
  const key = await readFile(keyPath); if (key.length !== 32) throw Error();
  const text = await readFile(resolve(root, ".env"), "utf8");
  const entries = Object.fromEntries(text.split(/\r?\n/).filter(l => /^[A-Z_]+=/.test(l)).map(l => {
    const at = l.indexOf("="); return [l.slice(0, at), l.slice(at+1).trim().replace(/^['"]|['"]$/g, "")];
  }));
  const sourceUrl = `https://${SOURCE_PROJECT}.supabase.co`;
  if (entries.VITE_SUPABASE_URL !== sourceUrl || !entries.VITE_SUPABASE_PUBLISHABLE_KEY) throw Error();
  const readFreshSource = async () => {
    const { stdout } = await promisify(execFile)("npx", ["--yes", "supabase@2.118.0", "db", "query", "--linked", "--project-ref", SOURCE_PROJECT, "--file", "scripts/migration/supabase-auth-snapshot.sql", "--output", "json"], { cwd: root, maxBuffer: 16 * 1024 * 1024, timeout: 90000 });
    const result = JSON.parse(stdout);
    if (result.rows?.length !== 1 || !result.rows[0].snapshot) throw Error();
    return result.rows[0].snapshot;
  };
  const source = await readFreshSource();
  const sourceClient = createClient(sourceUrl, entries.VITE_SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, debug: false },
    global: { fetch: (url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(15000), redirect: "error" }) },
  });
  const recordStatus = async status => {
    // Fixed phase names and counters only. No identity, input, SDK errors,
    // QR/secret, recovery code, cookie, or token is recorded here.
    await writeFile(resolve(dir, "admin-reenrollment-status.json"), JSON.stringify({ observedAt: new Date().toISOString(), ...status }), { mode: 0o600 });
  };
  const session = createReenrollmentSession({ source, sourceClient, readFreshSource, key, recordStatus,
    saveCapsule: async capsule => {
      openAdminReenrollment(await readFreshSource(), { capsule, key });
      await writeFile(capsulePath, JSON.stringify(capsule), { mode: 0o600, flag: "wx" });
      openAdminReenrollment(source, { capsule: JSON.parse(await readFile(capsulePath, "utf8")), key });
      console.log("admin_reenrollment_saved_and_readback_verified; production_import_and_login_pending");
    },
  });
  await recordStatus(session.status());
  const server = await startReenrollmentServer(session);
  console.log(`Open privately on this Mac: ${server.url}`);
  console.log("Waiting for the administrator. No production data import or DNS change is performed by this helper.");
  let closing = false;
  const close = async () => { if (closing) return; closing = true; await server.close(); process.exit(0); };
  setTimeout(() => { void close(); }, 20 * 60000);
  process.once("SIGINT", close); process.once("SIGTERM", close);
} catch { console.error("admin_reenrollment_start_failed_no_sensitive_diagnostics"); process.exitCode = 1; }
