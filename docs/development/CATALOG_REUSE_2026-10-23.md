# 版付き絵文字カタログの再利用

Issue #53。比較元mainは`e5a9d256490ef3de9acd4bb9899910d10df21b1c`。

## 方針

公開の全件検証済みcatalogだけをIndexedDBへ保存する。API origin当たり1 snapshotを単一transactionで置換し、版・選択方法・件数・全項目の形式・重複・payloadのSHA-256を再検証する。
SHA-256は保存データの破損検出であり、同じoriginの悪意あるscriptに対する署名認証ではない。
キャッシュがなければ従来の全ページ取得。再利用候補があれば既存APIの`limit=1`で選択したready版を照合し、同じ版・件数・先頭項目なら再利用する。
版が変わった場合は確認した新しい版にpinして全件を取得する。版の途中混在や部分snapshotは使わない。

読取り拒否・破損・blockは通常の全件取得へ戻る。保存は入力可能になるまでの待ちに含めず、quotaやabort時もネットワーク取得済みのcatalogを使える。
IndexedDB操作は750msで打切り、transaction完了でだけ保存成功とする。失敗した置換では以前のsnapshotが残るが、毎回の版確認を通るまで利用しない。
版確認の通信失敗・非ready・不正応答は従来の必要時だけの待機/再試行へ進み、古い版で代替しない。
トップ表示・PWA更新確認、入力保持・取消、認証/所有者/MFA、4言語、個人query、SW API非cacheとOG先読み除外は維持する。

## 検証と比較方法

単体で同版再利用・版変更・pinned選択の分離・破損・重複・件数不一致・origin相違・通信/保存失敗を検証する。
実local Worker/Master D1/Chrome/IndexedDBでready版を変更し、全ページのpinと次回再利用、破損修復・拒否/block/quota/abort、通常入力・保存等を確認する。旧版のimmutability/activation audit/generation guardは保持する。

今回は`slow-network-audit.mjs ... --catalog-action`で同条件の前後を取り直す。
表示直後に直接入力の絵文字を確定し、catalogによる変換後に入力として受理されるまでの時刻と待ち時間を記録する。
後続のavailability POSTはブラウザ内で503にして停止し、検索記録や取得等の業務書込みを行わない。この値は検索結果取得の完了時間ではない。
LCPは最初の操作までの値なので、従来の操作なし5秒後まで観測したLCPとは混ぜない。転送量は受理後・SW制御・5秒以上の観測が揃ってから記録する。
集計器は全ページの完了または単一metadata照合＋実際の入力受理を検証し、異なる計測modeを混ぜない。
通信本文の完了と入力受理は別の指標。Chrome155・390×844px・ページCPU4倍減速、1.6Mbps/150msと400kbps/400msの各初回/PWA再訪を前後3組ずつ直列測定する。
CDPのページ/SW制限は単一物理回線を完全には再現しない。実端末・自然回線・利用者p75ではない。
操作の観測は約200ms間隔のpollと2回の描画待ちを含む。短い待ちの値はこの観測分解能の影響を受ける。

## 本番の前後比較

各値は3 sampleの中央値。min/maxと全24 sampleは[集計JSON](metrics/2026-10-23-catalog-reuse.json)へ保存する。

| 回線・状態 | navigation→入力受理 秒 | 確定後の待ち 秒 | catalog本文 bytes | 観測総転送 bytes |
| --- | ---: | ---: | ---: | ---: |
| 1.6Mbps / cold | 8.011 → 7.857 | 3.563 → 3.814 | 236,846 → 236,977 | 1,064,645 → 1,066,114 |
| 1.6Mbps / warm | 4.407 → 1.342 | 2.987 → 0.434 | 236,977 → 298 | 243,378 → 4,569 |
| 400kbps / cold | 17.793 → 17.784 | 7.683 → 7.577 | 236,899 → 236,910 | 1,064,938 → 1,066,598 |
| 400kbps / warm | 7.949 → 1.419 | 7.032 → 0.298 | 236,990 → 298 | 243,514 → 4,569 |

再訪は全6 sampleで8要求からmetadata 1要求になった。同じ版の確認後に全件検証済みsnapshotを使う。
slow-4g:/:warmでは、確定後の待ちは85.5%、観測総転送量は98.1%減少。
slow-3g:/:warmでは、確定後の待ちは95.8%、観測総転送量は98.1%減少。
初回は8要求のまま。新しい初期JS gzipは338,962→339,906 bytes（944 bytes増）。初回を全件取得不要にした変更ではない。
初回の観測総転送は約0.14〜0.16%増、確定後の待ちは4Gで7.0%増・3Gで1.4%減。初回の高速化は確認できず、今回の採用理由は再訪時の入力待ちと転送量の削減にある。

| 回線・状態 | TTFB 秒 | FCP 秒 | LCP 秒 | UI出現 秒 | CLS |
| --- | ---: | ---: | ---: | ---: | ---: |
| slow-4g:/:cold | 1.213 → 0.962 | 3.540 → 3.216 | 4.372 → 4.008 | 4.330 → 4.015 | 0.006133 → 0.006133 |
| slow-4g:/:warm | 0.003 → 0.005 | 0.196 → 0.220 | 0.976 → 0.800 | 0.991 → 0.813 | 0.006133 → 0.000000 |
| slow-3g:/:cold | 1.065 → 1.308 | 8.960 → 9.284 | 10.048 → 9.992 | 9.995 → 9.996 | 0.006133 → 0.006133 |
| slow-3g:/:warm | 0.013 → 0.007 | 0.464 → 0.248 | 1.164 → 0.892 | 1.293 → 0.979 | 0.006031 → 0.000103 |

表示時間にはHTMLのTTFB等のばらつきもある。表示改善率を今回の再利用だけの効果と断定しない。CLSは操作を含むこのprotocolの値で、従来の受動観測と混ぜない。

## 受け入れ

- 型、Lint error/warning 0、client234件、現行契約146件、実Worker/Better Auth/D1/R2/Chromeの入力・保存・MFA・下書き・本人切替・所有権拒否と通常回帰、4 Worker dry-runが成功。計測集計器の8テストも成功。
- 実local Master D1でready版A→Bを通常のaudit/generation guardを維持して切り替え、新版に固定した8ページ取得・B保存・次回1件照合を確認。破損・読取り拒否・750ms block打切り・quota・transaction abortでも入力でき、失敗した置換はAを部分更新しない。最後にlocal Aへ復帰。
- 隔離HTTPSと実SWで旧方針からの更新・新規導入・入力/DOM/storage保持・offline shell/code・API非cacheを検証。公開では同じ旧PWA profileの登録を残したまま新entryへ更新し、保存snapshotのSHA-256・3,944件・再訪1件照合、4言語×4幅・5絵文字入力・匿名拒否を確認。公開の本人account保存やoffline catalog利用を実証したとはしない。
- 公開130資産のbytes/SHA-256と旧hash到達性を照合。robots.txtはCloudflare追記前のsourceと区別し、更新前後のedge応答一致を確認。OG画像の公開と先読み除外を保持。初回の独立GET接続リセットは読み取りだけ再実行し成功。
- 公開PWAの初回観測は新cacheのdownload後、activation完了前にnavigateしたため旧document待機が終了しなかった。受入れでは同じprofileを保持し、旧entryのprune後の通常navigationで新entryを確認。登録解除・cache消去・再配備はしていない。

## 配備・証拠

[PR68](https://github.com/kanouk/fanmark-id/pull/68)。配備ソース `f87cc01cfba05ecbb8533c260eb6a53857e68a78`、active 100% `1dcd421c-bc35-4a64-b688-403ae0e47c30`。
[ソースCI](https://github.com/kanouk/fanmark-id/actions/runs/39932639298)の全6 job成功後に候補uploadと有効化を別intentで1回ずつ実行。
秘密設定名17件・D1/R2/DO・runtime・Cron/Route・他3 Workerを独立readbackして保持を確認した。
最終PR/main CIと取り込み結果はPR68を参照。merge後は配備ソースとの非文書file一致を別に照合する。

生記録・成功/不成功の観測・intent/receiptはGit外 `~/.codex/private/fanmark-catalog-cache-2026-10-23/`。
補助UX、実端末・自然回線・ログイン後の計測はIssue #53へ残す。
