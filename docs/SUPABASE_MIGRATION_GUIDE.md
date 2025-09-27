# Supabase Migration ガイド

## 🎯 概要

このドキュメントはSupabaseのMigration作成・管理に特化したガイドです。今回の短縮URL機能実装で得られた知見をまとめています。

## 📋 Migration作成の基本手順

### **1. 新機能追加時**

```bash
# プロジェクト接続確認
supabase link --project-ref ppqgtbjykitqtiaisyji

# Migration作成
supabase migration new add_feature_name
# 例: supabase migration new add_shortid_lookup_functions

# 生成されるファイル例:
# 20250927143025_a1b2c3d4-e5f6-7890-abcd-ef1234567890_add_shortid_lookup_functions.sql
```

### **2. 既存関数の修正**

#### ⚠️ **重要: 関数修正時の必須パターン**

```sql
-- ❌ これはエラーになる
CREATE OR REPLACE FUNCTION public.existing_function(param text)
RETURNS TABLE(
    id uuid,
    name text,
    new_column text  -- ← 新しい列を追加
)
-- ERROR: 42P13: cannot change return type of existing function

-- ✅ 正しい方法
DROP FUNCTION IF EXISTS public.existing_function(text);

CREATE OR REPLACE FUNCTION public.existing_function(param text)
RETURNS TABLE(
    id uuid,
    name text,
    new_column text  -- 新しい列を追加
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
    RETURN QUERY
    SELECT
        f.id,
        f.name,
        f.new_column
    FROM some_table f
    WHERE f.field = param;
END;
$$;
```

## 🔧 **実際の実装例: 短縮URL機能**

### **背景**
複合絵文字（例：😶‍🌫️）のURLエンコード問題を解決するため、短縮URL機能を実装

### **実装したMigration**

```sql
-- Update get_fanmark_by_emoji to include short_id for redirect capability
-- First drop the existing function to avoid return type conflicts
DROP FUNCTION IF EXISTS public.get_fanmark_by_emoji(text);

CREATE OR REPLACE FUNCTION public.get_fanmark_by_emoji(emoji_combo text)
RETURNS TABLE(
  id uuid,
  emoji_combination text,
  fanmark_name text,
  access_type text,
  target_url text,
  text_content text,
  status text,
  is_password_protected boolean,
  short_id text  -- ← 新しく追加
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
    RETURN QUERY
    SELECT
        f.id,
        f.emoji_combination,
        COALESCE(bc.fanmark_name, f.emoji_combination) as fanmark_name,
        COALESCE(bc.access_type, 'inactive') as access_type,
        rc.target_url,
        mc.content as text_content,
        f.status,
        COALESCE(pc.is_enabled, false) as is_password_protected,
        f.short_id  -- ← 新しく追加
    FROM fanmarks f
    LEFT JOIN fanmark_basic_configs bc ON f.id = bc.fanmark_id
    LEFT JOIN fanmark_redirect_configs rc ON f.id = rc.fanmark_id
    LEFT JOIN fanmark_messageboard_configs mc ON f.id = mc.fanmark_id
    LEFT JOIN fanmark_password_configs pc ON f.id = pc.fanmark_id
    WHERE f.normalized_emoji = emoji_combo
    AND f.status = 'active';
END;
$$;

-- Create function to get fanmark data by short_id
CREATE OR REPLACE FUNCTION public.get_fanmark_by_short_id(shortid_param text)
RETURNS TABLE(
  id uuid,
  emoji_combination text,
  fanmark_name text,
  access_type text,
  target_url text,
  text_content text,
  status text,
  is_password_protected boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
    RETURN QUERY
    SELECT
        f.id,
        f.emoji_combination,
        COALESCE(bc.fanmark_name, f.emoji_combination) as fanmark_name,
        COALESCE(bc.access_type, 'inactive') as access_type,
        rc.target_url,
        mc.content as text_content,
        f.status,
        COALESCE(pc.is_enabled, false) as is_password_protected
    FROM fanmarks f
    LEFT JOIN fanmark_basic_configs bc ON f.id = bc.fanmark_id
    LEFT JOIN fanmark_redirect_configs rc ON f.id = rc.fanmark_id
    LEFT JOIN fanmark_messageboard_configs mc ON f.id = mc.fanmark_id
    LEFT JOIN fanmark_password_configs pc ON f.id = pc.fanmark_id
    WHERE f.short_id = shortid_param
    AND f.status = 'active';
END;
$$;
```

### **学んだ教訓**

1. **DROP FUNCTION が必須**: 返り値の型を変更する場合
2. **normalized_emoji vs emoji_combination**: データベース検索に使うカラムの確認が重要
3. **権限設定**: 必要に応じて GRANT EXECUTE を追加

## 🚨 **よくあるエラーと解決策**

### **Error 1: 返り値型の変更エラー**
```
ERROR: 42P13: cannot change return type of existing function
DETAIL: Row type defined by OUT parameters is different.
HINT: Use DROP FUNCTION function_name(param_types) first.
```

**解決策**: 必ず `DROP FUNCTION IF EXISTS` を先に実行

### **Error 2: パラメータ型の不一致**
```
ERROR: function "function_name" already exists with same argument types
```

**解決策**: パラメータ型も含めて正確に指定
```sql
DROP FUNCTION IF EXISTS public.function_name(text);  -- 型も指定
```

### **Error 3: Migration適用されない**

**原因**:
- ファイル命名規則が間違っている
- GitHub-Supabase連携が機能していない

**解決策**:
1. Supabase CLIで正式なファイルを作成
2. 手動適用の場合はSupabase Dashboard SQL Editorを使用

## 📊 **Migration状況の確認方法**

### **CLI経由**
```bash
# Migration一覧
supabase migration list

# 現在の接続状況
supabase status

# リモートからスキーマを取得
supabase db pull
```

### **Dashboard経由**
1. **Database → Functions**: 関数の存在確認
2. **Database → Migrations**: migration履歴確認
3. **SQL Editor**: 直接クエリで確認

```sql
-- 関数の存在確認
SELECT routine_name, routine_type
FROM information_schema.routines
WHERE routine_name LIKE '%fanmark%'
ORDER BY routine_name;

-- テーブル構造確認
\d fanmarks

-- 関数の詳細確認
\df+ get_fanmark_by_short_id
```

## 🛠️ **デバッグ・トラブルシューティング**

### **Migration が適用されない場合**

1. **ファイル名確認**
   ```bash
   ls -la supabase/migrations/
   # 正しい形式: 20250927HHMMSS_{uuid}_description.sql
   ```

2. **GitHub連携確認**
   ```bash
   git log --oneline -5
   # 最新のcommitが反映されているか
   ```

3. **手動適用**
   ```sql
   -- Supabase Dashboard SQL Editor で直接実行
   ```

### **関数が動作しない場合**

1. **権限確認**
   ```sql
   -- 必要に応じて権限を付与
   GRANT EXECUTE ON FUNCTION public.function_name(text) TO anon;
   GRANT EXECUTE ON FUNCTION public.function_name(text) TO authenticated;
   ```

2. **パラメータ確認**
   ```sql
   -- 実際の呼び出しをテスト
   SELECT * FROM get_fanmark_by_short_id('test123');
   ```

3. **ログ確認**
   ```sql
   -- エラーログの確認
   SELECT * FROM pg_stat_statements WHERE query LIKE '%function_name%';
   ```

## 📋 **Migration作成チェックリスト**

### **作成前**
- [ ] 最新コードをpull: `git pull origin main`
- [ ] Supabase CLI接続確認: `supabase status`
- [ ] 既存の関連migrationを確認

### **作成時**
- [ ] `supabase migration new feature_name` でファイル作成
- [ ] 関数修正時は `DROP FUNCTION IF EXISTS` を追加
- [ ] 返り値型を明確に定義
- [ ] 必要な権限（GRANT）を設定
- [ ] コメントで変更内容を説明

### **テスト**
- [ ] SQL構文エラーがないか確認
- [ ] ローカルで適用テスト（可能であれば）
- [ ] 実際のアプリケーションで動作確認

### **デプロイ**
- [ ] `git add` で適切なファイルのみ追加
- [ ] 詳細なコミットメッセージ
- [ ] `git push origin main`
- [ ] Supabase Dashboardで反映確認

## 🎯 **ベストプラクティス**

### **関数作成時**
```sql
-- テンプレート
CREATE OR REPLACE FUNCTION public.function_name(param_name param_type)
RETURNS TABLE(
    -- 返り値を明確に定義
    id uuid,
    name text,
    created_at timestamp with time zone
)
LANGUAGE plpgsql
SECURITY DEFINER  -- セキュリティ設定
SET search_path = 'public'  -- スキーマ固定
AS $$
BEGIN
    -- バリデーション
    IF param_name IS NULL OR param_name = '' THEN
        RAISE EXCEPTION 'Parameter cannot be null or empty';
    END IF;

    -- メインクエリ
    RETURN QUERY
    SELECT
        t.id,
        t.name,
        t.created_at
    FROM table_name t
    WHERE t.field = param_name
    AND t.status = 'active';
END;
$$;

-- 権限設定
GRANT EXECUTE ON FUNCTION public.function_name(param_type) TO anon;
GRANT EXECUTE ON FUNCTION public.function_name(param_type) TO authenticated;
```

### **テーブル作成時**
```sql
-- テーブル作成
CREATE TABLE IF NOT EXISTS public.table_name (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL CHECK (length(name) >= 1),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),

    -- ユニーク制約
    CONSTRAINT table_name_unique_field UNIQUE (field_name)
);

-- インデックス
CREATE INDEX IF NOT EXISTS idx_table_name_user_id ON public.table_name(user_id);
CREATE INDEX IF NOT EXISTS idx_table_name_status ON public.table_name(status);

-- RLS有効化
ALTER TABLE public.table_name ENABLE ROW LEVEL SECURITY;

-- ポリシー作成
CREATE POLICY "Users can manage their own records"
ON public.table_name
FOR ALL
USING (auth.uid() = user_id);

-- トリガー（updated_at自動更新）
CREATE TRIGGER update_table_name_updated_at
    BEFORE UPDATE ON public.table_name
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();
```

---

*このガイドは実際のトラブルシューティング経験に基づいて作成されました。*

*最終更新: 2025-09-27*