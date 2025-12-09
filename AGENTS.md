# Project Context for AI Agents

Project Name: **fanmark.id**  
Description: 絵文字をIDとして利用するWebサービスおよびプラットフォーム。

## 🚨 Instructions for Agents
1. **画面名の解決**: 画面名や機能名は `docs/ARCHITECTURE.md` を参照してファイルパスに変換してください。  
2. **仕様の遵守**: 実装前に `docs/PRODUCT.md` を読み、仕様を確認してください。  
3. **ドキュメント更新**: コード変更に伴い、仕様や構造が変わった場合はドキュメントも更新してください。

## Documentation Map
- **仕様確認**: `docs/PRODUCT.md`  
- **ファイル特定**: `docs/ARCHITECTURE.md`  
- **実装方法**: `docs/TECH.md`

## Tech Stack
- Frontend: Vite + React, Tailwind CSS (shadcn/ui)
- Backend: Supabase (Auth, DB, Edge Functions)

## Agent Behavior Guidelines
- **Search First**: ファイルを探す際は、推測で開かず `ls` や `grep` (可能なら `rg`) を活用して正確なパスを特定してください。
- **No Fluff**: 挨拶や過度な丁寧語は不要です。エンジニア同士の対話として、事実とコードを中心にコミュニケーションしてください。
