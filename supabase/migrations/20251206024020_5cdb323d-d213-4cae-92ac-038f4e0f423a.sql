-- =====================================================
-- Phase 1: Analytics Tables Migration
-- =====================================================

-- 1. fanmark_access_logs テーブル（生ログ）
CREATE TABLE public.fanmark_access_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fanmark_id uuid REFERENCES public.fanmarks(id) ON DELETE CASCADE NOT NULL,
  license_id uuid REFERENCES public.fanmark_licenses(id) ON DELETE SET NULL,
  accessed_at timestamptz DEFAULT now() NOT NULL,
  referrer text,
  referrer_domain text,
  referrer_category text, -- 'direct', 'search', 'social', 'other'
  user_agent text,
  device_type text, -- 'mobile', 'tablet', 'desktop'
  browser text,
  os text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  visitor_hash text -- プライバシー考慮のハッシュ化された訪問者ID
);

-- インデックス
CREATE INDEX idx_access_logs_fanmark_id ON public.fanmark_access_logs(fanmark_id);
CREATE INDEX idx_access_logs_accessed_at ON public.fanmark_access_logs(accessed_at);
CREATE INDEX idx_access_logs_fanmark_date ON public.fanmark_access_logs(fanmark_id, accessed_at);
CREATE INDEX idx_access_logs_visitor_hash ON public.fanmark_access_logs(visitor_hash, accessed_at);

-- 2. fanmark_access_daily_stats テーブル（日次集計）
CREATE TABLE public.fanmark_access_daily_stats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fanmark_id uuid REFERENCES public.fanmarks(id) ON DELETE CASCADE NOT NULL,
  license_id uuid REFERENCES public.fanmark_licenses(id) ON DELETE SET NULL,
  stat_date date NOT NULL,
  access_count integer DEFAULT 0,
  unique_visitors integer DEFAULT 0,
  -- リファラー別
  referrer_direct integer DEFAULT 0,
  referrer_search integer DEFAULT 0,
  referrer_social integer DEFAULT 0,
  referrer_other integer DEFAULT 0,
  -- デバイス別
  device_mobile integer DEFAULT 0,
  device_tablet integer DEFAULT 0,
  device_desktop integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(fanmark_id, stat_date)
);

-- インデックス
CREATE INDEX idx_daily_stats_fanmark_date ON public.fanmark_access_daily_stats(fanmark_id, stat_date);

-- =====================================================
-- RLS Policies
-- =====================================================

-- fanmark_access_logs RLS
ALTER TABLE public.fanmark_access_logs ENABLE ROW LEVEL SECURITY;

-- 所有者のみ閲覧可能
CREATE POLICY "Owners can view their fanmark access logs"
  ON public.fanmark_access_logs FOR SELECT
  USING (
    fanmark_id IN (
      SELECT fl.fanmark_id FROM public.fanmark_licenses fl
      WHERE fl.user_id = auth.uid()
    )
  );

-- fanmark_access_daily_stats RLS
ALTER TABLE public.fanmark_access_daily_stats ENABLE ROW LEVEL SECURITY;

-- 所有者のみ閲覧可能
CREATE POLICY "Owners can view their fanmark daily stats"
  ON public.fanmark_access_daily_stats FOR SELECT
  USING (
    fanmark_id IN (
      SELECT fl.fanmark_id FROM public.fanmark_licenses fl
      WHERE fl.user_id = auth.uid()
    )
  );