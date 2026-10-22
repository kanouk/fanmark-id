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
- 実local Worker/Auth/D1/R2とChromeで取得・保存・公開・本人切替・4言語×4幅を検証した。
- 新しい所有者moduleの取得失敗→再読み込み→未認証拒否、コードとsession確認の並行、確認前の個人API未実行を検証した。
- 直撃編集URLと保存失敗・下書き復元・R2画像は通常CIの合成local buildでも検証した。
- 比較前の公開本番を、1.6Mbps/150msと400kbps/400ms・CPU4倍減速・390×844pxで各3組の初回/PWA再訪を直列測定した。配備後にも同じ計測器と条件で取得した。

今回取り直した公開本番の前後各16 navigationを[集計JSON](metrics/2026-10-23-route-splitting.json)に保存した。
Apple M1・Chrome155・390×844px・DPR1・ページCPU4倍減速。トップは各条件で初回/PWA再訪を3組ずつ直列測定。
以前の[模擬計測](SLOW_NETWORK_2026-10-23.md)の値とは混ぜない。

| トップLCP | 変更前 中央値（範囲） | 変更後 中央値（範囲） |
| --- | ---: | ---: |
| 1.6Mbps / 150ms・初回 | 3.764秒（3.504–3.780） | 3.240秒（3.148–3.580） |
| 同・PWA再訪 | 0.504秒（0.492–0.752） | 0.488秒（0.480–0.728） |
| 400kbps / 400ms・初回 | 11.416秒（11.380–11.600） | 9.268秒（9.140–9.756） |
| 同・PWA再訪 | 0.844秒（0.812–0.932） | 0.820秒（0.796–1.060） |

初回中央値は約14%／19%短縮。再訪の差は小さく、範囲も重なるため改善を断定しない。
検索UIのpaint中央値も初回3.724→3.194秒／11.385→9.236秒、FCPは3.288→2.852秒／10.776→8.636秒になった。
トップCLS最大は前後とも約0.00039。1.6Mbpsの直撃診断（各1組）はAuth初回3.712→3.000秒、About初回3.724→3.088秒。
再訪はそれぞれ0.456→0.392秒、0.456→0.444秒。少数の参考値で、全遷移の速度保証ではない。
Authのcapabilities後の追加領域によるCLS約0.02は前後で同じで、残る補助UX課題とする。

初回の観測総転送量中央値は約1.697→1.756MB（約3.5%増）、SW先読みは約0.930→1.091MB。
分割後の静的chunkも既存PWA方針で先読みするため、表示が早くなっても総転送量は減っていない。
再訪の観測総転送量は約243KBでほぼ同じ。OG画像約691KBの先読みとcatalog再取得は次の独立した改善候補に残す。

## 配備と受け入れ

[PR66](https://github.com/kanouk/fanmark-id/pull/66)。配備ソースは`be75080dba1a67ce7bdd00c666cdc3dfdfe33e0e`、
[ソースCI](https://github.com/kanouk/fanmark-id/actions/runs/39871780864)の全6 job成功。
本番app `2ead3b1b-6722-4249-8f87-e667f3a9f59f`を100%へ切替。
[82資産manifest](../operations/deployed-assets-2026-10-23-route-split.json)と公開bytesを独立照合し、旧hashも保持した。
秘密設定名17件・D1/R2/DO・runtime・Cron/Route・他3 Workerの同一性を確認。
既存PWAからの更新、4言語×320/375/390/430px、匿名のAuth/About/PWA、Profile/Dashboardの拒否、5絵文字入力を確認した。
公開APIへの業務POSTはしていない。型・Lint 0・client225件・現行契約138件、実localの保存/下書き/本人切替と4言語切替時の同一入力DOM・入力値保持も成功。
最終の文書取り込み・PR/main CIはPR66を参照。文書記録だけのcommitは再配備しない。

計測方法・限界は[模擬計測](SLOW_NETWORK_2026-10-23.md)と同じ。実端末・自然回線の値ではなく、少数lab sampleの中央値。
生記録と配備操作はGit外の `~/.codex/private/fanmark-route-split-2026-10-23/` へ保存する。
