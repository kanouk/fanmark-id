-- 既存の孤立したuser_idをNULLに設定（安全措置）
UPDATE public.fanmark_licenses
SET user_id = NULL
WHERE user_id NOT IN (SELECT id FROM auth.users);

-- 外部キー制約を追加（ユーザー削除時にuser_idをNULLに設定）
ALTER TABLE public.fanmark_licenses
ADD CONSTRAINT fanmark_licenses_user_id_fkey
FOREIGN KEY (user_id)
REFERENCES auth.users(id)
ON DELETE SET NULL;

-- インデックスを追加してパフォーマンス向上
CREATE INDEX IF NOT EXISTS idx_fanmark_licenses_user_id
ON public.fanmark_licenses(user_id)
WHERE user_id IS NOT NULL;

-- 監査ログにコメント追加
COMMENT ON CONSTRAINT fanmark_licenses_user_id_fkey ON public.fanmark_licenses IS 
'Ensures user_id references valid auth users. Sets to NULL on user deletion to preserve license history.';