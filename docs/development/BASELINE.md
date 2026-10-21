# 開発基盤の基準計測

2026-10-22、main `2e4a43d`、Node 22.6.0、root/Worker lockfileで依存を導入して計測。

- フロント型検査: 成功。
- Worker型検査: 成功。
- client集約: `node --experimental-strip-types --test src/lib/*.test.ts`、256件成功。
- Lint: 93エラー / 21警告。旧Supabaseを含む既存範囲。改善後は現行対象を別に示す。
- 正規本番build: `node scripts/build-cloudflare-production.mjs`成功。

| 正規本番buildのJS | bytes | gzip bytes |
| --- | ---: | ---: |
| `index-C42muhhL.js` | 2,458,737 | 662,906 |
| `workbox-window.prod.es5-B9K5rw8f.js` | 5,720 | 2,359 |

10月21日計画の素のVite buildと異なり、正規builderではbundled emojiCatalogチャンクは生成されなかった。
不要catalog precacheの削減効果は正規buildに対して改めて判定し、過去計画の1.4MB削減を実績としない。
実行ログは作業環境のGit外に保存。依存の自動更新・本番操作は行っていない。
