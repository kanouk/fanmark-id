# Fanmark Tier Specification (2026-02 Rework)

## 1. Tier Overview

| Tier Level | Display Name | Rule (after normalization) | Initial License | Notes |
|------------|--------------|----------------------------|-----------------|-------|
| 1          | C            | 4〜5 個以上の絵文字（ただし連続パターンを除く） | 無期限 (`initial_license_days = NULL`) | `fanmark_licenses.license_end` も `NULL` で保持 |
| 2          | B            | 3 個の絵文字 | 30 日 | 従来の Tier2 を継承 |
| 3          | A            | 2 個の絵文字、または 2〜5 個の完全一致（連続）パターン | 14 日 | 肌色違い/ZWJ も正規化後に同じ ID なら連続扱い |
| 4          | S            | 1 個の絵文字 | 7 日 | 旧 Tier3 相当 |

`fanmark_tiers.display_name` にラベル（C/B/A/S）を保存し、管理 UI でもこの値を使用する。

## 2. Classification Logic

新しい SQL 関数 `public.classify_fanmark_tier(input_emoji_ids uuid[])` が全レイヤーの単一ソースとなる。判定順序は以下の通り。

1. 入力配列の長さが 1 → Tier4(S)
2. 入力配列の全要素が同一（連続パターン）かつ長さ 2〜5 → Tier3(A)
3. 長さが 4 以上 → Tier1(C)
4. 長さが 3 → Tier2(B)
5. 長さが 2 → Tier3(A)

入力は正規化済み `uuid[]`（肌色差分などを除去した ID）を想定。異常値（0 個、6 個以上）の場合は `NULL` を返し、呼び出し元で `invalid_length` を通知する。

## 3. Database Changes

- `fanmark_tiers`
  - `display_name text NOT NULL` を追加
  - `initial_license_days` を `NULL` 許容に変更（Tier1 無期限を表現）
  - Tier3 の `emoji_count_min/max` を 2〜5 に拡張、Tier4 row を追加
- `fanmark_licenses.license_end` は `NULL` 許容に変更。Tier1 では `NULL` を保持し、「占有中」として扱う。
- `fanmark_tier_extension_prices` に Tier4 の料金を Tier3 から複製し、延長機能の既存挙動を維持。
- `fanmark_basic_configs` / `fanmark_redirect_configs` / `fanmark_messageboard_configs` の RLS ポリシーを更新し、`license_end IS NULL` の無期限ライセンスでも所有者が設定更新できるようにする。
- ダッシュボードのファンマ検索 UI は取得完了後に検索入力をクリアし、無用な再取得エラーや混乱を避ける。

## 4. RPC / Edge Functions

- `public.check_fanmark_availability` は `classify_fanmark_tier` を呼び出し、レスポンスに `tier_display_name` と `license_days`（`NULL` 許容）を返す。
- `register-fanmark` Edge Function はローカル `determineTier` を廃止し、分類結果から `tier_level` と `initial_license_days` を取得。Tier1 の場合はライセンスを無期限 (`license_end = null`) で作成する。
- `extend-fanmark-license` は `license_end` が `NULL` のライセンスを延長不可として早期リターンする。

## 5. Frontend Updates

- 管理画面は `display_name` を表示し、初回日数フィールドに「無期限」トグルを追加。
- ダッシュボード／延長ダイアログは `license_end` が `NULL` の場合に「無期限」ラベルを表示し、延長操作を無効化。
- 検索結果は `tier_display_name` と `license_days` を保存し、Tier 表示（C/B/A/S）と無期限テキストを UI 上で示す。

## 6. API Consumers

- 新規レスポンス項目
  - `check_fanmark_availability`: `tier_display_name`, `license_days`
  - `register-fanmark`: 応答 `fanmark` に `tier_level`, `tier_display_name`, `initial_license_days`
- 連携側で Tier 分類ロジックを重複実装している場合は、本関数経由に切り替えること。

## 7. 実装サマリ（2025-10-24 時点）

- **マイグレーション**: `supabase/migrations/20260201090000_rework_fanmark_tiers.sql`
  - `fanmark_tiers` に `display_name` カラムを追加し、Tier ごとの絵文字数・初回日数・説明文を再設定。
  - Tier4 (S) row を新規追加し、Tier3 の延長料金を複製。
  - `fanmark_licenses.license_end` の NULL 許容化と無期限ライセンス対応。
  - `classify_fanmark_tier(uuid[])` / `check_fanmark_availability(uuid[])` を再実装して Tier 判定と無期限の可視化を統合。

- **Edge Function**
  - `supabase/functions/register-fanmark/index.ts`
    - 新しい `classify_fanmark_tier` を利用して Tier 情報と初回ライセンス日数を決定。
    - Tier1(C) では `license_end = null` でライセンス作成。
    - 監査ログに `tier_display_name`, `initial_license_days` を記録。
  - `supabase/functions/extend-fanmark-license/index.ts`
    - 無期限 (`license_end is null`) ライセンスを延長対象外として早期終了処理を追加。
    - 新しい Tier4 に対して料金テーブルを参照。
  - `_shared/return-helpers.ts` を更新し、無期限ライセンスでも `return` フローが整合するように `check_fanmark_availability_secure` と整合。

- **フロントエンド**
  - `FanmarkDashboard`, `ExtendLicenseDialog`, `FanmarkQuickRegistration` など Tier とライセンス日数を扱うコンポーネントで、ラベル表示（C/B/A/S）と無期限表示／延長不可のハンドリングを追加。
  - 検索・ダッシュボードで `tier_display_name`, `license_days` を UI/状態に保持。
  - 翻訳 (`src/translations/en.json`, `ja.json`) に新しいラベル・文言を追加。

- **管理 UI / Hooks**
  - `AdminTierExtensionPrices.tsx` で Tier4 の料金設定を操作可能に拡張。
  - `useFanmarkSearch.tsx`, `useFanmarkLimit.tsx` 等のフックで新しいレスポンス項目を扱うよう更新。

## 8. デプロイ手順

1. **Database Migration**
   - Supabase SQL Editor もしくは CLI で `20260201090000_rework_fanmark_tiers.sql` を適用する。
2. **Edge Function Deploy**
   - `supabase functions deploy register-fanmark extend-fanmark-license`
3. **フロントエンドのビルド・デプロイ**
   - 依存パッケージの更新は不要。
   - ビルド後、UI の Tier ラベルと無期限表示を確認する。

## 9. テスト観点

- **RPC / Functions**
  - `classify_fanmark_tier` の戻り値が Tier1〜4 に対して期待どおりになるか（1〜5 個の絵文字・連続パターン／非連続パターンの組み合わせで確認）。
  - `check_fanmark_availability` が `tier_display_name`, `license_days` を返し、異常系（0 個, 6 個以上, 未登録絵文字 ID）で `invalid_length` / `invalid_emoji_ids` を返すか。
- **Edge Functions**
  - `register-fanmark` で Tier1(C) を登録した際、`license_end` が `null` になること。
  - `extend-fanmark-license` で `license_end is null` のライセンスに対し `400`（延長不可）が返ること。
- **UI**
  - ダッシュボード／延長ダイアログで C/B/A/S のラベルと「無期限」表記が表示され、無期限ライセンスでは延長ボタンが無効化されること。
  - ファンマ検索から登録した直後に検索欄が空になること（残らないこと）。
  - 管理画面の延長料金設定で Tier4 を編集できること。
- **互換性**
  - 既存の Tier2/3 レコードが期待どおりに再分類される（例: Tier3(A) の `emoji_count_max`=5、Tier4(S) が追加されている）。
  - API レスポンスを利用する外部クライアントが新しいフィールドを取得できること。
