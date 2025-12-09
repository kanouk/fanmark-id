# fanmark.id ARCHITECTURE.md

## リポジトリ構造
- `src/`
  - `pages/`: 画面エントリ (`Index`, `Auth`, `Dashboard`, `PlanSelection`, `Profile`, `Favorites`, 各プレビュー/設定/詳細ページ、Admin系)。
  - `components/`: 画面構成要素。`components/ui` は shadcn/ui ベースの共通パーツ。
  - `hooks/`: Supabase 呼び出しや状態管理のカスタムフック（例: `useFavoriteFanmarks`, `useFanmarkSearch`, `useSubscription`）。
  - `providers/`: Supabase クライアントやテーマなどグローバルプロバイダ。
  - `integrations/`: Supabase型定義や外部連携ラッパー。
  - `translations/`: `en.json` / `ja.json`。言語トグルが全体で参照。
  - `lib` / `utils`: 変換・バリデーション・フォーマッタ（emoji 正規化、URL/電話番号生成など）。
- `supabase/functions/`: Edge Functions 群。主要なものは下記参照。
- `supabase/migrations/`: DB マイグレーション（Supabase CLI 生成形式）。
- `public/`: アセット。`generate-ogp-image` のテンプレート画像等。

## 画面とモジュールのマッピング
- `/` トップ/ランディング: `src/pages/Index.tsx`
- `/auth`: 認証/サインアップ/パスワードリセット: `src/pages/Auth.tsx`
- `/forgot-password`: `ForgotPassword.tsx`
- `/reset-password`: `ResetPassword.tsx`
- `/profile`: ユーザー設定: `Profile.tsx` + `UserProfileForm.tsx`
- `/dashboard`: ダッシュボード（ファンマ管理+移管/抽選バッジ）: `Dashboard.tsx` + `FanmarkDashboard.tsx`
- `/favorites`: お気に入り一覧: `Favorites.tsx`
- `/plans`: プラン選択・ダウングレード選択モーダル: `PlanSelection.tsx`, `FanmarkSelectionModal.tsx`
- `/fanmarks/:fanmarkId/settings`: `FanmarkSettingsPage.tsx` + `FanmarkSettings.tsx`
- `/fanmarks/:fanmarkId/profile/edit|preview`: `EmojiProfileEdit.tsx`, `FanmarkProfilePreview.tsx`
- `/fanmarks/:fanmarkId/messageboard/preview`: `FanmarkMessageboardPreview.tsx`
- `/f/:shortId`: ファンマ詳細（whois）: `FanmarkDetailsPage.tsx`
- `/a/:shortId`: 短縮アクセス: `FanmarkAccessByShortId.tsx`
- `/:emojiPath`: キャッチオールアクセス: `FanmarkAccess.tsx` + `FanmarkAcquisition.tsx`
- `*`: `NotFound.tsx`
- 管理画面 (admin サブドメイン想定): `AdminApp.tsx`, `AdminDashboard.tsx`, `AdminAuth.tsx`
- 主要コンポーネント: `Navigation`, `LanguageToggle`, `FanmarkSearch`, `FanmarkRegistrationForm`, `EmojiInput`, `FanmarkStatusBadge`, `GraceStatusCountdown`, `InvitationSystem`, `AdminTierExtensionPrices`, `AdminPatternRules`, `AdminDataReset`, `AdminSettings`.

## サービスフローとデータ
- 検索: `FanmarkSearch`/`useFanmarkSearch` → RPC `check_fanmark_availability`（Tier/SLA/available_at/lottery情報含む）。検索結果と最近取得は件数制限し、ローカルにプリフィル保存。
- 取得: `register-fanmark` Edge Functionが Tier 判定 (`classify_fanmark_tier`)、ライセンス作成、監査ログを実行。成功後は設定ページへ遷移。
- 管理: ダッシュボードは Supabase からライセンス＋設定を取得し、React Query キャッシュで一覧表示。返却は `return-fanmark` / `bulk-return-fanmarks` を呼び、ステータスを `grace` へ遷移。
- ライセンス延長: `extend-fanmark-license` Edge Function。無期限 (Tier C) は延長不可、抽選申込がある場合は延長が優先され pending をキャンセル。
- 抽選: `apply-fanmark-lottery` / `cancel-lottery-entry` でエントリ登録。`check-expired-licenses` が grace 終了時に抽選・新ライセンス発行・通知。
- 譲渡: `generate-transfer-code` → `apply-transfer-code` → `approve/reject-transfer-request`。コード存在中は返却/延長をブロック。完了時に新ライセンスをティアに応じて発行し設定をコピー。
- お気に入り: `record_fanmark_search`, `add/remove_fanmark_favorite`, `get_favorite_fanmarks` で discovery/favorite を維持し、返却完了時に通知イベントを生成。
- プラン: `change-subscription` / `create-checkout` / `create-extension-checkout` / `customer-portal` / `handle-stripe-webhook` / `check-subscription` が Stripe 同期を担う。`subscription-sync-flow` に従いポーリングでプラン状態を反映。
- 公開アクセス: `FanmarkAccess`/`FanmarkAccessByShortId` が RPC から最小データを取得し、アクセスタイプごとに UI 分岐。パスワード保護は `fanmark_password_configs` 経由。
- 通知: `notification_events` → `notification_rules` → `notifications`。`process-notification-events` Edge Function がスケジュール実行し、in-app/メール等をチャネル別に生成。`notification_templates` で本文管理、`notifications_history` にアーカイブ。
- OGP: `fanmark-ogp` / `generate-ogp-image` で OGP 動的生成。

## ディレクトリ・依存のヒント
- フロント: React + React Router + React Query + Tailwind + shadcn/ui。`components/ui` に集約したスタイルを利用。テーマ切替は `next-themes`（client）で実装。
- 型: `src/integrations/supabase/types.ts` は Supabase 型の単一ソース。RPC 追加時は更新必須。
- 状態: キャッシュは React Query、フォームは React Hook Form + Zod。トーストは `sonner`。
- 画像/アップロード: Supabase Storage を利用。プロフィール画像はローカルステート基準で同期。

## バッチ・スケジュール
- Cron (Supabase Dashboard/pg_cron): `check-expired-licenses-daily` (毎日 UTC 0:00), `process-notification-events-every-minute` (毎分) が HTTP POST で Edge Functions を叩く。
- `check-expired-licenses` はライセンスの active→grace→expired 遷移、抽選実行、通知イベント挿入を担当。

## 監査とセキュリティ
- 監査: 主要 Edge Functions は `audit_logs` に記録。移管・抽選・延長・返却・Stripe Webhook はメタデータを保存。
- RLS: `fanmark_lottery_entries`, `fanmark_favorites`, `fanmark_discoveries`, `invitation_codes`, `fanmark_transfer_*` などは認可ポリシーで保護。管理系は `is_admin()` / `is_super_admin()` を使用。
- レート/重複防止: `notification_events.dedupe_key`、抽選のユニーク制約、招待コードの残数チェックで制御。
