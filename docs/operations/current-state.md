# 最終確認状態と未確認事項

この文書は最後に独立照合した状態の記録で、現在値を保証するlive monitorではない。
本番操作の前には[更新手順](deployment.md)で現在のmain/CI/active deploymentを読み戻す。

## 本番移行と配備

**最終照合: 2026-10-21 09:50 JST**。公開本番はCloudflareで稼働し、一般メンテナンスは解除済み。

| 項目 | 最終確認した状態 |
| --- | --- |
| 本番URL | `https://fanmark.id/`。Worker Route方式。www/adminはalias Workerの限定転送 |
| 本番app | `fanmark-app-production` / active 100% `d709b04e-ee97-417d-9887-290c5c8d271a` |
| 配備operationのソース | `856599149b8faf9001f05e3ca5eccd69b7bf5f4a` / [PR43](https://github.com/kanouk/fanmark-id/pull/43) |
| 配備時点のmain | `e3aedcd12f18c0451d64fd72d2d6eaf91bb34d06`。検証済みPR HEADとtree一致 |
| 配備のPR CI / main CI | [39512200608](https://github.com/kanouk/fanmark-id/actions/runs/39512200608) / [39513921922](https://github.com/kanouk/fanmark-id/actions/runs/39513921922)。ともに2 job成功 |
| 文書入口の整理 | [PR44](https://github.com/kanouk/fanmark-id/pull/44)、main `3b13f283a6d479246d8bc285fbdeece8324451e9`。[main CI](https://github.com/kanouk/fanmark-id/actions/runs/39518911227)の2 job成功。アプリの再配備は不要 |
| 実行コード・設定 | PR43はtest/文書のみ。PR42の実行scriptと全resourcesを保持。秘密設定名17件、全23静的資産、V3保存先、Cron保持 |
| 公開確認 | root/Auth capabilities/maintenanceはHTTPS正常、未認証notificationsは401。最後にroot200とHTML hash保持を独立GETで確認 |
| frontend資産 | [manifest](deployed-assets-2026-10-21.json)。frontend sourceは`bf21ef7d7258a192f9dadab88c96656761a3eede`、旧hash付き資産も保持 |

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
| モバイル表示 | 移行時の390×844確認で18pxの横はみ出しと右端の無効ボタンの欠けを記録。今回の文書整理では修正していない。 |
| 過去のStripe履歴 | 旧subscription objectのprovider取得ができない履歴上の制約を保持。取得成功に書き換えない。解約済み自己テスト契約と未送信sandbox記録を保持する。 |
| 別端末での鍵復旧 | 同じMacからの遠隔Sync読戻しは確認済み。Mac喪失時の別端末でのアクセス・復号は未実証。 |

## 詳細原本

非秘密の完了要約はこの文書とPR/CI。個人データを含む操作証拠、鍵・backupのcustody、intent/receiptは
[Git外保管先](private-access.md)へ辿る。旧再開票の「PR41未マージ」「移送前」「本番Supabase」は当時の記録。
新しいoperationごとに現在値を確認し、この文書の日時・配備ソース・証拠・未確認事項を更新する。
