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

Cloudflare account内4 Workerの全settingsを読み取り、既存rate-limit namespace3個と本番候補 `41092711/12/13` の重複がないことを確認。配備時には再確認する。[namespace照合](evidence/production-ratelimit-readback-2026-10-18.json)。本番の実binding読戻し・秘密の保管/設定・provider接続・backup admission・実restore・通知先/配送・公開前operator確認は別途残る。

## P4: 旧環境の実Stripe account確認

旧Supabaseに保存されているSTRIPE_SECRET_KEYからGETのみを行い、live keyが `acct_1SFjhvJk0VCfiKUp` に属することを確認。全ページを読み取り、購読0、Invoice0、Checkout3（期限切れ2・支払済み完了1）、v1 Webhook endpoint0、直近30日event0を確認した。既存35 Functionのinventoryは確認前後で一致し、確認用の一時Functionは削除済み。課金・送信・Webhook変更は行っていない。[集計証拠](evidence/source-stripe-readback-2026-10-18.json)。

追加照合では、旧DBの購読1件はcanceled、設定上のtest料金IDと一致し、live側の同じ購読IDは404だった。test側のprovider object自体は未検証。過去のlive支払1件はlicense_extensionで、指定licenseの所有者とfanmarkは一致するが、現在はexpired。30日以上前の支払いで、対応するLICENSE_EXTENDED監査やsession ID記録は見つからなかった。適用済みとも未適用とも断定せず、移行処理から延長の再適用・返金をしない。[追加照合](evidence/source-stripe-correlation-2026-10-18.json)。

この結果は営業中の一時点の参照であり、停止境界の証拠ではない。履歴の例外扱いと切替直前の再照合は残る。API v1 endpoint一覧だけで他のevent destinationの不在を断定しない。

## 残条件

P1の本番配備・秘密・公開/backup/monitorの実接続と受け入れ、P2の全store runnerと独立checker・再開、P3の全入口停止と実source同等環境試験、P4のStripe実台帳・旧受信引継ぎ、P6のprovider/DNS設定と復元票、P7/P8の本番資源復旧・全体実測は残る。本番D1への実データ取り込み、旧サービス停止、DNS切替、main mergeは未実施。
