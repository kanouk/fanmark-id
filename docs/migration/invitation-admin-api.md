# 招待コード管理のD1 API

## 2026-10-06の現在地

現行Worker `471faabe-3aff-4312-ba22-cd326dc821e1`は登録D1 selector、Resend送信、
D1メールテンプレートとResend secret bindingを保持する。実capability GETは
signUp/emailVerification/passwordReset=true、invitationRequired=false。
登録は現在有効で、招待コードは必須ではない。以下の初期未設定・登録閉鎖の記録は
その時点のcheckpointとして扱う。[現在の限定証拠](evidence/staging-invitation-capabilities-current-2026-10-06.json)。
新規登録・招待コード消費・追加メールは今回実行していない。

## 範囲

既存の管理画面 `AdminInvitationManager` から、招待コードの一覧、作成、編集、有効/無効切替、削除を明示的にCloudflare Worker + business D1へ切り替えられるようにする。Worker selectorは`INVITATION_ADMIN_BACKEND=d1`、フロントselectorは`VITE_INVITATION_ADMIN_BACKEND=worker`。どちらも未設定時はWorker APIを停止し、フロントはSupabaseを既定とする。

## 保護と契約

- Better Authの既存管理者roleと、現在のsession/factorに結び付いたMFA assuranceを各管理APIで要求する。
- `GET /api/admin/invitation-codes`は最大500件を新しい順に返す。DTOは管理画面に必要なコード・利用数・期限・特典・状態・更新時刻だけを返し、作成者IDを含めない。
- `POST /api/admin/invitation-codes`はコード（nullならWorkerで生成）、最大利用回数、期限、JSON objectの特典を受け取る。利用数と状態はサーバーが初期化する。
- `PATCH /api/admin/invitation-codes/{uuid}`は最大利用数、期限、特典、有効状態だけを受け付け、必須`expectedUpdatedAt`との一致を条件に更新する。利用数・招待コード文字列・作成者は編集できない。
- `DELETE /api/admin/invitation-codes/{uuid}`は既存`user_settings.invited_by_code`から参照されるコードを外部キーで保護する。
- same-origin credentials CORS、`no-store`、5秒client timeout、応答サイズ/DTO検査を適用する。Worker障害時にSupabaseへフォールバックしない。

## サインアップとの境界

招待モード設定の管理API、招待コードの実データ、ユーザー行のremote D1 importはこのAPIの対象外。公開コード検証、Better Auth signup、確認メールのCoordinatorは `docs/migration/invitation-signup-api.md` に別実装し、両schema migrationとWorkerをstagingへ配備済み。初期配備時にはResend資格情報とsignup selectorがなく登録は閉じていた。現在の設定・実登録メールの限定証拠は `docs/migration/invitation-signup-api.md` を参照。

## 検証と現在地

- `npm --prefix workers/api run test:invitation-admin-d1`: 合成D1統合試験5件。
- `npm run test:invitation-admin-api`: フロントclient契約試験4件。
- Worker/frontend typecheckと変更ファイルESLintを確認。
- `INVITATION_ADMIN_BACKEND=d1` と `VITE_INVITATION_ADMIN_BACKEND=worker` をworkers.dev stagingだけで有効化。2026-09-26のWorker `839710a3-3290-46f8-b43c-c3a1e21d89c2` で、合成Better Auth管理者の同一session/factor MFA後に作成・一覧・compare-and-set編集・古い更新拒否・無効化・削除を確認した。作成者列はDTOに出ず、最後にbusiness D1の招待コード行は0件。Auth user-owned rowsも全て0件へ戻った。
- stagingのSPA JSと`/api/auth/ok`は200、未認証招待管理GETは401。ローカルWorker統合5件、frontend client契約4件、Worker/frontend typecheck、staging buildが成功。テストは合成コードのみで、招待コードやユーザー行は移行していない。
- 初期checkpointでは招待モード設定・公開コード検証・コード消費・Better Auth signup・確認メールは未接続だった。現在の公開コード検証/signup経路は配備済みで、登録/確認メールは別の実受け入れ記録がある。招待必須モードでの実消費と招待管理のnative編集は今回のGETで受け入れていない。招待コードの実データ移送、production、domain/DNSは変更なし。
