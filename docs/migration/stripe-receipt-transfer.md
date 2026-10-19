# 移行中に受信したStripe通知の移送

`stripe-receipt-transfer.mjs` は、旧環境の保存専用受信で確定したreceipt/dispatchを
本番Business D1へ移す。課金API・ライセンス付与・dispatchは実行しない。
旧handlerで既に適用した効果の照合は別工程であり、移送成功だけで処理を再開しない。

## 取得と保管

`source-stripe-receipt-only.mjs` の `exportSql` はrepeatable-read/read-only transactionで
run、関数定義、権限、受付停止状態、保存件数を検査し、2表を同じ時点で取得する。
受付中には取得できない。timestampはUTC・小数6桁へSQL内で整形し、NULLも保持する。

`collectSourceStripeReceipts` には固定project・run・原本Function identity、旧project専用の
読み取り接続 `query(sql)`、32-byte暗号鍵、Git外の保存pathを渡す。queryはそのSQLのJSON
objectを返すadapterとし、ログへ行や返却bodyを出さない。collectorはSQLを自分で生成し、
検査後にAES-256-GCMで暗号化する。runとsource全内容hashも認証対象に含める。
平文fileは作らず、0700 directoryに0600の新規archiveを排他的作成し、file/directoryを
fsyncしてから独立して読み直す。既存fileへの上書き・曖昧な失敗時の自動削除はしない。

`loadStripeReceiptExport` は同じrun・鍵・期待archive hashを必要とする。symlink、複数
hardlink、公開権限、内容変更、認証失敗を拒否する。復号したobjectを
`prepareInitialImportSet({ stripeReceiptExport, ... })` へ渡し、source hashを全storeの
descriptorへ固定する。鍵の別保管は他のbackupと同じ実施票で確認する。

上限は1,000件・平文8MiB。超過時は切り捨てず停止し、取得方式と停止時間を再計画する。
これは受信件数の予測ではない。実sourceへの新schema適用や、この最終取得は未実施。

## 変換・投入・照合

- 元のreceipt/dispatch ID、event ID、live/test区分、正規化内容、両hash、受信回数、全時刻を
  保持する。正規化内容のhashとevent/object identityを検査する。未知の列や処理済み行、
  不足dispatch、重複ID、不正な時刻は拒否する。
- 移行先専用の `lease_until=null`、`claim_generation=0` だけを加える。受信はreceived、
  処理待ちはpending/attempt_count=0のまま。raw bodyは元の保存方針どおり存在しない。
- 現行runtimeと同じ2表・index定義を検査し、その表への追加triggerを拒否する。
  投入前は両表が空でなければ開始しない。既存受信を消したりupsertしたりしない。
- 1batchは最大40組、SQL/値の見積もり750,000 bytes以内。各batchの先頭で両表の件数を
  同じtransaction内で検査する。競合・失敗・応答不明なら後続を止める。全streamが
  複数batchになる場合は、全体が一つのtransactionとは扱わない。
- 別read-only接続で2表の全列を読み、期待する内容へ全件照合する。件数だけの成功判定や、
  古いreportでの省略はしない。schemaも前後で検査する。

一括runnerではAuth→Master→Business→**receipts**→画像の順になる。receiptsは新しい
storeではなく、同じBusiness writer/journal・同じ調停executorを使う。本番実行と本番
readbackは、明示的な空streamを含め、このsource exportがなければ拒否する。
`stopAfter: 'receipts'` と `resumeAfter: 'receipts'` を使える。再開は完了済みstageの
全内容照合が条件で、部分投入や不明ACKの修復には使わない。

移行先の受信経路を準備しても、**旧stream投入・照合が終わる前には受信を有効化しない**。
旧受信をsealした後は旧経路が503を返す期間がある。実Stripeの再送・新旧endpoint変更と
効果の重複防止を実施票で確認する。新旧で同じeventを受けた際の処遇が不明なまま
dispatchや公開を始めない。sourceのreopenは取得境界を無効にするため、取得/照合をやり直す。

## 試験

`npm run test:source-stripe-receipt-only` は、独立PostgreSQL transactionで受付を閉じた後、
実SQLで取得→private fileへ暗号化→復号→native D1へ投入→全内容照合まで検査する。
追加試験は85組の複数batch、改変・誤った鍵/run、競合insert、余分なtrigger、保存後の
応答消失、空streamの書込なし確認を含む。管理API・実Stripeへの通信はしない。

一括runnerのnative3 D1/2 R2・実調停DO試験では、同じBusiness journalで受信記録を移し、
保存応答が失われると未確定operationを残して画像に進まないことを確認する。
本番データの実移送、旧handlerの副作用照合、provider再送の受け入れとは区別する。
