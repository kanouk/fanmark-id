-- Create broadcast_emails table for tracking bulk email history
CREATE TABLE public.broadcast_emails (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  subject TEXT NOT NULL,
  body_text TEXT NOT NULL,
  email_type TEXT NOT NULL DEFAULT 'broadcast_announcement',
  recipient_filter JSONB DEFAULT '{}'::jsonb,
  total_recipients INTEGER DEFAULT 0,
  sent_count INTEGER DEFAULT 0,
  failed_count INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft',
  created_by UUID REFERENCES auth.users(id),
  scheduled_at TIMESTAMP WITH TIME ZONE,
  started_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,
  error_details JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Add constraint for status values
ALTER TABLE public.broadcast_emails 
ADD CONSTRAINT broadcast_emails_status_check 
CHECK (status IN ('draft', 'scheduled', 'sending', 'completed', 'failed', 'cancelled'));

-- Enable RLS
ALTER TABLE public.broadcast_emails ENABLE ROW LEVEL SECURITY;

-- Only admins can manage broadcast emails
CREATE POLICY "Admins can manage broadcast emails"
ON public.broadcast_emails
FOR ALL
USING (is_admin())
WITH CHECK (is_admin());

-- Create updated_at trigger
CREATE TRIGGER update_broadcast_emails_updated_at
BEFORE UPDATE ON public.broadcast_emails
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Add index for status queries
CREATE INDEX idx_broadcast_emails_status ON public.broadcast_emails(status);
CREATE INDEX idx_broadcast_emails_created_at ON public.broadcast_emails(created_at DESC);

-- Insert broadcast email templates into email_templates
INSERT INTO public.email_templates (email_type, language, subject, body_text, button_text, is_active)
VALUES
  -- Japanese broadcast templates
  ('broadcast_maintenance', 'ja', '【Fanmark】メンテナンスのお知らせ', 'いつもFanmarkをご利用いただきありがとうございます。\n\n下記の日程でシステムメンテナンスを実施いたします。\n\nメンテナンス中はサービスをご利用いただけません。ご不便をおかけしますが、ご理解のほどよろしくお願いいたします。', '詳細を確認', true),
  ('broadcast_announcement', 'ja', '【Fanmark】重要なお知らせ', 'いつもFanmarkをご利用いただきありがとうございます。\n\n重要なお知らせがございます。', '詳細を確認', true),
  ('broadcast_security', 'ja', '【Fanmark】セキュリティに関するお知らせ', 'いつもFanmarkをご利用いただきありがとうございます。\n\nセキュリティに関する重要なお知らせがございます。', '詳細を確認', true),
  
  -- English broadcast templates
  ('broadcast_maintenance', 'en', '[Fanmark] Scheduled Maintenance Notice', 'Thank you for using Fanmark.\n\nWe will be performing scheduled maintenance during the following period.\n\nThe service will be temporarily unavailable during this time. We apologize for any inconvenience.', 'View Details', true),
  ('broadcast_announcement', 'en', '[Fanmark] Important Announcement', 'Thank you for using Fanmark.\n\nWe have an important announcement for you.', 'View Details', true),
  ('broadcast_security', 'en', '[Fanmark] Security Notice', 'Thank you for using Fanmark.\n\nWe have an important security-related announcement.', 'View Details', true),
  
  -- Korean broadcast templates
  ('broadcast_maintenance', 'ko', '[Fanmark] 점검 안내', 'Fanmark를 이용해 주셔서 감사합니다.\n\n아래 일정으로 시스템 점검을 실시합니다.\n\n점검 중에는 서비스를 이용하실 수 없습니다. 불편을 드려 죄송합니다.', '자세히 보기', true),
  ('broadcast_announcement', 'ko', '[Fanmark] 중요 공지', 'Fanmark를 이용해 주셔서 감사합니다.\n\n중요한 공지사항이 있습니다.', '자세히 보기', true),
  ('broadcast_security', 'ko', '[Fanmark] 보안 관련 공지', 'Fanmark를 이용해 주셔서 감사합니다.\n\n보안 관련 중요한 공지사항이 있습니다.', '자세히 보기', true),
  
  -- Indonesian broadcast templates
  ('broadcast_maintenance', 'id', '[Fanmark] Pemberitahuan Pemeliharaan', 'Terima kasih telah menggunakan Fanmark.\n\nKami akan melakukan pemeliharaan terjadwal pada periode berikut.\n\nLayanan akan tidak tersedia sementara selama waktu ini. Mohon maaf atas ketidaknyamanannya.', 'Lihat Detail', true),
  ('broadcast_announcement', 'id', '[Fanmark] Pengumuman Penting', 'Terima kasih telah menggunakan Fanmark.\n\nKami memiliki pengumuman penting untuk Anda.', 'Lihat Detail', true),
  ('broadcast_security', 'id', '[Fanmark] Pemberitahuan Keamanan', 'Terima kasih telah menggunakan Fanmark.\n\nKami memiliki pengumuman penting terkait keamanan.', 'Lihat Detail', true)
ON CONFLICT DO NOTHING;