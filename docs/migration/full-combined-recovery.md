# 全Master・合成Auth・業務・画像の一式復旧

全Masterと全合成Authの個別実D1復旧は受け入れ済み。この工程では同じ保存bundle
から全ストアを戻し、本人認証、業務所有者、カタログidentity、画像参照が同じ
アプリ構成でつながるか確認する。既存DB、実ユーザー/Auth/Storage、DNSは移送しない。

## 保存bundle

- Masterは保存済みの全25表/12,254行/98定義を保持。旧Auth行は空のまま。
- Authは元の全9非空表/3合成user/4 account/14行を保持し、業務fixtureの固定ownerに
  対応する合成credential user/accountを2行追加する。全4 user/5 account/16行。
  元password hash、TOTP暗号文、backup code、session/assurance、generation、
  停止/確認状態と監査を変更しない。実provider tokenは含まない。
- 業務は現行schemaの40表/15合成行。fixtureの3 emoji UUIDだけを全Masterの同じ
  絵文字のUUIDへ揃えて新規source-shaped snapshotを生成。実データidentityの修復を
  証明しない。manifest/catalog/schema-report/40 streamの正確な保存bytesを含める。
  復旧時に再exportして新しいrun IDへ置き換えない。
- 分離avatar/cover用の合成PNG2件と正確なStorage manifest/statusを保持。

全体をAES-GCMで保存し、元archive hash、schema/manifest hashと合成SDK鍵identityを
AADに含める。archiveとone-off鍵/test資格情報は別private directoryへ保管する。
これは運用鍵保管/交換、off-host保存/retention、担当/RPO-RTOの採用ではない。
元sessionの保持は隔離した完全性試験だけで、本番再開の失効方針は別に残る。

## 専用Workerと検証

`isolated-recovery-combined-worker.mjs`は新規所有3 D1/2 bucket、recovery名、split
topology、token/incarnationを要求する。画像readを含む全経路をprivate gateで保護。
既存Authのlogin/challenge/logout、本人profile/所有一覧、カタログ/参照MasterのGET、
画像GET/HEADと固定2画像のrecovery transportだけを許可する。signup、新MFA登録、
業務書込、退会、汎用SQLは閉じる。transportの認証headerを除去して実routerへ委譲し、
本人sessionを置き換えない。main Workerへbinding/routeを追加しない。

`npm --prefix workers/api run test:isolated-combined-recovery`はnative5件でprivate gate、
全resource identity、書込拒否、実SDK signin→本人Business read→logout、別R2 bucketの
実アプリ画像GET/HEADを確認し、通常Worker CIへ含める。小さい試験から全bundleの
復旧を推定しない。全bundleのローカル復旧は下記で受け入れた。

保存bytesを再読込してから別incarnationの2 targetへ戻す。Master/Authの全定義/列hash/
FK、業務40表のsource stream/credential変換とcommit後中断再開、R2のreplay/bytes/MIME/
key、単一wakeを照合する。実routerから全3944 catalog、保存Authのpassword/TOTP/
backup code/停止拒否、業務ownerのprofile/所有一覧と画像参照GET/HEADを確認する。

remoteはexact候補CI両job・account・main全表hash/Worker/inventoryを照合した後、
新規所有3 D1/2 bucket/Workerだけへ実行する。receipt、binding UUID/作成時刻/secret名/
100% versionを照合し、未知の書込ACKを再送しない。exact receiptで所有資源を削除後、
別read-only processで元inventory/全表hash/Workerと一時資源の不在を確認する。
実D1/R2一式復旧は下記の2 targetで受け入れた。converterの4 blocking group/deployable=falseは保持する。
one-off測定は本番RTOや全移行完了に拡張しない。実端末/provider/運用・最終確認は残る。

## 保存ファイルから2つのnative targetへ一式復旧（2026-10-06 JST）

e381075の専用入口を使用し、保存済みのbundle v2を再読込して別incarnationの
2 local native D1/R2へ復旧した。全Master25表/12,254行/98定義、合成Auth9表/16行/
30定義の全列/hash/FKが一致。業務40表/15行のsource stream、credential変換と
primaryのcommit後中断/再開、R22件のimport/replay/bytes/MIME/key、単一wake1/0を
確認した。業務snapshotはarchiveの正確なmanifestと40 streamを復元し、再exportしない。

実routerの全3944 catalogと業務emoji UUIDの対応、保存Authのsession/期限内assurance→
logout/旧cookie拒否、元password/TOTP、backup消費/再利用拒否、未確認/停止拒否と、
別の合成業務ownerの実signin→profile/全3所有一覧→avatar/cover GET/HEAD→logoutが
同じ構成で通過した。one-off計測108759ms/105409msは本番RTOではない。
鍵/改変はtarget前に拒否し、archiveを保持、2 runtimeを終了した。

独立03:46:28.205Zのread-only照合で元Master/Auth archive、元3合成userの行、
main全Business/Auth/Master表hashとAuth3/7/2/FK0・Worker8cを保持した。
remote資源作成/既存DB書込/実ユーザー移送/DNS変更は0。
[限定native証拠](evidence/full-combined-file-native-recovery-2026-10-06.json)。
e381075のCI37410033281は両job成功。実D1/R2一式復旧、運用鍵/失効方針と最終六項目は未完了。

## 保存ファイルから実D1・R2へ一式復旧を受け入れ（2026-10-06 JST）

候補dcb0127のCI37410960675は両job成功。同じ保存bundle v2から別incarnationの
2組の新規3 D1・2 R2・専用Workerへ、全Master25表/12,254行/98定義、合成Auth9表/
16行/30定義、業務40表/15行、PNG2件を復旧した。全定義/列hash/FK0、正確な保存
manifest/40 stream、credential commit後の中断再開、R2 import/replay/bytes/MIME/keyが一致。
実routerで3944絵文字と参照Master4/4/5/16、元session/期限内assurance/logout、
password/TOTP/backup消費・再利用拒否/停止拒否、本人profile/3所有一覧/画像GET・HEADを確認。
所要145407ms/105809msは復元・アプリ確認のone-off値で、本番RTOではない。

2組の所有資源をexact receiptで削除。独立04:06:55.383Zの照合で元D1/R2/Worker一覧、
main全表hash/count/FK0、Auth3 user/7 account/2 sessionとWorker8cを保持した。
D1/Workerはread-only監視credential、R2一覧は固定accountを確認したOAuthでGETのみ。
既存DB書込・main配備/secret変更・追加メール・実ユーザー移送・DNS変更は0。[実D1/R2の一式復旧証拠](evidence/full-combined-file-remote-recovery-2026-10-06.json)。

これは合成Auth/業務の復旧受け入れ。運用鍵/交換・off-host/retention・本番失効方針、
source converterの4 blocking groups/deployable=false、残るUI/provider/実端末・六項目の
完了条件は保持する。Mac解除の既存質問は返答待ち。

## 現行27 Businessでの保存bundle一式復旧（2026-10-06 JST）

コード候補5e037d0/CI37418737512両job成功版と、文書だけ異なる022a0d4を照合した。
文書候補022a0d4のCI37420051154も両job成功。
同じ暗号化保存bundle v2から、別incarnationの2組の新規3 D1/2 R2/専用Workerへ
全Master25表/12,254行/98定義、合成Auth9表/16行/30定義、業務40表/15行とPNG2件を復旧。
各Business targetの全27 migrationとschema定義が現行runtime profileへ一致した。
全Master/Auth列hash・定義/FK0、正確な保存40 stream、credential commit後中断再開、
R2 replay/画像bytes、実SDKのsession/password/TOTP/backup/停止拒否、本人profile/3所有一覧、
画像GET・HEAD、catalog3944/参照Master4/4/5/16、単一wake1/0を確認した。
所要132917/310412msはone-off値で、本番RTOではない。2組目は同名Worker再作成後のprivate
identity確認に失敗したため、正確な所有資源/version/bindingを再照合し、同じ一時Workerの
recovery gateだけを同じ権限で更新して再開した。初回HTTP応答/根本原因は未記録のため断定しない。
2組目の所要時間にはD1作成開始から、この再開とアプリ確認までを含む。
初回失敗と再開記録を保持し、スキーマ/データ復旧をやり直していない。

全所有資源をexact receiptで削除。独立2026-10-06T06:01:29.711Zの読み取りで
元D1/R2/Worker inventory、main全表hash/count/FK0、Auth3/7/2とWorkerd437を保持した。
main DB書込・配備/secret変更・追加メール・実ユーザー移送・DNS変更は0。
[現行27の限定復旧証拠](evidence/full-combined-file-remote-recovery-v27-2026-10-06.json)。

これは現在のschemaでの合成一式復旧の受け入れであり、source converterの4 blocking groups、
運用鍵/off-host/retention/失効方針の採用、本人操作と実スマホ・provider・最終統合の六項目は残る。
以前の25 Businessの証拠は当時の結果として保持し、書き換えない。
