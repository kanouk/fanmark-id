# Cloudflareで継続開発するためのリファクタリング計画

更新: 2026-10-22。対象: [#47](https://github.com/kanouk/fanmark-id/issues/47)。

目的は、これから画面・機能を頻繁に変更できる開発基盤を作ること。
本番の業務仕様を保持し、次の4条件を実装・回帰テスト・CI・本番配備の証拠で確認する。
行数やファイル数、特定文字列の件数だけで完了を判定しない。

## 今回の到達条件

| 条件 | 実装 | 完了の証拠 |
| --- | --- | --- |
| R0 ローカルで触れる | dev:localを標準経路にする。local D1/R2、Better Auth、合成の一般ユーザー2人と管理者、公開マスター | 検索→取得→ダッシュボード→設定→公開参照、プロフィール保存、管理者MFA、未認証・他人・MFA不足の拒否を実Workerとブラウザで確認 |
| R1 Cloudflare経路だけを追える | フロントの旧Supabase分岐・client依存・二重認証を除去し、既存Worker API層へ統一 | buildの依存と通信を検証。旧サービスへの通信なし。既存APIの成功・拒否・失敗契約とMFAログインを保持 |
| R2 主要画面を部分ごとに直せる | Dashboard、FanmarkSettings、Profile、取得・入力の責務を分離し、取得と更新後同期を整理 | 表示と取得・保存・返却・延長処理を独立して追える。主要導線の回帰テスト成功 |
| R3 変更の破損をCIで検出できる | clientテスト集約、型、Lint、Worker契約・復旧、合成localブラウザ、本番buildを通常CIで実行 | 新規cloneから再現可能。PR/main CI成功。秘密・遠隔書込み・自動配備なし |

## 作業順序

1. **開発環境・検証入口**: 基準計測、local専用構成とseed、常駐サーバー、終了処理、集約テスト。
2. **フロント単一化**: お気に入り・通知、検索・取得・所有、設定、認証、課金・退会、管理の順に機能群で分ける。
   不要catalogのprecache除外・管理画面遅延読込みは独立して扱う。
3. **主要画面の責務分離**: API接続と操作をhookへ、表示とフォームをcomponentへ分ける。
   React Queryは取得・更新後同期に使い、入力・下書きはフォーム側に残す。
4. **CI・型・文書**: 現行回帰・復旧テストを維持し、一回限りの移送検証を通常CIから切り離す。
   API入出力と抽出ロジックの型を先に強化する。文書は各変更と同じPRで更新する。
5. **リリース**: 対象HEADの検証とPR CI成功後、運用手順で候補/active配備を区別して照合する。
   merge/main CI、PC/モバイル/PWA/旧資産保持、未認証拒否、active versionと構成を確認・記録する。

大きな段階は機能群・責務ごとに小さいPRへ分割する。途中のPR完了を4条件全体の完了としない。
Workerルートは公開・本人・管理者・Webhookの認証境界を保持できる単位で分割する。
認証を公開API全体の入口へ一括適用しない。

## 採用した判断

| 事項 | 方針 |
| --- | --- |
| 正規開発経路 | dev:localを採用し安定後はdevも同じ入口。production/staging遠隔設定をそのまま使わない |
| 旧資産削除 | 参照切断を先行。Git内整理と遠隔Supabase退役は別判断。原本の保持終了は今回実施しない |
| 移送helper | 一回限りのものを再実行せず通常scripts/CIから隔離。運用・回帰・復旧で使うものは残す |
| 設定存続 | 移行用切替だけ除去。送信停止・環境差・freeze・復旧・公開先は値の種類数だけで削除しない |
| Node | 今回は22.6.0固定。LTSパッチ更新は別PRで検証して固定更新 |
| MFA | Better Auth MFA・管理者assuranceを保持。Supabase専用UIは整理。一般ユーザー向け新規設定UIは別機能 |

## 変更・検証の原則

- PRODUCT / ARCHITECTURE / TECHを先に読み、公開応答、所有権、上限、監査・原子性、時刻精度を保持する。
- Workerに対応先のない旧機能は不要と推測せず、仕様・到達可能性を確認して不明点を記録する。
- localはloopback専用・合成データ・外部送信なし。遠隔binding・認証情報・Cron・Routeを使わない。
- 削除前にscripts・tests・build設定・動的参照を含めて確認する。
- HTTPヘルパはCORS・cookie・cache・失敗形式が同じものだけ共通化する。
- React Queryはユーザー間キャッシュ混在を防ぎ、ログアウト・取得・保存後の同期を検証する。
- 認証・課金・退会のリファクタリングと仕様変更を同じPRへ混ぜない。
- backup/復旧、writer追跡、画像URL変換、PWA旧cache消去と旧hash資産保持を維持する。
- frontendも配備対象。CIは検証のみ。[更新手順](operations/deployment.md)に従い秘密・実データ・journalはGit外へ置く。
- 問題時はPRまたは検証済みWorker version単位で戻す。旧Supabaseへ切り戻さない。

## 完了記録

- [x] R0: local常駐・合成導線・権限拒否・終了処理
- [x] R1: frontend単一経路・依存除去・契約維持
- [x] R2: 主要画面の責務分離・取得更新同期・画面回帰
- [x] R3: 通常検証コマンド・PR/main CI・文書再現性
- [x] 本番: 候補/active照合・公開確認・旧資産保持・配備記録


## 2026-10-22 開発基盤の受け入れ

- R0: [PR57](https://github.com/kanouk/fanmark-id/pull/57)。同一HTTPSのVite/実Worker/Better Auth/合成D1・R2、管理者MFAと終了時破棄。
- R1: [PR58](https://github.com/kanouk/fanmark-id/pull/58)。フロントの旧SDK・二重認証を除去。送信停止・MFA・API権限境界・復旧契約を保持。
- R2/R3: [PR59](https://github.com/kanouk/fanmark-id/pull/59)。主要5画面をview/controllerへ分離し、本人ID付き共有queryと更新後同期を採用。
- 検証: client218件・現行契約121件・型検査・Lint（error 0、既存warning 19件）、実Worker/ブラウザ、実R2画像、失敗保存と下書き復元、他人拒否、別人ログイン、隔離UI8ケース、招待signup、Worker全契約・統合復旧、本番build/dry-runが成功。
- PR CI: R0 [39639195401](https://github.com/kanouk/fanmark-id/actions/runs/39639195401)、R1 [39642945634](https://github.com/kanouk/fanmark-id/actions/runs/39642945634)、R2 [39644301238](https://github.com/kanouk/fanmark-id/actions/runs/39644301238)。全2 job成功。
- 配備ソースmain: `b800e83c4813d546c7ad8eb1adb970d83d27b687`、main CI [39646666317](https://github.com/kanouk/fanmark-id/actions/runs/39646666317)。検証済みR2 HEAD `296dbd1c554f271480126f4786a893cbe0068666`とtree一致。
- 本番: 2026-10-22 03:01 JSTにactive 100% `aec6964b-ac2c-49ea-bcba-0f10b543ff2e`を独立照合。秘密設定名17件・保存先・runtime・4 Cron・3 Routeと他3 Workerを保持。
- 公開: root/Auth capabilities/maintenanceは200、個人3 API・admin sessionは401/no-store。PC・390px指定のブラウザ、PWAの制御とcache、旧hash資産のbyte一致を確認。rootの既存モバイル幅超過は更新前後で悪化なし。実端末・本人の実アカウントでの再受け入れは今回行っていない。
- 現行フロントのentry JSはgzip約623KB（基準約669KB）。管理画面の遅延読込み等は次の必要性で判断する。

今後の起動は[LOCAL](development/LOCAL.md)、画面の変更箇所は[SCREENS](development/SCREENS.md)、通常検証は `npm run verify:app` と `npm run test:local` を参照する。
Git外原本: [保管先とアクセス](operations/private-access.md)。配備ソースと、その後の開発コマンド・文書のcommitは別々に管理する。


## 2026-10-22 モバイル・Lintの残存項目を解消

- [PR60](https://github.com/kanouk/fanmark-id/pull/60)で取得ボタン右側の補助操作を狭い画面では折り返す通常配置へ変更。本番4言語×320/375/390/430pxで画面幅とscroll幅の一致を確認。
- Hook依存関係、Providerと購読hook/context、UI variantのmodule境界を修正し、Lint警告19件を0件へ。npm run lintは警告0件を必須にする。
- client218件・現行契約132件、実Worker/ブラウザ、5絵文字/dialog/picker、保存・本人切替、既存の失敗保存/下書き/画像/拒否・統合復旧が成功。検索・延長料金の古い応答競合7ケースと、[PR61](https://github.com/kanouk/fanmark-id/pull/61)のブラウザ遷移同期4ケースを含む。
- PR CI [39694302383](https://github.com/kanouk/fanmark-id/actions/runs/39694302383)とmain CI [39694309591](https://github.com/kanouk/fanmark-id/actions/runs/39694309591)の全2 job成功。
- 2026-10-22 08:54 JSTにactive 100% `9397fc9a-0456-4ac9-8605-44ccdd4ca369`と公開・PWA・旧資産を照合。保存先・秘密設定名・runtime・Cron/Route・他Workerは変更なし。詳細は[最終確認状態](operations/current-state.md)。

## 今回の後に再評価する項目

### CI待ち時間の改善（#52の限定範囲）

既存の全Worker検査を4群に分け、独立したCI runnerで実行する。
各群のコマンドと従来63種類の実行対象は[TECH](TECH.md#workerテストの実行群)で照合する。
重複する復旧検査2実行を除き、認証・業務・backup/復旧・ブラウザ・本番buildの検査範囲は維持する。
全面的なVitest設定統合やWorkerソース移動とは別の変更として扱う。

Worker全ファイル移動、全mjsのTS化、全vitest設定統合、全画面React Query化、全面strict化、
トースト/ローディング統一、Admin CRUD共通化は、効果と変更リスクを見て別作業にする。
これらを4条件の代わりの達成指標にしない。

## 過去の計画

- [2026-10-21版](history/REFACTORING_PLAN-2026-10-21.md): 移行後実測と旧Phase 0〜7。数値は当時の記録。
- [2026-06-12版](history/REFACTORING_PLAN-2026-06-12.md): Supabase時代。現行実装指示として使わない。
