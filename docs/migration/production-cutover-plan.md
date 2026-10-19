# #38 本番データ・ドメイン移行の実行計画

再開後の最新状態は[2026-10-19準備更新](PREPARATION-2026-10-19.md)を優先する。
G4はmaintenance/TLS/Stripe保存を確認し、実画面/Auth/Resend配信は一般503を保持する
[G5本人確認モード](production-owner-acceptance.md)へ接続する。モード有効化前に前進復旧境界を固定する。

2026-10-19再開後: 旧Aを保持する[Worker Routeの代替票](production-route-alternative.md)を実地検証に基づいて準備した。従来のCustom Domain案を当日に黙って置き換えず、G0で方式と逆操作を固定する。新Webhook driverは両方式を明示的に区別する。

> 2026-10-20更新：現在の指示は「本番移行直前まで準備」。専用資源・schema・閉鎖配備と予備コピーは作成済み。一括runner、source停止候補、Stripe保存専用候補と受信stream移送を追加した。旧環境の停止・本番ユーザーデータ投入・DNS切替は未実施。管理者MFAは10月20日に再登録・保存検証済み（10月21日00:24:45 JSTまで、最終source再照合が必要）。[最新handoff](HANDOFF.md)と[最新準備記録](PREPARATION-2026-10-19.md)を現在の実施状況として優先する。

更新日: 2026-10-20 JST。状態: **事前準備・管理者MFAの保存検証済み。当日のG0〜G5は未実施。旧環境が引き続き正。**

[開始前確認票](CUTOVER-ENTRY-2026-10-20.md)はP1〜P8の準備証拠と当日再確認、残る所有者の判断を対応付ける。

対象は[issue #38](https://github.com/kanouk/fanmark-id/issues/38)。[PR #41](https://github.com/kanouk/fanmark-id/pull/41) / `codex/cloudflare-api-preparation`を継続する。本番確認までGitの`main`を維持し、確認後に旧デプロイ経路を整理してマージする。

サービス所有者と実施担当向けの文書。最初に1〜3節で開始条件と停止時間を確認し、当日は4〜7節を参照する。不明点や例外は#38の実施記録へ集約し、所有者が継続・延期を判断する。実施済みの準備・非公開配備・予備コピーは上記記録に残す。準備期間に旧環境の停止や本番ユーザーデータ投入・DNS切替を行わない。

準備の実施状況・設定一覧・操作票・所有者の判断事項は[本番移行の準備記録](production-preparation.md)を参照する。ローカル準備の成功と、本番実施条件の充足は区別する。

## 1. 準備済みの検証結果と、本番前に完成させる作業

Cloudflare側の定義済み機能範囲は[2026-10-14の受け入れ記録](evidence/target-pre-cutover-acceptance-2026-10-14.json)で確認済み。計画作成時には先頭`ab0b8c7`、PR draft、CI38419354073のアプリ・Worker両job成功を確認した。最新commitのCIはhandoffを参照する。本番移送・本番運用の受け入れは含まない。

以下はP1〜P8の要求であり、すべてを未実装という意味ではない。準備では実装・隔離試験・実環境の読み取り確認・当日の実行票をそろえる。本番停止後の実行中処理0、最終snapshot一致などは当日の停止条件として確認する。これらの証拠を先取りするために準備中の本番を停止しない。

移送プログラム（runner）がデータを取り込み、読み取り専用の照合プログラム（checker）が結果を検査する。Webhookの受信・保存処理（receiver）と、受信内容を業務データへ適用する処理（dispatcher）は分けて停止・再開する。以下のsourceは移行元、targetは移行先、writerは更新を行う処理を指す。

| ID | 停止前に完成させる作業 | 完了を示す証拠 |
| --- | --- | --- |
| P1 | 本番専用Worker、Business/Auth/Masterの3 D1、画像2 R2、バックアップR2、通知・writer管理DO、監視を設計・準備する。既存staging V4を上書きしない案とする | account/zone/resource ID、schema、binding、秘密の保管先、必要容量を固定した資源表。本番origin用のビルド・配備と閉鎖状態の検証 |
| P2 | 本番専用の移送runnerと読戻し専用checkerを実装・検証する | 同じ確定snapshotからAuth→Master→Business→画像を移送し、途中停止・ACK不明・競合・再開を検証。schemaの未解決項目と実データ例外の処置が全件確定 |
| P3 | Supabaseの全更新経路を列挙し、停止・処理完了確認・再開手順を実装する | 旧SPA/PWA、直接REST/RPC、Storage、Auth登録/更新、Edge、Cron、外部caller、管理操作の停止試験。書込中の処理が0または全件照合済み |
| P4 | 旧Stripe Webhookを「受信・永続保存だけ継続、業務更新は停止」へ移せるようにする | 実配備版の確認、署名付き受信の永続化、旧適用処理の停止、未処理・処理済みイベントの引継ぎと逆方向の回収試験 |
| P5 | Supabase Authの実アカウント対応とMFAの方針を確定する | UUID/provider subject/権限の対応表。パスワード互換、重複identity、停止中アカウント、MFA移送または安全な再登録、管理者の復旧経路の検証 |
| P6 | DNS・証明書・OAuth・メール・Webhook・旧URLの変更表を確定する | 2節の未確定欄を実値で埋め、変更前後と復元操作を保存。本番hostでの確認方法、衝突するroute/redirect、証明書の準備状態を確認 |
| P7 | 本番資源を使うバックアップ・復旧・監視を検証する | Git外の暗号化保存から別の専用資源へ復旧し、全storeと操作台帳を照合。所有者が確認した本番RPOと復旧可能な最終操作点、新資源IDでのguard、鍵の別保管、失敗通知を確認 |
| P8 | 実データの予備コピーによる移送リハーサルと当日コマンドを確定する | 別途許可された予備export/importの所要時間、独立照合、例外一覧、後片付け。本番用の実行票をレビューし、最新成功CIのcommitを固定 |

P2は[本番一括runner/checker](initial-import-set.md)へ接続済み。固定3 D1/2 R2、同じ調停executor/操作journal、Business後の[Stripe受信stream](stripe-receipt-transfer.md)を扱う。汎用`importD1Snapshot()` / `importEncryptedD1Snapshot()`は引き続きlocal/isolated-remote限定で、本番制限を迂回しない。実停止・取得証拠、未確定操作の復旧、当日の秘密供給と実行票は別途確認する。

P4は特に重要。[実配備Edgeの記録](source-edge-bodies-review.md)では、旧Webhookは直接業務を書き換える版だった。リポジトリにある受信台帳のコードが本番配備済みとは限らない。受信を残したまま旧業務更新を止めることを証明できなければ、移行を開始しない。

P4の引継ぎ票には、旧receiverの最終commit境界、進行中受信0、新旧台帳のevent ID集合と処理済み/未処理状態、Checkout Sessionごとの適用済み効果、重複・競合の統合規則を含める。旧側へ戻す際も同じ項目を逆方向に照合する。

### 実行票を一式そろえてから開始する

Git外の専用ディレクトリに、run ID、source project、target account/各resource IDと作成世代、schema/commit、実施者・照合者、UTC/JST時刻、変更前後の設定、実行コマンド/API引数、結果ファイルのhash、復元コマンドを保存する。各票は`準備済み→実行中→照合済み`か`不明/失敗`で管理する。

必要な票は`source-freeze`、`source-export`、`target-import`、`reconcile`、`receipt-handoff`、`domain-switch`、`open-writer`、`pre-write-revert`、`forward-recovery`。名称は計画上の分類で、既存CLI名ではない。現在のrunner/停止/受信引継ぎ/復旧/Route/本人確認の操作票は[開始前確認票](CUTOVER-ENTRY-2026-10-20.md)へ集約済み。各run・実行時刻・最終snapshot・最新原本はG0以降で固定し、空欄が残れば実行しない。担当は実施担当、開始・例外・公開の判断は所有者とする。照合は別プロセス・読み取り専用資格情報で行い、実施ログの成功表示だけを根拠にしない。本計画に対する新たな独立Astraレビューは未実施。

## 2. URLを維持し、Webの配信先だけを切り替える

推奨案は`https://fanmark.id`を引き続き正規URLとし、Workerを配信元にする。レジストラ、ネームサーバー委任、メールのMX/SPF/DKIM/DMARCを同時に移さない。公開URL、絵文字URL、短縮ID、保護ページのpathを維持する。

2026-10-15の公開DNS照会ではNSは`alice.ns.cloudflare.com` / `gabriel.ns.cloudflare.com`。apex、www、admin、authのA回答はCloudflareのIP・TTL300秒、MXはCloudflare Email Routingだった。これは公開リゾルバの回答で、Cloudflare管理画面の接続先IP・record ID・所有account・証明書状態を証明しない。authのCNAME回答が空でも未設定とは判定しない。2026-09-21の記録ではauthはSupabase custom domainだったため再確認する。

| 対象 | 変更案 | 切り替え前に固定する情報・確認 |
| --- | --- | --- |
| `fanmark.id` | 元Aを保持するWorker Routeで本番Workerへ接続する候補。G0で所有者が方式を固定 | zone/account、現A/AAAA/CNAMEとproxy、既存routes/redirects/WAF、Worker ID、証明書、管理APIの変更差分・復元手順 |
| `www.fanmark.id` | `https://fanmark.id`へpath/queryを保って誘導 | 現行URL契約を確認。切替試験中は一時redirect、受け入れ後に恒久化を判断。APIのPOSTを無条件redirectしない |
| `admin.fanmark.id` | 専用aliasからapexの`/admin`へ一時誘導する候補 | queryなしルートだけを固定変換し、旧認証URL/API/秘密queryを転送しない。G0で方式を固定し実hostのTLSはG4/G5で確認 |
| `auth.fanmark.id` | 当日は旧認証URLの互換・案内用に保持する案 | 新Better Authは同一originの`fanmark.id/api/auth`を推奨。旧token/codeを新APIへ転送しない。旧メールリンクは新しい再発行へ案内。旧側での更新は閉鎖 |
| 画像 | アプリのAPIで旧Storage参照をR2配信URLへ対応させる | 実source origin、bucket/key/MIME/hash、外部に貼られた旧Storage URLの維持策。アプリ内変換だけで外部URLは直らない |
| OAuth 4 provider | 本番Better Authのcallbackへ対応させる | 同じ既存client/subjectを維持できるか確認。provider別の正確なcallback、許可origin、旧callbackの保持・復元を記録。追加登録できないproviderは切替時に変更 |
| メール | 既存送信元と配送設定を維持し、確認・resetリンクを新本番へ向ける | Resend送信元、Apple relayの許可、実受信、リンク期限、未完了の旧リンク再発行方法。自動で一斉再送しない |
| Stripe/Resend通知 | 本番専用の固定受信先へ切り替える | endpoint ID、署名鍵の保管先、mode/API version/event一覧。新Stripe pathは`/api/stripe/webhook`。DNS切替前にも到達できる受信hostをP4/P6で確定 |

以下のCustom Domainは代替案の参照。現在の推奨は[元Aを保持するRoute票](production-route-alternative.md)で、G0の方式承認までは接続しない。Custom DomainはWorkerを配信元とする構成に合い、DNSと証明書の作成を伴う。apexとwwwは別hostとして扱う。既存DNSとの衝突を解消する操作も本番変更なので、データ照合前にapexへ登録しない。[Cloudflare Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)。

P6では、別の検証hostで同じ構成を試し、apexのTLSを途切れさせず変更できることを確認する。既存証明書の継続・新証明書の準備方法が未確定なら延期する。既存proxied DNSを使うWorker Routeは代替案だが、優先順位・originへのフォールバック・復旧操作を検証して計画を改訂した場合だけ採用する。当日に方式を変更しない。[Cloudflare Routes](https://developers.cloudflare.com/workers/configuration/routing/routes/)。

proxied recordのTTLは通常Auto=300秒で編集できず、端末のcacheにより反映が長引くこともある。「TTLを60秒へ下げれば5分以内に終わる」と見積もらない。DNS onlyの変更が必要な場合だけ、事前にTTLを短縮し、変更前TTL以上を待つ。委任変更は別計画とする。[Cloudflare TTL](https://developers.cloudflare.com/dns/manage-dns-records/reference/ttl/)。

本番configは新規に作り、`BETTER_AUTH_URL`、CORS、画像origin、frontend API先、OAuth、Stripe mode/Price/鍵、通知、cron、backup対象、noindex/robots/sitemapを全項目照合する。stagingには合成origin・`test_only`・staging資源IDがあるためコピーして公開しない。現コードの`STRIPE_MODE_POLICY`は`test_only`または未設定時のdualであり、`live_only`や文字列`dual`は有効値ではない。実契約のmodeを調べ、必要な鍵と本人対応を確認して設定する。stagingの実課金化は行わない。

## 3. 停止枠は暫定2時間、当日は90分で継続可否を判断する

これは人員・告知枠を検討するための予算で、実測による保証ではない。停止は「利用者の最初の操作制限」から「通常操作の再開」までとし、再ログインや個別サポートに要する時間は別に追跡する。公開閲覧も一時的にメンテナンス表示となる前提で案内する。作業日は未定。

| 停止開始から | 作業枠 | 予定時間 |
| --- | --- | --- |
| 0〜10分 | 旧更新の停止、処理完了、受信継続を確認 | 10分 |
| 10〜30分 | DB/Auth/Storageの確定export、暗号化、manifest検証 | 20分 |
| 30〜60分 | 本番専用の空targetへ移送、再開点の記録 | 30分 |
| 60〜80分 | 独立照合、Stripe境界・画像・権利の確認 | 20分 |
| 80〜90分 | 新受信の引継ぎ、最終差分確認、公開可否の判断 | 10分 |
| 90〜105分 | ドメイン・provider設定変更、閉鎖中の到達/TLS確認 | 15分 |
| 105〜120分 | 制限した確認操作、新処理の単独開始、一般公開 | 15分 |

90分時点で照合未完了、TLS/受信経路未準備、復旧票不足なら新業務書き込みを始めず切り戻す。105分までにドメイン変更後の到達確認を通せない場合も同様。切り戻し所要時間は暫定15〜30分を確保し、P8で検証する。停止枠を超えそうなら期限前に所有者が延期・延長を判断し、利用者へ告知する案とする。今回は告知しない。

90分時点で中止した場合は停止開始から105〜120分、105分時点で中止した場合は120〜135分での旧側再開を暫定目標とする。いずれも受信差分や不明更新を解消できる場合の見積もり。G5で新業務更新が始まった後の障害は切り戻せず、6節Bの復旧となるため、2時間枠を超える可能性がある。

所有者と実施担当の拘束枠は3時間を提案する。2時間で再開できない可能性があるため、2時間を契約上の上限として案内しない。予備リハーサルが各枠を超えたら、停止日を決める前に全体を組み直す。目安は`各工程の実測×1.5＋DNS/TLS・人手確認枠＋切り戻し枠`。09:00の日次処理・09:05のbackup、請求・抽選・ライセンス期限に重なる時間帯を避け、停止中に期限を迎える対象も確認する。

既存の[代表容量の合成復旧](evidence/representative-recovery-capacity-native-accepted-2026-10-13.json)では収集76.467秒、復旧とアプリ確認67.423秒、資源作成・片付け込み278.874秒だった。全本番Businessデータの分布、Supabase→D1変換、実認証、DNSを含まないため、これを本番の停止時間へ換算しない。

## 4. データを止め、確定コピーを照合してから公開する

下表のG0〜G5は、次へ進むための判断点。未確認・失敗・ACK不明を成功へ読み替えない。

| 工程 | 実施内容 | 次へ進む条件・保存する証拠 |
| --- | --- | --- |
| G0 停止前 | P1〜P8を完了。所有者が日程・停止枠・対象・復旧案を確認。実施commit、各操作票、旧配備版、鍵・復旧先を固定。二人目相当の照合は別processで行う | 全票の未確定欄0、成功CI、予備移送と復旧の実測、初期監視正常。本番実行について所有者の明示的な指示を得る |
| G1 停止境界 | 旧画面を閉じ、旧API/RPC/Storage/Auth更新と管理操作、Cron/外部writerを停止。旧Webhookは永続受信のみ残す。進行中のSQL・Edge・queue・外部処理をdrainする | 各経路の拒否試験と、停止前に開始した処理の完了記録。実時刻・処理済みevent/Checkout Session・受信台帳の境界を保存。終了不明があれば停止を維持 |
| G2 確定コピー | 同じ停止境界でpublic DB、Auth、Storageをそれぞれ収集。旧受信台帳は増え続ける別streamとして管理。暗号化原本を検証し、空の本番targetへ移送する | source/target ID、manifest/schema/credential変換版、各batchのcheckpoint、全表・Auth・画像の読戻し結果 |
| G3 データ照合 | 下の照合表を独立checkerで検査。旧receiverをsealした最終境界の受信streamを新側へ引き継ぎ、全内容を照合する。旧新dispatcherは停止したまま、新provider受信の開始はG4 | 停止境界のDB写像の未説明差分0、FK違反0。旧receiverの最終commit・進行中0と全journal、処理済み/未処理・Checkout効果を独立照合。seal以後のStripe変化/配送は別境界として保存し、G4/G5でも未分類0を要求 |
| G4 閉鎖中の接続・受信 | G3と移送後backupの後、承認済み方式でapexだけをreceipt_onlyへ接続。TLS/503/no-storeを確認してWebhook登録・遠隔custody・実binding鍵一致と受信引継ぎを行う。OAuth callbackは保存済み | 別回線/リゾルバで固定新versionのmaintenance/証明書を確認。Stripe署名receiptの永続化と新旧受信境界、切替中の失敗配送/遅着/重複をID・業務効果ごとに独立照合。実画面/Auth/旧PWA/保護URLはG5で確認 |
| G5 新側のみ再開 | 所有者が本人確認モードへの進行と前進復旧境界を確認。有効化前に潜在的write開始を記録。一般503を保って実画面/OAuth/MFA/Resend受信を検証し、単独dispatcher・一般write・通知/Cron/aliasを順に開始する。Stripe現在値と適用結果も照合する | 最初の業務更新/外部副作用の時刻とIDを記録。旧側更新0、二重適用0、主要操作と管理者MFA正常。確認時点までの未処理を回収し、後続イベントにも未説明差分がないことを追跡。公開再開時刻を記録 |

新側で最初の本番業務更新を受け付けた後は、Cloudflareを正として修復する「前進復旧」（6節B）を行う。一般公開前でも、実施者の更新、課金操作、イベント適用、ライフサイクル処理が始まれば同じ扱いとする。応答が不明なら「書き込みなし」と仮定しない。

確認済み原本の取り込みと移送台帳の記録は、新たな業務更新とは区別する。ログインによるsession生成等も別に記録する。G5本人確認モードはResendの業務台帳更新を許すため、有効化前を潜在的write開始として固定し、それ以後の旧側復帰は行わない。

### コピーと照合は、保存先ごとに行う

| 対象 | 移送・変換の方針 | 合格条件 |
| --- | --- | --- |
| DB | 1つのREAD ONLY / REPEATABLE READ transactionでpublic表をexport。ID・参照・採番high-water・NULL・UTC精度・金額・JSON/配列を保持 | 表別件数/PK集合/型を含む値のhash、FK、現所有者/保有数/期限/無期限Tier C、移管/抽選/通知/監査を照合。意図した変換は版付き期待値と比較 |
| Auth | 元UUIDとprovider/subject対応を保持。bcrypt等の認証情報は非公開変換へ。旧session/verificationを新側で再利用しない | business参照の欠落0、意図しない重複/統合0、管理権限一致、停止ユーザー拒否。MFA未解決0。本人パスワード・秘密はログへ出さない |
| Master/設定 | 既存3,944 UUIDと許可済みreleaseを基準に、実sourceの変更差分を照合。本番Price/言語/制限/メール設定を採用する | 古いstaging設定で本番を上書きしない。catalog ID/内容、料金・上限、公開版とdraftの対応を確認 |
| 保護情報 | active credentialは専用変換で保持。inactive/deferredを黙って捨てない | 全行に移送/保留/廃止の処置と根拠があり、公開・非公開・password保護の実挙動が一致。例外があれば公開前に所有者判断 |
| Storage | `avatars` / `cover-images`のkeyとmetadataを保持し、本文を取得してR2へ条件付き作成 | 全objectのkey/size/hash/MIME/必要metadata、削除・追加差分、所有者とDB参照を照合。競合を上書きしない |
| Stripe | user/customer/subscription/Price/modeと延長Checkout Sessionを対応付ける。メール一致で補完しない | G3は停止境界の対応一致と以後の変化の全件分類。旧処理済み効果は再適用しない。G5で未処理を適用後、実Stripe現在値と照合。取込件数だけで合格にしない |

public DBの整合snapshotだけではAuth/Storageとの同時点性は保証されない。G1で全体の更新を止め、各exportの前後inventoryとID参照を照合する。接続断でDB snapshotが失われたら、同じsnapshotの続きとは扱わず、新runとして全体を再取得する。[snapshot設計](snapshot-export-design.md)。

原本・認証情報・行別照合・DNSの内部設定はGit外、directory0700/file0600、暗号化保存。鍵は保存物とは別に保管する。Storage exporterは本文を平文保存するため、専用private領域で取得し、確認済み暗号化保存後に一時平文を除去する。失敗時も残存を調べる。公開文書・GitHubへメール、hash化パスワード、token、画像本文、個別契約の情報を載せない。

### MFA・Webhook・旧クライアントを抜け道にしない

MFAは、既存TOTPを検証済み変換で移せるか、安全な本人確認付き再登録にするかをP5で決める。未登録状態へ落として通常権限を与える方法は採らない。再登録案なら対象ユーザーの保護状態、本人確認、期限、管理者復旧を実装してから移す。Better Authの公式Supabase移行手順もsession失効を前提とし、2FA/RLSは対象外としている。導入済み固定版での試験を別途必要とする。[公式移行ガイド](https://better-auth.com/docs/guides/supabase-migration-guide)。

旧Checkout/Portalはブラウザを閉じても残り得る。P4で未完了Session・非同期決済・停止期間の請求を列挙し、完了済み効果と未処理通知を区別する。旧版には新intentがない場合もあるため、イベント再送だけで延長権利を再付与しない。旧適用の証拠と現在のStripe値を使い、曖昧なものは自動適用を止めて照合する。

`CUTOVER_WRITE_FREEZE=true`はWorker用でSupabaseを停止しない。コード上はStripe受信、一部の認証、GET/HEADなどを許すため、全ストア無更新や管理者だけのアクセスを保証しない。2026-10-15にローカル実装した`receipt_only`はStripe受信以外のHTTPと業務Cronを閉じ、2026-10-19に閉鎖配備を確認した。開始済み処理のdrainは別途必要。G4のasset/Auth確認はこのモードでは行わず、閉鎖配備・native試験済みの[G5本人確認モード](production-owner-acceptance.md)へ接続する。実本番での本人ログインは移送後に確認する。`RECOVERY_WRITE_FREEZE`は受信も止めるため、Webhookの継続受信の代わりには使わない。

古いSPA/PWAや漏れた直接APIからの書き込みは、DNS変更だけでは防げない。Supabase projectの直接URL、旧service-role処理、Auth/Storageを含むバックエンド側の拒否を検証する。元の権限・job・設定を復元可能な形で保存し、`main`へのマージを停止手段に使わない。

## 5. 当日のコマンドは、存在する入口と未完成の入口を分ける

以下は実行票へ落とし込むための入口一覧。今回はコマンドの本番実行や資格情報の取得を行わない。`<...>`は未確定値で、そのまま実行する例ではない。

| 操作 | 確認済みの入口 | 本番実行票で追加するもの |
| --- | --- | --- |
| source事前検査 | `scripts/migration/identity-readiness.sql`、`auth-readiness.sql`、`source-scheduled-writers.sql`、`storage-cron-readiness.sql` | verified source接続、read-only/timeout、private保存先、対象全表への読取権限。個別SQLの観測を同一snapshotとしない |
| DB暗号化export | `node scripts/migration/snapshot-export-encrypted.mjs --catalog <private-catalog> --bundle <new-private-bundle> --role postgres --credential-descriptor <private-descriptor>` | 固定Node版・catalog/descriptor hash、PG接続と暗号鍵をプロセス環境から供給。秘密をargv/ログへ入れない |
| 画像export | `node scripts/migration/storage-export.mjs --output-dir <new-private-directory> --buckets avatars,cover-images` | 実source照合、容量制限、環境変数の供給、暗号化・平文cleanup。事前コピーを確定コピーと扱わない |
| Auth/Business/Master/R2 import | `prepareInitialImportSet` / `executeInitialImportSet` / `verifyInitialImportSet` | 固定資源、確定snapshot、Stripe受信export、停止証拠file、全journal、秘密供給を結んだ当日票。libraryの存在だけで実施可能とはしない |
| source停止/再開・受信引継ぎ | `source-database-freeze.mjs`、`source-cron-pause.mjs`、`source-edge-maintenance.mjs`、`source-stripe-receipt-only.mjs` | 保存済み原本version、停止/逆操作SQL、配備前後の照合、旧副作用drainと逆方向の受信回収票。候補guardはまだsourceに配備していない |
| DNS/Custom Domain | Cloudflareのverified zone/Workerに対する管理操作 | record/route/certificateの変更前後JSONとhash、競合処理、独立readback、逆操作。現在の公開A回答をorigin値として復元しない |

本番runnerは`prepare`/読み取り検証と`apply`を分離し、source/target/run/commit/schemaを照合してから変更を許す設計とする。自動retryで書き込みを重ねず、同じmanifestとtarget世代のcheckpointを読んで再開する。本番runnerはこれらをlibrary入口として実装した。当日CLI/呼出し票は秘密を出力しない形で固定する。

## 6. 最初の新業務書き込みの前後で復旧方法を変える

### A. 新業務書き込み前は旧Supabaseへ戻せる条件を確認する

1. 新Workerの業務操作、dispatcher、cron、一般認証を閉じ、実行中処理の終了を確認する。
2. 操作台帳・Stripe現在値・対象行から、新側の業務更新と外部副作用がないことを証明する。証明できなければBへ進む。
3. 新receiverが受けた未処理イベントを回収する。旧receiverへの受信復帰後、新receiverの最終commit・進行中0とevent ID/効果キーの統合を確認し、遅着も照合する。新側だけの受信を捨てない。逆方向の引継ぎが未検証なら旧書込を再開しない。
4. 変更済みのDNS/Custom Domain/route、OAuth callback、メールリンク等を保存した旧設定へ復元する。Custom Domain削除だけで旧DNSが戻ると仮定しない。両回線で旧配備への到達を確認する。
5. 旧Auth/Storage/DBの停止設定を元に戻し、旧dispatcherだけで未処理を適用する。確認操作後に一般操作と旧cronを再開する。新側は閉鎖したまま原本とログを保持する。

目標は判断後15〜30分で旧側再開。ただし受信差分や不明更新があれば時間より整合性を優先する。停止時点のDBへ戻して期間中の受信を消す操作はしない。

### B. 新業務書き込み後はCloudflareを正として修復する

1. 公開先をCloudflareのメンテナンス応答に保ち、業務書き込み・cron・dispatcher・外部送信を停止する。受信を継続できる独立経路と永続台帳を保持する。
2. 最初の成功、不明ACK、影響範囲、最後の確認済み操作までを保存する。故障した資源と台帳を削除しない。
3. コード/configだけの故障で、schema・bindingと互換性が確認できれば、同じデータを使う既知の正常版へ戻して照合する。データ破損なら、検証済みbackupを新しい専用の3 D1/2画像R2へ復旧する。
4. 復旧点以後の成功・不明操作、Stripe受信/効果、画像、Auth変更を元台帳と実providerから照合し、必要な差分を一度だけ適用する。未説明の欠損がある間は公開しない。
5. session/verification/MFA assuranceを失効させ、本人・管理者の再認証、権利・契約・画像・保護URLを確認する。復旧先のbindingと新versionを独立確認後、単独writerとして再開する。

新側更新後のDNSだけの切り戻し、元snapshotでの上書き、業務操作の盲目的再送は禁止。再構築できない更新があればメンテナンスを維持し、所有者へ影響と個別対応を報告する。

stagingの目標は、復旧点の古さが最大24時間（RPO）、復旧所要時間が4時間（RTO）である。本番案でも復旧4時間を初期目標とするが、検証前の保証値にはしない。

日次バックアップだけでは、最後のバックアップ以後に発生した更新を復元できない可能性がある。本番で24時間分の欠損を許容すると決めたわけではない。切替直前・直後の確認済み保存と継続する操作・受信台帳を用意し、Auth・画像を含む更新差分を復元できることをP7/P8で検証する。復元できない更新経路が残るなら、本番の開始条件を満たさない。

## 7. 公開直後の監視と、旧基盤を止める条件

公開直後30分は連続確認、当日中は1時間ごと、翌日と7日後に確認する案。自動監視は別途本番設定する。認証成功/失敗、5xx、他人のデータへのアクセス拒否、画像、権利、Stripe受信・処理済み/失敗/滞留、通知、cron、backupの復号照合を記録する。

誤ったユーザーへの権利・契約紐付け、重複課金/延長、秘密漏えい、書込の二重稼働、未説明の欠損は1件でも新操作を止める。5分続く主要API障害、通常1分周期の処理が10分以上滞留、backup失敗は調査・所有者通知の暫定閾値とし、予備検証の実測で調整する。schemaを壊すような自動復旧は行わない。

公開受け入れでは、既存アカウントのログイン/再ログイン、管理者MFA、本人profile、所有・取得・返却・移管・抽選、保護ページ、既存画像、プラン/契約表示、旧PWA更新を確認する。破壊的な操作や実課金は専用の確認対象と操作範囲を事前に定め、利用者データを試験用に変更しない。4言語、モバイル、旧リンクも対象に含める。

旧Supabaseは切替当日に削除しない。最低7日間を観測期間の案とし、期間経過だけで廃止しない。旧Authリンクの実際の最長期限、旧Storage外部URL、遅着Webhook/未完了決済、外部caller、監査保存、2回以上の本番日次backup成功と隔離復旧、利用者問い合わせの解消を確認する。保持中も旧業務更新は停止したままにする。

本番確認後、旧Supabase自動deploy・Lovable連携・通常buildの設定を整理してPR #41をマージする。旧基盤削除は別の明示的な判断で実施する。今回、#38の完了checkbox、PR draft、本番設定は変更しない。

用語: freezeは新規更新の拒否、drainは既に始まった処理の終了確認、ACK不明は成功応答を確認できない状態、RPOは復旧点の目標、RTOは復旧所要時間の目標。本計画で未確定の実行値や日程は、P1〜P8の成果物とともに所有者が確認する。
