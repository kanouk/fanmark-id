# 秘密情報・実データ・操作原本へのアクセス

この文書は保管場所と取得方法の案内。秘密値そのものや認証権限は含まない。
新しい端末・実行環境では所有者kanoukから必要な権限を受ける。既存Macのpathだけをクラウド実行環境から使うことはできない。
必要な情報に到達できない場合も通常開発とread-only調査を先に進め、足りない権限/原本を具体的に依頼する。

## サービスと保管先

| 対象 | 非秘密の参照先 | 認証・原本の取得経路 |
| --- | --- | --- |
| GitHub | `kanouk/fanmark-id`、main/PR/Actions | 接続済みGitHubまたは認証済み`gh`。新しいcloneでも最新mainを確認する。 |
| Cloudflare | account/zone/Worker名はproduction configと通常運用文書 | 所有者のdashboardまたは承認済みCLI/API identity。read/write scopeと期限を作業前に確認する。 |
| Wrangler既存profile | `fanmark-staging-inapp`（Wrangler 4.135.0） | macOSの`~/Library/Preferences/.wrangler/config/fanmark-staging-inapp.enc`とKeychain。profile名だけでstagingと判定しない。 |
| backup鍵・Auth escrow | `scripts/migration/production-key-custody.mjs`の`productionKeyServices`、active bindingのkey ID | 所有者のmacOS Keychainと非公開Obsidian Vault。下記参照。 |
| OAuth/Stripe/Resend/公開proof署名等 | active Workerのsecret binding名・provider管理画面 | 所有者の既存Keychain/Vault・暗号化custody。Cloudflareの秘密設定画面/APIで値を読み戻せると仮定しない。 |
| 暗号化backup | production appのbackup R2 binding、保存済みreceipt/manifest | 認可済みCloudflare R2読取り＋対応する保存鍵/escrow。DB dump・画像実体・復号物はGitへ置かない。 |
| 移行・更新の詳細journal | 既存Macの`~/.codex/private/` | 所有者がアクセスを付与したprivate directory。原本・成功/失敗・intentを保持する。 |

## 既存鍵の取得

backupのKeychain serviceは`fanmark-app-production-backup-archive-key`、
`fanmark-app-production-better-auth-secret`、`fanmark-app-production-backup-auth-escrow`。
accountはactive bindingと保存済みcustodyが示す`keyId`。過去の閉鎖configだけからkey IDを決めない。

非公開Vault内の`10_sensitive/secret-keys/fanmark-cloudflare-production-backup/<keyId>.md`に
archive鍵と暗号化Auth escrowを保存している。所有者の既存MacではVaultは`~/Documents/Private`。
取得・照合は`openProductionKeyCustody`等をprivate process内で使い、返り値を表示・JSON出力しない。
鍵をargv、shell history、チャット、PR、test fixture、公開logへ渡さない。

別端末でのVaultアクセスは、移行時点では実証していない。Sync表示だけで復旧可能とせず、
認可された端末で対象version・hash・復号互換を確認する。原本が不足していてもcreate helperを再実行しない。

## 既存Cloudflare認証

暗号化profileを読む実装は`scripts/migration/wrangler-credential-lease.mjs`。
OS鍵はKeychainのservice `wrangler` / account `fanmark-staging-inapp`に対応する。
`createWranglerCredentialLease`へaccount ID、profile絶対path、新しいprivate refresh directory、
`workers/api/node_modules/wrangler/package.json`の絶対pathを渡し、同一identityの期限・scopeを検証する。
最低残存時間は処理全体と終了記録までを見込む。
lease更新は既存OAuth grantだけを使い、更新応答の暗号化永続化・排他journal・固定account GETを要求する。
refreshの応答不明やlock残存時は再POSTせずjournalを調べる。tokenをprintしたり平文profileを作ったりしない。
新しい実行環境の認証追加は所有者による付与として別に行う。

## 保存済みの操作記録を探す

既存Macのprivate directory（値をコピーせず、必要なmetadata/receiptだけ調べる）:

- `~/.codex/private/fanmark-cutover-2026-10-19/production-cutover-v3-2026-10-20/`: 実移行、既存鍵、backup・隔離復旧、provider登録・公開受け入れの原本。
- `~/.codex/private/fanmark-notifications-read-all-2026-10-21/`: PR42、全件既読の本番操作と独立照合。
- `~/.codex/private/fanmark-empty-body-audit-2026-10-21/`: PR43、通常更新のsnapshot/intent/配備/CI/資産保持と`complete.json`。
- `~/.codex/private/fanmark-natural-backup-2026-10-21/`: 初回自然dailyと09:35 monitorのreceipt、暗号化実保存物の全量照合、現在writer状態、scheduledログと`complete.json`。診断用の一時Workerは削除・元inventoryへの復帰を確認済み。

READMEからintent/receipt/manifest/暗号化原本を辿る。Git外の`common.mjs`や`deploy-once.mjs`は
当時の一回限り操作へ固定されており、通常更新の実行入口にしない。
本番の現在状態はGit側の[状態](current-state.md)と独立readbackから始められ、過去の会話を読む必要はない。
原本を失った場合の詳細照合や復旧には、所有者による外部保管先へのアクセスが必要。

- `~/.codex/private/fanmark-development-foundation-2026-10-22/`: PR57〜59、更新前/候補/activeの照合、旧資産の復元と保持、公開/PC/モバイル/PWA検証の原本。新しい通常更新で当時のonce scriptを再実行しない。

- `~/.codex/private/fanmark-mobile-lint-2026-10-22/`: PR60、4言語/4画面幅の改修前後・Lint 0件・実local/CI・候補/active/公開と旧資産保持の照合。新operationのintentを一度だけ実行した記録。

- `~/.codex/private/fanmark-jev-palette-2026-10-23/`: PR70。保存試作と実Jevの比較、共有入力/マイページ/PWA・native workerdの検証、旧hashを含む231資産、本番前後の表示/転送量比較と全失敗試行。初期の追加DDL案は撤回し、既存の非公開設定領域による原子的な日次予算を採用。最初の公開検索で検出したredirect制約を修正し、別のintentで候補/activeを検証。キーは初回だけ1件追加、再配備では再登録しない。once scriptを再実行しない。
- `~/.codex/private/fanmark-supporting-ux-2026-10-23/`: PR69。非同期の単一フォント指定・JS前の公開shell・認証確認待ちの領域予約。前後の通信制限下計測、実localのJS保留・4言語・機能無効/一部有効/確認失敗・入力DOM/値/フォーカス保持、公開の既存PWA更新・179資産と旧hash保持を記録。失敗した検査も別保存し、新しいupload/deploy intentを1回ずつ実行。再実行しない。
- `~/.codex/private/fanmark-catalog-cache-2026-10-23/`: PR68。公開catalogのIndexedDB再利用、前後の低速回線測定、実local D1のready版変更・破損・拒否/block/quota/abort、旧公開PWAの同profile更新と1件照合、130資産の保持。upload/deployの排他intent・receiptと独立readbackを保存。再実行しない。
- `~/.codex/private/fanmark-pwa-precache-2026-10-23/`: PR67。OG画像の先読み除外。前後の低速回線測定、隔離localの実SW新規導入/更新/オフライン、実Worker回帰、公開の既存PWA自動更新・60→59 cache差分、82資産の保持。upload/deployの排他intentとreceipt、独立readbackを保存。再実行しない。
- `~/.codex/private/fanmark-route-split-2026-10-23/`: PR66。初期route分割のソースCI・実local回帰、前後各16 navigation、82資産の旧hash保持、既存PWA更新・公開4言語/4幅。upload/deployの排他intent・receipt、候補/active・設定/他Workerの独立readbackを保存。再実行しない。
- `~/.codex/private/fanmark-startup-2026-10-23-reviewed/`: PR64。最終候補のCI、更新前/候補/activeの照合、旧27資産の保持を含む34資産、既存PWA更新・公開4言語/4幅、catalog保留の実画面確認。upload/deployの排他intentと独立readbackを保存。先行する未配備preflightは別directoryへ保持し、再実行しない。

- `~/.codex/private/fanmark-startup-recovery-2026-10-24/`: PR72。起動エラーの再現、複数候補と失敗を含む公開比較、read admission/再試行のnative検証、最終280資産と旧PWA更新・自動/手動再試行。最新の完全buildは`final-build`、最終runtimeのmanifestは`stable-release.json`。先行配備と管理APIの旧版readbackを保持し、activationを再送せず独立GETで照合した。診断Worker/経路は削除済み。ticket/fenceは変更せず、active14の終了調査は#71へ分ける。過去のonce scriptを再実行しない。

## 記録の境界

PR73の原本は`~/.codex/private/fanmark-startup-long-waits-2026-10-24/`。PR72後の再発、8f候補の失敗、公開ファイル分離のe79候補、native/core/local/CI・329資産・旧PWAと設定障害注入・公開12起動・全未完了を保存。完全buildは`build`、最終runtime manifestは`release-public.json`。各phaseのupload/deployは新しいintent/receiptで一度だけ実施し、全設定とactiveを独立照合。APIの長時間待ちと認証503は未解消で#71へ継続する。未完了票の手動削除・fence強制解除・schema/秘密値の変更はしていない。過去のonce scriptを再実行しない。

Gitへ保存するのは構成・非秘密ID・公開資産hash・日時・commit/CI/配備version・検証結果・未確認事項。
秘密値、認証URL、cookie、MFA情報、ユーザーデータ、決済payload、DB dump、復号backupは保存しない。
private操作記録はdirectory 0700/file 0600とし、原本を上書きしない。
鍵・backupの再生成やrotationは通常更新とは別の明示的な作業として扱う。
`.env`/`.dev.vars`等の秘密設定fileはignoreする。旧`.env`はGitの追跡から外した。
公開設定の例は`.env.example`を使い、秘密値はGit外のprivate保管へ置く。
