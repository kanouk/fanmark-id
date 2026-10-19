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

## 公開前に旧側へ戻すSQL候補

`prepareStripeReceiptReturn({ sourceBefore, targetTables, runId, originalFunction, closedAt })`
は、元のsealed source exportと新側の2表から、旧PostgreSQLへ戻すSQLを生成する。
接続・実行・dispatch・Stripe API呼出しは行わない。targetの受付と進行中保存を止めた証拠は
別に必要で、返り値の`targetDrainVerified`と`productionReady`はfalse。

- 元の全receipt/dispatchを必須とし、ID・mode/event・payload/hash・初回受信時刻・dispatchを
  保持する。重複受信によるdelivery_countの増加とlast_received_at/updated_atだけを許す。
  count不変の時刻変更、count減少、時刻逆転、closedAt以後の記録は拒否する。
- 新しい通知もreceived/pending・attempt_count 0・claim_generation 0・leaseなしが必須。
  処理済み、処理中、再試行、内容不一致、元の行の欠落は回収候補にしない。
- SQLは同じrunのcontrol行と受信2表をロックし、関数定義・権限・sealed状態を検査する。
  sourceの全行が元exportと一致することを型付き比較で確認してから、targetにある全内容を
  一つのtransactionで反映する。追加trigger/ruleを拒否し、業務表には書き込まない。
- 更新後も全行・件数・状態を検査し、受信はsealedのまま保持する。途中失敗は全体を
  rollbackする。`reopen.sql`や旧handlerへの復帰は別操作で、適用効果の確認前には行わない。

返り値のSQLと`returnedSource`はprivate情報を含む。以下の保管・実行部品を接続したが、
実環境の停止と回収は未実施。SQL成功だけで旧サービスを再開しない。

native試験は実PostgreSQL→暗号化→D1→本番と同じD1受信関数で重複/新規受信→旧側への
SQL回収→全内容比較を通した。4 receipt/5 deliveryから5 receipt/7 deliveryとなり、元の
記録・microsecondsとpending状態を保持する。dispatchへの挿入を制約で失敗させると、
先行receipt更新もcontrol件数も元に戻ること、改変・処理履歴・追加trigger・再適用の
拒否も確認した。実環境の受付停止・通知回収の実証ではない。

## 暗号化保管と一度だけの返却実行

`collectStripeReceiptReturn`は同runの完了済みimport、保持中のwriter fence、進行中writer 0、
未確定操作なしを要求する。固定本番Business D1のread-only adapterでschemaと全2表を取得し、
run・元export hash・manifest・資源incarnation・fence状態を認証対象としてAES-256-GCMで保存する。
worktree外の0700 directory/0600新規fileにfsyncし、復号・全内容・現target/fenceを再検査する。
失敗時も生成済みarchiveを保持する。collector自身はfenceを取得・解除せず、D1へ書き込まない。

`source-stripe-return-transport.mjs`は固定projectのManagement APIへ、生成したSQLだけを送る。
読取りは管理者接続の明示的なrepeatable-read/READ ONLY transaction。APIの`read_only:true`は
private schemaを読めない専用ロールへ切り替わるため使用しない。読み取り専用adapterには
返却実行を許さず、任意SQLも受け取らない。資格情報・API例外本文は出力しない。

`executeStripeReceiptReturn`には保管済みarchive/hash、元export、同runの調停/読取D1、
sourceReaderとsourceWriter、未使用のprivate journalPathを渡す。順序は次のとおり。

1. archiveと現target/fence、旧側の全内容が元exportに一致することを確認する。
2. run・内容hash・生成SQL hashだけのintentをexclusive作成し、file/directoryをfsyncする。
3. target/fenceを再確認し、元内容の一致条件付きSQLを一度送る。
4. 別の読取り要求で旧側export全件を照合し、target/fenceを再検査して別fileに検証結果を保存する。

既存intentがあれば再送しない。応答不明時は`inspectStripeReceiptReturnExecution`へ同archiveと
intent hashを渡し、現在の旧側を「返却後の内容」「元の内容」「いずれとも不一致」に分ける。
元の内容に一致しても、先行transactionの終了を証明できないため再実行は許可しない。
読戻しで返却後の一致を確認できても、自動reopen・dispatch・fence解除はしない。

native DO/D1/PostgreSQL試験で暗号化、同一run/資源/manifestの固定、未完了・進行中writer拒否、
保存後のtarget変更検出、一度の実行、commit後の応答消失と再送なしの照合を確認した。
管理API応答は合成。実sourceではrole/transaction設定のREAD ONLY確認のみ実施し、
`billing_ingress`未導入を確認した。生成SQLの本番適用はしていない。

このfence検査は追跡対象writerの停止を確認するだけで、過去に業務書込みが公開されていないことや
旧handlerの終了・外部決済効果を証明しない。実受付の閉鎖・旧handler終了、業務未公開の証拠、
実資源への適用と全件読戻し、旧処理効果の照合は最終実行の前提として残る。
