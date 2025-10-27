-- Phase 1: RLSポリシー修正 - 現オーナーも抽選申込可能に

-- 既存のポリシーを削除
DROP POLICY IF EXISTS "Users can create entries for grace licenses" ON public.fanmark_lottery_entries;

-- 新しいポリシーを作成（現オーナーのチェックを削除）
CREATE POLICY "Users can create entries for grace licenses"
  ON public.fanmark_lottery_entries
  FOR INSERT
  WITH CHECK (
    auth.uid() = user_id AND
    EXISTS (
      SELECT 1 FROM public.fanmark_licenses fl
      WHERE fl.id = license_id
        AND fl.status = 'grace'
        AND fl.grace_expires_at > now()
    )
  );