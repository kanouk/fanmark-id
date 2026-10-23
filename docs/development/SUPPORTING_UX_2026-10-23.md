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

受け入れ後に前後値・テスト・CI・配備結果を追記する。原本はGit外`~/.codex/private/fanmark-supporting-ux-2026-10-23/`へ保存する。
