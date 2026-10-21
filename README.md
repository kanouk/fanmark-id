# fanmark.id

絵文字1〜5個をID（ファンマ）として取得し、プロフィール・リンク・メッセージを公開するサービス。
本番は **Cloudflare Workers / Better Auth / split D1 / R2**。2026-10-20に移行を完了した。
旧Supabaseは処理を停止した保存原本で、現行の認証・DB・Storage・配備先として使わない。

## 開発・運用の入口

新しいスレッドや新しいcheckoutでは、会話の引継ぎより先に次を読む。

1. [AGENTS.md](AGENTS.md): 作業規則と文書の優先順位。
2. [文書案内](docs/README.md): 通常開発・本番更新・障害対応の読み順。
3. [仕様](docs/PRODUCT.md)・[構造と画面対応](docs/ARCHITECTURE.md)・[開発手順](docs/TECH.md)。
4. 本番に触れる作業では[運用入口](docs/operations/README.md)と[最終確認状態](docs/operations/current-state.md)。

コードと非秘密の運用手順はこのリポジトリに置く。認証情報・実データ・操作journalはGit外で保管し、
[保管先とアクセス](docs/operations/private-access.md)から辿る。GitHubを開くだけで外部サービスの操作権限が付くわけではない。

## 最初のローカル確認

Node **22.6.0**を使用する。

```sh
npm ci
npm ci --prefix workers/api
npm run typecheck
npm --prefix workers/api run typecheck
npm run check:ci
npm run check:production-live-config
```

これらは遠隔配備を行わない。画面・Workerの検証、buildとpreviewの違いは[TECH](docs/TECH.md)を参照する。
GitHub Actionsは検証専用で、mergeしても本番は自動更新されない。

過去の仕様・Supabase運用・移行実験は[履歴案内](docs/history/README.md)に分離した。
