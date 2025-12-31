-- =========================================
-- Fanmark Transfer Notification Templates & Rules
-- =========================================

-- Template IDs:
-- transfer_requested: b1c2d3e4-f5a6-7890-abcd-111111111111
-- transfer_approved:  b1c2d3e4-f5a6-7890-abcd-222222222222
-- transfer_rejected:  b1c2d3e4-f5a6-7890-abcd-333333333333

-- =========================================
-- 1. transfer_requested templates (4 languages)
-- =========================================

-- Japanese
INSERT INTO notification_templates (template_id, version, channel, language, title, body, summary, is_active)
VALUES (
  'b1c2d3e4-f5a6-7890-abcd-111111111111',
  1,
  'in_app',
  'ja',
  '移管申請を受け付けました',
  '「{{fanmark_name}}」の移管申請を{{requester_name}}さんから受け付けました。承認または拒否を選択してください。',
  '移管申請受付',
  true
);

-- English
INSERT INTO notification_templates (template_id, version, channel, language, title, body, summary, is_active)
VALUES (
  'b1c2d3e4-f5a6-7890-abcd-111111111111',
  1,
  'in_app',
  'en',
  'Transfer Request Received',
  'You received a transfer request for "{{fanmark_name}}" from {{requester_name}}. Please approve or reject the request.',
  'Transfer request received',
  true
);

-- Korean
INSERT INTO notification_templates (template_id, version, channel, language, title, body, summary, is_active)
VALUES (
  'b1c2d3e4-f5a6-7890-abcd-111111111111',
  1,
  'in_app',
  'ko',
  '이전 신청을 받았습니다',
  '{{requester_name}}님으로부터 "{{fanmark_name}}"의 이전 신청을 받았습니다. 승인 또는 거부를 선택해 주세요.',
  '이전 신청 접수',
  true
);

-- Indonesian
INSERT INTO notification_templates (template_id, version, channel, language, title, body, summary, is_active)
VALUES (
  'b1c2d3e4-f5a6-7890-abcd-111111111111',
  1,
  'in_app',
  'id',
  'Permintaan Transfer Diterima',
  'Anda menerima permintaan transfer untuk "{{fanmark_name}}" dari {{requester_name}}. Silakan setujui atau tolak permintaan.',
  'Permintaan transfer diterima',
  true
);

-- =========================================
-- 2. transfer_approved templates (4 languages)
-- =========================================

-- Japanese
INSERT INTO notification_templates (template_id, version, channel, language, title, body, summary, is_active)
VALUES (
  'b1c2d3e4-f5a6-7890-abcd-222222222222',
  1,
  'in_app',
  'ja',
  '移管申請が承認されました',
  'ファンマーク「{{fanmark_name}}」の移管申請が承認されました。{{license_end}}まで有効です。',
  '移管承認',
  true
);

-- English
INSERT INTO notification_templates (template_id, version, channel, language, title, body, summary, is_active)
VALUES (
  'b1c2d3e4-f5a6-7890-abcd-222222222222',
  1,
  'in_app',
  'en',
  'Transfer Request Approved',
  'Your transfer request for "{{fanmark_name}}" has been approved. Valid until {{license_end}}.',
  'Transfer approved',
  true
);

-- Korean
INSERT INTO notification_templates (template_id, version, channel, language, title, body, summary, is_active)
VALUES (
  'b1c2d3e4-f5a6-7890-abcd-222222222222',
  1,
  'in_app',
  'ko',
  '이전 신청이 승인되었습니다',
  '팬마크 "{{fanmark_name}}" 이전 신청이 승인되었습니다. {{license_end}}까지 유효합니다.',
  '이전 승인',
  true
);

-- Indonesian
INSERT INTO notification_templates (template_id, version, channel, language, title, body, summary, is_active)
VALUES (
  'b1c2d3e4-f5a6-7890-abcd-222222222222',
  1,
  'in_app',
  'id',
  'Permintaan Transfer Disetujui',
  'Permintaan transfer Anda untuk "{{fanmark_name}}" telah disetujui. Berlaku hingga {{license_end}}.',
  'Transfer disetujui',
  true
);

-- =========================================
-- 3. transfer_rejected templates (4 languages)
-- =========================================

-- Japanese
INSERT INTO notification_templates (template_id, version, channel, language, title, body, summary, is_active)
VALUES (
  'b1c2d3e4-f5a6-7890-abcd-333333333333',
  1,
  'in_app',
  'ja',
  '移管申請が拒否されました',
  'ファンマーク「{{fanmark_name}}」の移管申請が拒否されました。',
  '移管拒否',
  true
);

-- English
INSERT INTO notification_templates (template_id, version, channel, language, title, body, summary, is_active)
VALUES (
  'b1c2d3e4-f5a6-7890-abcd-333333333333',
  1,
  'in_app',
  'en',
  'Transfer Request Rejected',
  'Your transfer request for "{{fanmark_name}}" has been rejected.',
  'Transfer rejected',
  true
);

-- Korean
INSERT INTO notification_templates (template_id, version, channel, language, title, body, summary, is_active)
VALUES (
  'b1c2d3e4-f5a6-7890-abcd-333333333333',
  1,
  'in_app',
  'ko',
  '이전 신청이 거부되었습니다',
  '팬마크 "{{fanmark_name}}" 이전 신청이 거부되었습니다.',
  '이전 거부',
  true
);

-- Indonesian
INSERT INTO notification_templates (template_id, version, channel, language, title, body, summary, is_active)
VALUES (
  'b1c2d3e4-f5a6-7890-abcd-333333333333',
  1,
  'in_app',
  'id',
  'Permintaan Transfer Ditolak',
  'Permintaan transfer Anda untuk "{{fanmark_name}}" telah ditolak.',
  'Transfer ditolak',
  true
);

-- =========================================
-- 4. Notification Rules (3 rules) - priority 1-10 range
-- =========================================

-- Rule for transfer_requested
INSERT INTO notification_rules (event_type, template_id, template_version, channel, priority, delay_seconds, enabled)
VALUES (
  'transfer_requested',
  'b1c2d3e4-f5a6-7890-abcd-111111111111',
  1,
  'in_app',
  8,
  0,
  true
);

-- Rule for transfer_approved
INSERT INTO notification_rules (event_type, template_id, template_version, channel, priority, delay_seconds, enabled)
VALUES (
  'transfer_approved',
  'b1c2d3e4-f5a6-7890-abcd-222222222222',
  1,
  'in_app',
  8,
  0,
  true
);

-- Rule for transfer_rejected
INSERT INTO notification_rules (event_type, template_id, template_version, channel, priority, delay_seconds, enabled)
VALUES (
  'transfer_rejected',
  'b1c2d3e4-f5a6-7890-abcd-333333333333',
  1,
  'in_app',
  8,
  0,
  true
);