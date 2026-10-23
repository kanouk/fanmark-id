# 最終確認状態と未確認事項

この文書は最後に独立照合した状態の記録で、現在値を保証するlive monitorではない。
本番操作の前には[更新手順](deployment.md)で現在のmain/CI/active deploymentを読み戻す。

## 本番移行と配備

**最終照合: 2026-10-24 00:50 JST**。公開本番はCloudflareで稼働し、一般メンテナンスは解除済み。

| 項目 | 最終確認した状態 |
| --- | --- |
| 本番URL | `https://fanmark.id/`。Worker Route方式。www/adminはalias Workerの限定転送 |
| 本番app | `fanmark-app-production` / active 100% `68cdfe9b-ea09-4297-9de4-7dd9204c8b26` |
| 配備operationのソース | `1e33a518f5f7e2d26bbd85c89642597cfa4d5e69` / [PR70](https://github.com/kanouk/fanmark-id/pull/70)。frontendは`dde6a7f`のbuildとbyte同一で、配備ソースとの入力tree一致を照合 |
| 配備時点のmain | `637dd2aa37c725150152ebe989395de52c620557`。取り込み後のmain/CIは[PR70](https://github.com/kanouk/fanmark-id/pull/70)を参照。非文書fileを配備ソースと別に照合 |
| 配備のPR CI / main CI | 修正版ソース [39977912764](https://github.com/kanouk/fanmark-id/actions/runs/39977912764) の全6 job成功。最終文書HEADのPR CI・main CIは[PR70](https://github.com/kanouk/fanmark-id/pull/70)を参照 |
| 文書入口の整理 | [PR44](https://github.com/kanouk/fanmark-id/pull/44)、main `3b13f283a6d479246d8bc285fbdeece8324451e9`。[main CI](https://github.com/kanouk/fanmark-id/actions/runs/39518911227)の2 job成功。アプリの再配備は不要 |
| 開発入口の最終整理 | `c1b29fd`で旧遠隔smoke入口と起動/補助ガイドを整理。当時の25資産が当時の配備済み版とSHA-256一致。今回の改修・資産は別行に記録 |
| 実行コード・設定 | PR64のcatalog背景取得・必要時だけの待機・入力保持、認証/maintenance並行確認、管理/分析/プランの遅延importに加え、PR66で所有者・案内等18 routeを分割。4言語は即時切替を維持。PR67で共有用OG画像だけPWA先読みから除外し、全画面コードと基本画面・アイコンは保持。PR68で公開catalogをIndexedDBへ保存し、ready版をオンライン照合して同版だけ再利用。版変更・破損・保存障害は通常取得へ戻し、個人API/SW cache方針は保持。PR69でフォント指定を非同期の1件へ統一し、公開HTMLの早期表示と認証機能の確認待ち領域予約を追加。PR70で共有絵文字パレットの4言語名称検索・Jev候補・連続選択/Undoを導入。最大5個・既存正規化/取得・catalog再利用を保持。Jev失敗時も名称/一覧は使える。予算集計は既存system_settingsの非公開keyに置き、DB構造とbackupのschema pinを保持。Lint 0必須。秘密設定名はJevキーを含む18件、D1/R2/DO・runtime・4 Cron・3 Routeと他3 Workerを保持 |
| 公開確認 | root/Auth capabilities/maintenanceは200、未認証profile/owned/notifications/admin sessionは401/no-store。既存PWAの同profile更新・snapshot SHA-256/3,944件・再訪1件照合、4言語×320/375/390/430px、Jev実検索3件と連続選択・例外0を確認。実検索以外の業務POSTはしていない。先行の503と15秒未完了も保持し、速度の安定性は保証しない |
| frontend資産 | [manifest](deployed-assets-2026-10-23-jev-palette.json)。旧hashを保持した231 file。追加辞書JSONは必要時取得。robots.txtのsource hashとCloudflare配信時追記を区別 |

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
| 自然日次backupの継続 | 初回は上記の通り確認済み。通常Cron/monitorを保持。PR70のread-only照会でscheduled票4件（更新前版3・現行1）、ownerなし・HTTP票0を観測。未解決時のdrain拒否と対応は[運用調査#71](https://github.com/kanouk/fanmark-id/issues/71)を優先する。現行1件の通常実行/残存と自然backupの成否は未確定。障害時はreceipt/claim/実保存物を調べる。連続成功や将来の実削除は初回成功だけから推定しない。 |
| 旧Supabase退役 | 原本保持中。10月28日ごろの見直しは提案で、削除承認ではない。[保持終了条件](../migration/production-operations.md#旧supabaseの保持終了を判断する条件)を確認する。 |
| モバイル表示 | [PR60](https://github.com/kanouk/fanmark-id/pull/60)で取得ボタンの補助操作を狭い画面では通常配置へ変更。匿名rootの390px→400px、320px→365pxの幅超過を解消。本番4言語×4幅・合成localの5絵文字/dialog/picker/取得と390px編集を確認。実端末確認は別項目 |
| 過去のStripe履歴 | 旧subscription objectのprovider取得ができない履歴上の制約を保持。取得成功に書き換えない。解約済み自己テスト契約と未送信sandbox記録を保持する。 |
| 別端末での鍵復旧 | 同じMacからの遠隔Sync読戻しは確認済み。Mac喪失時の別端末でのアクセス・復号は未実証。 |

## 開発基盤改修の検証範囲

[計画の完了記録](../REFACTORING_PLAN.md#2026-10-22-開発基盤の受け入れ)を参照する。
合成localで認証・保存・権限拒否・画像・下書き・アカウント切替を検証し、本番は匿名の公開確認を行った。
続く[PR60](https://github.com/kanouk/fanmark-id/pull/60)で匿名rootの幅超過とLint警告19件を解消。client218件・現行契約132件と実Worker/ブラウザ・PR/main CIが成功した。
[PR64](https://github.com/kanouk/fanmark-id/pull/64)で初期JS gzip 618,153→446,087 bytes（約28%減）。型・Lint 0・client222件・現行契約138件、実Worker/ブラウザの待機・取消・失敗/再試行・遅延module・認証拒否と通常回帰が成功した。公開では既存PWA更新・catalog待機なしのトップ・16表示幅・34資産を独立確認した。詳細は[起動の比較](../development/STARTUP_PERFORMANCE.md)。
続く[低速回線の模擬計測](../development/SLOW_NETWORK_2026-10-23.md)で、公開本番の初回/PWA再訪を通信・CPU制限下で測定した。これはアプリ更新や再配備ではない。
[PR66](https://github.com/kanouk/fanmark-id/pull/66)で初期JS gzip 446,087→338,962 bytes（約24%減）。型・Lint 0・client225件・現行契約138件と実local/公開確認が成功。今回取り直した初回LCP中央値は1.6Mbpsで3.764→3.240秒、400kbpsで11.416→9.268秒。PWA再訪はほぼ同等、初回総転送量は約3.5%増でPWA先読みを次の改善候補に残した。[比較と限界](../development/ROUTE_SPLITTING_2026-10-23.md)。
[PR67](https://github.com/kanouk/fanmark-id/pull/67)でOG画像だけをPWA先読みから除外。公開82 fileの変更はSWのみで、他はbyte同一。初回総転送量は約1.755→1.064MB（約39%減）、SW先読み約1.091→0.400MB（約63%減）。初回LCP中央値は3.072→3.600秒／9.432→9.764秒、TTFBも増えており表示速度の改善は未確認。隔離SWの新規導入/更新/オフライン/入力・storage保持、既存公開PWAの自動更新・cache60→59差分、実Worker回帰と4言語×4幅が成功。[比較と限界](../development/PWA_PRECACHE_2026-10-23.md)。
[PR68](https://github.com/kanouk/fanmark-id/pull/68)で版付き公開catalogをIndexedDBへ保存し、再訪は既存APIの1件照合で同版を再利用。実localのready版変更・破損・拒否/block/quota/abort、旧公開PWA更新・snapshot検証・4言語/4幅と130資産保持が成功。前後24 navigationで入力受理と転送量を比較。[比較と限界](../development/CATALOG_REUSE_2026-10-23.md)。
[PR69](https://github.com/kanouk/fanmark-id/pull/69)でGoogle Fontsの重複除去/非同期適用、HTMLの公開起動表示、認証機能確認待ちの領域予約を追加。前後48 navigationで表示・操作を比較し、実localの11 UX条件・通常回帰、既存PWA更新・catalog snapshot保持・公開4言語/4幅と179資産を検証。[比較と限界](../development/SUPPORTING_UX_2026-10-23.md)。
[PR70](https://github.com/kanouk/fanmark-id/pull/70)で保存試作のJevを共有入力へ移植。型・Lint 0・client239件・現行契約150件・実D1 API16件、通常local/CI/PWAと本番の3検索・4言語/4幅を検証。ヒーローは別。初期JS gzipは約2.47%減だが、公開計測では表示速度維持を確認できず、未完了も保持。検索品質・費用・表示の比較と未完了試行は[レポート](../development/JEV_PALETTE_2026-10-23.md)を参照。
本人の実アカウントでの再受け入れ・実端末・自然回線のLCP/CLS確認は未実施。

## 詳細原本

非秘密の完了要約はこの文書とPR/CI。個人データを含む操作証拠、鍵・backupのcustody、intent/receiptは
[Git外保管先](private-access.md)へ辿る。旧再開票の「PR41未マージ」「移送前」「本番Supabase」は当時の記録。
新しいoperationごとに現在値を確認し、この文書の日時・配備ソース・証拠・未確認事項を更新する。
