# fanmark.id — 絵文字の住所がある小さな街

[ヒーロー刷新 #27](https://github.com/kanouk/fanmark-id/issues/27) の候補Aを動かす独立したThree.js試作。既存の温かい白・ミント・ピンク、丸みのあるUIを使い、絵文字の組み合わせが人やお店への入口になる世界を表現する。本番トップや通常ページ、取得・認証・決済は変更しない。

## 起動・確認

リポジトリの既存フロント依存がインストール済みの環境で:

```sh
npm ci --prefix prototypes/hero-world
npm run dev:hero
# http://127.0.0.1:4179/
npx tsc --project prototypes/hero-world/tsconfig.json
npx eslint prototypes/hero-world/*.ts prototypes/hero-world/*.tsx
npm run build:hero
# dist/hero-world/
```

Three.jsと型定義は試作配下のpackage.json/lockで `0.186.0` に固定。既存ルートにはreact-day-picker/date-fnsのpeer依存の不整合があるため、今回その依存関係を変更せず分離した。ルート依存から再構築する環境では既存プロジェクトのインストール方針に従う。

## 表現・操作

- 花屋 `🌸🌿`、森のカフェ `☕🥐`、音楽のアトリエ `🎧✨`、ねこの入口 `🐈⭐`。丸い木・小さな池・花壇・気球・住人を配置。
- 住人の小さなジャンプ、看板・気球・雲の揺れ、ポインターによる控えめな視差。看板選択で弾みと小さな紙吹雪。
- 看板はRaycasterで選択可能。同じ操作をHTMLの4つのボタンからキーボードでも行える。選択した絵文字とアドレス例が下に表示される。
- 主CTAは選択エリアへ移動。コピー、英語/日本語切り替え、動きの停止/再生、視点リセット、静止画/3D切り替え。
- 「パレットで自由につくる」は別途保存済みのローカル試作 `http://127.0.0.1:4178/` へのリンク。その試作サーバーが必要。選択値の引き渡しや本番検索には未接続。
- 看板はサンプル。取得可能性や所有者を表すものではない。最近取得された実データもこの試作では表示しない。

## ファイル・移植

- `world.ts`: プロシージャルなThree.jsモデル、描画、アニメーション、ヒット判定、破棄処理。`createWorld(host, onSelect, onFailure)` でDOM・Reactから分離。
- `App.tsx`: デザインプレビューの見出し、選択、アドレス例、UI状態。Three.jsは動的import。
- `places.ts`: 看板定義。本番移植では既存の絵文字変換・UUID・マスター版に整合させる。
- `styles.css`: 試作専用スタイル。本番へのグローバル読み込みはせず、ヒーロー内へスコープする。
- `public/world-poster.svg`: 同じ街を描いた簡略ベクター静止画。3D読み込み中・失敗時・手動静止画モードでもCTAとHTML選択を維持する。
- `vite.config.ts`: ポート4179の独立エントリ。通常の `npm run build` はこの試作を含まない。

`src/pages/Index.tsx` のヒーローへ移植する際は、既存AppHeader、FanmarkAcquisition、RecentFanmarksScrollを維持する。見出し・主CTA・検索はThree.jsの初期化を待たせず、看板選択を既存prefillへ渡す。試作のローカルURLを製品版へ持ち込まない。共有スタイルやページ全体をこのデモに置換しない。

## 描画負荷と動きの配慮

- 上限30fps。画面外・非表示タブ・停止操作では継続描画を止める。
- `prefers-reduced-motion` では初期停止し、設定変更も追従。スクロールも即時にする。
- DPR上限はPC1.5 / 狭い画面1.25。背景・影・モデルはローカル生成。外部3Dモデル、物理エンジン、ポストプロセスは使わない。
- 静止物を材質ごとにまとめて描画。影は初期化/リサイズ時に更新する固定影とソフトな接地影の組み合わせ。アニメーションの微小な移動を影が完全追従する方式ではない。
- ResizeObserver/IntersectionObserver/イベント/RAF/geometry/material/textureを終了時に破棄。
- WebGLの生成失敗・context lostは静止画へ戻す。context lost後は静止画/3Dを切り替えて再生成できる。
- 絵文字の顔はOSのカラーフォントからCanvasTextureへ描画するため、OSによって表記は異なる。Google FontsのFigtree/Noto Sans JPを使用し、失敗時はシステムフォントへフォールバック。

## 2026-09-20の確認と残課題

型検査・対象ファイルのLint・独立ビルドに成功。ブラウザーで1280×720と390×844の表示と横はみ出しなしを確認。看板を直接押す選択、HTMLのキーボード選択、コピー成功表示、日英切り替え、停止中の描画回数が増えないこと、静止画モードでcanvasが破棄されること、3D復帰を確認した。

静止物の統合前は通常313 draw calls、統合後の観測は155（描画場面・紙吹雪で変動）。保存時ビルドのgzip容量はUI JS約51KB・遅延3D JS約143KB・CSS約3.1KB（ブランド画像・SVG・外部フォントを除く）。初期HTML/UIと遅延3Dを分離しているが、実機での消費電力・発熱・フレーム時間、LCP/CLS、低速回線でのロードは未評価。本番採用前に既存ヒーローとの比較と性能予算を決める。WebGL非対応・context lostの故障注入、OSの動き低減設定、スクリーンリーダー、実機タッチは追加検証が必要。

保存ブランチは `codex/hero-emoji-world`。#27 のユーザー確認・性能評価・本番統合の受け入れは未完了。Cloudflare移行 #28 と独立したフロント表現で、Supabase固有の新しい依存はない。絵文字パレット #26 の保存状態も変更しない。

技術資料: [Three.js](https://threejs.org/docs/)、[BufferGeometryUtils](https://threejs.org/docs/pages/module-BufferGeometryUtils.html)。モデルと静止画はこの試作用にコードで作成。ブランドアイコンのみ既存 `src/assets/sparkles.png` を使用。
