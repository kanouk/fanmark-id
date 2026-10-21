# 最終確認状態と未確認事項

この文書は最後に独立照合した状態の記録で、現在値を保証するlive monitorではない。
本番操作の前には[更新手順](deployment.md)で現在のmain/CI/active deploymentを読み戻す。

## 本番移行と配備

**最終照合: 2026-10-21 08:30 JST**。公開本番はCloudflareで稼働し、一般メンテナンスは解除済み。

| 項目 | 最終確認した状態 |
| --- | --- |
| 本番URL | `https://fanmark.id/`。Worker Route方式。www/adminはalias Workerの限定転送 |
| 本番app | `fanmark-app-production` / active 100% `d709b04e-ee97-417d-9887-290c5c8d271a` |
| 配備operationのソース | `856599149b8faf9001f05e3ca5eccd69b7bf5f4a` / [PR43](https://github.com/kanouk/fanmark-id/pull/43) |
| その時点のmain | `e3aedcd12f18c0451d64fd72d2d6eaf91bb34d06`。検証済みPR HEADとtree一致 |
| PR CI / main CI | [39512200608](https://github.com/kanouk/fanmark-id/actions/runs/39512200608) / [39513921922](https://github.com/kanouk/fanmark-id/actions/runs/39513921922)。ともに2 job成功 |
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

## 続けて確認すること

| 項目 | 最終記録時点の境界・次の確認 |
| --- | --- |
| 初回の自然日次backup | 2026-10-21 09:05 JST予定。08:30時点では未照合。UTC slot `2026-10-21`のreceipt/claim/archive/保持とwriter解除を確認する。手動保存やUTC20 slotの成功で代用しない。 |
| 自然日次後のmonitor | 同日09:35 JSTを照合する。既存Macの外部automationに09:40の単発確認を予約済み。cloneや新スレッド作成では予約は移らない。結果を得た担当者が本票へ日時と根拠を追記する。 |
| 旧Supabase退役 | 原本保持中。10月28日ごろの見直しは提案で、削除承認ではない。[保持終了条件](../migration/production-operations.md#旧supabaseの保持終了を判断する条件)を確認する。 |
| モバイル表示 | 移行時の390×844確認で18pxの横はみ出しと右端の無効ボタンの欠けを記録。今回の文書整理では修正していない。 |
| 過去のStripe履歴 | 旧subscription objectのprovider取得ができない履歴上の制約を保持。取得成功に書き換えない。解約済み自己テスト契約と未送信sandbox記録を保持する。 |
| 別端末での鍵復旧 | 同じMacからの遠隔Sync読戻しは確認済み。Mac喪失時の別端末でのアクセス・復号は未実証。 |

## 詳細原本

非秘密の完了要約はこの文書とPR/CI。個人データを含む操作証拠、鍵・backupのcustody、intent/receiptは
[Git外保管先](private-access.md)へ辿る。旧再開票の「PR41未マージ」「移送前」「本番Supabase」は当時の記録。
新しいoperationごとに現在値を確認し、この文書の日時・配備ソース・証拠・未確認事項を更新する。
