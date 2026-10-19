# 2026-10-18 本番移行の実装・検証

PR #41の既存ブランチを継続。本番準備完了とは判定しない。本人の再認証は、他の準備がそろってから行う。10月16日の再登録capsuleは期限切れで、期限を書き換えたり検査を迂回したりしない。

## P2: 本番専用D1 transport

`production-remote-d1.mjs`は保存済み本番資源表のaccount/DB UUID/名前/作成時刻に固定し、SQL batchごとにAPI metadataを再確認する。既定は読み取り専用。SELECTと限定した読取PRAGMAだけを許し、複文や不明SQLを拒否する。既存isolated-remoteの対象制限は維持する。

書込transportは0700ディレクトリ・0600ファイルのjournalを必須とする。送信前にintentをfsyncし、全結果を受け取り検証した後にだけACKを保存する。途中終了・応答不明・結果欠落ではpendingとlockを保持し、同じjournalの別processからも追加書込を拒否する。記録には行・資格情報を含めずbatch hashだけを保存する。異なるjournalを使った同一DBへの同時書込の防止、pendingの独立照合・解決、全storeの取り込みを指揮するrunnerは未実装。transport単体を本番import開始の許可と扱わない。汎用importerへproduction transportをlocalとして渡す経路も拒否する。

`verifyImportedD1Snapshot`を追加した。import reportを信用せず、別の読み取り専用呼出しでsource manifest/全行・資格情報変換結果・全進捗台帳・schema・FK・連番上限を照合する。共有codecを使うが、書込facadeを渡さず、資格情報台帳の状態を修正しない。移送後の進捗台帳を前後比較し、行の欠落/改変・連番巻戻し・未完了台帳・未解決guardを拒否する。対象と関連46試験成功。進捗prefix/chunk digestの改変拒否も追加検証した。全storeを停止するguardはまだ別工程なので結果は `unfenced-readback`、`fullMigrationReconciled=false`、`deployable=false` を保持する。これは全storeの独立検証や本番再開許可の代替ではない。

native D1で新規10試験を確認し、既存isolated transport/importerと合わせて39試験成功。実Cloudflareへの接続は読み取り専用で確認し、全3DBのschema・初期seed・migration ledger一致とFK0を再確認。[実環境の確認](evidence/production-schema-readback-2026-10-18.json)。実データのINSERTは行っていない。

## P3: DB更新拒否と逆操作

`source-database-freeze.mjs`は実inventoryに一致する関係だけに対し、更新拒否トリガー、読戻し検査、解除SQLを生成する。接続・実行は行わない。設置前後に全関係集合と権限を照合し、ACCESS EXCLUSIVE lockで開始済みSQLの終了を待つ。lock timeout 5秒・statement timeout 30秒。途中失敗は同じtransaction全体を取り消す。

実sourceのread-only検査ではpublic40/auth27/storage8の計75表。管理された35表はpostgres所有ではなく、所有者専用のALTER/DROP TRIGGERを直接使えない。TRIGGER権限のある71表については、所有表をENABLE ALWAYS、管理表を通常triggerで拒否する。逆操作はrun固有の関数・全依存triggerの定義と件数を照合してから、その関数だけをCASCADEで削除する。これは[Supabaseの管理schemaのtrigger解除手順](https://supabase.com/docs/guides/database/postgres/triggers)に基づく。所有権の変更はしない。

除外する4表はauth.schema_migrations/storage.migrationsと、未使用のstorage.buckets_vectors/storage.vector_indexes。vector2表が非空なら生成した停止SQLは拒否する。現在はいずれも0件。通常runtimeの6roleはsuperuserではなくsession_replication_roleのSET権限もないことをread-onlyで確認した。一般writerがreplica modeで通常triggerを回避できる構成は拒否する。管理者・プラットフォームのDDL/migration/role設定変更は別途停止し、除外したmigration metadataと全schemaを確定copy前後で照合する必要がある。

隔離PostgreSQL17で7試験成功。通常role/service_role/ownerのINSERT・UPDATE・DELETE・TRUNCATEと0行更新、所有表のreplica mode、非所有者のTRIGGER権限だけでの設置・解除、誤inventory/誤inverse/改変triggerの拒否、実行中transactionとのlock timeoutと全体rollbackを確認した。ポートを公開せず、専用containerはID/name/labelを照合して削除した。初回のtest harnessは初期化中の一時socketをreadyと判定して失敗し、最終TCP listenerで判定する修正後に成功した。

これはDB境界の部品であり、本番での停止実行ではない。外部副作用を伴うEdge、Stripe receiver、Cron、Auth/Storage HTTP受付と開始済みupload、DDL/deployの停止・drainを含む全source停止の受け入れは未完了。DB triggerによるHTTP失敗だけで、メールや保存済み画像本文の副作用がないとは判定しない。

## P1: 本番画面ビルド

本番modeで旧Supabase認証へ戻る問題と告知送信selectorのstaging限定を修正。専用buildは空envDirで既存VITE値を捨て、production originと全backend selectorを固定する。旧Supabase clientの通信・保存session・自動refreshを停止し、PWA cacheを分離する。認証境界2試験、告知API試験、application typecheckと実buildで検証。未配備。先行するD1/source停止のcommit `e76e34c` はCI `39133067109`、画面buildの `0d88fe6` はCI `39134134434` の両jobが成功した。

## P1/P7: 本番の運用adapterと閉鎖設定

本番専用Backup/Alert RPC・scheduler/monitorと絵文字マスター公開serviceを追加。既存の保存・復元・更新停止・公開処理を共用し、本番の3 D1 / 2画像bucket / Worker scopeを固定する。stagingのentrypointで本番scopeを受け入れない。本番receipt/鍵escrowの形式を分け、monitorに画像/DB/復号鍵/保存・削除RPCの権限を渡さない。共用コードの互換性のため環境変数には既存の `STAGING_BACKUP_*` 名が残るが、scope・保存先・entrypointで環境を分離する。

native D1/R2/DOで両profileの46試験が成功。更新終了待ち・失敗時の停止解除・全5storeへの隔離復元・復元session失効・30日保持・秘密の非露出・応答不明の再送拒否・monitor権限分離を含む。絵文字公開はstaging V2/V3/V4とproductionの計16試験が成功し、draft→stage→promotion→rollback、世代競合、破損artifact、backup停止中の拒否、環境取り違えを確認した。いずれも合成データのlocal試験であり、本番の遠隔復旧実測ではない。

`wrangler.app-production-closed.jsonc` は本番資源を結び、公開route/workers.dev/preview URL/Cronを0、画面をreceipt_onlyで閉じる設定候補。専用DO classでstaging namespaceを再利用しない。バックアップ/監視も専用Worker候補でCron停止。初期schema以外のimport ledger等が最終schemaへ加わり得るため、backup schema hash・鍵ID・通知先は空の未確定値として保持し、admission=pendingにする。偽の値で稼働扱いにしない。型検査・設定拒否試験2件・3 bundleのdry-runが成功。さらに実Workerコードをlocal Miniflareで動かし、画面/Auth/管理APIの503拒否、署名なしStripe受付の拒否、全3DB/3R2無変更、外向き通信0を確認した。配備は行っていない。

レビューで、取り込み後に追加される3つの進捗台帳が既存の業務バックアップprofileと一致せず、captureが失敗する問題を確認した。台帳を消すのではなく、固定3表を含む専用archive形式を追加し、元の形式の復元も維持した。元schema/取り込み後schemaの11試験で、暗号化・復元・台帳保持・部分欠落拒否・失敗rollback・応答不明時の再実行拒否を確認。production運用fixtureにも実importerと同じDDLの台帳を含める。

10月16日の暗号化予備コピーを使い、業務40表5,770行をnative local D1へ取り込み、別呼出し照合→83表（進捗台帳を含む）の暗号化保存→新しい空DBへの復元→再照合を実施した。全行一致・FK0、archive 3,517,141 bytes、全体72.3秒（取り込み54.6秒、復元1.7秒）。再認証は使用していない。初回に復元後の連番がSQLiteのREAL型になる不整合を検出し、INTEGERへの明示変換で修正。関連18試験で整数型・削除済みID上限・既存Master/Business復旧を確認した。[実データでの保存・復元](evidence/real-business-backup-rehearsal-2026-10-18.json)。これは業務DBだけのローカル検証で、Auth/Master/R2の実資源を束ねた遠隔復旧や本番停止時間の実測ではない。

絵文字更新用のproduction専用export/publication CLIも追加した。全5 bindingとscopeを検査し、Node 22.6.0で既存artifact生成を利用する。公開用一時入口は10分で失効し、更新POSTは1回だけ。既存stagingと合わせ21試験が成功。本番実行はしていない。[運用経路](emoji-releases.md#2026-10-18-production-operations)。

Cloudflare account内4 Workerの全settingsを読み取り、既存rate-limit namespace3個と本番候補 `41092711/12/13` の重複がないことを確認。配備時には再確認する。[namespace照合](evidence/production-ratelimit-readback-2026-10-18.json)。本番の実binding読戻し・秘密の保管/設定・provider接続・backup admission・実restore・通知先/配送・公開前operator確認は別途残る。

## P4: 旧環境の実Stripe account確認

旧Supabaseに保存されているSTRIPE_SECRET_KEYからGETのみを行い、live keyが `acct_1SFjhvJk0VCfiKUp` に属することを確認。全ページを読み取り、購読0、Invoice0、Checkout3（期限切れ2・支払済み完了1）、v1 Webhook endpoint0、直近30日event0を確認した。既存35 Functionのinventoryは確認前後で一致し、確認用の一時Functionは削除済み。課金・送信・Webhook変更は行っていない。[集計証拠](evidence/source-stripe-readback-2026-10-18.json)。

追加照合では、旧DBの購読1件はcanceled、設定上のtest料金IDと一致し、live側の同じ購読IDは404だった。test側のprovider object自体は未検証。過去のlive支払1件はlicense_extensionで、指定licenseの所有者とfanmarkは一致するが、現在はexpired。30日以上前の支払いで、対応するLICENSE_EXTENDED監査やsession ID記録は見つからなかった。適用済みとも未適用とも断定せず、移行処理から延長の再適用・返金をしない。[追加照合](evidence/source-stripe-correlation-2026-10-18.json)。

この結果は営業中の一時点の参照であり、停止境界の証拠ではない。履歴の例外扱いと切替直前の再照合は残る。API v1 endpoint一覧だけで他のevent destinationの不在を断定しない。

## 残条件

P1の本番配備・秘密・公開/backup/monitorの実接続と受け入れ、P2の全store runnerと独立checker・再開、P3の全入口停止と実source同等環境試験、P4のStripe実台帳・旧受信引継ぎ、P6のprovider/DNS設定と復元票、P7/P8の本番資源復旧・全体実測は残る。本番D1への実データ取り込み、旧サービス停止、DNS切替、main mergeは未実施。

## 非公開runtimeの実配備とStorage停止検証

runtime commit `62e139b` のCI `39136846799` はアプリ/Worker両方成功。本番専用アプリ・backup・monitorの3 Workerを公開経路/Cronなしで配備した。秘密はまだ設定せず、backup admission=pending、アプリはreceipt_only。管理APIで全binding集合、3 D1/3 R2、service entrypoint、専用DO namespace、rate-limit ID、変数、workers.dev/preview無効、Cron 0を別途読み戻し、既存4 Workerのsettingsとzone routesの保持を確認した。[実配備の照合](evidence/production-closed-runtime-2026-10-18.json)。本番データの取り込み・source停止・ドメイン切替は未実施。

本番のStorage APIは1.80.2。対応する公式imageをdigest固定し、外部へ接続できないDocker network上でPostgreSQLと動かした。DB停止中の新規upload/upsert/update/copy/move/delete/bucket設定を拒否し、public/authenticatedの元画像の読み出しと停止解除後の更新を確認。さらに開始済みの通常uploadと、最初のchunkを送ったTUS再開可能uploadの完了が停止後に拒否され、元objectのmetadata/本文が保持されることを確認した。5試験成功。[試験記録](evidence/source-storage-freeze-2026-10-18.json)。ローカルfile backendの証拠であり、本番S3 backendやS3 multipart、全Edge/外部副作用のdrainを済ませたとは扱わない。

絵文字CLI commit `07de140` はpush済みで、CI `39137905597` の結果を確認中。再認証は引き続き全準備がそろってから行う。

## 2026-10-19: 移行先全体の実行調停

本番専用の内部RPC `ProductionImportCoordinatorService` を追加した。既存のproduction writer DOの同一transactionで移行runと停止ownerを取得し、manifest/hash・全5storeのincarnation集合を固定する。開始済みwriterがあれば取得せず、1つの操作がpendingの間は別process/別journal/別storeの次の操作も拒否する。操作UUIDの再利用を拒否し、TTLでpendingを解除しない。独立照合結果のhashを受け取る完了操作も停止を解除しない。完了後は通常backupの新しい停止ownerを利用できる。

Node側のproduction D1書込transportは、この調停clientとprivate journalを必須とする。送信順はlocal intent fsync→remote intent→D1→remote ACK→local ACK fsync。どの応答不明でも次の書込へ進めず、任意SQLや行内容をremote調停台帳へ保存しない。読み取り専用transportは引き続き調停なしで利用できる。全store runnerとpendingの独立解決手順は未完成で、汎用importerのproduction拒否は維持する。

native DOの新規7件・既存15件、native DO/RPC/D1と別filesystem journalを組み合わせた6件・既存transport10件、公開HTTP閉鎖1件が成功。別journalでの再送拒否、begin応答の消失時にD1へ送らないこと、D1 commit応答消失時に実行済み1行を保持して全storeを停止することを確認した。公開HTTPには入口を追加せず、閉鎖Workerへの `/migration/claim` と `/migration/begin` も503になる。新調停機能はまだ本番へ配備していない。

先行commit `07de140` のCI `39137905597` は両job成功。配備/Storage検証記録の `64cda3b` を同じPRへpushした。main・旧source・DNSは維持し、再認証は他の準備完了後とする。

## 2026-10-19: 旧Edge Functionの保存と停止候補

稼働中35 Functionの配備metadataを読取り、各Functionの専用private directoryへsourceと共有ファイルを保存した（計61ファイル）。同名の共有パスを別配備の内容で上書きしない。取得前後の全inventoryが一致し、各ファイルのhash・権限・配備version/JWT設定を読み戻した。公式Edge Runtime 1.76.2をdigest固定し、全35 Functionの切り戻し用bundleをローカルで生成、出力hashを再確認。実際の再配備や元binaryと同一であることは検証していない。旧形式2件ではprovider bundle hashが返らず、CLIのDocker downloadを使用した。[限定証拠](evidence/source-edge-preparation-2026-10-19.json)。

`source-edge-maintenance.mjs` はprivate backupの改変・versionずれ・symlink・不正pathを拒否し、入力本文/環境変数/外部providerへ触れない503応答を生成する。元のplatform JWT設定を保持する票とし、通常34件を候補、`handle-stripe-webhook` 1件はreceipt引継ぎ待ちに分ける。署名通知の保存を失う503への単純置換は行わない。6試験成功、停止用bundleもnetworkなしで生成成功。本番への配備・Cron停止・DB停止は0。

本番管理画面の再確認ではin-appのタブがクラッシュしており、タブ取得がURL security policyで拒否された。回避操作は行わない。現在のブラウザ経由のDNS/provider確認は未完了で、CLIで可能な準備を続ける。管理者MFAの再認証は依頼していない。

## 2026-10-19: Cron停止/復元SQLとCI修正

`source-cron-pause.mjs` は既存job集合、schedule、command hash、DB/role、接続先、active状態を照合し、もともとactiveだったjobだけを `cron.alter_job` で停止するSQLと逆操作を生成する。private run schemaにmarkerを残し、異なるrun・追加job・設定変更・command変更がある復元は拒否する。元からinactiveだったjobを有効にしない。管理tableへの直接UPDATE権限は要求しない。ACCESS SHARE lockはDDL保護だけで、管理者による再設定は別途停止が必要。開始済みCron/HTTP/Edgeの終了確認を代行しない。

公式Supabase PostgreSQL17.6/pg_cron1.6.4の隔離containerで、SELECTとalter_job実行権限だけのpostgres roleを使って5試験成功。試験環境にだけalter_jobのEXECUTEを付与した。sourceの現在の権限を読むCLI呼出しは `Access token not provided` で失敗し、Node22.6での再確認でも同じだったため、本番で同じSQLが実行可能とはまだ判定しない。sourceに権限変更・停止SQLは適用していない。

9cef0c1のCI39140191739はアプリ成功/Worker失敗。新しい専用DO試験が通常のvitest設定でも拾われ、DO bindingのない環境で起動したことをcheck annotationsで確認した。通常設定のexcludeへ追加し、専用設定での7試験は維持する。run log downloadはGitHub API403だったが、check annotationsの読取は成功した。

CI修正後の通常vitest設定は10 file/109件成功。専用DO設定の7件は引き続き別設定で実行する。新規source preparationと既存preparationの計15件も成功。

## P2: Authのatomic投入と独立読戻し（2026-10-19）

`auth-import-stage.mjs` はAuth全件を一つのD1 transactionで投入する。現予備コピーの45行は上限99行・900 bindings・projection 256KiB以内。上限超過、管理者不在、非empty target、schema差分は開始前に拒否し、大量データを分割して途中状態を作らない。native D1で4 migrationから再構築したテーブル/index/trigger定義と照合する。transaction内でもempty状態とMFA generation 0を検査し、事前確認後の書込も拒否する。通常INSERTのみで、再実行/upsert/セッション移植/鍵再生成はしない。

production-stageは固定Auth D1の調停済み書込transportと、同一identity/incarnationの別read-only transportを要求する。汎用local modeからproductionへ流用できない。途中のFK違反で全行とMFA generationがrollbackすること、commit後の応答消失では再送せず独立readbackできること、native DOがauth intentを保持した状態で一度だけbatchを送ることを確認した。全storeの完了や公開は行わない。

`auth-import-readback.mjs` は投入に使った同一の暗号化済みprojectionを開始前にコピーし、全ユーザー/credential hash/provider subject/MFA ciphertext/backup-code ciphertext/admin roleを100行ずつ別読出しで比較する。余分/不足/改変行、OAuth token/signup状態の混入、旧session/verification/MFA assurance、監査行、generation不一致を拒否。schemaを前後照合し、native FKと既存identity/MFA集計も検査する。報告とエラーに個人の行/ID/資格情報/hashを含めない。source freeze・暗号化鍵保管・ログイン成功の証明は別途必要で、`unfenced-readback` / `productionReady=false` を維持する。

新規10件とnative調停7件を含む関連35件成功。すべて合成データ/ローカルnative engineで、本番Authの実データ投入は未実施。残りはMaster/Business/R2を統合する本番runner・source凍結証拠・全store独立照合・不明ACKの解決、provider/DNS/遠隔復旧。管理者MFAは全準備後。

## P3: S3 backendと分割uploadの凍結試験（2026-10-19）

実sourceと同版Storage API 1.80.2をS3 backendで起動し、隔離した別Storage APIのS3互換入口/file storeを保存先にした。PostgreSQLも別DBを使用し、外部接続なしのDocker network、host port非公開、合成データのみで検証した。通常7種の変更拒否、公開/認証GETの元bytes保持、凍結前に物理データを送信開始した12MiB overwriteの完了拒否、開始済みTUSの完了拒否が成功した。さらにStorageのS3 APIで5MiB+64KiBのpartsを先に保存し、凍結後のCompleteMultipartUploadが拒否され、元object metadata/公開bytesが保たれることを確認した。解除SQLも成功。6件成功、所有container/networkはfinallyで削除済み。

この試験はS3 adapter・versioned object公開境界を検査する。AWSなど本番保存先の動作や、そのbucketへStorageを介さず直接書くclientの停止、孤立した物理part/objectが一切増えないことは証明しない。source本番への接続/書込は0。[限定証拠](evidence/source-storage-s3-freeze-native-2026-10-19.json)。既存file backend試験とともにCIへ追加した。

## P2/P7: 実予備コピーのMaster移送・復元（2026-10-19）

10/16暗号化予備コピーを検証・private領域へ一時復号し、絵文字3,944件（許可済みidentity hash一致）と料金/言語/予約pattern/延長価格29件をnative Master D1へ取り込んだ。generic Business converterの金額はセント整数であり、reference-master用のドル小数文字列とは型が異なる。最初の試験はこの境界で拒否され、検証済みsourceの元小数文字列を保持する写像へ修正した。stagingの設定をコピーせず、canonical行のtimestampも元の値を保持する。

公開release選択後に別read-only呼出しでcanonical全行/公開emoji/references/active pointer/FKを照合。25表11,881行を暗号化し、別の空D1へ復元後、全表hash/schema/FKと同じ独立照合が成功した。総58.4秒、暗号化archive 5,846,192 bytes。使った鍵はmemory-onlyで、遠隔保存・端末外の鍵保管・Cloudflare runtime容量/RTO・全5store同時復旧の証明ではない。MFA capsule未使用。本番接続/書込0、scratch領域は削除済み。[限定証拠](evidence/real-master-backup-rehearsal-2026-10-19.json)。

## P2: Master変換の共通化（2026-10-19）

`scripts/migration/master-snapshot-projection.mjs` に5表のオフライン変換を移した。stream hash/byte数/件数/列/PK/行hash/順序と承認済み絵文字identityを検査し、canonical timestamps、NULL、booleanを保持する。`monthly_price_usd` は元のdecimal文字列を残し、reference writerが一度だけセントへ変換する。通常のBusiness converterのセント値との一致も確認する。32MiBを超える入力や不正データは内容を含めないエラーで拒否する。全snapshot検証や凍結の証拠は別に必要。

単体・native D1の4試験と、移行データ回帰386件が成功。0ドル・1セント・9.99ドル・numeric(10,2)上限の実格納値を照合した。共通処理で実予備コピーを再処理し、絵文字3,944件/参照29件から25表11,881行を暗号化・別の空D1へ復元し全行hashを照合、58.6秒で成功した。[検証記録](evidence/real-master-projection-backup-rehearsal-2026-10-19.json)。旧予備コピー・ローカルMasterだけの証拠で、本番遠隔復旧や全store runnerの完成とはしない。

管理画面の再確認では、Cloudflare/Supabase/Stripeの3タブが引き続きクラッシュし、さらにMacロック中で自動解除不可とツールから報告された。所有者にロック解除・タブ再オープンだけを依頼した。管理者MFAは依頼していない。残実装は全store runner/独立checker/不明ACK解決、実設定に依存する残検証はsource全入口停止・Stripe引継ぎ・DNS/provider・鍵別保管と遠隔復旧である。


## P2: Masterの初回投入・独立照合（2026-10-19）

`master-import-stage.mjs` / `master-import-readback.mjs` / `master-runtime-schema.mjs` を追加した。9 migrationからnative schemaを再構成して前後照合し、固定本番Masterの書込transport・別read-only transport・一致するincarnationを要求する。最初のbatch内でも空DBを確認する。以後は複数transactionで投入するため、全体atomicとは扱わない。途中失敗・応答不明では停止し、自動再送・途中再開・既存行の削除をしない。既存release helperに初回投入専用の `freshOnly` を追加し、通常の更新経路の動作は維持する。

独立checkerはcanonical絵文字の全10列（元の時刻を含む）、公開artifact、4参照表の内容・金額・manifest、初回activationの指定ID/世代/監査、各表の件数、未使用Auth領域の空状態、FKを照合する。初回絵文字監査の内容・件数・ID/日時形式も照合するが、生成日時をsource時刻と同一視しない。projectionとactivation IDは処理開始時にコピーし、読み取り中の呼出し側変更の影響を受けない。これは停止証拠や全store runnerの代替ではない。

native 9試験（内容改変・schema欠落・空DB確認後の競合・2回目batchの応答消失・101行のpaging等）、移行回帰395件、既存emoji/reference release統合13件が成功。実予備コピーを共通stage/checkerで再処理し、絵文字3,944/参照29件→25表11,881行の暗号化・別DB復元・全行hashと独立readback一致を64.0秒で確認した。[実データ検証](evidence/real-master-stage-backup-rehearsal-2026-10-19.json)。10/16の稼働中sourceの予備コピー、local native D1、memory-only鍵であり、本番停止時間・遠隔復旧・鍵別保管の証拠にはしない。

## P3/P4/P6: 管理画面復旧後の読み取り確認（2026-10-19）

所有者のMacロック解除・タブ再オープン後、Cloudflare/Supabase/Stripeにログイン済みであることを確認。保存済みSupabase CLI credentialをプロセス内で読み取り専用APIへ使用し、値を表示/保存せずDB接続を復旧した。75 relation中71のTRIGGER権限、schema作成、Cronの参照/alter権限、writer roleのreplication変更不可を確認。観測時点の実行中Cron/他transactionは0だったが、継続的なdrain確認ではない。Cronは2件中1件active。停止/確認/逆操作のSQL候補6本を同一run IDでprivate保存し、未実行。[source停止準備](evidence/source-stop-preparation-2026-10-19.json)。

DNSの変更前BINDをprivate保存。既存Workerルート0、Page Rules 0、Single Redirect Rules 0、TLS mode Full、apex/wildcardのUniversal SSL active（2026-12-28期限）を確認。BINDにはAPI record IDがなく、DNS APIの操作権限/正確な逆操作の確認は未完了。Supabaseでは4 OAuth providerが有効でclient ID/secretあり、site URLは `https://fanmark.id/`、メール確認が必要。provider管理画面の本番callback登録/新環境の秘密設定は別途必要。

Stripeは現在の同一accountで、本番のイベント送信先画面が未設定表示、testはstaging向け1件activeを確認。旧DBの解約済み契約1件は現accountのlive APIで404、test検索でも見つからなかった。検索をAPI全件照合の代わりにせず、別account/sandboxの利用歴を所有者に確認中。履歴は保持し、課金/延長/削除/再送はしない。[管理画面記録](evidence/dashboard-readback-2026-10-19.json)。

作業開始時の `1cbb5b9` / CI [39145660388](https://github.com/kanouk/fanmark-id/actions/runs/39145660388) は両job成功。Mac/管理画面の障害は解消したが、全store runner・不明ACKの解決、source全入口の停止/外部effect終了、Stripe所属と引継ぎ、provider/DNS実設定・鍵別保管/遠隔復旧は残る。管理者MFAは全準備後。本番実データimport/source停止/DNS変更/main mergeは未実施。

## P4: 旧解約済み契約の由来と保持（2026-10-19）

旧DBの顧客IDと完全に一致する顧客が、既存の「ファンマID サンドボックス」に存在した。同じ金額・表示上の期間開始日時のテスト決済も確認した。契約ID自体は見つからず、削除理由やStripe上の契約状態を推測で埋めない。所有者は「それは自分でテストしたときのデータだと思います」と説明し、記録を残したまま準備を続けるよう指示した。説明は別の由来記録として残し、元の解約履歴を削除・移行除外・有効化・再課金しない。メールや顧客識別子を含む照合原本はGit外に保持。[個人情報を含まない判定記録](evidence/stripe-legacy-history-disposition-2026-10-19.json)。管理者MFAは全準備後のまま。

直前HEAD `a634104` のCI [39174607042](https://github.com/kanouk/fanmark-id/actions/runs/39174607042) はApplication/Workerの両job成功。

## P2/P7: 初回の分割R2投入と独立照合（2026-10-19）

`split-r2-import-stage.mjs` を追加。2 bucketの全inventoryが空であることを確認し、初回専用の`freshOnly`で既存report・既存画像・条件付き作成競合を拒否する。途中失敗や応答不明は残したまま停止し、自動再送・再開・削除はしない。通常importの再開動作は既定のまま維持する。

独立checkerは投入reportを読まず、source manifestを再検証し、分割bucketの全key/size/etag/versionの前後一致、画像全byteのSHA-256、MIME、元bucket/key/hash/size metadataを照合する。余分な画像、別bucket、ページングの循環や不足、読戻し中の変更を拒否する。別実行のcheckerにput/delete能力は不要。これはfenceのない観測であり、実本番binding identity/調停接続/source停止を証明しない。

native local R2の15試験（ページ分割、同じkeyを両bucketで使用、空byte、同サイズ改変、metadata、余分な画像、保存先入替え、応答消失、競合、再実行拒否等）と移行データ回帰410件が成功。全store runner・本番R2専用transport/永続調停、不明ACKの独立解決、Stripe受信引継ぎ、source停止、OAuth/DNS、鍵別保管/実資源での一式復旧は引き続き未完了。

実予備コピー109画像（avatars69/covers40、13,285,729 bytes）を新stageで分割R2へ投入し、各bucketをAES-GCM暗号化→別の空bucketへ復元→全内容hashと独立checkerで照合した。91.7秒で成功。[限定証拠](evidence/real-split-r2-stage-backup-rehearsal-2026-10-19.json)。固定MiniflareがstorageClassを空欄で返す既知の制限により最初はbackup検証で拒否された。既存native復旧試験と同じlocal専用fixture補正（空欄だけStandardへ）で再試験し、production recoveryの検証規則は緩めていない。remote保存クラスの証明ではなく、10/16予備コピー・local R2・memory-only鍵の証拠。実CloudflareのRTOや鍵別保管、全5store同時復旧は未証明。


## 2026-10-19: 業務DBの初回投入専用経路

`48fd081`のCI39176801478はApplication/Workerとも成功。旧解約済み契約は所有者の「自分のテストと思う」という回答を保持し、履歴を含む全40表を引き続き移行対象とした。

`importInitialBusinessSnapshot`を追加。27 migrationの78表・初期seed・アプリ連番を読み取りで照合し、既存取り込み台帳/reportを拒否する。最初の台帳作成transactionにも初期行条件を入れ、途中投入へ自動復帰しない。通常のlocal/isolated-remote importerの再開契約は変更しない。production-stageでは固定Business writer・独立read-only transport・同一identity/incarnation・全store coordinator付きjournalを要求する。

旧共通処理のrace再読込を初回stageに持ち込まないため、DB例外/不完全ACK後は当該adapterの全操作を止める。DBへのエラー記録も行わず、保存済み行・台帳・journalを保持する。別checkerはreportに依存せずsource全行/credential変換/台帳/連番/FKを確認する。複数transactionであり、source停止・全store atomicity・応答不明の解決/再開をこの部品の成功とはしない。

本番Businessの読み取りでschema・78表の初期状態・連番一致、import台帳未作成を確認した。実資源への書き込みは0。これは読取時点の確認で、実行時の排他証明ではない。[読取記録](evidence/production-business-initial-state-readback-2026-10-19.json)。

保存済み10/16予備コピー40表5,770行を新しい初回stageでlocal native D1へ投入し、83表の暗号化→別DB復元→独立照合/全hash一致が121.5秒で成功した。archive3,517,141 bytes、取り込み台帳保持、FK違反0。並行試験中のlocal測定であり、本番RTOに換算しない。MFA capsuleは使わず、旧暗号化Auth資料はユーザーID照合だけに使用した。[実データ試験](evidence/real-initial-business-stage-backup-rehearsal-2026-10-19.json)。

前回の分割R2試験の追加結果も保存した。復元済み109画像について実アプリStorage handlerのGET/HEAD計218応答を確認し、body SHA-256・MIME・length・nosniff・HEAD空bodyが一致した。local native bindingでのhandler試験であり、配備済みWorkerやブラウザ表示の受け入れではない。[配信試験](evidence/real-split-r2-app-delivery-rehearsal-2026-10-19.json)。

残る実装/受け入れは、本番R2 transportと全store調停の接続、5 store runner/応答不明の独立解決、source全入口停止・drain・Stripe受信引継ぎ、OAuth/secret/operator設定、DNSの実資源に対応する逆操作、別保管鍵と実資源での一式復旧。管理者MFAはこれらの準備後に行う。本番import/source停止/DNS切替/main mergeは未実施。

検証: 新規native17件を含む移行データ回帰427件成功（145.8秒）。従来のBusiness/Auth停止・再開・別DB復旧試験1件も成功（64.0秒）。新規試験では台帳作成/run/checkpoint/資格情報予約/資格情報commit/完了更新の6箇所でcommit後の応答消失を起こし、その後のnative DB呼出し0、既存状態の保持・再実行拒否を確認した。本番transportの合成HTTP試験では全writeのdurable journal/調停ACKを照合した。
