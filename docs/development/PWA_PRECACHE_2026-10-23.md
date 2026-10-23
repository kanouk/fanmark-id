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
計測値、配備version、CI、公開資産の結果は受け入れ後に追記する。

方式は[WorkboxのglobIgnores](https://github.com/GoogleChrome/workbox/blob/v7/packages/workbox-build/src/types.ts)を使用する。
計測方法と限界は[低速回線の模擬計測](SLOW_NETWORK_2026-10-23.md)を参照。実端末・自然回線・利用者p75は別項目。
