# フロントの変更入口

フロントは同originのWorker APIとBetter Authを使う。Supabase client・SDK・JWTブリッジ・realtime購読は使わない。
API関数は入力/応答の検証、timeout、origin、cookie、失敗形式を保持する。画面側からDBへ直接アクセスしない。

| 対象 | 画面・hook | API層 |
| --- | --- | --- |
| ログイン・MFA・初回password | useAuth / useAuthForm / AdminAuth | auth-backend / better-auth-client / profile-api |
| 検索・最近のファンマ | useFanmarkSearch / RecentFanmarksScroll | recent-fanmarks / fanmark-availability / fanmark-search-api |
| 取得・返却・移管・抽選 | FanmarkAcquisition / FanmarkDashboard / 各操作hook | fanmark-registration / return / transfer / lottery の各api |
| 本人プロフィール | useProfile / Profile | profile-api / storage-api |
| ファンマの設定・編集・preview | FanmarkSettings / useEmojiProfile | fanmark-settings-api / fanmark-profile-api |
| 公開URL・パスワード保護 | FanmarkAccess / PasswordProtection | public-access-api / verified-access-api |
| お気に入り・通知 | useFavoriteFanmarks / Notifications | favorites-api / notifications-api |
| プラン・課金・退会 | PlanSelection / ExtendLicenseDialog / Profile | subscription-api / stripe-*-api / account-deletion-api |
| 管理・マスター・招待・告知 | Admin* / SecureWaitlistAdmin | admin-*-api / reference-master-admin-api / invitation-admin-api |

省略名の実ファイルはARCHITECTUREの画面対応表から探す。`src/lib/*-api.ts`が現行のリクエスト契約。
`favorites-backend.ts`は既存import名を保つexportだけで、切替機構は持たない。
本人プロフィールの応答は、指定した期待ユーザーIDとも照合してから画面へ反映する。

## 環境差と停止設定

- API origin: VITE_FANMARK_API_BASE_URL / VITE_AUTH_API_BASE_URL。未指定のブラウザでは同originを使う。
- 告知の一括送信・テスト送信: VITE_BROADCAST_SEND_BACKEND / VITE_BROADCAST_TEST_SEND_BACKEND。
- 管理者リセット: VITE_ADMIN_DATA_RESET_BACKEND。無指定・disabledでは停止する。

最後の3項目は機能を止めるための設定で、旧バックエンドへの切替ではない。
旧バックエンド選択子・SDK・bundled catalogの再導入は `npm run check:frontend` で拒否する。
文字列や過去の説明を機械的に禁止する検査ではない。

## カタログ

main.tsxはWorkerから公開カタログを読み、取得完了後にアプリを起動する。
失敗時はエラーと再試行を表示し、別カタログへfallbackしない。PWA更新確認はカタログ取得より先に行う。
src/data/emojiCatalog.tsはlocal seedに使う公開データで、frontendからはimportしない。
生成CLIは明示したUUID付きJSONなどのファイルを読む。旧サービスの認証情報から取得しない。

## 整理した未使用の旧実装

MFAChallenge/MFAEnrollmentのSupabase専用UI、未参照のFanmarkRegistrationForm/FanmarkQuickRegistration、
未使用の旧絵文字master取得helperとその専用テストを除去した。
既存Better AuthのMFA要求・管理者assurance・Workerの権限判定は維持する。
遠隔Supabaseの原本、保存済み旧Storage URLのR2変換、移行時の履歴文書はこの整理の対象外。
