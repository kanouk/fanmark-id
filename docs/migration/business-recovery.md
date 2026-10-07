# 業務D1の保存・復旧処理

`workers/api/src/business-d1-recovery.ts`は、現行27 migrationの業務D1を取得・暗号化し、
新しい空D1へ復旧する管理処理。公開APIや定期collectorへは接続していない。
sourceのpublic 40表を変換して取り込む移送器とは別で、既にCloudflare上にある業務表・
コマンド台帳・通知outbox・採番状態を保持する。実ユーザーの取得・移送は実行していない。

## 契約

- 固定79表（`d1_migrations`を含む）と`sqlite_sequence`を取得する。現行の226 schema
  objectを、archive以外の信頼したmigrationから得たschema hashへ照合する。
- schema前後、80表、FK確認を同一D1 batchの83 statementで読む。他のAuth/Master/
  R2も同時点で取得したという保証ではない。
- 表と列と行を正規化してhashを作る。NULL・文字列・有限数だけを許し、整数はJavaScript
  のsafe integer範囲、各表は最大20,000行。未知の表や列形状の混在は拒否する。
- `fanmark-business-recovery-v1`はAES-256-GCM、12-byte nonce、canonical base64。
  format/schema hash/row hashを認証し、tagを含む暗号文上限32 MiBを保存・読込で共用する。
  Master/source/一式bundleのformatと交換できない。平文byte bufferは使用後に消去する。
- 復旧先にmigration ledgerだけがある場合も拒否。DDL、100行/512 KiB以内のJSON chunk、
  保存した採番状態、index/view/triggerを単一batchへ渡す。最大900 statementで、Paid D1の
  query budgetに空target確認と83 statementのreadbackを収める。Free D1では使わない。
- triggerは全行を戻した後に設置し、過去の招待消費や通知wakeを再発生させない。
  `sqlite_sequence`はschemaのAUTOINCREMENT表だけを許し、既存行の最大ID未満や欠落を
  拒否する。削除済みの最大IDも保持するため、次のevent/ledgerで古いIDを再利用しない。
- schema/全表hash/FKを再取得して照合。失敗・ACK不明でtargetを消去しない。実際に
  commit済みなら内容を保持し、再実行の前にoperatorが状態を読む。

## 検証

```sh
npm --prefix workers/api run test:business-recovery:d1
```

実local workerd D1へ27 migrationを適用し、79表・採番表・226 objectを保存/復旧した。
合成event 1,001行、削除済みevent ID 9,000とledger ID 100、招待消費済みcommand、
本人profile、pending通知、wake requested=9/ack=7、削除済みlicenseのincarnationを含む。
復旧後の全hashが一致し、追加event ID 9,001/ledger ID 101、招待消費1回保持、wake9/7を
確認。実triggerは復旧後の新しい更新でwake10へ進み、巻戻しを拒否した。

別の空targetでFK/constraint失敗によるDDLとデータのatomic rollback、commit後ACK喪失の
保持と盲目的な再実行拒否、不正鍵・改変・他format・不正採番の書込前拒否も確認。
通常Worker CIに含む。Master profileは同じengineへ移し、既存7件のnative回帰が成功。
Masterのformat/schema pin/legacy Auth空/28 statement captureとAPI名は保持する。

この合成検証はremote Business D1の新しい復旧受け入れ、全ストアcollector、R2保存、
運用鍵・定期/off-host・retention・RPO/RTO・復旧後のジョブ再開方針の採用を意味しない。
保存したpending commandを実環境で再開する前には、Auth/Stripe/R2と対応する復旧点の
照合が必要。実ユーザーデータ移送・公開domain/DNSは最後の別工程のまま。
