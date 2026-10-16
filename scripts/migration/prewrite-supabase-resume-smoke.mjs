#!/usr/bin/env node

/**
 * Rehearse the old Supabase Auth + owner-scoped write path in a disposable,
 * loopback-only local project. No linked project, production data, or Cloudflare
 * resource is used. The local shim/grant mirror known live metadata required
 * because the checked-in historical migration chain is not independently
 * bootstrappable as-is.
 */

import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const sourceMigrations = path.join(projectRoot, "supabase", "migrations");
const projectId = `fanmark-prewrite-${process.pid}-${randomUUID().slice(0, 8)}`;
const databaseContainer = `supabase_db_${projectId}`;
const excludeServices = "realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor";
const authShimName = "20260104030000_local_rehearsal_is_admin.sql";
const migrationThatDropsAdmin = "20260104025602_remote_schema.sql";
const localAdminShim = `-- Local-only shim; returns false and grants no administrator access.
CREATE OR REPLACE FUNCTION public.is_admin() RETURNS boolean
LANGUAGE sql STABLE AS $$ SELECT false $$;
`;

function run(command, args, timeout = 30_000) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    encoding: "utf8",
    timeout,
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.error) throw new Error(`${command}_failed`);
  return result;
}

function requireSuccess(result, code) {
  if (result.status !== 0) throw new Error(code);
  return result.stdout;
}

function jsonOutput(stdout, code) {
  try {
    return JSON.parse(stdout);
  } catch {
    throw new Error(code);
  }
}

function safeApiError(status, body) {
  const value = body?.code ?? body?.error_code ?? body?.error ?? body?.message;
  const code = typeof value === "string" && /^[a-z0-9_.-]{1,80}$/iu.test(value)
    ? `_${value.toLowerCase()}`
    : "";
  return new Error(`local_api_${status}${code}`);
}

async function request(apiUrl, pathname, { method = "GET", apiKey, bearer = apiKey, body, prefer } = {}) {
  const headers = { apikey: apiKey, Authorization: `Bearer ${bearer}`, Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (prefer) headers.Prefer = prefer;
  const response = await fetch(new URL(pathname, apiUrl), {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  let value = null;
  if (text) {
    try {
      value = JSON.parse(text);
    } catch {
      throw new Error("local_api_invalid_json");
    }
  }
  if (!response.ok) throw safeApiError(response.status, value);
  return { status: response.status, value };
}

function sqlUuid(value) {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)) {
    throw new Error("local_auth_user_id_invalid");
  }
  return `'${value.toLowerCase()}'`;
}

async function removeOwnedDockerResources() {
  const containers = run("docker", ["ps", "-aq", "--filter", `name=${projectId}`]).stdout
    .split(/\s+/u).filter(Boolean);
  if (containers.length) run("docker", ["rm", "-f", ...containers]);

  const volumes = run("docker", ["volume", "ls", "-q", "--filter", `name=${projectId}`]).stdout
    .split(/\s+/u).filter((name) => name.includes(projectId));
  if (volumes.length) run("docker", ["volume", "rm", ...volumes]);

  const networks = run("docker", ["network", "ls", "-q", "--filter", `name=${projectId}`]).stdout
    .split(/\s+/u).filter((name) => name.includes(projectId));
  if (networks.length) run("docker", ["network", "rm", ...networks]);
}

async function main() {
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), "fanmark-prewrite-supabase-"));
  const supabaseDirectory = path.join(tempDirectory, "supabase");
  const migrationDirectory = path.join(supabaseDirectory, "migrations");
  let authUserId = null;
  let apiUrl = null;
  let anonKey = null;
  let serviceKey = null;
  let startAttempted = false;
  let testPassed = false;
  let apiDurationMs = null;
  let firstOwnerSettingsUpdateAfterFreezeMs = null;

  try {
    await mkdir(migrationDirectory, { recursive: true });
    const sourceConfig = await readFile(path.join(projectRoot, "supabase", "config.toml"), "utf8");
    const localConfig = sourceConfig.replace(/^project_id\s*=\s*"[^"]+"/mu, `project_id = "${projectId}"`);
    if (localConfig === sourceConfig) throw new Error("local_project_id_not_isolated");
    await writeFile(path.join(supabaseDirectory, "config.toml"), localConfig, { mode: 0o600 });

    const migrations = (await readdir(sourceMigrations, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
      .map((entry) => entry.name)
      .sort();
    if (!migrations.includes(migrationThatDropsAdmin)) throw new Error("source_migration_anchor_missing");
    await cp(sourceMigrations, migrationDirectory, {
      recursive: true,
      filter: (source) => source === sourceMigrations || source.endsWith(".sql"),
    });

    const droppingMigration = await readFile(path.join(migrationDirectory, migrationThatDropsAdmin), "utf8");
    if (!/drop\s+function\s+if\s+exists[\s\S]{0,120}is_admin/iu.test(droppingMigration)) {
      throw new Error("local_admin_shim_anchor_changed");
    }
    await writeFile(path.join(migrationDirectory, authShimName), localAdminShim, { mode: 0o600 });

    startAttempted = true;
    requireSuccess(run("supabase", ["start", "--workdir", tempDirectory, "--exclude", excludeServices], 300_000), "local_supabase_start_failed");
    const localStatus = jsonOutput(
      requireSuccess(run("supabase", ["status", "--workdir", tempDirectory, "--output", "json"]), "local_supabase_status_failed"),
      "local_supabase_status_invalid",
    );
    if (typeof localStatus.API_URL !== "string" || !/^http:\/\/(127\.0\.0\.1|localhost):\d+$/u.test(localStatus.API_URL)) {
      throw new Error("local_supabase_api_not_loopback");
    }
    apiUrl = localStatus.API_URL;
    anonKey = localStatus.ANON_KEY;
    serviceKey = localStatus.SERVICE_ROLE_KEY;
    if (typeof anonKey !== "string" || typeof serviceKey !== "string") throw new Error("local_supabase_keys_missing");

    const containerNames = run("docker", ["ps", "--format", "{{.Names}}"], 15_000).stdout.split(/\s+/u);
    if (!containerNames.includes(databaseContainer)) throw new Error("local_supabase_database_container_mismatch");

    // The live database was read-only checked to grant these four operations to
    // authenticated and enforce them with its three owner-bound RLS policies.
    requireSuccess(run("docker", [
      "exec", databaseContainer, "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres",
      "-c", "GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.user_settings TO authenticated; GRANT SELECT ON TABLE public.user_settings TO service_role",
    ], 15_000), "local_user_settings_privilege_setup_failed");

    const email = `prewrite-${randomUUID()}@example.com`;
    const password = randomUUID() + randomUUID();
    const startedAt = performance.now();
    const created = await request(apiUrl, "/auth/v1/admin/users", {
      method: "POST",
      apiKey: serviceKey,
      body: { email, password, email_confirm: true },
    });
    authUserId = created.value?.id ?? null;
    if (typeof authUserId !== "string") throw new Error("local_auth_user_create_missing_id");

    const signedIn = await request(apiUrl, "/auth/v1/token?grant_type=password", {
      method: "POST",
      apiKey: anonKey,
      body: { email, password },
    });
    const user = signedIn.value?.user;
    const accessToken = signedIn.value?.access_token;
    if (user?.id !== authUserId || typeof accessToken !== "string") throw new Error("local_auth_uuid_not_preserved");

    const filter = new URLSearchParams({ select: "user_id,preferred_language", user_id: `eq.${authUserId}` });
    const ownPath = `/rest/v1/user_settings?${filter.toString()}`;
    const ownRow = await request(apiUrl, ownPath, { apiKey: anonKey, bearer: accessToken });
    if (!Array.isArray(ownRow.value) || ownRow.value.length !== 1 || ownRow.value[0].user_id !== authUserId) {
      throw new Error("local_owner_rls_read_failed");
    }
    const nextLanguage = ownRow.value[0].preferred_language === "en" ? "ja" : "en";
    const updateFilter = new URLSearchParams({ user_id: `eq.${authUserId}` });
    const updated = await request(apiUrl, `/rest/v1/user_settings?${updateFilter.toString()}`, {
      method: "PATCH",
      apiKey: anonKey,
      bearer: accessToken,
      body: { preferred_language: nextLanguage },
      prefer: "return=representation",
    });
    if (!Array.isArray(updated.value) || updated.value.length !== 1 || updated.value[0].preferred_language !== nextLanguage) {
      throw new Error("local_owner_rls_update_failed");
    }
    const freezeRejectedAt = Number(process.env.FANMARK_CUTOVER_REJECTED_AT);
    if (Number.isSafeInteger(freezeRejectedAt) && freezeRejectedAt > 0) {
      firstOwnerSettingsUpdateAfterFreezeMs = Math.max(0, Date.now() - freezeRejectedAt);
    }
    const readback = await request(apiUrl, ownPath, { apiKey: anonKey, bearer: accessToken });
    if (readback.value?.[0]?.preferred_language !== nextLanguage) throw new Error("local_owner_write_readback_mismatch");
    apiDurationMs = Math.round(performance.now() - startedAt);

    await request(apiUrl, `/auth/v1/admin/users/${encodeURIComponent(authUserId)}`, {
      method: "DELETE",
      apiKey: serviceKey,
    });
    const afterDelete = await request(apiUrl, `/rest/v1/user_settings?${filter.toString()}`, { apiKey: serviceKey });
    if (afterDelete.value?.length !== 0) throw new Error("local_auth_cleanup_incomplete");
    authUserId = null;
    testPassed = true;
  } finally {
    if (authUserId && apiUrl && serviceKey) {
      try {
        await request(apiUrl, `/auth/v1/admin/users/${encodeURIComponent(authUserId)}`, { method: "DELETE", apiKey: serviceKey });
      } catch {
        const literal = sqlUuid(authUserId);
        run("docker", [
          "exec", databaseContainer, "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres",
          "-c", `DELETE FROM public.user_settings WHERE user_id = ${literal}; DELETE FROM auth.users WHERE id = ${literal};`,
        ], 15_000);
      }
    }
    if (startAttempted) run("supabase", ["stop", "--workdir", tempDirectory, "--no-backup"], 120_000);
    await removeOwnedDockerResources();
    await rm(tempDirectory, { recursive: true, force: true });
  }

  if (!testPassed) throw new Error("local_prewrite_smoke_incomplete");
  process.stdout.write(
    `PASS local-only Supabase pre-write path: email/password Auth, UUID preservation, owner RLS read/update/readback, cascade cleanup (${apiDurationMs} ms API sequence).\n` +
    (firstOwnerSettingsUpdateAfterFreezeMs === null ? "" : `First owner-scoped user_settings update after the frozen Cloudflare rejection: ${firstOwnerSettingsUpdateAfterFreezeMs} ms.\n`) +
    "No linked project, remote Supabase rows, Cloudflare resource, or email provider was used.\n",
  );
}

main().catch((error) => {
  const code = error instanceof Error && /^[a-z0-9_.-]{1,100}$/iu.test(error.message)
    ? error.message
    : "local_prewrite_smoke_failed";
  process.stderr.write(`FAIL ${code}\n`);
  process.exitCode = 1;
});
