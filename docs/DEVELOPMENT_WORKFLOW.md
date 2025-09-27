# 開発ワークフロー：Lovable + Claude Code + Supabase

## 概要

このドキュメントは、fanmark.idプロジェクトにおけるLovable、Claude Code/Codex（ローカル開発）、Supabaseを組み合わせた開発ワークフローのベストプラクティスを説明します。

## 🏗️ 開発環境構成

```
GitHub Repository (Single Source of Truth)
    ↓
├── Lovable (UI開発・プロトタイピング)
├── Claude Code/Codex (機能開発・Migration作成)
└── Supabase (データベース・Edge Functions)
```

## 📋 基本原則

1. **GitHub = 単一の真実の源（Single Source of Truth）**
2. **すべての変更はGitHubを経由**
3. **Migration-First アプローチ**
4. **環境別責任分担の明確化**

## 🔄 開発ワークフロー

### **フロントエンド開発**

#### ✅ **問題のないパターン**

```bash
# 1. 最新コードを取得
git pull origin main

# 2. ローカルで開発
# - UI調整
# - コンポーネント作成
# - ロジック実装

# 3. GitHubにpush
git add .
git commit -m "機能: ○○を追加"
git push origin main

# 4. Lovableでdeploy
# → Lovableが自動的にGitHubから最新コードを取得してデプロイ
```

### **Supabase開発（データベース・Edge Functions）**

#### ⚠️ **注意が必要なパターン**

```bash
# 1. 最新コードを取得
git pull origin main

# 2. Supabase CLIでMigration作成
supabase migration new add_feature_name
# → 20250927HHMMSS_{uuid}_add_feature_name.sql が自動生成

# 3. Migrationファイル編集
# - 関数作成・修正
# - テーブル追加
# - ポリシー設定

# 4. GitHubにpush
git add supabase/migrations/20250927*_add_feature_name.sql
git commit -m "データベース: ○○機能のスキーマ追加"
git push origin main

# 5. GitHub-Supabase連携により自動デプロイ
# → pushと同時にSupabaseにmigrationが適用される
```

## 🚨 **よくある問題と解決策**

### **Problem 1: Lovable PublishしてもSupabaseに反映されない**

**原因**: LovableのPublish ≠ Supabaseデプロイメント

**解決策**:
- Supabase変更は必ずMigrationファイルで管理
- GitHub-Supabase連携を活用

### **Problem 2: 関数修正時のエラー**

```
ERROR: 42P13: cannot change return type of existing function
```

**原因**: 既存関数の返り値型を変更しようとした

**解決策**:
```sql
-- 必ずDROP FUNCTIONから開始
DROP FUNCTION IF EXISTS public.function_name(param_types);

-- その後にCREATE OR REPLACE
CREATE OR REPLACE FUNCTION public.function_name(...)
RETURNS TABLE(...) -- 新しい返り値型
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
    -- 関数本体
END;
$$;
```

### **Problem 3: Migration履歴の不整合**

**原因**: ローカルとリモートでmigration管理が分離

**解決策**:
```bash
# 現在の同期状況確認
supabase migration list

# 必要に応じてリモートからpull
supabase db pull
```

## 📝 **Migrationファイル作成ベストプラクティス**

### **1. 正しいファイル作成**

```bash
# ❌ 手動でファイル作成
touch supabase/migrations/20250927_feature.sql

# ✅ Supabase CLIで作成
supabase migration new add_feature_name
```

### **2. Migrationファイルテンプレート**

```sql
-- Migration: Add feature_name functionality
-- Created: 2025-09-27
-- Description: 機能の詳細説明

-- 既存関数がある場合は必ずDROP
DROP FUNCTION IF EXISTS public.existing_function(text);

-- 新しいテーブル作成
CREATE TABLE IF NOT EXISTS public.new_table (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    -- カラム定義
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- インデックス作成
CREATE INDEX IF NOT EXISTS idx_new_table_field ON public.new_table(field_name);

-- RLS (Row Level Security) 設定
ALTER TABLE public.new_table ENABLE ROW LEVEL SECURITY;

-- ポリシー作成
CREATE POLICY "policy_name" ON public.new_table
    FOR SELECT USING (auth.uid() = user_id);

-- 関数作成
CREATE OR REPLACE FUNCTION public.new_function(param_name text)
RETURNS TABLE(
    id uuid,
    name text,
    created_at timestamp with time zone
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
    RETURN QUERY
    SELECT
        t.id,
        t.name,
        t.created_at
    FROM new_table t
    WHERE t.field = param_name;
END;
$$;

-- 権限設定
GRANT EXECUTE ON FUNCTION public.new_function(text) TO anon;
GRANT EXECUTE ON FUNCTION public.new_function(text) TO authenticated;
```

### **3. ファイル命名規則**

```
✅ 正しい形式 (Supabase CLI生成):
20250927143025_a1b2c3d4-e5f6-7890-abcd-ef1234567890_add_feature_name.sql

❌ 間違った形式 (手動作成):
20250927_add_feature.sql
feature_migration.sql
```

## 🛠️ **環境別開発ガイド**

### **Lovable使用時**

**適している作業**:
- UI/UXの調整
- コンポーネントの作成
- プロトタイピング
- フロントエンドロジック

**注意点**:
- Supabase変更は避ける
- 大きな変更前には必ず `git pull`
- 変更後は自動的にGitHubにcommit

### **Claude Code/Codex（ローカル）使用時**

**適している作業**:
- Supabase Migration作成
- 複雑なロジック実装
- デバッグ・トラブルシューティング
- 大規模なリファクタリング

**必須手順**:
```bash
# 作業開始前
git pull origin main

# Supabase CLI設定確認
supabase status
supabase link --project-ref ppqgtbjykitqtiaisyji

# 作業完了後
git add .
git commit -m "詳細なコミットメッセージ"
git push origin main
```

## 🚀 **デプロイフロー**

### **フロントエンド**
```
ローカル開発 → git push → GitHub → Lovable自動deploy
```

### **Supabase**
```
Migration作成 → git push → GitHub → Supabase自動migration適用
```

### **確認方法**

#### **Supabase反映確認**
1. **Database → Functions**: 新しい関数が表示される
2. **Database → Migrations**: migration履歴に追加される
3. **SQL Editor**: `SELECT routine_name FROM information_schema.routines WHERE routine_name = 'new_function';`

#### **Lovable反映確認**
1. **Lovable Dashboard**: 最新のcommit hashが表示される
2. **ブラウザ**: 変更が反映されたページを確認

## 📚 **参考コマンド集**

### **Git操作**
```bash
# 現在のステータス確認
git status

# 変更をステージング（選択的）
git add specific_file.ts
git add supabase/migrations/20250927*_feature.sql

# 全ての変更をステージング
git add .

# コミット
git commit -m "機能: ○○を追加

詳細説明:
- ○○機能の実装
- ○○の修正

🤖 Generated with Claude Code

Co-Authored-By: Claude <noreply@anthropic.com>"

# プッシュ
git push origin main

# 最新を取得
git pull origin main
```

### **Supabase CLI**
```bash
# バージョン確認
supabase --version

# プロジェクト接続
supabase link --project-ref ppqgtbjykitqtiaisyji

# Migration作成
supabase migration new add_feature_name

# Migration一覧
supabase migration list

# スキーマをローカルに同期
supabase db pull

# ローカルデータベースリセット（開発時）
supabase db reset
```

### **デバッグ・確認**
```bash
# GitHubとの同期状況確認
git log --oneline -10

# Supabaseプロジェクト情報
supabase status

# ファイル変更確認
git diff

# 特定ファイルの履歴
git log -- supabase/migrations/specific_file.sql
```

## ⚠️ **注意事項・制限事項**

### **やってはいけないこと**

1. **Supabase Dashboardでの直接変更（緊急時以外）**
   ```
   ❌ SQL Editorで直接関数作成・修正
   ✅ Migration fileで管理
   ```

2. **手動でのMigrationファイル作成**
   ```
   ❌ 手動で20250927_feature.sqlを作成
   ✅ supabase migration new コマンドを使用
   ```

3. **Git管理外でのSupabase変更**
   ```
   ❌ ローカルのみで変更→直接Supabaseに適用
   ✅ Migration file → Git → GitHub-Supabase連携
   ```

### **緊急時の対応**

本番環境で緊急修正が必要な場合：

1. **即座の対応**: Supabase Dashboardで直接修正
2. **事後処理**: Migration fileを作成してGit管理
3. **ドキュメント**: 変更内容をコミットメッセージに詳記

## 🎯 **成功パターンのチェックリスト**

### **作業開始前**
- [ ] `git pull origin main` で最新コード取得
- [ ] 作業内容がフロントエンドかSupabaseかを明確化
- [ ] Supabase作業の場合、CLIが正しく接続されているか確認

### **Supabase Migration作成時**
- [ ] `supabase migration new feature_name` でファイル作成
- [ ] 既存関数修正時は `DROP FUNCTION IF EXISTS` を追加
- [ ] 返り値型を明確に指定
- [ ] 必要な権限（GRANT）を設定

### **作業完了時**
- [ ] ローカルでの動作確認
- [ ] 適切なファイルのみをgit add
- [ ] 詳細なコミットメッセージ
- [ ] `git push origin main`
- [ ] Supabaseでの反映確認

### **トラブル時**
- [ ] エラーメッセージの詳細確認
- [ ] `supabase migration list` で同期状況確認
- [ ] 必要に応じて `supabase db pull`
- [ ] このドキュメントの該当セクションを確認

---

## 📞 **サポート・質問**

このワークフローで問題が発生した場合：

1. **エラーメッセージを詳細に記録**
2. **実行したコマンドの履歴を確認**
3. **GitHub Issues で報告**
4. **緊急時はSlack/Discord等でリアルタイム相談**

---

*このドキュメントは実際の開発経験に基づいて作成され、継続的に更新されます。*

*最終更新: 2025-09-27*
*作成者: Claude Code開発チーム*