-- Staging-only auth email master data; no accounts, preferences, or email delivery state.
-- Source rows were read from the exact allowlisted auth email template types.
-- Existing target IDs are left unchanged; inspect exact uniqueness before applying.
INSERT INTO email_templates (id, email_type, language, subject, body_text, button_text, is_active, created_at, updated_at) VALUES
  ('8aeb45ee-f40a-4de1-9f08-8c4807459681', 'email_change', 'en', '[Fanmark] Confirm Your Email Change', 'We received a request to change your email address.

Please click the button below to confirm your new email address.

This link is valid for 24 hours.

If you didn''t request this, please check your account security.', 'Confirm Email Address', '1', '2026-01-02 12:32:58.206454+00', '2026-01-02 21:56:21.064819+00'),
  ('a87ee92c-3392-4a84-b765-f5c12bf0cdac', 'email_change', 'id', '[Fanmark] Konfirmasi Perubahan Email Anda', 'Kami menerima permintaan untuk mengubah alamat email Anda.

Silakan klik tombol di bawah untuk mengonfirmasi alamat email baru Anda.

Tautan ini berlaku selama 24 jam.

Jika Anda tidak meminta ini, silakan periksa keamanan akun Anda.', 'Konfirmasi Alamat Email', '1', '2026-01-02 12:32:58.206454+00', '2026-01-02 21:56:21.064819+00'),
  ('72531565-c2a2-4e13-9417-9556d7478fbf', 'email_change', 'ja', '【ファンマID】メールアドレス変更の確認', 'メールアドレス変更のリクエストを承りました。

下記のボタンをクリックして、新しいメールアドレスを確認してください。

このリンクは24時間有効です。

※ このリクエストに心当たりがない場合は、アカウントのセキュリティを確認してください。', 'メールアドレスを確認する', '1', '2026-01-02 12:32:58.206454+00', '2026-01-02 21:56:21.064819+00'),
  ('2a982bd3-86ab-4865-88c2-230b7fa8eb9a', 'email_change', 'ko', '[Fanmark] 이메일 주소 변경 확인', '이메일 주소 변경 요청을 받았습니다.

아래 버튼을 클릭하여 새 이메일 주소를 확인해 주세요.

이 링크는 24시간 동안 유효합니다.

※ 이 요청을 하지 않으셨다면 계정 보안을 확인해 주세요.', '이메일 주소 확인하기', '1', '2026-01-02 12:32:58.206454+00', '2026-01-02 21:56:21.064819+00'),
  ('1e94afd8-5fbe-47ab-a78b-d1d954e168e3', 'magiclink', 'en', '[Fanmark] Your Login Link', 'Thank you for requesting a login link.

Please click the button below to log in to Fanmark.

This link is valid for 15 minutes. If it expires, please request a new login link.

For security reasons, this link can only be used once.', 'Log In', '1', '2026-01-02 12:32:58.206454+00', '2026-01-02 21:56:21.064819+00'),
  ('702cfbde-7ea7-4667-8373-62b8100a9431', 'magiclink', 'id', '[Fanmark] Tautan Masuk Anda', 'Terima kasih telah meminta tautan masuk.

Silakan klik tombol di bawah untuk masuk ke Fanmark.

Tautan ini berlaku selama 15 menit. Jika sudah kedaluwarsa, silakan minta tautan masuk baru.

Demi keamanan, tautan ini hanya dapat digunakan sekali.', 'Masuk', '1', '2026-01-02 12:32:58.206454+00', '2026-01-02 21:56:21.064819+00'),
  ('1ff036d6-cafa-4435-887a-373eaf0da4b4', 'magiclink', 'ja', '【ファンマID】ログインリンクのご案内', 'ログインリンクをリクエストいただきありがとうございます。

下記のボタンをクリックして、ファンマIDにログインしてください。

このリンクは15分間有効です。期限が切れた場合は、再度ログインをリクエストしてください。

※ セキュリティ上の理由により、このリンクは一度のみ使用可能です。', 'ログインする', '1', '2026-01-02 12:32:58.206454+00', '2026-01-02 21:56:21.064819+00'),
  ('7216f8cb-296d-4003-81aa-92dadc9d2dc4', 'magiclink', 'ko', '[Fanmark] 로그인 링크 안내', '로그인 링크를 요청해 주셔서 감사합니다.

아래 버튼을 클릭하여 Fanmark에 로그인하세요.

이 링크는 15분 동안 유효합니다. 만료된 경우 다시 로그인 링크를 요청해 주세요.

※ 보안상의 이유로 이 링크는 한 번만 사용할 수 있습니다.', '로그인하기', '1', '2026-01-02 12:32:58.206454+00', '2026-01-02 21:56:21.064819+00'),
  ('4ddb440e-0f15-4f00-aba1-5e63a5af683a', 'recovery', 'en', '[Fanmark] Password Reset Request', 'We received a request to reset your password.

Please click the button below to set a new password.

This link is valid for 1 hour. If it expires, please request a new password reset.

If you didn''t request this, you can safely ignore this email. Your account remains secure.', 'Reset Password', '1', '2026-01-02 12:32:58.206454+00', '2026-01-02 21:56:21.064819+00'),
  ('d4632d96-315b-4529-9de6-59f01e631b70', 'recovery', 'id', '[Fanmark] Permintaan Reset Kata Sandi', 'Kami menerima permintaan untuk mereset kata sandi Anda.

Silakan klik tombol di bawah untuk mengatur kata sandi baru.

Tautan ini berlaku selama 1 jam. Jika sudah kedaluwarsa, silakan minta reset kata sandi baru.

Jika Anda tidak meminta ini, Anda dapat mengabaikan email ini. Akun Anda tetap aman.', 'Reset Kata Sandi', '1', '2026-01-02 12:32:58.206454+00', '2026-01-02 21:56:21.064819+00'),
  ('fa9ae032-9975-4afe-9615-c6f132cb79f2', 'recovery', 'ja', '【ファンマID】パスワード再設定のご案内', 'パスワード再設定のリクエストを承りました。

下記のボタンをクリックして、新しいパスワードを設定してください。

このリンクは1時間有効です。期限が切れた場合は、再度パスワード再設定をリクエストしてください。

※ このリクエストに心当たりがない場合は、このメールを無視してください。アカウントは安全な状態で保護されています。', 'パスワードを再設定する', '1', '2026-01-02 12:32:58.206454+00', '2026-01-02 21:56:21.064819+00'),
  ('c779475a-2baf-4ed2-908d-40fde6c90962', 'recovery', 'ko', '[Fanmark] 비밀번호 재설정 안내', '비밀번호 재설정 요청을 받았습니다.

아래 버튼을 클릭하여 새 비밀번호를 설정해 주세요.

이 링크는 1시간 동안 유효합니다. 만료된 경우 다시 비밀번호 재설정을 요청해 주세요.

※ 이 요청을 하지 않으셨다면 이 이메일을 무시하셔도 됩니다. 계정은 안전하게 보호되고 있습니다.', '비밀번호 재설정하기', '1', '2026-01-02 12:32:58.206454+00', '2026-01-02 21:56:21.064819+00'),
  ('c58060b1-a446-4ac7-b268-0f4005a93c16', 'signup', 'en', '[Fanmark] Please verify your email address', 'Thank you for signing up for Fanmark!

To complete your account registration, please click the button below to verify your email address.

This link is valid for 24 hours. If it expires, please restart the registration process.', 'Verify Email Address', '1', '2026-01-02 12:32:58.206454+00', '2026-01-02 21:56:21.064819+00'),
  ('4e0c4972-2ee1-49fb-9cc2-2eb4b3e91f2c', 'signup', 'id', '[Fanmark] Silakan verifikasi alamat email Anda', 'Terima kasih telah mendaftar di Fanmark!

Untuk menyelesaikan pendaftaran akun Anda, silakan klik tombol di bawah untuk memverifikasi alamat email Anda.

Tautan ini berlaku selama 24 jam. Jika sudah kedaluwarsa, silakan ulangi proses pendaftaran.', 'Verifikasi Alamat Email', '1', '2026-01-02 12:32:58.206454+00', '2026-01-02 21:56:21.064819+00'),
  ('1dad455e-1662-40ed-995d-6bcb3504f4bd', 'signup', 'ja', '【ファンマID】メールアドレスの確認をお願いいたします', 'この度はファンマIDにご登録いただき、誠にありがとうございます。

アカウントの作成を完了するには、下記のボタンをクリックしてメールアドレスの確認を行ってください。

このリンクは24時間有効です。期限が切れた場合は、再度登録手続きを行ってください。', 'メールアドレスを確認する', '1', '2026-01-02 12:32:58.206454+00', '2026-01-02 21:56:21.064819+00'),
  ('dddb4e37-7e69-45ab-adff-8543392e856c', 'signup', 'ko', '[Fanmark] 이메일 주소 인증을 부탁드립니다', 'Fanmark에 가입해 주셔서 감사합니다!

계정 등록을 완료하려면 아래 버튼을 클릭하여 이메일 주소를 인증해 주세요.

이 링크는 24시간 동안 유효합니다. 만료된 경우 다시 등록 절차를 진행해 주세요.', '이메일 주소 인증하기', '1', '2026-01-02 12:32:58.206454+00', '2026-01-02 21:56:21.064819+00')
ON CONFLICT(id) DO NOTHING;
