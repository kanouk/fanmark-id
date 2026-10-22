# 最終確認状態と未確認事項

この文書は最後に独立照合した状態の記録で、現在値を保証するlive monitorではない。
本番操作の前には[更新手順](deployment.md)で現在のmain/CI/active deploymentを読み戻す。

## 本番移行と配備

**最終照合: 2026-10-23 06:50 JST**。公開本番はCloudflareで稼働し、一般メンテナンスは解除済み。

| 項目 | 最終確認した状態 |
| --- | --- |
| 本番URL | `https://fanmark.id/`。Worker Route方式。www/adminはalias Workerの限定転送 |
| 本番app | `fanmark-app-production` / active 100% `7de243f5-1907-4080-8408-53a70983b318` |
| 配備operationのソース | `b1d7cfbf16e68de75e516893c5f9856bfd01ab28` / [PR64](https://github.com/kanouk/fanmark-id/pull/64)。frontendも同じ検証済みソースからbuild |
| 配備時点のmain | `256a8507a647e23b47121e6ed8db55b2c650cc89`。配備後のmain/CIはPR64を参照。非文書fileの同一性を配備ソースと別に照合 |
| 配備のPR CI / main CI | 候補 [39859114353](https://github.com/kanouk/fanmark-id/actions/runs/39859114353) の全6 job成功。最終main CI・取り込み結果は[PR64](https://github.com/kanouk/fanmark-id/pull/64)を参照 |
| 文書入口の整理 | [PR44](https://github.com/kanouk/fanmark-id/pull/44)、main `3b13f283a6d479246d8bc285fbdeece8324451e9`。[main CI](https://github.com/kanouk/fanmark-id/actions/runs/39518911227)の2 job成功。アプリの再配備は不要 |
| 開発入口の最終整理 | `c1b29fd`で旧遠隔smoke入口と起動/補助ガイドを整理。当時の25資産が当時の配備済み版とSHA-256一致。今回の改修・資産は別行に記録 |
| 実行コード・設定 | PR64でcatalog背景取得・必要時だけの待機・入力保持、認証/maintenance並行確認、管理/分析/プランの遅延import。Lint 0必須。秘密設定名17件、D1/R2/DO・runtime・4 Cron・3 Routeと他3 Workerを保持 |
| 公開確認 | root/Auth capabilities/maintenanceは200、未認証profile/owned/notifications/admin sessionは401/no-store。カタログ応答0件のままトップ表示。既存PWA更新・4言語×320/375/390/430pxと旧hash資産を確認。公開確認でPOSTは実行していない |
| frontend資産 | [manifest](deployed-assets-2026-10-23-startup.json)。旧hashを保持した34 file。robots.txtの配信時追記はsource hashと区別し、公開の更新前後byte一致も確認 |

後からmergeしたdocs-only commitはこの配備ソースに含まれない。文書のmergeとアプリの配備を別に管理する。
通常production configがD1/R2/DO/Route/Cronの非秘密な構成を保持する。V1/V2や旧stagingの資源を本番と取り違えない。

## 完了済みの受け入れ

- [PR41](https://github.com/kanouk/fanmark-id/pull/41): 実データ移送・Worker Route公開・通常Cron・alias接続・旧自動配備廃止まで完了しmerge済み。
- 既存accountのログインと新しい管理者MFAは本人確認済み。Google/Discord/Apple/GitHubの本番callbackは保存・再表示照合済み。再登録しない。
- 移行時の画像109件のbytes照合、実backupの118表・109画像の隔離復旧、監視通知の本人受信、公開後30分監視を受け入れた。現在のデータ件数が同じとは推定しない。
- [PR42](https://github.com/kanouk/fanmark-id/pull/42): 全件既読の空stream誤判定を修正。本人UIと独立D1 SELECTで残4件の既読化・未読0・内容保持を確認した。
- PR43: 関連6経路を点検し追加同型不具合なし。関連83件とWorker型検査が成功。本番の所有者データを使った削除/決済試験はしていない。

## 自然日次backupの初回確認

2026-10-21のUTC slotを、手動実行せず照合した。時刻はJST。

| 項目 | 確認した結果 |
| --- | --- |
| 自然daily | 09:05:25開始、09:07:33にreceiptが`verified`。09:07:36の`production_backup_verified`と、`5 0 * * *`のscheduledイベントの`outcome: ok`を照合 |
| 実保存物 | R2から暗号化archive全33,306,335 bytesを独立GET。receipt・自然実行ログ・実ファイルのSHA-256一致。既存鍵で認証付き復号し、全part・118表・109画像の整合性を確認。今回の確認では復旧先への書込みはしていない |
| 保持処理 | 30日保持処理は09:07:35完了、期限対象の削除0件。30日経過後の実削除を確認したという意味ではない |
| 停止解除 | receiptの`fenceReleased: true`と現在の調停状態を独立照合。09:46時点でownerなし、active writer 0、完全ticket走査で残存0 |
| 定期monitor | 09:35:16のscheduledイベントが`outcome: ok`、`production_backup_monitor_healthy`のslotが`2026-10-21`。当該時間帯のbackup/monitorログはともにerror 0、当日scopeの障害通知8種類のclaimはすべて不存在 |
| 公開と設定 | root/Auth capabilities/maintenanceは200、一般メンテナンス解除、未認証notifications/admin sessionは401。app/backup/monitorの100% versionとCronを保持 |

backup versionは`bd6ccaa6-eb42-462c-ab1c-dc33e939c152`、monitor versionは
`1d8029c1-545e-46ae-8a1b-c06d198ce8df`。修正や本番appの再配備は不要だった。
完全な証拠は[Git外journal](private-access.md#保存済みの操作記録を探す)に保存した。
これは初回の単発確認であり、新しい毎日の外部確認を予約したものではない。

## 続けて確認すること

| 項目 | 最終記録時点の境界・次の確認 |
| --- | --- |
| 自然日次backupの継続 | 初回は上記の通り確認済み。通常Cronとmonitorを継続し、障害時はreceipt/claim/実保存物を調べる。連続成功や将来の実削除は初回成功だけから推定しない。 |
| 旧Supabase退役 | 原本保持中。10月28日ごろの見直しは提案で、削除承認ではない。[保持終了条件](../migration/production-operations.md#旧supabaseの保持終了を判断する条件)を確認する。 |
| モバイル表示 | [PR60](https://github.com/kanouk/fanmark-id/pull/60)で取得ボタンの補助操作を狭い画面では通常配置へ変更。匿名rootの390px→400px、320px→365pxの幅超過を解消。本番4言語×4幅・合成localの5絵文字/dialog/picker/取得と390px編集を確認。実端末確認は別項目 |
| 過去のStripe履歴 | 旧subscription objectのprovider取得ができない履歴上の制約を保持。取得成功に書き換えない。解約済み自己テスト契約と未送信sandbox記録を保持する。 |
| 別端末での鍵復旧 | 同じMacからの遠隔Sync読戻しは確認済み。Mac喪失時の別端末でのアクセス・復号は未実証。 |

## 開発基盤改修の検証範囲

[計画の完了記録](../REFACTORING_PLAN.md#2026-10-22-開発基盤の受け入れ)を参照する。
合成localで認証・保存・権限拒否・画像・下書き・アカウント切替を検証し、本番は匿名の公開確認を行った。
続く[PR60](https://github.com/kanouk/fanmark-id/pull/60)で匿名rootの幅超過とLint警告19件を解消。client218件・現行契約132件と実Worker/ブラウザ・PR/main CIが成功した。
[PR64](https://github.com/kanouk/fanmark-id/pull/64)で初期JS gzip 618,153→446,087 bytes（約28%減）。型・Lint 0・client222件・現行契約138件、実Worker/ブラウザの待機・取消・失敗/再試行・遅延module・認証拒否と通常回帰が成功した。公開では既存PWA更新・catalog待機なしのトップ・16表示幅・34資産を独立確認した。詳細は[起動の比較](../development/STARTUP_PERFORMANCE.md)。
本人の実アカウントでの再受け入れ・実端末・低速回線LCP/CLSの確認を実施済みとはしない。

## 詳細原本

非秘密の完了要約はこの文書とPR/CI。個人データを含む操作証拠、鍵・backupのcustody、intent/receiptは
[Git外保管先](private-access.md)へ辿る。旧再開票の「PR41未マージ」「移送前」「本番Supabase」は当時の記録。
新しいoperationごとに現在値を確認し、この文書の日時・配備ソース・証拠・未確認事項を更新する。
