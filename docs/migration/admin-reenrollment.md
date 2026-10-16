# 管理者の認証アプリ再登録

所有者は2026-10-16に移行先での再登録を選択した。Supabaseの既存factorは変更しない。
この手順は本番データ移送・DNS切替の許可を取り直すためのものではなく、本人だけが行える認証操作である。

## 実施経路

Node 22で、Git外の所有者専用0700ディレクトリを指定する。

```sh
node scripts/migration/run-admin-reenrollment.mjs --private-dir /Users/kanouk/.codex/private/fanmark-cutover-2026-10-16
```

起動時に固定Supabase projectのAuth snapshotをread-onlyで取得し、同じMacの127.0.0.1だけで専用画面を開く。
入口URLは一度だけ使える能力トークンをfragmentに持つ。共有・記録公開しない。
Helperは20分で終了する。再起動しても保存済みcapsuleを上書きしない。
画面に期限と失敗した段階を表示する。終了時もエラーを隠さない。
旧TOTP確認は入力のたびに新しいchallengeを取得し、期限切れや使用済みchallengeを再利用しない。
資格情報を含まない進行段階・残試行回数・期限だけをGit外の`admin-reenrollment-status.json`へ保存する。
この進行記録は登録完了の証拠ではなく、完了判定には暗号化capsuleの存在・復号・最終source照合を要求する。

1. 本人が現在の管理者パスワードを入力する。Supabaseの既存SDKでログインし、対象UUIDと既存のverified TOTP factorを照合する。
2. 本人が旧認証アプリのコードを入力する。Supabaseのchallenge/verifyとgetUserで本人・AAL2を確認し、DBから権限・資格情報を再取得して変化がないことを確認する。
3. この時点で初めて、同じUUIDとbcryptを持つ1人分の一時D1をメモリ内に作る。業務データも公開handlerもない。固定Better Auth SDKの通常enable/verify経路で新しい認証を登録する。本人がQRを読み取り、復旧コードを保存し、新しいコードを入力する。
4. 新しいfactorの検証後、さらにパスワードからfresh sessionを開始し、同じ新コードの要求・成功とsession単位のMFA assurance・adminRoleをDBで照合する。旧環境の資格情報を再確認し、暗号化capsuleを保存・読戻し検証する。一時D1とhelper内のsessionを破棄する。Supabaseログアウトはこのhelperのsessionだけを対象にする。

画面を開くだけでは本番AuthへのログインもMFA登録も行わない。パスワード送信後はSupabaseの通常ログインとしてsessionが作られるが、既存factorや業務データは変更しない。
秘密情報をツール出力・Git・チャットへ書かない。QR表示後は画面の自動読み取りやスクリーンショットを避け、本人が操作する。

## 保存と本番投影

`admin-reenrollment.key`と`admin-reenrollment.aesgcm.json`をGit外に0600で保存する。
AES-256-GCMのAADはprojectとpurposeを固定する。source bindingは同じ鍵によるHMACで、管理者UUID、email確認状態、bcrypt、停止状態、provider identity、旧factor秘密・ID、admin role/planを結び付ける。
ログインによって変わるupdated_atや表示名はbindingに含めない。現在の管理者以外、未確認メール、停止中、複数factorは拒否する。

`projectSupabaseAuth(source, { encrypt, reenrollment: { capsule, key } })`は、最終sourceとbindingが一致し、検証から24時間以内のcapsuleだけを受け入れる。新しいSDK secretと復旧コードは最終targetの鍵で暗号化し直す。
元の管理者UUID/roleは保持し、factorは新IDへ置換する。MFA無効化の例外フラグは設けない。
旧session、一時target session、verification、MFA assuranceは本番へ投影しない。

保存鍵とcapsuleは同じMac内にあるため、これだけで災害復旧用バックアップ・鍵の別保管が完成したとは扱わない。
期限切れ・資格情報変更時には再登録をやり直す。本番import後の閉鎖環境で、本人が実targetの管理者ログイン/MFAを成功させることが公開前の別条件として残る。

## 検証と未完了

`npm run test:admin-reenrollment`で、旧認証不成立・別user・AAL1・回数超過・期限超過・source drift・改ざん・間違った鍵・Origin/Host/cookie不一致を拒否することを検証する。
合成のsource API応答とnative D1/Better Authで正常経路を確認する。実Supabaseの本人操作や本番D1への移送成功とは区別する。
既存Auth投影試験も継続する。通常CIの`test:migration-data`に含める。

実本人の再登録、prod key custody、最終snapshotの照合、本番import、実targetの管理者ログインは未完了。
その他P1〜P8の条件が揃うまで旧サービスを停止せず、ドメインを切り替えない。
