# 移行中の旧Stripe受信を保存専用にする候補

`scripts/migration/source-stripe-receipt-only.mjs` は、旧環境の業務更新停止中に
Stripe通知だけを保存するSQLとEdge Functionの候補を生成する。ネットワーク接続、
SQL実行、配備はしない。通常の `handle-stripe-webhook/index.ts` も置き換えない。
受信記録の移送・照合は[専用streamの手順](stripe-receipt-transfer.md)へ接続した。
旧handlerの副作用照合と当日の停止/取得確認が終わる前に、本候補を本番へ適用しない。

2026-10-19の読み取りでは、旧projectの `billing_ingress` schemaと同名public RPCは
存在しない。既存Webhookはversion 172、JWT検証なし。35関数の保存済み原本を全file
hashで検査し、管理APIからもWebhookのID/version/JWT設定が同じであることを確認した。
配備前には再取得が必要。旧解約済み契約は変更・除外しない。

## 保存と受付終了

- 固定project、run UUID、旧Function ID/version/原本hashを必要とする。受信専用の
  schemaまたは既存RPCがあれば上書きせず拒否する。全pending migrationの適用はしない。
- 既存の `20260921090000_add_stripe_receipt_foundation.sql` だけを基礎にし、
  Stripe署名を検証する共通handlerを再利用する。receiptとpending dispatchを同一
  PostgreSQL transactionで保存する。課金、ライセンス付与、通知送信、dispatch実行はしない。
- live/testは別キーで保存する。既存の正規化済みsnapshotとraw bodyのhashを残し、
  raw body自体は保存しない。未対応イベントの保存も自動的な業務適用の承認にはならない。
- private schemaはanon/authenticated/service_roleから直接読書きできない。
  service_role専用public RPCはrun UUIDを確認し、private coreを呼ぶ。
- RPCはcontrol行の共有ロックをtransaction終了まで保持する。`seal.sql` は同じ行の
  排他ロックを取得してから受付を閉じる。開始済みの保存がcommitするまで待ち、後続は
  保存を拒否する。handlerは永続化できなければ503を返し、200で受領済みとは扱わない。
- lock timeoutは5秒、statement timeoutは30秒。timeoutではtransactionをrollbackし、
  受付状態を変更しない。停止時間の見積もりや全入口のdrain完了時間ではない。
- `verify.sql` はrun、元の関数定義、権限、receipt/dispatchの対応・未処理状態を検査する。
  seal後は保存件数とdelivery総数も照合する。件数一致は全内容のhash照合を代替しない。

## 実施時の順序と復旧境界

1. 同じrunのsource停止票、全関数の原本・逆配備bundle、Stripe受信記録の移送票をそろえる。
   管理APIでsourceのversion/JWT設定、SQLでschema/RPCの不存在を再確認する。
2. 明示的な移行開始時に限り `install.sql` を実行し、保存専用candidateを旧Webhookと
   同じslug・JWT設定で配備する。新bundleのversion/hashを読み戻す。原本は保持する。
3. 他の旧入口・Cronを停止し、開始済みの外部副作用とDB/Storage処理を照合する。
   `source-database-freeze.mjs` の対象public/auth/storageを止めてもprivate受信は継続する。
4. 新環境への受信経路を未有効のまま準備し、旧受信をsealして別接続で検査する。その固定境界から
   receipt/dispatchを別streamとしてexport・暗号化・移送・全内容照合する。
   業務snapshotだけのimportで受信記録まで移ったことにしない。移送・照合後に新受信を有効化する。
5. 旧経路でseal後に届く通知は503になる。新旧のevent ID/live modeと、既に旧handlerで
   適用された業務結果を突き合わせ、再送・未処理イベントの処遇を確定してから公開する。

seal/reopenの応答が失われたら、再実行前に `verify.sql` で実状態を読む。
`reopen.sql` は同じrun・定義・権限とseal時件数を確認して受付だけを再開する。
receipt/dispatchは削除しない。既に同じ状態への再操作は拒否する。
旧handlerへの復帰は、保存した原本bundleを使う別操作であり、reopenだけでは復帰しない。
新旧いずれかで適用済みの課金・ライセンス効果がある場合、単純な旧handler復帰や
全イベントの再送で復旧したとは扱わない。

## 検証と未完了

`npm run test:source-stripe-receipt-only` は、外部接続なしのPostgreSQL 17コンテナと
実Stripe SDKの合成署名を使う。生成したentryを実行し、署名拒否、重複、live/test分離、
業務freezeとの共存、run/権限拒否、独立transactionの保存完了待ち、seal timeout、
seal後503、関数/権限変更の検出、記録を残したreopenを検査する。CIにも追加した。

7件成功。生成した本番候補はDeno型検査とSupabase Edge Runtime v1.76.2のbundle生成も
成功した。bundleはprivate保存したが未配備。実Stripeの送信・再試行は試験していない。

このロックが証明するのは新しい保存専用RPCの完了待ちだけ。旧versionの実行中Edge、
旧handlerの複数transaction間の部分適用、Stripe外部副作用、全入口停止の証明は残る。
受信streamのexport/importは一括runnerへ接続した。両環境の効果照合と実停止/取得の確認が
残るため、`productionReady=false` を維持する。
管理者MFA再認証はこれらと他の移行準備がそろった後に行う。
