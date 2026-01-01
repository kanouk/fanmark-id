# fanmark.id TECH.md

## スタックとランタイム
- フロント: Vite + React 18 + TypeScript, React Router, React Query, Tailwind CSS, shadcn/ui (Radix UI), Zod + React Hook Form, Sonner (toast), Lucide。
- バックエンド: Supabase (PostgreSQL, Auth, Storage, Edge Functions, pg_cron, Realtime)。
- 決済: Stripe (Checkout, Subscription, Customer Portal, Webhook)。
- 通知: Supabase テーブル駆動のイベント→ルール→キュー方式、Resend 等の外部チャネルを追加可能。
- その他: Vite PWA、OGP 生成 Edge Function、MCP サーバ統合（計画/実装中）。

## セットアップと開発
1. 依存インストール: `npm install`（または `bun install`）。  
2. 開発サーバー: `npm run dev`（ポートは Vite デフォルト）。  
3. 型/静的チェック: `npm run lint`。  
4. ビルド: `npm run build` / プレビュー `npm run preview`。  
5. Supabase ローカル: `npm run db:start` / `db:reset` / `db:stop`（`supabase` CLI 依存）。`supabase link --project-ref <ref>` で本番/ステージングへ接続。  
6. 翻訳追加時は `src/translations/*.json` を編集し、UI で言語切替を確認。

## Supabase: スキーマ/関数運用
- Migration-first: `supabase migration new <name>` で作成し、既存関数の返り値変更時は **必ず `DROP FUNCTION IF EXISTS ...`** を先頭に置く（`SUPABASE_MIGRATION_GUIDE.md` 方針）。
- 主な Edge Functions:  
  - ライセンス/取得: `register-fanmark`, `return-fanmark`, `bulk-return-fanmarks`, `extend-fanmark-license`, `check-expired-licenses`  
  - 抽選: `apply-fanmark-lottery`, `cancel-lottery-entry`  
  - 譲渡: `generate-transfer-code`, `apply-transfer-code`, `approve-transfer-request`, `reject-transfer-request`, `cancel-transfer-code`  
  - 決済: `create-checkout`, `create-extension-checkout`, `change-subscription`, `customer-portal`, `handle-stripe-webhook`, `check-subscription`  
  - 通知: `process-notification-events`  
  - 管理/ユーティリティ: `_shared/return-helpers`, `reset-fanmark-data`, `admin-*`, `fanmark-ogp`, `generate-ogp-image`, `record-fanmark-access`
- RPC/ビュー: `check_fanmark_availability`, `get_fanmark_by_emoji/short_id/complete_data`, `validate_invitation_code`, `use_invitation_code`, `add/remove_fanmark_favorite`, `get_favorite_fanmarks`, `record_fanmark_search`, `get_user_lottery_entries`, `notification` 系など。追加時は `src/integrations/supabase/types.ts` を同期。
- Cron: Supabase Dashboard > Database > Cron Jobs で HTTP POST 実行。  
  - `check-expired-licenses-daily` (`0 0 * * *`) → `functions/v1/check-expired-licenses`  
  - `process-notification-events-every-minute` (`* * * * *`) → `functions/v1/process-notification-events`

## セキュリティ / RLS の公開方針（誤検知対策）
このプロダクトは「ドメインレジストリ（WHOIS）モデル」で、**一部のデータは意図的に公開**します。セキュリティスキャナが「公開＝危険」と判定しやすいため、以下の公開方針は **誤検知として無視（ignore）** します。

- `fanmarks`: 所有/登録状態は公開情報（検索・トレンド機能の前提）。
- `fanmark_licenses`: `user_id` はUUIDのみで、PIIは `user_settings` に隔離。所有関係は公開情報。
- `fanmark_discoveries`: `search_count` / `favorite_count` 等の匿名集計のみ（PIIなし）。
- `system_settings`: `is_public=true` の設定のみ公開。プランの表示価格・上限は `system_settings` を参照する。
- `recent_active_fanmarks`（VIEW）: 「最近のファンマーク」表示用の最小限データのみ。
- `user_roles`: 役割判定はRLS + SECURITY DEFINER の `has_role()` 等で制御（他ユーザーの役割列挙は不可）。

**スキャンで頻出する誤検知（ID）**
- `PUBLIC_USER_DATA` (fanmark_licenses): レジストリモデルのため仕様上公開（UUIDのみ、PIIは `user_settings`）。
- `PUBLIC_USER_DATA` (fanmark_discoveries): 匿名集計データ（search_count, favorite_count）のみでPII無し。
- `EXPOSED_SENSITIVE_DATA` (system_settings): `is_public=true` の設定のみ公開（RLSで制御済み）。
- `MISSING_RLS_PROTECTION` (recent_active_fanmarks): VIEWのRLS指摘だが、公開用の最小データのみで仕様上公開。
- `MISSING_RLS_PROTECTION` (user_roles): 役割テーブルは「本人のrole参照のみ」を許可。タイミング攻撃の懸念は一般的に許容範囲（必要ならレート制限/監査ログで補強）。
- `SUPA_function_search_path_mutable`: 一部の関数でsearch_path未設定の警告。主要SECURITY DEFINER関数は設定済みで低リスク。
- `SUPA_extension_in_public`: publicスキーマの拡張警告。実害なし。

> 重要: `user_settings` は **常に auth.uid() = user_id** で保護し、公開しない（PII保護の境界）。



## Stripe デプロイメント（要約）
- テスト/本番で別々の Product/Price・Webhook エンドポイントを作成。Webhook URL: `https://<project>.supabase.co/functions/v1/handle-stripe-webhook`、イベントは checkout.session.completed / customer.subscription.* / invoice.payment_* を登録。
- Supabase Secrets（Lovable/Supabase CLI 経由）を更新: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID_CREATOR`, `STRIPE_PRICE_ID_BUSINESS`, `FRONTEND_URL`。
- Customer Portal はモードごとに設定し、プラン切替を許可。延長 Price ID は `fanmark_tier_extension_prices` を Admin UI から管理（環境変数不要）。
- Checkout 後は `subscription-sync-flow` のポーリングでプラン同期。問題があれば `stripe_payment_intents` / `stripe_webhook_events` / `user_settings.plan_type` を照合。
- Stripe Customer は初回決済時に作成・取得し、`user_settings.stripe_customer_id` に保存。Webhook は `stripe_customer_id` でユーザー特定する。
- `customer.subscription.deleted` は同一customerにactiveサブスクが存在しない場合のみ `plan_type='free'` に更新。
- プラン変更（有料→有料）は `subscriptions.update` で price を更新し、アップグレードは `proration_behavior='create_prorations'`、ダウングレードは `proration_behavior='none'` とする。
- 有料→有料の更新で支払い方法が不足している場合は Customer Portal に誘導して支払い方法を追加する。
- `check-subscription` は Stripe の price_id を参照して `user_settings.plan_type` を同期する。
- `customer.subscription.created/updated` は `status='active'` の場合のみ `plan_type` を更新する（トライアル無し）。
- `checkout.session.completed` で `metadata.type=license_extension` の場合、延長後は必ず status=active, grace_expires_at=null, is_returned=false、除外解除、UTC 0:00 に丸めた `license_end` へ更新し、フロントの延長パス（extend-fanmark-license）と同じ状態遷移に揃える。

## 通知・お気に入り・抽選の実装ガイド
- 通知: まず `notification_events` にイベントを登録（`create_notification_event` RPC）。`notification_rules` でチャネル・遅延・クールダウンを定義し、`process-notification-events` が `notifications` を生成。フロントは React Query で in-app 未読を購読し、既読更新 RPC を提供。
- お気に入り: `fanmark_discoveries` で未取得も含めたカタログを保持し、`fanmark_favorites` と `fanmark_events` で使用履歴を管理。UI トグル後はキャッシュを無効化して一覧と統計カードを同期。
- 抽選: Grace 中のみ申込可。延長は申込中でも可能で、延長実行時は pending エントリーを `cancelled_by_extension` に更新し通知。バッチで抽選→ライセンス発行→通知→履歴保存までをトランザクションで処理。
- 移管ロック: 移管完了時に `fanmark_licenses.transfer_locked_until` を30日後で更新し、`generate-transfer-code` で発行をブロック。

## MCP / 外部連携
- MCP サーバー方針: Edge Function `mcp-server`（計画）で `get_fanmark_profile`, `get_fanmark_redirect`, `get_fanmark_message`, `search_fanmark` ツールを公開。公開プロフィールのみ返却し、パスワード・非公開は抑止。`emojiConversion.ts` と既存 RPC を再利用。
- 画像メール/メール送信は Resend 等に差し替え可能。OGP は `generate-ogp-image` でサーバーサイド生成。
- Cloudflare 等の CDN/キャッシュをかける場合はパスワード保護・非公開プロフィールの扱いに注意。

## 開発ワークフロー
- 原則 GitHub を単一ソース。Supabase 変更は Migration 経由でコミットし、`supabase db pull` で同期確認。Lovable での UI 調整後も Git に反映。
- 変更手順例: `git pull` → 開発 → `supabase migration new ...`（必要時）→ `npm run lint` → `git add` → `git commit` → `git push`。Supabase 連携で自動デプロイされる。
- トラブル時: 関数返り値変更エラーは `DROP FUNCTION` を確認、cron 未実行は `cron.job` / Edge Function Logs を確認、Stripe 反映不全は Price ID と Secrets を照合。

## QA/テスト観点
- Tier 判定: 1〜5個の絵文字（連続/非連続）で S/A/B/C を網羅。無期限ライセンスは延長不可で表示を「無期限」扱い。
- 返却/猶予: `grace_expires_at` に基づく再取得不可/カウントダウン表示を確認。`available_at` を UI に出す。
- 移管: コード発行条件（残48h+、申請中ブロック、AuthCode有効期限48h固定/`license_end`までの短い方）、承認後の新ライセンス発行・設定コピー、Transfer Lock 30日を検証。
- 抽選: 延長との排他、0/1/複数件パス、当落通知、履歴保存。
- 抽選エラー: `apply-fanmark-lottery` の `fanmark_limit_reached` を UI で翻訳して表示する。
- Stripe: Checkout → Webhook → `user_settings.plan_type` 反映、Customer Portal でプラン変更、延長決済の Price ID 設定。
- お気に入り/通知: 返却時の `favorite_fanmark_available` 通知、未読バッジ、キャッシュ同期。
- UI改修の原則: 本来不要なロジック（バリデーション・データ処理）を変更しない。仕様変更が必要な場合は必ず仕様を確認し、ユーザーの合意を取ってから行う。Auth では特に、ログインパスワードは8文字以上でチェック表示、目アイコンは入力が1文字以上のときだけ表示し、メール欄とアイコン位置を揃える。
