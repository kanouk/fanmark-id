# 初回移送の一括実行と独立照合

`initial-import-set-readback.mjs`は、Auth・Master・Businessの3 D1とavatars/coversの2 R2を読み取り専用で検査する。個別stageの成功だけで全体完了とせず、同じ入力と保存先を使ったことを確認する。localリハーサルと、全journal/調停executorを使う明示的な本番実行入口を持つ。source停止の確認・実データの最終取得・部分stage修復・公開は別工程。

## 入力を固定する

`prepareInitialImportSet`に、Business manifestの絶対path、Storage exportの絶対path、確定済みAuth投影、承認済みemoji identity hash、移送run UUID、全5 incarnation UUID、2つのMaster activation UUID、Business保存先IDとruntime profileを渡す。本番実行では、確認した停止/取得証拠fileのSHA-256を`sourceEvidenceSha256`へ渡してdescriptorに含める。localだけならnullが既定。

本番は受付停止後の `stripeReceiptExport` も必須とし、空の場合も明示的な取得結果を渡す。
元のID/時刻/受信回数を保持してBusinessへ移し、全内容hashをdescriptorへ固定する。
[暗号化取得・移送・照合](stripe-receipt-transfer.md)を参照。

Businessの全streamを既存snapshot verifierで検証する。Masterはそのsnapshotの5表から直接投影し、別時点のMaster投影を混ぜない。Authは元の暗号化済み投影をコピーして保持し、比較時に秘密や回復codeを作り直さない。Businessの全user_settings ID・表示名・admin planとuser_rolesのadminをAuthへ照合する。画像manifestと各期待値、run/保存先/incarnation/activation/profileのhashを一つのdescriptorへまとめる。

返す`prepared`は同じprocess内の参照であり、JSONへ変換して復元しない。別processでは元のprivate入力から再構築し、同じ`identitySha256`になることを確認する。このhashをproduction調停の`manifestSha256`へ使う。descriptorの一致はsource凍結や最終取得時刻の証明ではない。

## 全storeを照合する

`verifyInitialImportSet({ prepared, databases, buckets, mode, coordinator, journalPaths })`へ、Auth/Master/Businessとavatars/coversを渡す。

- `local`はnative localリハーサル用。本番D1/R2 transportや調停clientを混ぜない。
- `production-stage`は固定本番資源のread-only transportだけを許す。同じrun・manifest hash・incarnationの調停clientと、全5 journalの完了ACKを要求する。
- Auth・Master・Business・Stripe受信・画像の既存独立checkerを順に使う。業務データの参照先は渡されたAuth D1へ実際にSELECTし、呼出元の任意resolverを使わない。
- 前後でsourceファイルと全journalの状態を照合し、最後にAuth/Masterも再検査する。古い完了reportを信用して省略しない。

成功reportは`allExpectedStoreContentsMatched=true`を返す。これは固定した入力への一致であり、`sourceFreezeVerified`・`fullMigrationReconciled`・`productionReady`はfalseのまま。調停completeや停止解除を呼ばず、移送の再開許可も発行しない。SQL・資格情報・sourceの個人情報をreportへ含めず、不正JSONやproviderの例外本文も公開しない。

## 検証

40表の合成Business exportからMasterを生成し、native3 D1/2 R2へ個別stageで移送して一括照合する。別DBの混入、Auth内容/同じIDの表示名の不一致、管理権限の相違、画像改変、source改変を拒否する。本番用adapterも同じnativeデータで通し、管理APIの配備版driftと遠隔ACK欠落を拒否する。この管理API/調停は合成応答であり、本番資源への移送・全体復旧・本番ログインの証拠にはしない。

## 隔離環境で一続きに実行・再開する

`rehearseInitialImportSet`へ同じ`prepared`、localの3 D1 writer/readerと2 R2 writer/reader、Business/Storage reportの絶対pathを渡す。Auth→Master→Business→receipts→画像の順に既存stageを呼び、最後に全store checkerを通す。BusinessのAuth参照も実際のAuth readerで検査する。各段階の前後で元のsnapshotと画像manifestが変わっていないことを確認する。

`stopAfter`は`auth`・`master`・`business`・`receipts`・`storage`から選ぶ。receiptsは旧受信exportを渡した場合に追加され、本番では必須。通常は`storage`まで実行する。再開時は同じprivate入力から`prepared`を再構築し、`resumeAfter`に完了済みの最後のstageを明示する。指定だけでは省略せず、先頭からそのstageまで全内容を読み直して一致した場合にだけ次へ進む。途中まで入ったstageの不足行や画像を補う機能ではない。

一つの`prepared`での実行は一度だけ。失敗時は後続stageへ進まず、自動再試行・削除もしない。Auth完了後の停止、改変を検出してMasterへの投入前に拒否、Master応答不明でBusiness/画像への投入前に停止、同じ入力からの再開、全完了後の書き込みなし再照合をnative環境で検証する。

この入口はlocal限定。本番/隔離remoteのD1や本番R2を渡した時点で拒否し、`mode=production-stage`の指定も受け付けない。このlocal入口の`remoteExecutionSupported`・`sourceFreezeVerified`・`productionReady`はfalseを維持する。


## 本番用の明示的な実行入口

`executeInitialImportSet`は、固定本番3 D1/2 R2のwriterと別read-only接続、同じ調停client、全5 journalの絶対path、`sourceEvidencePath`、2つのreport pathを受け取る。各writerが同じrun/clientとそのjournalを実際に使っていることを確認し、別run・別journal・read-only writer・保存先の取り違えを開始前に拒否する。5 journalは同じprivate directoryに置く。接続先・配備版・全履歴も照合する。

この入口自身は旧環境を停止しない。実施者はsource全入口の停止・実行中処理の終了・Stripe受信引継ぎ・停止後に取得した最終データの確認を先に完了し、その記録fileを指定する。fileは0600・symlinkなし・1 hardlink・最大4MiBとし、固定hashを各stage前後で照合する。hash一致は記録内容の真実性や停止継続を証明しない。内容を検証するcollectorと当日の実確認は残っており、返す`sourceFreezeVerified`はfalseのまま。

実行前に元のrun/descriptorで`coordinator.claim()`し、5つのjournal付きtransportを開く。runnerは`acquireExecution()`を一度だけ呼び、DO上の実行者IDを保持する。同じrunを名乗る別clientのbegin/ACK/completeを拒否し、実行権にTTLや自動奪取は設けない。R2のdispatchは、その実行者が先に受理させたoperationと一致する場合だけ一度行う。

実行順と`stopAfter`/`resumeAfter`はlocalと共通。Businessの外部Auth参照は実Auth readerですべて解決するため、既存importerの`allowUnresolvedGates=true`を使う。これは未知のFKやraw credentialを許可する指定ではなく、正規runtime schema・credential profile・全参照先IDの検証は維持する。

正常な区切りでは、全journalが未確定操作なしと確認できた場合だけ、照合結果を`initial-set-<executorId>.json`へ排他的作成し、fileと親directoryをfsyncする。`stopAfter`が画像より前ならcheckpoint hashとともに実行権だけを返し、全体の更新停止と履歴は保持する。再開では同じ入力からpreparedを再構築し、claim後に元のwriterを使うか同じjournalで開き直す。完了済みprefixの全内容を再検査してから次へ進む。

画像まで終わった場合は全storeの独立checkerを通し、保存済みreadback hashを`complete`へ渡す。`coordinatorCompleted=true`はこの固定入力の投入/照合記録を閉じたことだけを表す。一般更新の停止、source停止、DNS、Cronは解除せず、`productionReady=false`を維持する。

途中失敗では実行権とoperation lockを残す。`acquire`や最終`complete`の応答が不明でも再送しない。失われた最終応答は、保存したreportとDOのreadback hashを別途照合できる。部分stage・未知commit・停止したexecutorの引継ぎはこの入口で自動処理しない。[復旧境界](production-import-recovery.md)。

## 本番入口の隔離試験

合成40表・Auth・画像を、本番用transportからnative3 D1/2 R2・実R2 service・実調停DOへ投入する。管理APIとgateway URLの配送だけを合成し、外向き通信を拒否する。Auth後の正常停止と再開、全件照合とcomplete、source証拠改変/接続取り違え、保存後のMaster/Stripe受信応答消失で後続未実行、最終complete応答消失時の永続report保持を検証する。本番資源への実投入・source停止・公開の実証ではない。

初回Authのatomic commit応答消失には、別入口 `recoverInitialAuthImportExecution` を使う。終了済みexecutor・元batch hash・全件読戻しがそろった場合だけACKを確定し、書込み再送はしない。その他の部分stageは対象外。条件と残存lockの扱いは[復旧手順](production-import-recovery.md)を参照。
