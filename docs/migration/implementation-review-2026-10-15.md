# 本番前の実装・設計レビュー

PR #41、既存移行ブランチ。起点`714fee4`の[CI 38748657327](https://github.com/kanouk/fanmark-id/actions/runs/38748657327)はApplication/Worker両jobが成功、Supabase Previewはskipped。今回の修正はローカル実装・合成試験までで、staging/本番への配備、実ユーザーデータ取得、資源作成、送信、DNS変更、mergeは行わない。

実装に使ったモデル名から品質を判断せず、現在のコード、適用する全migration、失敗ケースを確認した。今回の範囲は、移行時の停止・通知、Authのidentity/MFA境界、D1 importerの再開、Stripe受信、5 store復旧。18機能群すべての画面・業務ルールを再監査したものでも、別担当による独立レビューでもない。

## 確認した問題と対応

| 項目 | 根拠と影響 | 今回の対応・残る条件 |
| --- | --- | --- |
| 通知の停止中にD1のwake状態が更新される | `CUTOVER_WRITE_FREEZE=true`でも`flushNotificationWake()`とDOのwake POSTが通り、`acknowledged_generation`が0→1へ変化することをローカルD1で再現。通知の送信や二重課金を確認したという意味ではないが、確定コピーの停止境界としては不十分 | HTTP拒否をwriter追跡より前に行い、後処理・直接flush・DO POSTでも停止を確認。停止解除後に未処理通知が1回だけ届くことを検証。未配備 |
| boolean freezeだけでは閉鎖した移行先にならない | `true`はAuthのログイン/session等と公開GETを許し、Cron診断専用D1への記録も許す。これは既存の限定停止契約であり、全ストア無更新と解釈できない | `receipt_only`を追加。署名検証付きStripe受信だけを通し、一般HTTP/Auth/asset、Cronの追跡・診断を閉じる。不明値は全HTTPを拒否。既存`true`の許可範囲は維持 |
| Auth移送前の検査が部分的 | 既存のsource集計はhash形式/provider/MFA種類を調べるが、移送先のidentity重複・MFA状態・管理者復旧条件までは判定しない | 読み取り専用の`inspectAuthIdentityReadiness()`を追加。16種類の停止理由を集計し、個人識別子・メール・hash・factor secretを返さない。実SupabaseとのID対応、パスワード/TOTP互換、停止アカウントの同等性は別検査 |

認証のunique制約については、初期schemaだけでは欠けて見えたが、`0009_auth_oauth_signup.sql`に`account(providerId, accountId)`のunique indexがある。現在の4 migrationを全部適用すると重複を拒否したため、現行の欠陥という仮説を棄却した。制約を意図的に削除した合成DBでは、新しいpreflightが制約欠落と重複を検出する。既存のmigrationは変更せず、追加のunique制約案も採用していない。

## 新しい閉鎖モードの契約

| `CUTOVER_WRITE_FREEZE` | HTTP | 通知・Cron |
| --- | --- | --- |
| 未設定・空・`false` | 従来どおり | 従来どおり |
| `true` | 既存のAPI更新停止。Stripe、限定Auth、公開GET等は通す | 通知の処理・wakeのD1更新・業務Cronは停止。明示されたCron診断は継続 |
| `receipt_only` | 正確な`POST /api/stripe/webhook`のみ通常処理へ。他は503/no-store/Retry-After。受信は署名・mode・D1永続化の既存検証を通る | 通知のD1更新・業務処理、Cronの追跡と診断を停止 |
| 不明な値 | Webhookも含め全HTTPを503で拒否 | 業務・追跡・診断を停止 |

閉鎖中に拒否するHTTPはwriter用DOにも触れない。許可したStripe受信は通常のwriter guardを通す。既存の通知DO alarmは再開のための次回時刻を保持・更新し得るが、D1の処理やwake acknowledgeは進めない。既に始まった処理、直接SQL、旧Supabase、別Worker、外部callerを停止する機能ではない。進行中処理のdrainは必須。

`RECOVERY_WRITE_FREEZE`は引き続きWebhookも止める。backup取得では受信台帳の別streamと5 storeの確定境界を調整する必要があり、`receipt_only`だけで整合backupを取得できるとは扱わない。Resend等の他Webhookは閉鎖されるため、その受付・再試行・回収は別の操作票で確認する。

一般画面には外部assetを使わない503のメンテナンス案内、APIにはJSONエラーを返す。このモード中は実施者もasset/APIに入れない。G4の確認には専用hostや実施者限定の入口を別途検証し、確認のために一般公開を先に再開しない。

## Auth preflightの使い方と限界

[auth-identity-preflight.mjs](../../scripts/migration/auth-identity-preflight.mjs)の`inspectAuthIdentityReadiness(database)`へ、確認済みのAuth D1読取bindingを渡す。外部接続や適用を行うCLIは設けていない。今回実行したのは合成ローカルDBだけ。

単一SELECTで、全体件数とunique index欠落、identity/credential/factor重複、孤児参照、空の識別子、未対応provider/role、credential subject不一致、MFAのフラグ・factor不一致、MFA未準備の管理者を返す。MFA登録途中の行も停止理由になり得るので、削除や無効化で検査を通さず内容を確認する。

`identityAndMfaChecksPassed=true`は集計上の問題が0という意味で、`productionReady`は常にfalse。ユーザーUUIDやprovider subjectのsourceとの一致、停止期限、メール確認状態、実パスワード、TOTP暗号形式、backup codeの互換性、Business全参照、実際の管理者ログインは証明しない。`npm run test:auth-identity-preflight`で検査自体を再現できる。

## 維持する設計と残る実装

- **D1 importer**: schema・target incarnation・credential profileを先に検査し、checkpointと行更新をbatchで管理、成功応答不明を読戻しで照合する構造を維持する。`local`/所有する`isolated-remote`を本番名へ偽装して使わない。本番専用transport/runnerと、importerから独立した全件checkerは未完成。
- **Auth/OAuth**: 実装はprovider subjectとUUID、pending signup marker、同一sessionのMFA assuranceを使う。verified emailによる通常のOAuth linkingには既存の契約・試験がある。これを移行時のメール一致によるUUID補完の許可と混同しない。
- **Stripe**: 受信と業務適用を分け、event IDとCheckout Sessionの効果キーで処理する設計を維持する。前回追加した引継ぎcheckerはcanonical投影同士の比較まで。旧実配備handlerのreceipt-only化と実投影adapterを実装しない限り、本番引継ぎはできない。
- **復旧**: 5 storeを外部guard下で取得し、再取得hash、鍵、source/target ID、復旧後のhashを照合する。再取得一致だけをwriter停止の証明にしない。日次backup以後のAuth/画像/外部副作用を回収できるRPO 0の経路は未完成。
- **ドメイン**: コードでは`admin`サブドメインで`AdminApp`、そのrootで管理画面を表示し、他pathはrootへ戻す。apexには`/admin/*`もある。初回は既存admin hostを保持する案を推奨する。auth cookie/origin、実際のredirect設定、TLSは未検証なので、単純なhost置換で同等とはしない。

既存コードの大規模な再編より、上記の移行境界を実データ移送前に閉じることを優先する。確認済みの原子性・認可を保ちながら、ひとつの境界ごとに失敗試験と読戻しを追加する。

## 所有者が判断する点

| 判断事項 | 推奨案 | 理由・判断までに必要な情報 |
| --- | --- | --- |
| 実データ予備取得とリハーサル | まず機密値を出さない最新集計、次に必要な範囲の暗号化予備コピーを別途実施指示の下で行う。保管先・取扱者・削除期限・隔離先・費用を先に固定 | 本番の件数・identity/MFA・課金例外と所要時間は合成試験では確定しない。今回は実取得しない |
| MFAを移せない場合の対応 | 移送可否を技術検証し、不可の場合だけ保護状態を保った本人確認付き再登録・個別サポートを選ぶ | アカウントを通常権限へ落として移すと保護を失う。対象件数・手順が分かるまで一律再登録の判断は不要 |
| 停止枠と延期判断 | 日程は実測後に決める。現案の通常2時間・90/105分判断・作業者3時間を目安にし、間に合わない場合は新側の書込み開始前に延期 | 未実測の時間を利用者への保証にしない。新側書込み後はDNSだけで戻せない |
| 復旧と旧基盤の保持 | アカウント・権利・課金の欠損を認めない前提を維持。旧基盤は最低7日案に加え、旧リンク期限・遅延決済・backup2回・隔離復元の条件を優先 | 日次backupだけでは更新差分の欠損を防げない。RPO/RTOの実証と保持費用を提示してから判断 |

本番の資源ID、停止SQL、schema、各adapter、署名鍵の注入方法などは技術側の作業であり、所有者の承認だけで未検証を解消しない。

## 検証記録

検証はNode 22.6.0、ローカルworkerd/D1/DOと合成fixture。外部providerは合成応答で、実メール・実決済は行っていない。結果は[evidence](evidence/implementation-review-2026-10-15.json)を参照する。通知の再現テストは修正前に失敗し、修正後に成功。今回のコードは未配備なので、以前のstaging受入れ結果をそのまま今回のruntimeへ適用しない。
