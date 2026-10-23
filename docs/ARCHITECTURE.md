# 構造と画面の対応

主要5画面の表示・controller・共有取得の入口は[画面変更ガイド](development/SCREENS.md)を参照する。

現行本番はCloudflare Workers / Better Auth / split D1 / R2。
[文書案内](README.md)と[運用入口](operations/README.md)を先に読み、過去のstaging受入れ記録とは区別する。

## 本番の構造

通常の開発環境は[ローカル開発](development/LOCAL.md)を使う。
`scripts/dev/local-stack.mjs`が実Worker/Better Auth/local D1・R2とViteを同一HTTPS originへ接続する。
本番の業務実装を共有し、データ・外部接続・秘密設定を分離する。

- `src/`: Vite/Reactの画面・client・hook。`src/main.tsx`で共通CSSを読み、絵文字catalogは裏で取得する。`emoji-catalog-state.ts` / `useEmojiCatalog` / `EmojiCatalogStatus.tsx`が必要時だけの待機・再試行を扱う。
- `index.html` / `AppStartupSkeleton.tsx`: 公開ブランドだけの起動表示。小さい共通CSSをHTMLへ置き、JS前とreadiness待機中で共有する。Google FontsはHTMLの1指定へ統一し非同期に適用。`pages/Auth.tsx`はcapabilities確認待ちのsignup・reset・SNS領域を予約し、確認前の操作は増やさない。
- `src/components/emoji-input/EmojiPalette.tsx`: 共有入力から必要時に読み込むパレット。`shared/emoji-palette`の名称検索・4言語copy、版・SHA検証した公開JSON、`useJevSearch.ts`のdebounce/取消/応答検証を使用。トップ・Dashboard取得欄・PWAで同じ動作を持つ。
- `workers/api/src/emoji-palette-api.ts` / `emoji-palette-jev.ts`: 匿名Jev検索。現在のready MasterのID/並びを使い、旧試作の6観点探索を移植。秘密はWorkerだけに置き、既存IP limiterとBusiness D1の非個人集計による日次上限を確認する。
- `src/lib/emoji-catalog-cache.ts`: 全件検証した公開catalogのIndexedDB snapshot。`emoji-catalog-worker.ts`の既存APIによる1件取得でready版を照合し、保存不備は全件取得、版確認失敗は従来の再試行へ進む。SWのAPI cacheや本人queryとは分離する。
- `src/lib/route-modules.ts` / `RouteModulePreload.tsx`: トップで使わない画面のimportと対象path。直撃URLのコード取得をreadinessと並行させ、画面のmountとAPI権限確認は既存gateに従う。
- `vite.config.ts` / `scripts/check-pwa-cache.mjs`: PWAの静的先読みと生成SW検査。共有用OG画像を除外し、基本HTML・全画面コード・CSS・アイコンを保持する。更新・新規導入・オフライン静的資産は`scripts/test/pwa-precache-browser.mjs`で検証する。
- `workers/api/src/index.ts`: 同originのStatic Assets、API、Auth、公開アクセス、Webhookへの入口。
- `workers/api/src/better-auth.mjs` / `auth-social.mjs`: Better Auth、session/MFA、OAuthと新規ユーザー処理。
- `workers/api/src/*-d1-api.ts`: 本人・所有権・管理者MFAを確認する業務API。
- Auth D1: user/account/session/MFA。Business D1: 所有権・契約projection・設定・通知・操作台帳。
  Master D1: 絵文字releaseと参照マスター。schemaの適用順をstore間で混ぜない。
- `workers/api/src/storage-r2.ts` / `storage-image-url.mjs`: 所有者限定の画像更新と公開R2画像。
  保存済み旧Storage URLはR2 URLへ変換し、旧Supabaseへfetchしない。
- `workers/api/src/ogp.ts`: 現行Workerの公開ページ/OGP。旧Supabase OGP関数は現行配備先ではない。
- `workers/api/src/recovery-writer-drain.ts`: writer追跡と停止境界。
- `workers/api/src/staging-backup.ts` / `recovery-set.ts`: 名前にstagingを含むが、本番にも使うbackup/復旧実装。
  通常設定・保存先は[本番通常運用](migration/production-operations.md)で選ぶ。

AuthProvider / TranslationProviderはsrc/providers/、購読hookと共有contextはsrc/hooks/。UI variantとform/sidebar contextは専用moduleへ分離する。詳しくは[画面変更ガイド](development/SCREENS.md)を参照する。

## 画面・操作から実装を探す

表中の画面名を入口に`src/lib/`のclientと`workers/api/src/`の対応API、該当testを読む。
frontendはWorker APIとBetter Authだけを呼ぶ。[フロントの入口](development/FRONTEND.md)を参照する。
Workerに残る移行期の選択子は通常のfrontend切替や障害時fallbackとして使わない。

| 画面・機能 | 主な画面・hook/client | Worker側の入口・契約 |
| --- | --- | --- |
| トップ・絵文字検索 | `src/pages/Index.tsx`、`src/components/FanmarkSearch.tsx`、`src/lib/recent-fanmarks.ts` | emoji catalog / recent / search API |
| ログイン・signup・初回password | `src/pages/Auth.tsx`、`src/pages/PasswordSetup.tsx`、`src/lib/better-auth-client.ts` | `index.ts`、`better-auth.mjs`、`oauth-signup-provisioning.mjs` |
| password復旧 | `src/pages/ForgotPassword.tsx`、`src/pages/ResetPassword.tsx` | Auth capabilities / Better Auth recovery |
| 管理者ログイン・MFA | `src/pages/AdminAuth.tsx`、`src/pages/AdminDashboard.tsx` | Better Auth + 各admin APIのMFA gate |
| ダッシュボード・返却・延長 | `src/pages/Dashboard.tsx`、`src/components/FanmarkDashboard.tsx` | owned / return / Stripe extension API |
| 移管 | `src/hooks/useTransferCode.ts`、`src/lib/fanmark-transfer-api.ts` | `fanmark-transfer-d1-api.ts` |
| ユーザー設定・退会 | `src/pages/Profile.tsx`、`src/lib/profile-api.ts`、`src/lib/account-deletion-api.ts` | profile / account deletion API |
| ファンマ設定 | `src/pages/FanmarkSettingsPage.tsx`、`src/components/FanmarkSettings.tsx` | `fanmark-settings-d1-api.ts` |
| プロフィール編集・preview | `src/pages/EmojiProfileEdit.tsx`、`src/pages/FanmarkProfilePreview.tsx` | `fanmark-profile-d1-api.ts` |
| 伝言板preview | `src/pages/FanmarkMessageboardPreview.tsx` | fanmark settings / public access |
| whois・詳細 | `src/pages/FanmarkDetailsPage.tsx`、`src/hooks/useFanmarkDetails.tsx` | `fanmark-details-d1-api.ts` |
| 公開短縮URL・絵文字URL・QR | `src/components/FanmarkAccessByShortId.tsx`、`src/pages/FanmarkPublicQR.tsx` | `public-access.ts`、`verified-access.mjs`、`ogp.ts` |
| お気に入り | `src/pages/Favorites.tsx`、`src/hooks/useFavoriteFanmarks.ts` | `favorites-d1-api.ts` |
| お知らせ・通知badge・全件既読 | `src/pages/Notifications.tsx`、`src/hooks/useUnreadNotifications.ts`、`src/lib/notifications-api.ts` | `notifications-d1-api.ts` / [契約](migration/notifications-api.md) |
| プラン・決済管理画面 | `src/pages/PlanSelection.tsx`、`src/lib/stripe-customer-portal-api.ts` | `stripe-*-d1-api.ts`、Stripe webhook/dispatch |
| 招待管理 | `src/components/AdminInvitationManager.tsx`、`src/lib/invitation-admin-api.ts` | `invitation-admin-d1-api.ts` |
| マスター・通知・告知管理 | `src/components/AdminEmojiMaster.tsx`、`src/components/AdminNotificationManager.tsx`、`src/components/AdminBroadcastEmail.tsx` | emoji / notification master / broadcast admin API |
| メンテナンス・期限処理 | `src/components/AdminSettings.tsx`、`src/components/AdminExpirationTest.tsx`、`src/pages/Maintenance.tsx` | maintenance / lifecycle settings / lifecycle run API |
| 画像upload・削除 | `src/lib/storage-api.ts` | `storage-r2.ts` / [契約](migration/storage-r2-app-api.md) |

## 実行先と定期処理

apexのWorker Routeがappへ接続し、www/adminはalias Workerから限定的にHTTPS誘導する。
app・daily backup・monitorの4 Cronと3 Routeは[通常運用](migration/production-operations.md)を参照する。
`wrangler.*-production.jsonc`が通常設定、`*-production-closed.jsonc`は開始前の履歴設定。

providerのcallbackは既存設定を維持する。Webhookは署名検証・receiptと業務反映を分ける。
障害時は[障害対応](operations/incident-response.md)で受信済み・処理済み・未確定を区別し、POSTを再送しない。
旧Supabaseは停止原本で、移送後の書込みを戻す切戻し先にはしない。

旧画面説明、RLS、移行実験とstaging配備履歴は[旧ARCHITECTURE](history/ARCHITECTURE-2026-10-21.md)に保存した。
