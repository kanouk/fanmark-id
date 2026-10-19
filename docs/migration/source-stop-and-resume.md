# 旧環境の停止順序と公開前の中止手順

対象は `ppqgtbjykitqtiaisyji` から専用Cloudflare資源への移行。これは実行票の候補であり、
停止・配備・移送・DNS変更を実行した記録ではない。管理者MFAは、以下の未完了準備を
閉じてから最後に取得する。既存の解約済み自己テスト契約は原本のまま移す。

## 開始前にそろえるもの

| 項目 | 現状と開始条件 |
| --- | --- |
| source原本 | 35 Edge Functionの原本、各ID/version/JWT設定、個別依存file hashを保存済み。開始直前に全件再照合する |
| 停止・逆操作SQL | Cron、71保護relation、保存専用Stripe receiverの候補あり。同じrunの14 fileへ再生成し、独立にhash/権限を確認した。当日のinventory再取得・再生成は未実施 |
| 旧handlerの終了確認 | Functionの差替えやDB transaction 0だけでは、旧版Edgeの開始済み外部処理の終了を証明できない。実行・送信・決済の対応を確認するcollectorは未完了 |
| Stripe棚卸し | 下記GET専用collectorを実装。元の秘密鍵を移出しない一時診断adapterでlive取得とsource照合を実施済み。当日の停止境界での再照合は未完了 |
| 中止時の受信記録 | source streamの暗号化保存・D1への移送、逆方向のatomic SQL・固定読取adapter・暗号化保管・一度の実行journal/別要求読戻しを実装、native往復検証済み。実資源の閉鎖・旧処理終了・実回収は未実施 |
| 移行先の閉鎖 | 一般HTTP/Auth/Cronと業務dispatcherを止める。受信専用経路も開ける前に当該Worker version・binding・署名鍵・台帳を照合する |

未完了のまま停止を始めない。特に、障害時に旧サービスを戻すための手順が書かれている
ことと、受信した通知を落とさずに戻せることの実証を分ける。

## 当日の実行順序

| 順序 | 操作と確認 | 保存する証拠 |
| --- | --- | --- |
| 1 | 旧環境の変更作業・外部writerを止める。原本35関数、Cron、DB/Storage inventory、Stripeアカウントと送信先を再取得 | run、時刻、全定義hash、停止担当・対象 |
| 2 | 固定runの保存専用receiverを準備し、同じ旧Webhook slugへ配備する。署名検証と永続保存の受付を維持する | 配備ID/version/JWT・保存先。旧版handlerの終了は別確認 |
| 3 | Checkout/Portalを含む34関数の入口をmaintenanceへ変更し、Cronを元の定義に結び付けて停止する。直接API/Auth/Storage・管理者操作を含む新規writerも停止する | 各入口の拒否と定義、停止前に始まった処理の一覧 |
| 4 | 開始済みのDB/Storage/Edge・外部決済/メール処理を突き合わせる。Stripeのopen Session、complete/unpaid、処理中PaymentIntent、継続請求、Payment Linkを確認 | 未確定処理の終端・副作用との対応。経過時間だけで終了扱いしない |
| 5 | DB freezeを適用して独立検査し、Auth/業務/Storageの最終snapshotを取る。既存uploadや署名URL経由のbytes変更も止まったことを確認する | 同じ境界の全件数/hash、freeze定義、Storage実bytesの再照合 |
| 6 | 旧receiverをsealし、開始済み保存commitの完了を確認。専用streamを暗号化取得し、固定5 storeへの移送・独立読戻しと併せて照合する | seal時の全内容、archive hash、全journal、独立比較report |
| 7 | 必要な受信経路だけを新側へ開ける。境界後に届く通知を別streamとして保持し、旧側での適用済み効果と照合する | 新旧mode/event ID・Checkout/業務効果の対応と未解決0 |
| 8 | provider設定・認証・バックアップ/復旧・公開経路の受入れを確認して公開判断へ進む | 本票だけでは公開しない。新側の一般書込み開始は別の境界 |

open Checkoutの強制失効、請求取消、返金、通知の再送はこの準備処理に含めない。
残っていた場合は対象と処遇を確定する。画面の「complete」だけでは入金済みと扱わない。
StripeのSession仕様ではcompleteでも支払い処理が進行中のことがある。
[公式Session仕様](https://docs.stripe.com/api/checkout/sessions/object)

## 公開前に中止した場合

「公開前」は、新側の一般書込み・業務dispatcher・外部副作用を一度も開始していないことを
実記録で確認できる状態。未確定のimportがあっても新資源を閉じたまま保存できるが、
それだけで旧環境の再開が安全とはならない。

1. 新側の一般HTTP/Auth/Cron/dispatcherを閉鎖したまま、移送の新規操作を止める。
   executor、未確定operation、private journal、部分投入データを消さない。
2. 新側受信を一度も開けていなければ、source receiverの実seal状態と保存済みstreamを
   照合する。開けた後なら、新側の受付中保存を完了させ、境界後streamを回収して旧側に
   永続保存・全内容照合する。[回収adapterとjournal](stripe-receipt-transfer.md)を使うが、実閉鎖と旧処理終了の証拠・本番回収の読戻しがそろうまで再開不可。
3. sourceがseal済みなら、同じrunの `verify.sql` で確認して `reopen.sql` を実行する。
   既にopenなら再実行しない。応答不明は状態を読み直す。受信記録を削除しない。
4. 通知ごとにsource業務の適用結果を確認する。保存済み通知に200を返した後では、
   Stripeの再送に頼って取り戻せない。元handlerへの全件再送やpendingの一括完了はしない。
5. 復旧中も入口とCronを止めたまま、DB freezeの逆操作を適用し、元の権限・trigger・
   Storage状態を確認する。35関数は保存原本とJWT設定へ個別に戻し、全inventoryを照合する。
   Stripeの旧handlerを戻すのは受信・効果の照合を終えた後。保存用schema/記録は保持する。
6. 元の公開経路でAuth・所有者操作・画像を確認してから、元々activeだったCronだけを
   復元する。旧環境を再び唯一のwriterとし、新側は閉鎖を保持する。

新側で業務書込みや外部副作用が始まった、または開始の有無が不明なら、この中止手順の
対象外。DNSだけ旧側へ戻して二つのwriterを作らない。データ・決済・通知を含めた復旧を行う。

## Stripe棚卸しcollector

`scripts/migration/source-stripe-inventory.mjs` の `collectSourceStripeInventory` は、メモリ上の
既存資格情報とlive/testを受け取り、固定アカウントを確認後、Session・全状態のSubscription・
Invoice・PaymentIntent・Payment Link・取得可能なEventをGETだけで取得する。
ページ欠落、重複、上限到達、mode混在、未知の状態、API失敗では結果を成功として返さない。
sourceデータを変更せず、イベントを再送・適用しない。

返り値はIDと照合に必要なmetadataを含むためGit外のprivate保存に限定する。秘密・
メール・client secret・イベント全文は返さない。CIでは偽の資格情報/応答だけを使う。
本番adapterは元のsecretを同じ実行環境内で渡し、チャット・引数・ログへ出さない。

取得は複数HTTP要求なのでatomic snapshotではない。イベント一覧も永続的な全履歴ではなく、
v1/v2の送信先全件一覧や旧業務効果の証明を含まない。過去のpaidを未適用と決めず、
すべて照合対象として保持する。件数0だけで移行可能としない。

Stripeはlive通知を最大3日間自動再試行し、手動再送にはDashboardで15日、CLIで30日の
期間制限がある。停止中の記録保存や復旧手順をその再試行期間で代用しない。特に
Sessionの作成日とEventの作成日は同じとは限らない。
[公式再送仕様](https://docs.stripe.com/webhooks#automatic-retries)

## 2026-10-19の実取得

同じcollectorのsource hashを固定し、10分で失効するnonceとservice roleを要求する
一時診断関数から実行した。旧環境の秘密鍵はその環境内だけで使用した。全6 collectionの
ページ終端まで読み取り、未完了Checkout/処理中支払い/継続契約・請求/有効Payment Link/
配信待ち通知は0件。Sessionはexpired 2・paid/complete 1、PaymentIntentはsucceeded 1。

過去のpaidは対応する旧ライセンス1件（expired）と所有者/fanmarkが一致したが、
同じSessionの監査と延長監査は0件。適用結果は未確定として保持し、返金・再送・
ライセンス補正は行わない。新しい受信を処理する際には、この履歴を再適用しないための
照合が別に必要。ユーザーが保持を求めたcanceled契約1件もそのまま存在した。

診断関数を削除し、元の35関数のID/version/JWT/provider hashが開始前と同じことを
独立した一覧取得で確認した。原本関数と業務データへの書込みはない。
[取得結果と制限](evidence/source-stripe-inventory-readback-2026-10-19.json)。
本番の停止・drain・最終snapshotはまだ行っていない。

## 停止時間

現状は本番の停止時間を確定できない。準備済みデータ量のlocal restore測定を本番RTOに
読み替えない。最終snapshot/暗号化・5 store import/独立比較・Stripe効果照合・認証確認・
公開経路確認を通したリハーサル時間と、上記中止手順の実測を実行票へ追加する。
本番開始前に中止判断の時刻と担当を決め、未解決の処理が残る場合は公開へ進めない。
