-- Update Japanese email templates to use ファンマID instead of Fanmark

UPDATE public.email_templates SET
  subject = '【ファンマID】メールアドレスの確認をお願いいたします',
  body_text = 'この度はファンマIDにご登録いただき、誠にありがとうございます。

アカウントの作成を完了するには、下記のボタンをクリックしてメールアドレスの確認を行ってください。

このリンクは24時間有効です。期限が切れた場合は、再度登録手続きを行ってください。',
  updated_at = now()
WHERE email_type = 'signup' AND language = 'ja';

UPDATE public.email_templates SET
  subject = '【ファンマID】パスワード再設定のご案内',
  updated_at = now()
WHERE email_type = 'recovery' AND language = 'ja';

UPDATE public.email_templates SET
  subject = '【ファンマID】ログインリンクのご案内',
  body_text = 'ログインリンクをリクエストいただきありがとうございます。

下記のボタンをクリックして、ファンマIDにログインしてください。

このリンクは15分間有効です。期限が切れた場合は、再度ログインをリクエストしてください。

※ セキュリティ上の理由により、このリンクは一度のみ使用可能です。',
  updated_at = now()
WHERE email_type = 'magiclink' AND language = 'ja';

UPDATE public.email_templates SET
  subject = '【ファンマID】メールアドレス変更の確認',
  updated_at = now()
WHERE email_type = 'email_change' AND language = 'ja';