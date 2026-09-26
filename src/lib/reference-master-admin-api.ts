export interface AdminTierSettings {
  id: string;
  tier_level: number;
  display_name: string;
  description: string | null;
  initial_license_days: number | null;
  is_active: boolean;
}

export interface AdminExtensionPrice {
  id: string;
  tier_level: number;
  months: number;
  price_yen: number;
  is_active: boolean;
  stripe_price_id: string | null;
  stripe_price_id_live: string | null;
}

export interface ReferenceMasterAdminPricing {
  schemaVersion: 1;
  releaseVersion: string;
  generation: number;
  tiers: AdminTierSettings[];
  extensionPrices: AdminExtensionPrice[];
}

export class ReferenceMasterAdminApiError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ReferenceMasterAdminApiError";
    this.code = code;
  }
}

type ApiOptions = { baseUrl: string; fetcher?: typeof fetch; timeoutMs?: number };

const ERROR_MESSAGES: Record<string, string> = {
  unauthenticated: "管理者として再ログインしてください。",
  admin_required: "この操作には管理者権限が必要です。",
  mfa_enrollment_required: "管理操作の前に二要素認証を登録してください。",
  mfa_required: "二要素認証をもう一度確認してください。",
  reference_master_edit_conflict: "別の更新が先に保存されました。最新の設定を読み直してください。",
  reference_master_row_not_found: "対象の設定が見つかりません。最新の設定を読み直してください。",
  invalid_stripe_price_id: "Stripe Price IDの形式を確認してください。",
  invalid_reference_master_edit: "更新内容を確認してください。",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readErrorCode(value: unknown): string {
  return isRecord(value) && typeof value.error === "string" ? value.error : "request_failed";
}

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function parsePricing(value: unknown): ReferenceMasterAdminPricing {
  if (!isRecord(value) || value.schemaVersion !== 1 ||
      typeof value.releaseVersion !== "string" || !/^[0-9a-f]{64}$/u.test(value.releaseVersion) ||
      !Number.isSafeInteger(value.generation) || Number(value.generation) < 1 ||
      !Array.isArray(value.tiers) || !Array.isArray(value.extensionPrices)) {
    throw new ReferenceMasterAdminApiError("invalid_response", "料金設定APIの応答形式が不正です。");
  }
  const tiers = value.tiers.map((item): AdminTierSettings => {
    if (!isRecord(item) || typeof item.id !== "string" || !Number.isSafeInteger(item.tier_level) ||
        typeof item.display_name !== "string" || !nullableString(item.description) ||
        !(item.initial_license_days === null || Number.isSafeInteger(item.initial_license_days)) ||
        typeof item.is_active !== "boolean") {
      throw new ReferenceMasterAdminApiError("invalid_response", "料金設定APIの応答形式が不正です。");
    }
    if (Number(item.tier_level) < 1 || Number(item.tier_level) > 4 ||
        (item.initial_license_days !== null && (Number(item.initial_license_days) < 0 || Number(item.initial_license_days) > 36_500))) {
      throw new ReferenceMasterAdminApiError("invalid_response", "料金設定APIの応答形式が不正です。");
    }
    return item as unknown as AdminTierSettings;
  });
  const extensionPrices = value.extensionPrices.map((item): AdminExtensionPrice => {
    if (!isRecord(item) || typeof item.id !== "string" || !Number.isSafeInteger(item.tier_level) ||
        !Number.isSafeInteger(item.months) || !Number.isSafeInteger(item.price_yen) ||
        typeof item.is_active !== "boolean" || !nullableString(item.stripe_price_id) ||
        !nullableString(item.stripe_price_id_live) ||
        [item.stripe_price_id, item.stripe_price_id_live].some((id) =>
          id !== null && (typeof id !== "string" || !/^price_[A-Za-z0-9]{1,128}$/u.test(id)))) {
      throw new ReferenceMasterAdminApiError("invalid_response", "料金設定APIの応答形式が不正です。");
    }
    if (Number(item.tier_level) < 1 || Number(item.tier_level) > 4 || Number(item.months) < 1 || Number(item.months) > 120 ||
        Number(item.price_yen) < 0 || Number(item.price_yen) > 2_147_483_647) {
      throw new ReferenceMasterAdminApiError("invalid_response", "料金設定APIの応答形式が不正です。");
    }
    return item as unknown as AdminExtensionPrice;
  });
  return { ...value, tiers, extensionPrices } as unknown as ReferenceMasterAdminPricing;
}

export function createReferenceMasterAdminApi({ baseUrl, fetcher = fetch, timeoutMs = 15_000 }: ApiOptions) {
  const endpoint = new URL("/api/admin/reference-masters/pricing", baseUrl);

  async function request(init: RequestInit = {}): Promise<ReferenceMasterAdminPricing> {
    let response: Response;
    try {
      response = await fetcher(endpoint, {
        ...init,
        credentials: "include",
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new ReferenceMasterAdminApiError("request_failed", "Cloudflareの料金設定APIに接続できませんでした。");
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    if (!response.ok) {
      const code = readErrorCode(payload);
      throw new ReferenceMasterAdminApiError(code, ERROR_MESSAGES[code] ?? "料金設定を更新できませんでした。");
    }
    return parsePricing(payload);
  }

  return {
    get(): Promise<ReferenceMasterAdminPricing> {
      return request({ method: "GET" });
    },

    updateTierDays(
      releaseVersion: string,
      id: string,
      initialLicenseDays: number | null,
    ): Promise<ReferenceMasterAdminPricing> {
      return request({
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          expectedReleaseVersion: releaseVersion,
          type: "tier",
          id,
          changes: { initialLicenseDays },
        }),
      });
    },

    updateExtensionPrice(
      releaseVersion: string,
      id: string,
      changes: Partial<Pick<AdminExtensionPrice, "price_yen" | "is_active" | "stripe_price_id" | "stripe_price_id_live">>,
    ): Promise<ReferenceMasterAdminPricing> {
      const wireChanges: Record<string, unknown> = {};
      if (Object.prototype.hasOwnProperty.call(changes, "price_yen")) wireChanges.priceYen = changes.price_yen;
      if (Object.prototype.hasOwnProperty.call(changes, "is_active")) wireChanges.isActive = changes.is_active;
      if (Object.prototype.hasOwnProperty.call(changes, "stripe_price_id")) wireChanges.stripePriceId = changes.stripe_price_id;
      if (Object.prototype.hasOwnProperty.call(changes, "stripe_price_id_live")) wireChanges.stripePriceIdLive = changes.stripe_price_id_live;
      return request({
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          expectedReleaseVersion: releaseVersion,
          type: "extension_price",
          id,
          changes: wireChanges,
        }),
      });
    },
  };
}
