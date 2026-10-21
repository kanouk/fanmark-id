# 文書案内

現在の本番はCloudflare。新しいスレッドはこの入口から必要な情報を読み、実際のHEAD・CI・配備版を確認する。
会話履歴の記憶や、過去の「現在」「次の工程」という見出しを実行指示にしない。

| 作業 | 最初に読む文書 | 次に読む文書 |
| --- | --- | --- |
| 通常の機能開発・不具合修正 | [PRODUCT](PRODUCT.md)、[ARCHITECTURE](ARCHITECTURE.md) | [TECH](TECH.md)、変更するAPIの契約 |
| 本番更新 | [運用入口](operations/README.md)、[最終確認状態](operations/current-state.md) | [更新手順](operations/deployment.md) |
| 障害の調査・修復 | [障害対応](operations/incident-response.md) | [本番通常設定](migration/production-operations.md)、対象APIの契約 |
| 秘密設定・backup原本が必要 | [保管先とアクセス](operations/private-access.md) | ownerによる権限付与、保存済み暗号化原本の照合 |
| 移行理由・過去の実証を調べる | [履歴案内](history/README.md) | `migration/`の個別契約・証拠 |

## 情報の優先順位

1. 現在のソース・設定と、独立して読み戻した実稼働状態。
2. `operations/`と`migration/production-operations.md`の通常運用手順。
3. PRODUCT / ARCHITECTURE / TECHと各機能のAPI契約。
4. 日付付き実証・移行再開票・旧技術記録。履歴は上位の現在状態を上書きしない。

矛盾や未確認事項を見つけたら現在値を調べて記録する。過去の成功票を手編集して次の工程を実行しない。
新しい配備では、対象commit・成功CI・配備version・検証日時を最終確認状態へ追記し、
実データや秘密を含む証拠はGit外のoperation directoryへ保存する。
