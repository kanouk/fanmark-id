-- Update email templates to be more professional and trustworthy

-- Signup templates
UPDATE public.email_templates SET
  subject = '【Fanmark】メールアドレスの確認をお願いいたします',
  body_text = 'この度はFanmarkにご登録いただき、誠にありがとうございます。

アカウントの作成を完了するには、下記のボタンをクリックしてメールアドレスの確認を行ってください。

このリンクは24時間有効です。期限が切れた場合は、再度登録手続きを行ってください。',
  button_text = 'メールアドレスを確認する',
  updated_at = now()
WHERE email_type = 'signup' AND language = 'ja';

UPDATE public.email_templates SET
  subject = '[Fanmark] Please verify your email address',
  body_text = 'Thank you for signing up for Fanmark!

To complete your account registration, please click the button below to verify your email address.

This link is valid for 24 hours. If it expires, please restart the registration process.',
  button_text = 'Verify Email Address',
  updated_at = now()
WHERE email_type = 'signup' AND language = 'en';

UPDATE public.email_templates SET
  subject = '[Fanmark] 이메일 주소 인증을 부탁드립니다',
  body_text = 'Fanmark에 가입해 주셔서 감사합니다!

계정 등록을 완료하려면 아래 버튼을 클릭하여 이메일 주소를 인증해 주세요.

이 링크는 24시간 동안 유효합니다. 만료된 경우 다시 등록 절차를 진행해 주세요.',
  button_text = '이메일 주소 인증하기',
  updated_at = now()
WHERE email_type = 'signup' AND language = 'ko';

UPDATE public.email_templates SET
  subject = '[Fanmark] Silakan verifikasi alamat email Anda',
  body_text = 'Terima kasih telah mendaftar di Fanmark!

Untuk menyelesaikan pendaftaran akun Anda, silakan klik tombol di bawah untuk memverifikasi alamat email Anda.

Tautan ini berlaku selama 24 jam. Jika sudah kedaluwarsa, silakan ulangi proses pendaftaran.',
  button_text = 'Verifikasi Alamat Email',
  updated_at = now()
WHERE email_type = 'signup' AND language = 'id';

-- Recovery templates
UPDATE public.email_templates SET
  subject = '【Fanmark】パスワード再設定のご案内',
  body_text = 'パスワード再設定のリクエストを承りました。

下記のボタンをクリックして、新しいパスワードを設定してください。

このリンクは1時間有効です。期限が切れた場合は、再度パスワード再設定をリクエストしてください。

※ このリクエストに心当たりがない場合は、このメールを無視してください。アカウントは安全な状態で保護されています。',
  button_text = 'パスワードを再設定する',
  updated_at = now()
WHERE email_type = 'recovery' AND language = 'ja';

UPDATE public.email_templates SET
  subject = '[Fanmark] Password Reset Request',
  body_text = 'We received a request to reset your password.

Please click the button below to set a new password.

This link is valid for 1 hour. If it expires, please request a new password reset.

If you didn''t request this, you can safely ignore this email. Your account remains secure.',
  button_text = 'Reset Password',
  updated_at = now()
WHERE email_type = 'recovery' AND language = 'en';

UPDATE public.email_templates SET
  subject = '[Fanmark] 비밀번호 재설정 안내',
  body_text = '비밀번호 재설정 요청을 받았습니다.

아래 버튼을 클릭하여 새 비밀번호를 설정해 주세요.

이 링크는 1시간 동안 유효합니다. 만료된 경우 다시 비밀번호 재설정을 요청해 주세요.

※ 이 요청을 하지 않으셨다면 이 이메일을 무시하셔도 됩니다. 계정은 안전하게 보호되고 있습니다.',
  button_text = '비밀번호 재설정하기',
  updated_at = now()
WHERE email_type = 'recovery' AND language = 'ko';

UPDATE public.email_templates SET
  subject = '[Fanmark] Permintaan Reset Kata Sandi',
  body_text = 'Kami menerima permintaan untuk mereset kata sandi Anda.

Silakan klik tombol di bawah untuk mengatur kata sandi baru.

Tautan ini berlaku selama 1 jam. Jika sudah kedaluwarsa, silakan minta reset kata sandi baru.

Jika Anda tidak meminta ini, Anda dapat mengabaikan email ini. Akun Anda tetap aman.',
  button_text = 'Reset Kata Sandi',
  updated_at = now()
WHERE email_type = 'recovery' AND language = 'id';

-- Magic link templates
UPDATE public.email_templates SET
  subject = '【Fanmark】ログインリンクのご案内',
  body_text = 'ログインリンクをリクエストいただきありがとうございます。

下記のボタンをクリックして、Fanmarkにログインしてください。

このリンクは15分間有効です。期限が切れた場合は、再度ログインをリクエストしてください。

※ セキュリティ上の理由により、このリンクは一度のみ使用可能です。',
  button_text = 'ログインする',
  updated_at = now()
WHERE email_type = 'magiclink' AND language = 'ja';

UPDATE public.email_templates SET
  subject = '[Fanmark] Your Login Link',
  body_text = 'Thank you for requesting a login link.

Please click the button below to log in to Fanmark.

This link is valid for 15 minutes. If it expires, please request a new login link.

For security reasons, this link can only be used once.',
  button_text = 'Log In',
  updated_at = now()
WHERE email_type = 'magiclink' AND language = 'en';

UPDATE public.email_templates SET
  subject = '[Fanmark] 로그인 링크 안내',
  body_text = '로그인 링크를 요청해 주셔서 감사합니다.

아래 버튼을 클릭하여 Fanmark에 로그인하세요.

이 링크는 15분 동안 유효합니다. 만료된 경우 다시 로그인 링크를 요청해 주세요.

※ 보안상의 이유로 이 링크는 한 번만 사용할 수 있습니다.',
  button_text = '로그인하기',
  updated_at = now()
WHERE email_type = 'magiclink' AND language = 'ko';

UPDATE public.email_templates SET
  subject = '[Fanmark] Tautan Masuk Anda',
  body_text = 'Terima kasih telah meminta tautan masuk.

Silakan klik tombol di bawah untuk masuk ke Fanmark.

Tautan ini berlaku selama 15 menit. Jika sudah kedaluwarsa, silakan minta tautan masuk baru.

Demi keamanan, tautan ini hanya dapat digunakan sekali.',
  button_text = 'Masuk',
  updated_at = now()
WHERE email_type = 'magiclink' AND language = 'id';

-- Email change templates
UPDATE public.email_templates SET
  subject = '【Fanmark】メールアドレス変更の確認',
  body_text = 'メールアドレス変更のリクエストを承りました。

下記のボタンをクリックして、新しいメールアドレスを確認してください。

このリンクは24時間有効です。

※ このリクエストに心当たりがない場合は、アカウントのセキュリティを確認してください。',
  button_text = 'メールアドレスを確認する',
  updated_at = now()
WHERE email_type = 'email_change' AND language = 'ja';

UPDATE public.email_templates SET
  subject = '[Fanmark] Confirm Your Email Change',
  body_text = 'We received a request to change your email address.

Please click the button below to confirm your new email address.

This link is valid for 24 hours.

If you didn''t request this, please check your account security.',
  button_text = 'Confirm Email Address',
  updated_at = now()
WHERE email_type = 'email_change' AND language = 'en';

UPDATE public.email_templates SET
  subject = '[Fanmark] 이메일 주소 변경 확인',
  body_text = '이메일 주소 변경 요청을 받았습니다.

아래 버튼을 클릭하여 새 이메일 주소를 확인해 주세요.

이 링크는 24시간 동안 유효합니다.

※ 이 요청을 하지 않으셨다면 계정 보안을 확인해 주세요.',
  button_text = '이메일 주소 확인하기',
  updated_at = now()
WHERE email_type = 'email_change' AND language = 'ko';

UPDATE public.email_templates SET
  subject = '[Fanmark] Konfirmasi Perubahan Email Anda',
  body_text = 'Kami menerima permintaan untuk mengubah alamat email Anda.

Silakan klik tombol di bawah untuk mengonfirmasi alamat email baru Anda.

Tautan ini berlaku selama 24 jam.

Jika Anda tidak meminta ini, silakan periksa keamanan akun Anda.',
  button_text = 'Konfirmasi Alamat Email',
  updated_at = now()
WHERE email_type = 'email_change' AND language = 'id';