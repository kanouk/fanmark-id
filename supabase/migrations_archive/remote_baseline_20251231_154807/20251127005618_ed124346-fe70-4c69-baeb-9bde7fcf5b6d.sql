-- 1. fanmark.id@gmail.com に admin ロールを追加
INSERT INTO user_roles (user_id, role)
VALUES ('962dbc8b-442b-42ff-96de-ec9b48d94610', 'admin')
ON CONFLICT (user_id, role) DO NOTHING;

-- 2. kanouk@gmail.com の admin ロールを削除
DELETE FROM user_roles 
WHERE user_id = 'b53a2c63-fe3c-425c-94b1-dfd3438b0424' 
  AND role = 'admin';

-- 3. kanouk@gmail.com の plan_type を creator に変更
UPDATE user_settings 
SET plan_type = 'creator', updated_at = now()
WHERE user_id = 'b53a2c63-fe3c-425c-94b1-dfd3438b0424';