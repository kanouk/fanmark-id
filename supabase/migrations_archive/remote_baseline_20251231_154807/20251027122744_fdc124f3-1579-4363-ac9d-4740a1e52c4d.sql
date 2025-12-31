-- ============================================
-- 抽選システム: テーブル作成とRLSポリシー
-- ============================================

-- 抽選申込テーブル
CREATE TABLE public.fanmark_lottery_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fanmark_id UUID NOT NULL REFERENCES public.fanmarks(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  license_id UUID NOT NULL REFERENCES public.fanmark_licenses(id) ON DELETE CASCADE,
  lottery_probability NUMERIC NOT NULL DEFAULT 1.0,
  entry_status TEXT NOT NULL DEFAULT 'pending',
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  lottery_executed_at TIMESTAMPTZ,
  won_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  cancellation_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT unique_fanmark_user_license UNIQUE (fanmark_id, user_id, license_id),
  CONSTRAINT valid_entry_status CHECK (entry_status IN ('pending', 'won', 'lost', 'cancelled', 'cancelled_by_extension')),
  CONSTRAINT valid_cancellation_reason CHECK (cancellation_reason IS NULL OR cancellation_reason IN ('user_request', 'license_extended', 'system')),
  CONSTRAINT positive_probability CHECK (lottery_probability > 0)
);

-- インデックス作成
CREATE INDEX idx_lottery_entries_fanmark_status ON public.fanmark_lottery_entries(fanmark_id, entry_status);
CREATE INDEX idx_lottery_entries_user_status ON public.fanmark_lottery_entries(user_id, entry_status);
CREATE INDEX idx_lottery_entries_license_status ON public.fanmark_lottery_entries(license_id, entry_status);

-- 抽選履歴テーブル
CREATE TABLE public.fanmark_lottery_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fanmark_id UUID NOT NULL REFERENCES public.fanmarks(id) ON DELETE CASCADE,
  license_id UUID NOT NULL REFERENCES public.fanmark_licenses(id) ON DELETE CASCADE,
  total_entries INTEGER NOT NULL,
  winner_user_id UUID,
  winner_entry_id UUID REFERENCES public.fanmark_lottery_entries(id),
  probability_distribution JSONB NOT NULL DEFAULT '[]'::jsonb,
  random_seed TEXT,
  executed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  execution_method TEXT NOT NULL DEFAULT 'automatic',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT valid_execution_method CHECK (execution_method IN ('automatic', 'manual'))
);

-- インデックス作成
CREATE INDEX idx_lottery_history_fanmark ON public.fanmark_lottery_history(fanmark_id);
CREATE INDEX idx_lottery_history_executed_at ON public.fanmark_lottery_history(executed_at DESC);

-- RLS有効化
ALTER TABLE public.fanmark_lottery_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fanmark_lottery_history ENABLE ROW LEVEL SECURITY;

-- ============================================
-- RLSポリシー: fanmark_lottery_entries
-- ============================================

-- ユーザーは自分のエントリーのみ閲覧可
CREATE POLICY "Users can view their own entries"
  ON public.fanmark_lottery_entries
  FOR SELECT
  USING (auth.uid() = user_id);

-- ユーザーはGrace期間中のライセンスに申込可能
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
        AND fl.user_id != auth.uid()
    )
  );

-- ユーザーは自分のpendingエントリーのみキャンセル可
CREATE POLICY "Users can cancel their pending entries"
  ON public.fanmark_lottery_entries
  FOR UPDATE
  USING (auth.uid() = user_id AND entry_status = 'pending')
  WITH CHECK (entry_status IN ('cancelled', 'pending'));

-- 管理者はすべてのエントリーを管理可能
CREATE POLICY "Admins can manage all lottery entries"
  ON public.fanmark_lottery_entries
  FOR ALL
  USING (is_admin());

-- ============================================
-- RLSポリシー: fanmark_lottery_history
-- ============================================

-- 管理者のみ抽選履歴を閲覧可能
CREATE POLICY "Admins can view lottery history"
  ON public.fanmark_lottery_history
  FOR SELECT
  USING (is_admin());

-- システムのみ履歴を作成可能（Edge Functionから）
CREATE POLICY "System can create lottery history"
  ON public.fanmark_lottery_history
  FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

-- ============================================
-- トリガー: updated_at自動更新
-- ============================================

CREATE TRIGGER update_lottery_entries_updated_at
  BEFORE UPDATE ON public.fanmark_lottery_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================
-- 監査ログトリガー
-- ============================================

CREATE OR REPLACE FUNCTION public.log_lottery_entry_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.audit_logs (
      user_id,
      action,
      resource_type,
      resource_id,
      metadata
    ) VALUES (
      NEW.user_id,
      'LOTTERY_ENTRY_CREATED',
      'fanmark_lottery_entry',
      NEW.id::text,
      jsonb_build_object(
        'fanmark_id', NEW.fanmark_id,
        'license_id', NEW.license_id,
        'lottery_probability', NEW.lottery_probability
      )
    );
  ELSIF TG_OP = 'UPDATE' AND OLD.entry_status != NEW.entry_status THEN
    INSERT INTO public.audit_logs (
      user_id,
      action,
      resource_type,
      resource_id,
      metadata
    ) VALUES (
      NEW.user_id,
      'LOTTERY_ENTRY_STATUS_CHANGED',
      'fanmark_lottery_entry',
      NEW.id::text,
      jsonb_build_object(
        'old_status', OLD.entry_status,
        'new_status', NEW.entry_status,
        'cancellation_reason', NEW.cancellation_reason
      )
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER audit_lottery_entry_changes
  AFTER INSERT OR UPDATE ON public.fanmark_lottery_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.log_lottery_entry_changes();