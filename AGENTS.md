# Project Context for AI Agents

Project Name: **fanmark.id**  
Description: 絵文字をIDとして利用するWebサービスおよびプラットフォーム。

## 🚨 Instructions for Agents
1. **画面名の解決**: 画面名や機能名は `docs/ARCHITECTURE.md` を参照してファイルパスに変換してください。  
2. **仕様の遵守**: 実装前に `docs/PRODUCT.md` を読み、仕様を確認してください。  
3. **ドキュメント更新**: コード変更に伴い、仕様や構造が変わった場合はドキュメントも更新してください。

## 現行本番と作業開始

- 本番はCloudflareへ移行済み。新しいスレッドは`docs/README.md`から読み、会話の引継ぎを必須にしない。
- 通常開発はPRODUCT / ARCHITECTURE / TECH、本番更新・障害対応は`docs/operations/README.md`を先に読む。
- 最終確認状態は`docs/operations/current-state.md`。現在のHEAD・CI・active deploymentを独立確認し、古い再開票を実行指示にしない。
- 秘密・実データ・操作journalはGit外。`docs/operations/private-access.md`から取得先を確認し、秘密値を表示/commitしない。
- CIは検証のみで自動配備しない。docs-onlyの変更はWorker配備を行わない。
- 旧Supabaseは停止原本。二重書込み、旧側への切戻し、鍵/backup/callback/MFA登録の再作成、完了済み移送helperの再実行をしない。
- 無関係なdirty変更を保持する。特に既存`supabase/.temp/cli-latest`をstageしない。過去の一回限りhelperのHEAD/phase保護を更新して再利用しない。

## Documentation Map
- **仕様確認**: `docs/PRODUCT.md`  
- **ファイル特定**: `docs/ARCHITECTURE.md`  
- **実装方法**: `docs/TECH.md`

## Tech Stack
- Frontend: Vite + React, Tailwind CSS (shadcn/ui)
- Backend: Cloudflare Workers, Better Auth, split D1, R2（旧Supabaseは停止・原本保持）
- Production operations: `docs/migration/production-operations.md`

## Agent Behavior Guidelines
- **Search First**: ファイルを探す際は、推測で開かず `ls` や `grep` (可能なら `rg`) を活用して正確なパスを特定してください。
- **No Fluff**: 挨拶や過度な丁寧語は不要です。エンジニア同士の対話として、事実とコードを中心にコミュニケーションしてください。
