# 補助UXの改善（Issue #53）

比較元mainは`10f9a285a90ffeaff8ef4e1921075bfd447e4120`。既存の機能と認証・メンテナンス・PWA・catalogの境界を維持する。

## 変更

- Google FontsのCSS importを除き、HTML側のFigtree 300/400/500/600/700/800を残す。CSSは表示を止めず取得し、load後に適用する。フォント取得失敗時は従来のsans-serifを使う。
- HTMLに小さい共有CSSと公開ブランド・骨組みを置く。ボタン、個人データ、認証状態は出さない。React起動時には同じCSSのreadiness骨組みに置き換わり、確認済みの画面だけを開く。保存言語は既存4言語だけを反映し、保存領域が読めなくてもHTML表示を止めない。
- ログイン入力は先に使用できるまま、capabilities確認待ちのsignup/reset/SNS領域を予約する。確認後も同じ入力DOM・値・フォーカスを保ち、未知の機能を先に有効化しない。無効・失敗時にはplaceholderを取り除き、従来どおりメールログインだけを維持する。

## 比較方法

`slow-network-audit.mjs ... --supporting-ux`。トップ・auth各画面、低速4G（1.6Mbps/150ms）と低速3G（400kbps/400ms）の初回/PWA再訪を各3組、前後各24 navigationで測定する。
Chrome155、390×844 CSSpx/DPR1、ページCPU4倍、Apple M1。ページとSWのCDP制限は単一物理回線を完全には再現しない。実端末・自然回線・ログイン後・利用者p75ではない。

FCP/LCP/CLS、公開ヘッダーの描画観測、操作UI出現、dialogと文字入力を分けて記録する。受動観測終了後の操作はsubmitせず、匿名GET以外の送信を拒否する。入力描画時間はCDP入力と2回の描画待ちを含み、実利用者のINPではない。
受動観測はUI出現後5秒以上・全catalog応答本文・SW制御を待つ。catalog全件受信と検証/installの完了は混同しない。同一版の1件metadata確認も全8ページ取得も有効な転送として記録し、保存済みでも利用できなかった再訪を除外しない。

実装前のbaselineにも同じ計測器を使用する。前後のentryは異なるが、browser・回線・viewport・CPU・公開catalogの版/件数を照合する。統計のmin/maxと全sampleを保存し、小さい差を本変更だけの効果と断定しない。

## 前後比較

各値は3 sampleの中央値。min/maxと全48 sampleは[集計JSON](metrics/2026-10-23-supporting-ux.json)へ保存する。

| 条件 | FCP 秒 | LCP 秒 | 操作UI出現 秒 | CLS |
| --- | ---: | ---: | ---: | ---: |
| slow-4g:/:cold | 3.148 → 1.252 | 3.496 → 4.528 | 3.449 → 4.486 | 0.000000 → 0.000000 |
| slow-4g:/:warm | 0.304 → 0.156 | 0.824 → 1.104 | 0.881 → 1.110 | 0.000000 → 0.000000 |
| slow-3g:/:cold | 9.024 → 2.512 | 9.612 → 10.388 | 9.563 → 10.355 | 0.000388 → 0.000000 |
| slow-3g:/:warm | 0.764 → 0.084 | 1.352 → 0.832 | 1.357 → 0.835 | 0.000000 → 0.000000 |
| slow-4g:/auth:cold | 2.920 → 1.236 | 3.116 → 3.216 | 3.086 → 3.200 | 0.020769 → 0.000000 |
| slow-4g:/auth:warm | 0.372 → 0.084 | 0.816 → 0.748 | 0.861 → 0.800 | 0.020457 → 0.000000 |
| slow-3g:/auth:cold | 9.104 → 2.692 | 9.436 → 10.660 | 9.406 → 10.632 | 0.020457 → 0.000000 |
| slow-3g:/auth:warm | 0.924 → 0.192 | 1.448 → 1.444 | 1.452 → 1.444 | 0.020457 → 0.000000 |

| 条件 | ヘッダー観測 秒 | 入力描画 ms | dialog出現 ms | 観測総転送 bytes |
| --- | ---: | ---: | ---: | ---: |
| slow-4g:/:cold | 3.162 → 1.259 | 47 → 47 | 153 → 219 | 1,066,170 → 1,068,256 |
| slow-4g:/:warm | 0.320 → 0.569 | 46 → 32 | 121 → 119 | 4,521 → 4,525 |
| slow-3g:/:cold | 9.028 → 2.513 | 66 → 31 | 215 → 114 | 1,066,307 → 1,067,434 |
| slow-3g:/:warm | 1.107 → 0.141 | 47 → 31 | 169 → 121 | 243,515 → 4,578 |
| slow-4g:/auth:cold | 2.932 → 1.234 | 59 → 46 | — | 1,064,091 → 1,065,776 |
| slow-4g:/auth:warm | 0.659 → 0.192 | 43 → 44 | — | 2,687 → 2,762 |
| slow-3g:/auth:cold | 9.143 → 2.691 | 190 → 46 | — | 1,064,170 → 1,066,234 |
| slow-3g:/auth:warm | 1.256 → 0.809 | 57 → 51 | — | 241,898 → 2,795 |

FCPは実際の最初のcontent paint。ヘッダー観測はDOM検出後の2 RAFであり、busy taskにより既に描画された時点より遅れる。LCPや操作UI出現をFCPの改善率に置き換えない。API応答・HTMLのTTFB・catalogの再取得やCPU taskにもばらつきがある。
トップ初回のLCP中央値は4Gで約30%、3Gで約8%増え、UI出現も約30%・8%増えた。原因はこの少数sampleだけでは断定できないが、実測の悪化として保持する。表示開始の改善と、操作可能になる時点の改善は別に判断する。

比較計測は改修前24試行が完了。改修後は27試行中24試行が完了し、起動条件待ちの90秒時間切れが2回、SWのNetwork.enableに対するCDP初期化失敗が1回あった。表は正常完了を条件とした中央値であり、不成功を含む実利用の完了率やp75ではない。最初の時間切れはprobe未保存で原因未確定。別の不成功ではmaintenance GETのERR_ABORTEDを観測したが、通信中断の因果は確定できていない。独立GETは正常で、PWA有無の少数の切り分けでも応答にばらつきがあり、PWA競合とは断定しない。未完了組だけを同じ条件で再測定し、遅い成功回も除外しない。再開時はNode側の受動CDP観測と失敗時だけの状態保存を加え、正常完了時の条件・操作・受理基準は維持した。

HTMLの応答開始まで14.739秒、操作UI出現まで17.557秒だった回も残した。応答待ちを差し引いた数値で実際のFCP/LCPを置き換えない。今回の採用理由は表示開始と認証画面の安定性であり、LCP・操作開始全体の短縮を確認したとはしない。

Google Fontsのstylesheet要求は全sampleで2→1（preconnectは含めない）。初期JS gzipは339,906→340,134 bytes（228 bytes増）、HTML sourceは2,896→6,005 bytes。フォントの太さは既存300〜800を維持する。

再訪のcatalogはmetadata確認と全ページへのfallbackの両方を残して集計した。組数は集計JSONのcatalogTransportMixに記録する。本変更でcatalog保存/読取り条件は変えておらず、再利用の改善率としない。

## 検証・受け入れ

- 型・Lint error/warning 0、client234件・現行契約147件、計測器9テスト、実local Worker/Better Auth/D1/R2/Chromeの取得・保存・所有権拒否・MFA・下書き・本人切替と通常回帰が成功。
- main moduleを保留した実HTMLで公開ブランド/背景と画像を描画し、操作ボタン・個人情報を出さないこと、再開後の保護routeが未認証を拒否することを確認。
- 合成のcapabilities応答を遅延させ、4言語×320/768px・SNS無効/1/4 provider・取得失敗の計11条件で入力DOM/値/フォーカスとemail/submit位置を保持。未確認signup/reset/SNSを開かず、不要なplaceholderを確認後に取り除く。実provider認証の再受け入れとは区別する。
- 本番の実capabilities応答をブラウザ内で一時保留し、入力後の実応答で同じDOM/値/フォーカスと位置を保持。応答データは加工していない。公開4言語×4幅、PWA検索の5絵文字、未認証の保護画面拒否を確認。
- 隔離SWで新規導入/更新・入力/DOM/storage保持・offline shell/code・API非cacheが成功。公開では登録を残した同じ旧PWA profileが新entryへ更新し、同じcatalog snapshot checksumと次回1件照合を保持。
- 公開179資産のbytes/SHA-256と旧hash到達性、OG公開・先読み除外を照合。robots.txtはsourceとCloudflare追記を分け、edge応答の更新前後一致を確認。通常4 Worker dry-runも成功。
- 検査側の色の期待値・selector引用符・preconnectを含めたfont件数検査を修正して成功を確認。旧PWA準備時の一度のCDP timeoutは原因未特定の不成功観測として保持し、新しい匿名profileの成功結果と分離した。本番upload/deployの再送はない。

## 配備記録

[PR69](https://github.com/kanouk/fanmark-id/pull/69)。配備ソース `ad424218242aa5d31390bfa2dfce5a04b6491358`、active 100% `9b978526-57d8-422d-9a60-e942352ccbd3`。
[ソースCI](https://github.com/kanouk/fanmark-id/actions/runs/39951178136)の全6 job成功後に候補uploadと有効化を別intentで1回ずつ実行。
秘密設定名17件・D1/R2/DO・runtime・Cron/Route・他3 Workerを独立照合して保持。API・schema・認証の境界は変更していない。
最終PR/main CI・取り込み結果はPR69を参照。merge後のmainと配備ソースの非文書file一致を別に照合する。

完全な原本・不成功の観測・intent/receiptはGit外 `~/.codex/private/fanmark-supporting-ux-2026-10-23/`。実端末・自然回線・ログイン後・本人の実アカウントでの再受け入れはIssue #53へ残す。
