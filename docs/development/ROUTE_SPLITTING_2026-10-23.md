# 初期JSの追加分割

Issue #53の優先1。比較元mainは`db3671bcf66444e4a669dc6f21581006b49f0fa7`。
Node 22.6.0・同じlockfile・同じ正規production builderで比較した。

## 変更

ダッシュボード、本人設定、ファンマ設定、プロフィール編集/preview、QR、お気に入り、通知、PWA、案内/復旧画面をroute単位のimportへ分割した。
`route-modules.ts`がpathとloaderを定義し、`RouteModulePreload`は現在のURLに必要なmoduleだけをreadiness確認と並行取得する。
画面のmount・個人API・所有者判定・管理者MFAは従来のgateを通る。loaderの失敗は既存の再読み込みUIへ進む。

トップと通常ログインは初期JSに保持する。4言語の翻訳も一括読込みを維持し、切替に通信待ちや翻訳取得エラーを追加しない。
Provider・共有query・画面のURL/query・検索入力・下書き・保存処理は変更しない。
今回の対象は初期JSの分割。PWA先読みの除外・catalog永続cache・font指定の整理は別の変更として扱う。

## 同条件の容量比較

index.htmlのmodule scriptとmodulepreloadを列挙した。gzipはPython gzip.compress level9・mtime0、zlib 1.2.12で両方を計算する。
圧縮ライブラリの違いによる数KBの差を改善率に混ぜない。

| 対象 | 変更前 | 変更後 | 差 |
| --- | ---: | ---: | ---: |
| 初期JS bytes | 1,587,014 | 1,137,849 | 約28%減 |
| 初期JS gzip bytes | 446,087 | 338,962 | 約24%減 |

後で読むroute chunkを含む総JS量やPWA先読み全体が24%減ったという意味ではない。
PWAは引き続き静的chunkを先読みするため、再訪と低速回線での全転送量は別に比較する。

## 検証と速度比較

- 型・Lint 0・client225件・現行契約138件、本番build、CI構成検査と通常4 Workerのdry-run。
- 実local Worker/Auth/D1/R2とChromeで取得・保存・公開・本人切替・4言語×4幅を検証する。
- 新しい所有者moduleの取得失敗→再読み込み→未認証拒否、コードとsession確認の並行、確認前の個人API未実行を検証する。
- 直撃編集URLと保存失敗・下書き復元・R2画像は通常CIの合成local buildでも検証する。
- 比較前の公開本番を、1.6Mbps/150msと400kbps/400ms・CPU4倍減速・390×844pxで各3組の初回/PWA再訪を直列測定した。配備後にも同じ計測器と条件で取得する。

比較前のLCP中央値は、1.6Mbpsが初回3.764秒・再訪0.504秒、400kbpsが初回11.416秒・再訪0.844秒。
以前の[模擬計測](SLOW_NETWORK_2026-10-23.md)と混ぜず、今回取り直した値を前後比較に使う。
配備後の測定値と受け入れ範囲は、公開確認が終わってから追記する。

計測方法・限界は[模擬計測](SLOW_NETWORK_2026-10-23.md)と同じ。実端末・自然回線の値ではなく、少数lab sampleの中央値。
生記録と配備操作はGit外の `~/.codex/private/fanmark-route-split-2026-10-23/` へ保存する。
