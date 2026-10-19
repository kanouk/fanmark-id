# 初回移送の全保存先をまとめた独立照合

`initial-import-set-readback.mjs`は、Auth・Master・Businessの3 D1とavatars/coversの2 R2を読み取り専用で検査する。個別stageの成功だけで全体完了とせず、同じ入力と保存先を使ったことを確認する。隔離localでは同じ入力で全stageを実行・照合できる。本番runner、source停止のcollector、部分stageの修復はまだ別工程。

## 入力を固定する

`prepareInitialImportSet`に、Business manifestの絶対path、Storage exportの絶対path、確定済みAuth投影、承認済みemoji identity hash、移送run UUID、全5 incarnation UUID、2つのMaster activation UUID、Business保存先IDとruntime profileを渡す。

Businessの全streamを既存snapshot verifierで検証する。Masterはそのsnapshotの5表から直接投影し、別時点のMaster投影を混ぜない。Authは元の暗号化済み投影をコピーして保持し、比較時に秘密や回復codeを作り直さない。Businessの全user_settings ID・表示名・admin planとuser_rolesのadminをAuthへ照合する。画像manifestと各期待値、run/保存先/incarnation/activation/profileのhashを一つのdescriptorへまとめる。

返す`prepared`は同じprocess内の参照であり、JSONへ変換して復元しない。別processでは元のprivate入力から再構築し、同じ`identitySha256`になることを確認する。このhashをproduction調停の`manifestSha256`へ使う。descriptorの一致はsource凍結や最終取得時刻の証明ではない。

## 全storeを照合する

`verifyInitialImportSet({ prepared, databases, buckets, mode, coordinator, journalPaths })`へ、Auth/Master/Businessとavatars/coversを渡す。

- `local`はnative localリハーサル用。本番D1/R2 transportや調停clientを混ぜない。
- `production-stage`は固定本番資源のread-only transportだけを許す。同じrun・manifest hash・incarnationの調停clientと、全5 journalの完了ACKを要求する。
- Auth・Master・Business・画像の既存独立checkerを順に使う。業務データの参照先は渡されたAuth D1へ実際にSELECTし、呼出元の任意resolverを使わない。
- 前後でsourceファイルと全journalの状態を照合し、最後にAuth/Masterも再検査する。古い完了reportを信用して省略しない。

成功reportは`allExpectedStoreContentsMatched=true`を返す。これは固定した入力への一致であり、`sourceFreezeVerified`・`fullMigrationReconciled`・`productionReady`はfalseのまま。調停completeや停止解除を呼ばず、移送の再開許可も発行しない。SQL・資格情報・sourceの個人情報をreportへ含めず、不正JSONやproviderの例外本文も公開しない。

## 検証

40表の合成Business exportからMasterを生成し、native3 D1/2 R2へ個別stageで移送して一括照合する。別DBの混入、Auth内容/同じIDの表示名の不一致、管理権限の相違、画像改変、source改変を拒否する。本番用adapterも同じnativeデータで通し、管理APIの配備版driftと遠隔ACK欠落を拒否する。この管理API/調停は合成応答であり、本番資源への移送・全体復旧・本番ログインの証拠にはしない。

## 隔離環境で一続きに実行・再開する

`rehearseInitialImportSet`へ同じ`prepared`、localの3 D1 writer/readerと2 R2 writer/reader、Business/Storage reportの絶対pathを渡す。Auth→Master→Business→画像の順に既存stageを呼び、最後に全store checkerを通す。BusinessのAuth参照も実際のAuth readerで検査する。各段階の前後で元のsnapshotと画像manifestが変わっていないことを確認する。

`stopAfter`は`auth`・`master`・`business`・`storage`から選ぶ。通常は`storage`まで実行する。再開時は同じprivate入力から`prepared`を再構築し、`resumeAfter`に完了済みの最後のstageを明示する。指定だけでは省略せず、先頭からそのstageまで全内容を読み直して一致した場合にだけ次へ進む。途中まで入ったstageの不足行や画像を補う機能ではない。

一つの`prepared`での実行は一度だけ。失敗時は後続stageへ進まず、自動再試行・削除もしない。Auth完了後の停止、改変を検出してMasterへの投入前に拒否、Master応答不明でBusiness/画像への投入前に停止、同じ入力からの再開、全完了後の書き込みなし再照合をnative環境で検証する。

この入口はlocal限定。本番/隔離remoteのD1や本番R2を渡した時点で拒否し、`mode=production-stage`の指定も受け付けない。`allowUnresolvedGates`はlocalの既存schema検証用に限って使う。本番のsource停止証拠・process間のrunner所有権・全journalの実照合は未接続であり、返す`remoteExecutionSupported`・`sourceFreezeVerified`・`productionReady`はfalseを維持する。
