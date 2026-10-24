# #71の保存ログによる調査（2026-10-24）

## 保存設定

利用者の明示依頼で、14:12 JSTに本番appのscript-level settingsだけをPATCHした。
`observability.enabled=true`、logsは100%・persist有効、自動invocation logとtraceは無効、query stringは除去する。
任意のURL/query・Cookie・検索語を独自ログへ追加しない。既存の固定分類による調停遅延・例外と定期処理の集計を保存する。
新しい価格条件の受諾・外部destination・権限の拡大はしていない。dashboardは20M events/monthを超え、価格条件を受諾しない場合はsamplingすると表示した。

コード再配備は行わず、active `67165a66-d847-4e4f-875d-96ef4864ad3a`・他3 Worker・全binding/runtime・18秘密設定名・3 routes/4 cronsの同一性を独立GETで確認した。
正規configにも同じ設定を記載し、次の通常更新で無効へ戻らないようにする。config検査は保存の無効化・invocationログ・query非除去・trace有効化を拒否する。

Cloudflareの[保存ログ](https://developers.cloudflare.com/workers/observability/logs/workers-logs/)と[version共通の設定API](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/settings/methods/edit/)に従う。
保存開始前の例外本文が復元される機能ではない。script settingsの変更はアプリのversion更新と別に照合する。

## 調査の境界

14:12:18 JSTの自然cronが出力した`stripe-webhook-dispatch`の完了集計を保存Eventsで確認した。Live接続を閉じても検索できる保存レコードであり、Liveだけの観測と区別する。
11:30〜14:15 JSTの対象DOのadaptive集計は、取得行462 requests・errors 0・success、colo NRT・同じ671版だった。samplingと集計遅延があり、全要求の無障害証明でも根本原因の解消証明でもない。wallTimeの単位は換算しない。

過去の保存済みLive原本8本と前回の例外分類を再確認したが、障害時の未処理例外本文は収録されていなかった。現在のソースにおいて、調停enterのACK前は業務を開始せず、完了した自身のleaveだけ有限再試行する。readのfence確認・通常output gate・保存先・既存票を維持する。
短い正常観測や古いruntime/経過時間だけでは既存24票の終了を証明できず、手動削除・fence強制解除・backup再送はしない。#71は未完了のまま維持する。

## トップページ

今回の調査・ログ設定ではfrontendを変更しない。PR70は共有絵文字パレットだけを移植し、`src/pages/Index.tsx`のヒーローと全体レイアウトは従来のまま。3Dヒーローと全面デザイン見直しは別の変更である。

詳細原本: `~/.codex/private/fanmark-persisted-diagnosis-2026-10-24/`。intent・receipt・独立readback、Live原本と公開probeを保持する。
