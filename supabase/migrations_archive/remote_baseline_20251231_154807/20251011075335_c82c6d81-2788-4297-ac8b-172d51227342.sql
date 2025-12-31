-- ============================================
-- セキュリティ強化: 価格情報の非公開化
-- ============================================

-- 1. 価格情報とビジネスルールを非公開に設定
UPDATE system_settings 
SET is_public = false 
WHERE setting_key IN (
  'premium_pricing',
  'business_pricing', 
  'enterprise_pricing',
  'creator_fanmarks_limit',
  'business_fanmarks_limit',
  'enterprise_fanmarks_limit',
  'max_fanmarks_per_user'
);

-- 2. 管理者用RLSポリシーの追加
CREATE POLICY "Admins can view all settings"
ON system_settings
FOR SELECT
TO authenticated
USING (is_admin());

CREATE POLICY "Admins can update all settings"  
ON system_settings
FOR UPDATE
TO authenticated
USING (is_admin())
WITH CHECK (is_admin());

-- 3. ファンマークプロフィールのセキュリティ強化
DROP POLICY IF EXISTS "Users can view public profiles or their own profiles" ON fanmark_profiles;

CREATE POLICY "Authenticated users can view public profiles or own"
ON fanmark_profiles
FOR SELECT
TO authenticated
USING (
  is_public = true 
  OR EXISTS (
    SELECT 1 FROM fanmark_licenses fl
    WHERE fl.id = fanmark_profiles.license_id 
      AND fl.user_id = auth.uid()
  )
);