# Master D1の共通復旧処理

`workers/api/src/master-d1-recovery.ts`はMaster限定の取得・暗号化・読込・空D1への
復旧を提供する。通常routerやCronからは呼ばない。担当・鍵・保存先・保持期間の採用と
全ストアcollectorは[backup-operations.md](backup-operations.md)の別条件となる。

## 契約

- `captureMasterRecoverySnapshot(db, expectedSchemaHash)`は25表・schemaの前後・FKを
  1つの28 statement batchで取得する。別のBusiness/Auth/R2まで原子的に取得しない。
- schemaはSQLite/Cloudflare内部objectを除くtable/index/view/trigger。`d1_migrations`は
  含む。schema hashは信頼済みDDL/独立receiptから呼び出し元が固定し、未検証archiveの
  headerをそのまま信頼しない。内部`sqlite_sequence`のhigh-waterは保存対象外。
- Masterに残るlegacy Authのuser/account/session/verification/twoFactor/adminRole/
  mfaAssuranceは全て空を要求する。実Authは専用Auth復旧へ分離する。
- 行は列名とJSON値で正規化し、順序に依存しないcontent hashを照合する。NULL・文字列・
  有限数だけを許可し、整数の精度喪失・BLOB・不均一な列を拒否する。1表20,000行以内。
- `sealMasterRecoverySnapshot()`/`openMasterRecoverySnapshot()`はAES-256-GCM、12-byte
  nonce、format/schemaHash/rowsHashをAADに使う。nonce/暗号文はcanonical base64。
  GCM tagを含む暗号文32 MiB上限を保存・読込の両方で適用し、平文byte bufferは消去する。
- `restoreMasterRecoverySnapshot()`はschema objectが一つでもあるtargetを拒否する。
  table作成→JSON chunkで行投入→index/view/trigger作成を、deferred FK付き単一batchで
  実行する。履歴を投入する時に監査・activation triggerを発火させない。
- chunkは100行/512 KiB以内、restore batchは950 statement以内。超過はtarget write前に
  拒否する。単一JSON parameterにすることで個別INSERTや多列placeholderの上限を避ける。
  [CloudflareのD1制限](https://developers.cloudflare.com/d1/platform/limits/)に対して
  Paidのquery枠に余裕を残す設計であり、Freeで全Masterを復旧できる保証はしない。
- native batch失敗はrollback。commit後のACK不明ではtargetを消さず、独立readbackで
  照合する。targetが非空なら再実行を拒否し、新しい空targetが必要となる。
- 復旧後に同じschema/全表hashとFKを再取得する。generic schema importerではなく、
  固定25表の既知Master専用primitiveである。

## 検証（2026-10-07 JST）

`npm --prefix workers/api run test:master-recovery:d1`はNode WebCryptoとnative local
D1/workerdで7件成功。信頼済みmigrationを使い、合成絵文字1,001行、対応監査1,001行、
active/inactiveのready releaseと履歴、migration ledger、generation13を復旧した。
誤鍵/改ざん、Unicodeサイズ超過、legacy資格情報、不正schema/行、既存targetを拒否。
不正列/deferred FKのDDLを含むrollback、実commit後ACK喪失の保持/再実行拒否、復旧後の
immutable guardと新しい更新監査も確認した。通常Worker CIにこの試験を追加した。

別private processで、10月6日に保存済みの全Master archiveを独立schema receiptと照合し、
新formatへ明示変換・暗号化保存・再読込して新しいlocal D1に復旧した。
25表/12,254行/98 objectの全hashが一致し、233 statementで復旧、28 statementでreadback。
同じprocessの追加captureも一致、FK0。公開用viewは絵文字3,944、Tier4/言語4/
予約5/延長価格16。保存時点のgeneration0を保持した。現stagingのgenerationを戻す試験
ではない。測定2,538 msはlocalの結果で、本番RTOやD1 APIの制限内実行を保証しない。
[限定証拠](evidence/master-recovery-shared-full-local-2026-10-07.json)。

新source export、remote read/write、追加mail、Worker配備は0。旧private proofの形式は
新formatへ直接互換ではなく、復号済みの既知schema/行を検証して明示変換した。
定期collector、運用鍵/off-host/retention、同一時点の全ストアcaptureは未採用。

## 共通engineへの移動（2026-10-07）

内部処理を`d1-store-recovery.ts`へ移し、Masterは同じ25表/空Auth/format/schema pin/
query budgetのprofileで使用する。公開export名を維持し、既存native7件が成功した。
Businessは別formatで採番状態も扱うが、このMaster v1に採番high-waterの取得を追加した
ものではない。Masterの既存の境界は保持する。[Business profile](business-recovery.md)。
