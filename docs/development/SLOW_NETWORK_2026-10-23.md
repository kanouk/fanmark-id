# 低速回線での起動計測と改善候補

2026-10-23、Issue #53。アプリの動作・本番設定は変更せず、公開本番を匿名で計測した。
本番entry `/assets/index-B5VE3_jg.js` は既存の配備manifestとbytes/SHA-256が一致した。
対象mainは `2c4cd1ace9778bd1ec6fc31720f5c2d297f18cbf`、配備ソースはPR64の `b1d7cfbf16e68de75e516893c5f9856bfd01ab28`。

## 条件と読み方

- Apple M1 / macOS、Chrome 155.0.8059.85、390×844 CSS px、DPR 1、ページのCPUを4倍に減速。
- 通信はCDPで下り1.6Mbps・上り750kbps・latency 150ms、および上下400kbps・latency 400msへ制限した独自設定。実端末・実回線や公式プリセットの再現ではない。
- ページと接続したService Workerに同じ通信制限を適用した。単一の物理回線を全プロセスで共有する帯域制御ではなく、SW接続前の初期通信を完全に捕捉した保証もない。
- 初回は新しいChrome profile。再訪は同じprofileでSWの先読み完了後に開き直す。HTTP cacheだけの再訪や、インストール直後の更新は別条件になる。
- トップは各条件3組を直列実行。他のブラウザ計測・buildとのCPU競合を避けた。日本語の匿名利用のみ。ログイン・決済・保存は実行していない。
- UI出現から最低5秒、catalog全8応答の本文完了、SW制御を待ち、操作前のLCP/CLSを記録した。LCPは観測区間の最後の候補、CLSは最大5秒・間隔1秒未満の最大window。訪問全体の値や実利用者のp75ではない。
- 検索UI出現は直接入力ボタンの出現後2 frame。catalog検証・インストール完了とは別。ダイアログ応答は通信が落ち着いた後の実クリックで確認し、INP/TTIとは扱わない。

通信・CPU制限は[Chromeの説明](https://developer.chrome.com/docs/devtools/settings/throttling)、指標の意味は[LCP](https://web.dev/articles/lcp)と[CLS](https://web.dev/articles/cls)を参照。
集計値・全sample・条件は[計測JSON](metrics/2026-10-23-slow-network.json)。失敗した試行・計測器の修正前・最後のcatalog本文が未完了の試行は集計から除外した。

## トップの結果

秒は3回の中央値。範囲は[JSON](metrics/2026-10-23-slow-network.json)に保持する。

| 通信・訪問 | 最初の内容表示 FCP | 主要表示 LCP | 検索UI出現 | catalog全本文完了 | CLS最大値 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1.6Mbps・初回 | 3.20秒 | 3.68秒 | 3.63秒 | 5.51秒 | 0.00039 |
| 1.6Mbps・PWA再訪 | 0.25秒 | 0.60秒 | 0.60秒 | 2.17秒 | 0 |
| 400kbps・初回 | 10.65秒 | 11.40秒 | 11.34秒 | 18.60秒 | 0.00039 |
| 400kbps・PWA再訪 | 0.22秒 | 0.84秒 | 0.84秒 | 6.87秒 | 0 |

PR64によりcatalogを待たずに画面が進む。一方、初回は初期JS取得・実行の前に内容を表示できない。
本番の初期JSは約434KB（応答はzstd、展開後1,587,014 bytes）。従来のgzip 446,087 bytesというbuild比較と混同しない。
再訪はJSがSWから供給されて転送0 bytesになるが、catalogは毎回8要求・本文約240KBを取得する。
再訪400kbpsでも先頭ページ本文は中央値1.33秒で届くが、全本文完了には6.87秒かかる。
ダイアログの実クリック応答は各組の中央値91〜135ms。これは落ち着いた状態の観測で、全操作の応答性を保証しない。

## routeと先読み

以下は1.6Mbpsで各1組の診断値。トップの3回中央値と同じ精度の比較には使わない。

| 直撃route | 初回LCP | 再訪LCP | 初回CLS / 再訪CLS |
| --- | ---: | ---: | ---: |
| `/auth` | 3.34秒 | 0.48秒 | 0.02077 / 0.02046 |
| `/admin`（匿名ログイン画面） | 4.14秒 | 0.42秒 | 0 / 0 |
| `/about` | 4.62秒 | 0.61秒 | 0.00012 / 0 |

ログイン画面はcapabilities取得後にSNSログイン等が追加され、footerなどが動く。大きなずれではないが、表示領域の予約はUX改善候補になる。
認証後の管理画面・所有者画面、実アカウント、他言語の速度は今回の測定範囲外。

トップ初回で観測したHTTP転送は約1.70MB、うちSW先読み約0.93MB。
`og-image.png`だけで約691KB、管理dashboard・分析chunkも合計約171KBを取得した。
OG画像は通常のトップ描画には使わず、SNS用のmetadataから参照される。
ここを除外すれば初回の観測転送量の約41%相当を減らす余地があるが、LCPが41%短縮するという意味ではない。
先読みは初期JSの取得後に始まるため、主に裏の通信量とSWインストール時間に影響する。
`totalWireBytes`は観測できたCDP encodedDataLengthの合計で、cache供給を除きHTTP headerを含む。TLS等を含む物理回線の総byte数ではない。

## 推奨する順番と採用条件

1. **初期JSの追加分割**。`App.tsx`から静的importするDashboard・設定・プロフィール編集・QR等と、4言語を一括importする`TranslationProvider`を調べる。
   これが初回表示に直接効く優先項目。共有moduleがあるため、全moduleをそのまま削れるとは見積もらない。
   [同じentry hashの診断build](metrics/2026-10-23-module-attribution.json)でも、これらと4言語JSONが初期chunkへ含まれることを確認した。
   認証gate・deep link・入力保持・言語切替・chunk失敗時の再試行を維持し、初回と遷移先の両方で前後比較して採用する。
2. **不要なPWA先読みを削る**。まずOG画像をprecachingから外す。公開画像・OG metadata自体は保持する。
   管理・分析chunkの先読み縮小は、初回の画面遷移やoffline時の挙動を別途確認して判断する。
   既存PWAからの更新、旧hash資産保持、基本shellのcache、APIをSW cacheへ入れない境界を維持する。
   この順序は[Workboxの先読み方針](https://developer.chrome.com/docs/workbox/precaching-dos-and-donts/)とも整合する。
3. **公開catalogを版付きで再利用する**。起動時に現在のready版を確認し、同じorigin・同じ版の全件検証済みデータだけを再利用する。
   同じ版なら残り7要求・約210KBを省く候補。初回のLCPより再訪時の絵文字確定待ちに効く。
   保存失敗・破損・版変更は現行の取得へ戻し、異なる版や途中データをinstallしない。個人APIのcache方針は変えない。
4. **字体と待ち時間の見え方**。Google Fonts指定が`index.html`とCSS `@import`の二箇所にあり、二つのCSS要求を観測した。読込み元の一本化を検討する。
   JS取得前の体感改善にはHTMLの公開ヘッダー・背景等を先に表示する方法がある。操作開始時間とは分けて測り、置換時のCLSを悪化させない。
   `/auth`の後から増える領域も予約する。これらの速度効果はまだ前後比較していない。

初期JS・先読み・catalogの変更は独立して比較し、効果が確認できたものから採用する。変更単位でPR/versionを戻せるようにする。
今回の小さいCLSや、recent一覧20件/6件の二要求・匿名設定取得の数KBを、主要な短縮対象より先に全面整理する根拠は得られていない。
実端末・自然回線・ログイン後の速度は引き続き未計測。今回の結果から製品全体の速度や実利用者の達成率を推定しない。

## 再現

Node 22.6.0とインストール済みChromeを使用する。計測は通常CIに含めず、対象変更の前後で明示的に実行する。
`CHROME_PATH`でChromeの実行fileを指定できる。初回・再訪の組を3回ずつ直列に取り、buildや他のブラウザ計測を同時実行しない。

```sh
(
  set -e
  audit_dir=$(mktemp -d)
  for sample in 1 2 3; do
    node scripts/test/slow-network-audit.mjs slow-4g / "$audit_dir/4g-$sample"
  done
  for sample in 1 2 3; do
    node scripts/test/slow-network-audit.mjs slow-3g / "$audit_dir/3g-$sample"
  done
  node scripts/test/slow-network-summary.mjs "$audit_dir/summary.json" \
    "$audit_dir/4g-1" "$audit_dir/4g-2" "$audit_dir/4g-3" \
    "$audit_dir/3g-1" "$audit_dir/3g-2" "$audit_dir/3g-3"
  node --test scripts/test/slow-network-summary.test.mjs
)
```

速度設定名は独自の識別名。計測器はGET/HEAD/OPTIONS以外のfetchを拒否し、観測したmethodも照合する。
現在の再現スクリプトは先頭応答の版・総件数・page sizeから必要な要求数を求める。build・browser・viewport・CPU・catalog版・同じ名前の通信設定が異なる組の集計は拒否する。前後の変更は別JSONへ集計して比較する。
公開済み18 sampleの生記録は当時の3,944件・500件/ページで採取した。元記録は保持し、同じ版の固定APIを独立GETして照合したmetadataを付けたコピーからも同じ値になることを確認した。
生のタイミングと画面はGit外の `~/.codex/private/fanmark-network-audit-2026-10-23/` に保持する。
