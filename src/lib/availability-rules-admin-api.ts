const API_PATH = "/api/admin/availability-rules";
const MAX_RESPONSE_BYTES = 16 * 1024;
const TIMEOUT_MS = 5_000;
const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/iu;
const RULE_TYPES = new Set(["specific_pattern", "duplicate_pattern", "prefix_pattern", "count_based"]);

export type AvailabilityRuleType = "specific_pattern" | "duplicate_pattern" | "prefix_pattern" | "count_based";

export interface AvailabilityRuleConfig {
  prefixes?: Record<string, number>;
  patterns?: string[];
  pricing?: Record<string, number>;
  enabled?: boolean;
}

export interface AvailabilityRuleAdmin {
  id: string;
  rule_type: AvailabilityRuleType;
  priority: number;
  rule_config: AvailabilityRuleConfig;
  is_available: boolean;
  price_usd: string | null;
  description: string | null;
  updated_at: string;
}

export type AvailabilityRuleAdminPatch =
  | { isAvailable: boolean; expectedUpdatedAt: string }
  | { prefixPrice: { emoji: string; priceUsd: string }; expectedUpdatedAt: string };

export class AvailabilityRulesAdminApiError extends Error {
  readonly kind: "configuration" | "http" | "invalid_response" | "network" | "timeout";
  readonly status?: number;

  constructor(kind: AvailabilityRulesAdminApiError["kind"], status?: number) {
    super(kind === "http" && status ? `availability rules request failed (${status})` : `availability rules request ${kind}`);
    this.name = "AvailabilityRulesAdminApiError";
    this.kind = kind;
    this.status = status;
  }
}

export function getAvailabilityRulesAdminBackend(
  value: string | undefined = import.meta.env?.VITE_AVAILABILITY_RULES_ADMIN_BACKEND,
): "supabase" | "worker" {
  const backend = value?.trim();
  if (!backend || backend === "supabase") return "supabase";
  if (backend === "worker") return "worker";
  throw new AvailabilityRulesAdminApiError("configuration");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => hasOwn(value, key));
}

function validTime(value: unknown): value is string {
  return typeof value === "string" && value.length <= 64 && Number.isFinite(Date.parse(value));
}

function validMoney(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && /^(?:0|[1-9][0-9]{0,7})\.[0-9]{2}$/u.test(value));
}

function parseConfig(value: unknown): AvailabilityRuleConfig {
  if (!isRecord(value) || Object.keys(value).some((key) => !["prefixes", "patterns", "pricing", "enabled"].includes(key))) {
    throw new AvailabilityRulesAdminApiError("invalid_response");
  }
  if (hasOwn(value, "enabled") && typeof value.enabled !== "boolean") throw new AvailabilityRulesAdminApiError("invalid_response");
  if (hasOwn(value, "patterns") && (!Array.isArray(value.patterns) || value.patterns.length > 100 ||
      value.patterns.some((pattern) => typeof pattern !== "string" || pattern.length > 256))) {
    throw new AvailabilityRulesAdminApiError("invalid_response");
  }
  if (hasOwn(value, "prefixes") && (!isRecord(value.prefixes) || Object.keys(value.prefixes).length > 50 ||
      Object.values(value.prefixes).some((price) => typeof price !== "number" || !Number.isFinite(price) || price < 0 || price > 99_999_999.99))) {
    throw new AvailabilityRulesAdminApiError("invalid_response");
  }
  if (hasOwn(value, "pricing") && (!isRecord(value.pricing) || Object.keys(value.pricing).some((key) => !/^[1-5]$/u.test(key)) ||
      Object.values(value.pricing).some((price) => typeof price !== "number" || !Number.isFinite(price) || price < 0 || price > 99_999_999.99))) {
    throw new AvailabilityRulesAdminApiError("invalid_response");
  }
  return value as AvailabilityRuleConfig;
}

function parseRule(value: unknown): AvailabilityRuleAdmin {
  const keys = ["id", "rule_type", "priority", "rule_config", "is_available", "price_usd", "description", "updated_at"];
  if (!isRecord(value) || !exactKeys(value, keys) || typeof value.id !== "string" || !UUID.test(value.id) ||
      typeof value.rule_type !== "string" || !RULE_TYPES.has(value.rule_type) ||
      typeof value.priority !== "number" || !Number.isInteger(value.priority) || value.priority < 1 || value.priority > 4 ||
      typeof value.is_available !== "boolean" || !validMoney(value.price_usd) ||
      !(value.description === null || (typeof value.description === "string" && value.description.length <= 2_000)) ||
      !validTime(value.updated_at)) throw new AvailabilityRulesAdminApiError("invalid_response");
  return {
    id: value.id.toLowerCase(),
    rule_type: value.rule_type as AvailabilityRuleType,
    priority: value.priority,
    rule_config: parseConfig(value.rule_config),
    is_available: value.is_available,
    price_usd: value.price_usd,
    description: value.description as string | null,
    updated_at: value.updated_at,
  };
}

async function readJson(response: Response): Promise<unknown> {
  if (response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json" || !response.body) {
    throw new AvailabilityRulesAdminApiError("invalid_response");
  }
  const declared = response.headers.get("content-length");
  if (declared && /^\d+$/u.test(declared) && Number(declared) > MAX_RESPONSE_BYTES) {
    void response.body.cancel().catch(() => undefined);
    throw new AvailabilityRulesAdminApiError("invalid_response");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_RESPONSE_BYTES) {
        void reader.cancel().catch(() => undefined);
        throw new AvailabilityRulesAdminApiError("invalid_response");
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof AvailabilityRulesAdminApiError) throw error;
    throw new AvailabilityRulesAdminApiError("invalid_response");
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown; }
  catch { throw new AvailabilityRulesAdminApiError("invalid_response"); }
}

async function requestJson(path: string, init: RequestInit, fetchImplementation: typeof fetch): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetchImplementation(path, {
      ...init,
      signal: controller.signal,
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!response.ok) throw new AvailabilityRulesAdminApiError("http", response.status);
    return await readJson(response);
  } catch (error) {
    if (error instanceof AvailabilityRulesAdminApiError) throw error;
    if (controller.signal.aborted) throw new AvailabilityRulesAdminApiError("timeout");
    throw new AvailabilityRulesAdminApiError("network");
  } finally {
    clearTimeout(timer);
  }
}

export async function listAvailabilityRules(
  fetchImplementation: typeof fetch = fetch,
): Promise<AvailabilityRuleAdmin[]> {
  const payload = await requestJson(API_PATH, { method: "GET", headers: { Accept: "application/json" } }, fetchImplementation);
  if (!isRecord(payload) || !exactKeys(payload, ["schemaVersion", "rules"]) || payload.schemaVersion !== 1 ||
      !Array.isArray(payload.rules) || payload.rules.length > 64) throw new AvailabilityRulesAdminApiError("invalid_response");
  return payload.rules.map(parseRule);
}

export async function updateAvailabilityRule(
  id: string,
  patch: AvailabilityRuleAdminPatch,
  fetchImplementation: typeof fetch = fetch,
): Promise<AvailabilityRuleAdmin> {
  if (!UUID.test(id)) throw new AvailabilityRulesAdminApiError("configuration");
  const payload = await requestJson(`${API_PATH}/${encodeURIComponent(id.toLowerCase())}`, {
    method: "PATCH",
    headers: { Accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify(patch),
  }, fetchImplementation);
  if (!isRecord(payload) || !exactKeys(payload, ["schemaVersion", "rule"]) || payload.schemaVersion !== 1) {
    throw new AvailabilityRulesAdminApiError("invalid_response");
  }
  return parseRule(payload.rule);
}
