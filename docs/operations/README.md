# Cloudflare運用の入口

このリポジトリと所有者から付与されたサービス権限で、会話の引継ぎなしに作業を始めるための入口。
コード・手順・非秘密の状態はGit、資格情報・実データ・操作原本はGit外へ分ける。

1. [最終確認状態](current-state.md)で本番移行完了・配備ソース・未確認事項を把握する。
2. [本番通常運用](../migration/production-operations.md)で通常config・保存先・Cron・DNSの境界を読む。
3. [更新](deployment.md)または[障害対応](incident-response.md)を選ぶ。
4. 遠隔操作や復旧原本が必要なら[保管先とアクセス](private-access.md)を確認する。

## 作業開始時

- `git status --short`、現在branch、`git fetch origin`後のmain、開いているPR、CIを確認する。
  無関係なdirty変更は保持する。既存の`supabase/.temp/cli-latest`をstageしない。
- 本番の現在値はCloudflareのactive deploymentを読み戻す。記録したversionや成功日時は観測時点の情報。
- 通常開発・read-only調査は過去の会話を探さず始められる。認証権限が足りなければ所有者に付与を依頼する。
  GitHubにあることを、秘密値や本番変更の許可を持つこととは扱わない。
- 古い移行用helperのHEAD/main/runtime固定は意図した保護。その値を現行へ書き換えて再利用しない。
  通常更新は新しいoperationとして記録する。

## 操作記録の最小項目

Git外に新しいoperation directory（0700、file 0600）を作り、対象環境、依頼の範囲、開始時刻、
HEAD/CI、active version、全bindingと資産manifest、変更要求のintent、応答、独立readbackを保存する。
intentは排他的に作成する。応答不明時は同じmutationを再送せず、version・保存物・receiptを確認する。
Gitには秘密・実データを含まない結果と参照方法だけを残す。

本番更新後は最終確認状態の配備ソース・version・CI・実証・未確認事項を更新する。
日付付き記録を現在値と混同しない。秘密値を取り除いた状態を維持する。
