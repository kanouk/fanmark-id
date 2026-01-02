-- Email templates table for multi-language auth email customization
CREATE TABLE public.email_templates (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  email_type text NOT NULL,
  language text NOT NULL DEFAULT 'ja',
  subject text NOT NULL,
  body_text text NOT NULL,
  button_text text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(email_type, language)
);

-- Enable RLS
ALTER TABLE public.email_templates ENABLE ROW LEVEL SECURITY;

-- Only admins can manage templates
CREATE POLICY "Admins can manage email templates"
ON public.email_templates
FOR ALL
USING (is_admin())
WITH CHECK (is_admin());

-- System can read templates (for edge functions)
CREATE POLICY "System can read email templates"
ON public.email_templates
FOR SELECT
USING (auth.role() = 'service_role');

-- Add updated_at trigger
CREATE TRIGGER update_email_templates_updated_at
BEFORE UPDATE ON public.email_templates
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Insert default templates
INSERT INTO public.email_templates (email_type, language, subject, body_text, button_text) VALUES
-- Japanese
('signup', 'ja', 'Fanmark へようこそ！メールアドレスを確認してください', 'Fanmark へのご登録ありがとうございます。以下のボタンをクリックして、メールアドレスを確認してください。', '確認する'),
('recovery', 'ja', 'パスワードをリセット', 'パスワードリセットのリクエストを受け付けました。以下のボタンをクリックして、新しいパスワードを設定してください。', 'パスワードをリセット'),
('magiclink', 'ja', 'ログインリンク', 'ログインリンクをリクエストしました。以下のボタンをクリックしてログインしてください。', 'ログイン'),
('email_change', 'ja', 'メールアドレスの変更を確認', 'メールアドレスの変更リクエストを受け付けました。以下のボタンをクリックして確認してください。', '確認する'),
-- English
('signup', 'en', 'Welcome to Fanmark! Please verify your email', 'Thank you for signing up for Fanmark. Please click the button below to verify your email address.', 'Verify Email'),
('recovery', 'en', 'Reset Your Password', 'We received a password reset request. Click the button below to set a new password.', 'Reset Password'),
('magiclink', 'en', 'Your Login Link', 'You requested a login link. Click the button below to log in.', 'Log In'),
('email_change', 'en', 'Confirm Email Change', 'We received a request to change your email address. Click the button below to confirm.', 'Confirm'),
-- Korean
('signup', 'ko', 'Fanmark에 오신 것을 환영합니다! 이메일을 인증해 주세요', 'Fanmark에 가입해 주셔서 감사합니다. 아래 버튼을 클릭하여 이메일 주소를 인증해 주세요.', '인증하기'),
('recovery', 'ko', '비밀번호 재설정', '비밀번호 재설정 요청을 받았습니다. 아래 버튼을 클릭하여 새 비밀번호를 설정하세요.', '비밀번호 재설정'),
('magiclink', 'ko', '로그인 링크', '로그인 링크를 요청하셨습니다. 아래 버튼을 클릭하여 로그인하세요.', '로그인'),
('email_change', 'ko', '이메일 변경 확인', '이메일 주소 변경 요청을 받았습니다. 아래 버튼을 클릭하여 확인해 주세요.', '확인'),
-- Indonesian
('signup', 'id', 'Selamat Datang di Fanmark! Silakan verifikasi email Anda', 'Terima kasih telah mendaftar di Fanmark. Silakan klik tombol di bawah untuk memverifikasi alamat email Anda.', 'Verifikasi'),
('recovery', 'id', 'Reset Kata Sandi', 'Kami menerima permintaan reset kata sandi. Klik tombol di bawah untuk mengatur kata sandi baru.', 'Reset Kata Sandi'),
('magiclink', 'id', 'Tautan Masuk Anda', 'Anda meminta tautan masuk. Klik tombol di bawah untuk masuk.', 'Masuk'),
('email_change', 'id', 'Konfirmasi Perubahan Email', 'Kami menerima permintaan untuk mengubah alamat email Anda. Klik tombol di bawah untuk mengonfirmasi.', 'Konfirmasi');