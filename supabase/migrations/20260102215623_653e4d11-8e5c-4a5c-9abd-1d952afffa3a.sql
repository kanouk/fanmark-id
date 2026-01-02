-- Phase 1: Populate email_templates with existing fallbackTranslations
-- This ensures send-auth-email will use DB templates instead of hardcoded fallbacks

-- Signup templates (4 languages)
INSERT INTO public.email_templates (email_type, language, subject, body_text, button_text, is_active) VALUES
('signup', 'ja', '【ファンマID】メールアドレスの確認をお願いいたします', 'この度はファンマIDにご登録いただき、誠にありがとうございます。

アカウントの作成を完了するには、下記のボタンをクリックしてメールアドレスの確認を行ってください。

このリンクは24時間有効です。期限が切れた場合は、再度登録手続きを行ってください。', 'メールアドレスを確認する', true),

('signup', 'en', '[Fanmark] Please verify your email address', 'Thank you for signing up for Fanmark!

To complete your account registration, please click the button below to verify your email address.

This link is valid for 24 hours. If it expires, please restart the registration process.', 'Verify Email Address', true),

('signup', 'ko', '[Fanmark] 이메일 주소 인증을 부탁드립니다', 'Fanmark에 가입해 주셔서 감사합니다!

계정 등록을 완료하려면 아래 버튼을 클릭하여 이메일 주소를 인증해 주세요.

이 링크는 24시간 동안 유효합니다. 만료된 경우 다시 등록 절차를 진행해 주세요.', '이메일 주소 인증하기', true),

('signup', 'id', '[Fanmark] Silakan verifikasi alamat email Anda', 'Terima kasih telah mendaftar di Fanmark!

Untuk menyelesaikan pendaftaran akun Anda, silakan klik tombol di bawah untuk memverifikasi alamat email Anda.

Tautan ini berlaku selama 24 jam. Jika sudah kedaluwarsa, silakan ulangi proses pendaftaran.', 'Verifikasi Alamat Email', true),

-- Recovery templates (4 languages)
('recovery', 'ja', '【ファンマID】パスワード再設定のご案内', 'パスワード再設定のリクエストを承りました。

下記のボタンをクリックして、新しいパスワードを設定してください。

このリンクは1時間有効です。期限が切れた場合は、再度パスワード再設定をリクエストしてください。

※ このリクエストに心当たりがない場合は、このメールを無視してください。アカウントは安全な状態で保護されています。', 'パスワードを再設定する', true),

('recovery', 'en', '[Fanmark] Password Reset Request', 'We received a request to reset your password.

Please click the button below to set a new password.

This link is valid for 1 hour. If it expires, please request a new password reset.

If you didn''t request this, you can safely ignore this email. Your account remains secure.', 'Reset Password', true),

('recovery', 'ko', '[Fanmark] 비밀번호 재설정 안내', '비밀번호 재설정 요청을 받았습니다.

아래 버튼을 클릭하여 새 비밀번호를 설정해 주세요.

이 링크는 1시간 동안 유효합니다. 만료된 경우 다시 비밀번호 재설정을 요청해 주세요.

※ 이 요청을 하지 않으셨다면 이 이메일을 무시하셔도 됩니다. 계정은 안전하게 보호되고 있습니다.', '비밀번호 재설정하기', true),

('recovery', 'id', '[Fanmark] Permintaan Reset Kata Sandi', 'Kami menerima permintaan untuk mereset kata sandi Anda.

Silakan klik tombol di bawah untuk mengatur kata sandi baru.

Tautan ini berlaku selama 1 jam. Jika sudah kedaluwarsa, silakan minta reset kata sandi baru.

Jika Anda tidak meminta ini, Anda dapat mengabaikan email ini. Akun Anda tetap aman.', 'Reset Kata Sandi', true),

-- Magiclink templates (4 languages)
('magiclink', 'ja', '【ファンマID】ログインリンクのご案内', 'ログインリンクをリクエストいただきありがとうございます。

下記のボタンをクリックして、ファンマIDにログインしてください。

このリンクは15分間有効です。期限が切れた場合は、再度ログインをリクエストしてください。

※ セキュリティ上の理由により、このリンクは一度のみ使用可能です。', 'ログインする', true),

('magiclink', 'en', '[Fanmark] Your Login Link', 'Thank you for requesting a login link.

Please click the button below to log in to Fanmark.

This link is valid for 15 minutes. If it expires, please request a new login link.

For security reasons, this link can only be used once.', 'Log In', true),

('magiclink', 'ko', '[Fanmark] 로그인 링크 안내', '로그인 링크를 요청해 주셔서 감사합니다.

아래 버튼을 클릭하여 Fanmark에 로그인하세요.

이 링크는 15분 동안 유효합니다. 만료된 경우 다시 로그인 링크를 요청해 주세요.

※ 보안상의 이유로 이 링크는 한 번만 사용할 수 있습니다.', '로그인하기', true),

('magiclink', 'id', '[Fanmark] Tautan Masuk Anda', 'Terima kasih telah meminta tautan masuk.

Silakan klik tombol di bawah untuk masuk ke Fanmark.

Tautan ini berlaku selama 15 menit. Jika sudah kedaluwarsa, silakan minta tautan masuk baru.

Demi keamanan, tautan ini hanya dapat digunakan sekali.', 'Masuk', true),

-- Email change templates (4 languages)
('email_change', 'ja', '【ファンマID】メールアドレス変更の確認', 'メールアドレス変更のリクエストを承りました。

下記のボタンをクリックして、新しいメールアドレスを確認してください。

このリンクは24時間有効です。

※ このリクエストに心当たりがない場合は、アカウントのセキュリティを確認してください。', 'メールアドレスを確認する', true),

('email_change', 'en', '[Fanmark] Confirm Your Email Change', 'We received a request to change your email address.

Please click the button below to confirm your new email address.

This link is valid for 24 hours.

If you didn''t request this, please check your account security.', 'Confirm Email Address', true),

('email_change', 'ko', '[Fanmark] 이메일 주소 변경 확인', '이메일 주소 변경 요청을 받았습니다.

아래 버튼을 클릭하여 새 이메일 주소를 확인해 주세요.

이 링크는 24시간 동안 유효합니다.

※ 이 요청을 하지 않으셨다면 계정 보안을 확인해 주세요.', '이메일 주소 확인하기', true),

('email_change', 'id', '[Fanmark] Konfirmasi Perubahan Email Anda', 'Kami menerima permintaan untuk mengubah alamat email Anda.

Silakan klik tombol di bawah untuk mengonfirmasi alamat email baru Anda.

Tautan ini berlaku selama 24 jam.

Jika Anda tidak meminta ini, silakan periksa keamanan akun Anda.', 'Konfirmasi Alamat Email', true)

ON CONFLICT (email_type, language) DO UPDATE SET
  subject = EXCLUDED.subject,
  body_text = EXCLUDED.body_text,
  button_text = EXCLUDED.button_text,
  is_active = true,
  updated_at = now();