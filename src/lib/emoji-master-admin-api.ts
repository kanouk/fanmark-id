export interface EmojiMasterAdminInput {
  emoji: string;
  shortName: string;
  keywords: string[];
  category: string | null;
  subcategory: string | null;
  codepoints: string[];
  sortOrder: number | null;
}

export interface EmojiMasterAdminItem extends EmojiMasterAdminInput {
  id: string;
  updatedAt: string;
  releaseProtected: boolean;
}

export interface EmojiMasterAdminPage {
  schemaVersion: 1;
  activeReleaseVersion: string | null;
  page: number;
  pageSize: number;
  total: number;
  items: EmojiMasterAdminItem[];
}

export class EmojiMasterAdminApiError extends Error {
  readonly code: string;
  readonly importedCount?: number;

  constructor(code: string, message: string, importedCount?: number) {
    super(message);
    this.code = code;
    this.importedCount = importedCount;
    this.name = "EmojiMasterAdminApiError";
  }
}

type ApiOptions = {
  baseUrl: string;
  fetcher?: typeof fetch;
  timeoutMs?: number;
};

const ERROR_MESSAGES: Record<string, string> = {
  unauthenticated: "管理者として再ログインしてください。",
  admin_required: "この操作には管理者権限が必要です。",
  mfa_enrollment_required: "管理操作の前に二要素認証を登録してください。",
  mfa_required: "二要素認証をもう一度確認してください。",
  emoji_identity_release_protected: "公開済み絵文字の絵文字とコードポイントは変更できません。",
  emoji_deletion_requires_release_review: "削除は参照先と公開履歴の確認後に行ってください。",
  emoji_edit_conflict: "別の更新が先に保存されました。最新の内容を読み直してください。",
  emoji_conflict: "同じ絵文字がすでに登録されています。",
  emoji_codepoints_mismatch: "絵文字とコードポイントが一致していません。",
  invalid_emoji_record: "絵文字マスターの入力内容を確認してください。",
  invalid_import_batch: "インポートは1回あたり1〜100件にしてください。",
  duplicate_import_emoji: "インポートファイルに同じ絵文字が複数あります。",
  request_too_large: "インポートデータが大きすぎます。ファイルを分けてください。",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseItem(value: unknown): EmojiMasterAdminItem {
  if (!isRecord(value) ||
      typeof value.id !== "string" ||
      typeof value.emoji !== "string" ||
      typeof value.shortName !== "string" ||
      !Array.isArray(value.keywords) || value.keywords.some((entry) => typeof entry !== "string") ||
      !(value.category === null || typeof value.category === "string") ||
      !(value.subcategory === null || typeof value.subcategory === "string") ||
      !Array.isArray(value.codepoints) || value.codepoints.some((entry) => typeof entry !== "string") ||
      !(value.sortOrder === null || Number.isSafeInteger(value.sortOrder)) ||
      typeof value.updatedAt !== "string" ||
      typeof value.releaseProtected !== "boolean") {
    throw new EmojiMasterAdminApiError("invalid_response", "絵文字マスター API の応答形式が不正です。");
  }
  return value as unknown as EmojiMasterAdminItem;
}

function parsePage(value: unknown): EmojiMasterAdminPage {
  if (!isRecord(value) || value.schemaVersion !== 1 ||
      !(value.activeReleaseVersion === null || /^[0-9a-f]{64}$/u.test(String(value.activeReleaseVersion))) ||
      !Number.isSafeInteger(value.page) || !Number.isSafeInteger(value.pageSize) ||
      !Number.isSafeInteger(value.total) || !Array.isArray(value.items)) {
    throw new EmojiMasterAdminApiError("invalid_response", "絵文字マスター API の応答形式が不正です。");
  }
  return { ...value, items: value.items.map(parseItem) } as EmojiMasterAdminPage;
}

function readErrorCode(value: unknown): string {
  return isRecord(value) && typeof value.error === "string" ? value.error : "request_failed";
}

export function createEmojiMasterAdminApi({ baseUrl, fetcher = fetch, timeoutMs = 15_000 }: ApiOptions) {
  const root = new URL("/api/admin/emoji-master", baseUrl);

  async function request(path: string, init?: RequestInit): Promise<unknown> {
    const response = await fetcher(new URL(path, root), {
      ...init,
      credentials: "include",
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
    });
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    if (!response.ok) {
      const code = readErrorCode(payload);
      throw new EmojiMasterAdminApiError(code, ERROR_MESSAGES[code] ?? "絵文字マスターを更新できませんでした。");
    }
    return payload;
  }

  function jsonInit(method: string, body: unknown): RequestInit {
    return {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    };
  }

  return {
    async list(params: { page: number; pageSize: number; search: string }): Promise<EmojiMasterAdminPage> {
      const url = new URL(root);
      url.searchParams.set("page", String(params.page));
      url.searchParams.set("pageSize", String(params.pageSize));
      url.searchParams.set("search", params.search);
      const payload = await request(`${url.pathname}${url.search}`);
      return parsePage(payload);
    },

    async get(id: string): Promise<EmojiMasterAdminItem> {
      return parseItem(await request(`/${encodeURIComponent(id)}`));
    },

    async create(input: EmojiMasterAdminInput): Promise<EmojiMasterAdminItem> {
      return parseItem(await request("", jsonInit("POST", input)));
    },

    async update(id: string, updatedAt: string, input: EmojiMasterAdminInput): Promise<EmojiMasterAdminItem> {
      return parseItem(await request(`/${encodeURIComponent(id)}`, jsonInit("PUT", { ...input, updatedAt })));
    },

    async import(records: EmojiMasterAdminInput[]): Promise<number> {
      let importedCount = 0;
      for (let offset = 0; offset < records.length; offset += 100) {
        try {
          const payload = await request("/import", jsonInit("POST", { records: records.slice(offset, offset + 100) }));
          if (!isRecord(payload) || !Number.isSafeInteger(payload.importedCount) || Number(payload.importedCount) < 0) {
            throw new EmojiMasterAdminApiError("invalid_response", "絵文字マスター API の応答形式が不正です。");
          }
          importedCount += Number(payload.importedCount);
        } catch (error) {
          if (importedCount > 0) {
            const reason = error instanceof Error ? error.message : "不明なエラーです。";
            throw new EmojiMasterAdminApiError(
              "partial_import_failed",
              `先行する${importedCount}件は未公開ドラフトに保存済みです。公開版は変わっていません。${reason}`,
              importedCount,
            );
          }
          throw error;
        }
      }
      return importedCount;
    },
  };
}
