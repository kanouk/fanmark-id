# PWAの不要な先読み削減

Issue #53の次の改善。比較元mainは`b377e256f2da6f0da9d35d12d5a9b06edca76c7b`。

## 採用範囲

通常画面が使わない共有用`og-image.png`をWorkboxの`globIgnores`へ追加する。
画像の公開配信・bytes・OG/Twitterメタ情報は保持し、共有先からの取得は従来通り可能。
画面コード・CSS・基本HTML・アイコン、SWのcache名・autoUpdate・skipWaiting/clientsClaimと旧API cache掃除は維持する。
管理・分析等のchunkを除外すると、未訪問画面のオフライン時のコード取得が変わるため今回は保持する。
API応答のruntime cacheやcatalog永続cacheは追加しない。

## 検証

正規builderは生成SWの先読みmanifestを検査し、OG画像の除外・公開ファイルの存在・全画面JS/CSS・HTML/manifest・PWAアイコンとAPI拒否を確認する。
CIへ隔離HTTPS＋実ChromeのSW検証を追加。旧方針（同じ画面コードとcache名にOG画像を含む）から更新し、旧OG cacheの削除・入力DOM/値とstorage保持を確認する。
新規導入でOG要求が発生しないこと、全画面コード・CSS・基本画面・アイコンが残ることを確認する。
HTTP cacheを無効にして静的サーバーを503へ切り替え、オフラインで静的資産とPWAのHTMLを取得し、APIがcacheから再生されないことも確認する。
これは業務APIをオフラインで使えるという仕様追加ではない。通常の認証・maintenance確認と失敗/再試行を保持する。

公開本番では、配備前に導入した同じ匿名PWA profileを使って更新・cache・通常画面・狭幅を独立確認する。
以前の計測値は混ぜず、同じ計測器・Chrome・通信/CPU制限で前後を各3組ずつ取り直す。

## 前後比較

[全24 navigationと条件・集計JSON](metrics/2026-10-23-pwa-precache.json)。Apple M1・Chrome155、390×844px・DPR1・ページCPU4倍減速。
トップは下り1.6Mbps/latency150msと400kbps/latency400msで前後各3組の初回/PWA再訪を直列測定した。

| 初回の観測HTTP転送量 中央値 | 変更前 | 変更後 |
| --- | ---: | ---: |
| 1.6Mbps / 150ms・全体 | 1,755,323 bytes | 1,064,495 bytes（約39.4%減） |
| 400kbps / 400ms・全体 | 1,756,828 bytes | 1,065,052 bytes（約39.4%減） |
| SW先読み（1.6Mbps） | 1,091,177 bytes | 399,541 bytes（約63.4%減） |
| SW先読み（400kbps） | 1,091,602 bytes | 399,962 bytes（約63.4%減） |
| OG画像（1.6Mbps） | 691,559 bytes | 0 bytes |

再訪は両版ともOG画像を取得せず、全体約243KBでほぼ同じ。catalogの8応答は引き続き毎回取得する。
公開ファイル82件のうち変更は`sw.js`だけ（7,601→7,516 bytes）。画像690,436 bytes、JS・CSS・HTML・manifest・旧hash資産はすべてbyte単位で同一。
先読みmanifestの一意pathは60→59。OG画像1件だけを除外し、他pathのrevisionは同一。

| LCP中央値（範囲） | 変更前 | 変更後 |
| --- | ---: | ---: |
| 1.6Mbps・初回 | 3.072秒（2.904–3.408） | 3.600秒（3.216–3.684） |
| 同・PWA再訪 | 0.708秒（0.684–1.360） | 0.524秒（0.524–0.608） |
| 400kbps・初回 | 9.432秒（9.332–9.708） | 9.764秒（9.312–9.856） |
| 同・PWA再訪 | 1.108秒（1.024–1.416） | 1.000秒（0.976–1.232） |

**表示速度の改善は確認できていない。** 初回LCPは数値上遅くなった。HTMLのTTFB中央値も0.269→0.603秒／0.634→0.873秒と増えている。
各sampleでLCPからTTFBを引いた診断値の中央値は2.804→2.830秒／8.798→8.891秒で、範囲も重なる。
この診断値で実際のLCPを置き換えたり、変更が遅延の原因ではないと断定したりしない。
再訪では元々OG画像の先読みがなく、短縮を今回の変更の効果とは扱わない。CLS最大は前後とも約0.00039。
今回は同じ画面/オフライン静的資産を保持し、不要な背景転送が明確に減った範囲を採用する。LCPの安定した評価は実端末・自然回線等の別計測に残す。

## 配備と受け入れ

[PR67](https://github.com/kanouk/fanmark-id/pull/67)。配備ソース`b01f80ed8aac8a98ed529a105b4f11d8d5d5749d`の
[CI 39877238728](https://github.com/kanouk/fanmark-id/actions/runs/39877238728)全6 job成功。本番app `8bbf9f50-5dfb-4219-9fdb-321864f4afab`を100%へ切替。
[82資産manifest](../operations/deployed-assets-2026-10-23-pwa-precache.json)・OG配信と共有メタ情報、公開API・未認証の個人/管理API拒否を独立照合。
秘密設定名17件・D1/R2/DO・runtime・Cron/Route・他3 Workerは保持した。

- 正規buildと生成SW検査、型・Lint 0・client225件・現行契約138件・CI構成検査、通常4 Worker dry-runが成功。
- 実local Worker/Auth/D1/R2で取得・保存・公開・本人切替・MFA/拒否・下書き・4言語/モバイルの通常回帰が成功。
- 隔離HTTPS/Chromeの実SWで新規導入・旧方針からの更新・入力DOM/値とstorage保持、オフラインの全画面コード/CSS/基本画面/アイコン、API非cacheが成功。CIでも同じテストが成功。
- 公開では更新前から使っている同じ匿名PWA profileを維持し、通常起動の自動更新後のcacheを独立照合。60→59 pathの差はOG画像だけ。他59件が保持され、再導入やcache消去は行っていない。
- 公開の4言語×320/375/390/430px、PWA検索/5絵文字入力、案内画面・保護画面の匿名拒否を確認。例外0、業務POSTは実行していない。

公開確認の途中で、Chrome終了をまたぐ追加localStorage markerが残っていない検査失敗を記録した。公開のstorage保持の証拠には使わず、同じprofileの永続SW cache差分で更新を判定した。
入力/storage保持は隔離localのSW更新テストで確認済み。失敗原記録もGit外journalへ保持し、アプリや配備を再実行していない。
最終の文書取り込み・PR/main CIはPR67を参照。記録だけのcommitは再配備しない。
生記録・upload/deployのintent/receiptと独立readbackはGit外の`~/.codex/private/fanmark-pwa-precache-2026-10-23/`へ保管する。

方式は[WorkboxのglobIgnores](https://github.com/GoogleChrome/workbox/blob/v7/packages/workbox-build/src/types.ts)を使用する。
計測方法と限界は[低速回線の模擬計測](SLOW_NETWORK_2026-10-23.md)を参照。実端末・自然回線・利用者p75は別項目。
