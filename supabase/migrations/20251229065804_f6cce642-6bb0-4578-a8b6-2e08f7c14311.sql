-- Create notification templates for lottery_cancelled_by_extension event
-- First, create a template_id that will be shared across languages
DO $$
DECLARE
  v_template_id uuid := gen_random_uuid();
BEGIN
  -- Japanese template
  INSERT INTO notification_templates (
    template_id,
    channel,
    language,
    version,
    title,
    body,
    summary,
    is_active
  ) VALUES (
    v_template_id,
    'in_app',
    'ja',
    1,
    '抽選キャンセル',
    'ファンマーク「{{fanmark_emoji}}」の抽選は、所有者がライセンスを延長したためキャンセルされました。',
    '抽選がキャンセルされました',
    true
  );

  -- English template
  INSERT INTO notification_templates (
    template_id,
    channel,
    language,
    version,
    title,
    body,
    summary,
    is_active
  ) VALUES (
    v_template_id,
    'in_app',
    'en',
    1,
    'Lottery Cancelled',
    'The lottery for "{{fanmark_emoji}}" has been cancelled because the owner extended their license.',
    'Lottery has been cancelled',
    true
  );

  -- Korean template
  INSERT INTO notification_templates (
    template_id,
    channel,
    language,
    version,
    title,
    body,
    summary,
    is_active
  ) VALUES (
    v_template_id,
    'in_app',
    'ko',
    1,
    '추첨 취소',
    '팬마크 "{{fanmark_emoji}}" 추첨이 소유자의 라이선스 연장으로 취소되었습니다.',
    '추첨이 취소되었습니다',
    true
  );

  -- Indonesian template
  INSERT INTO notification_templates (
    template_id,
    channel,
    language,
    version,
    title,
    body,
    summary,
    is_active
  ) VALUES (
    v_template_id,
    'in_app',
    'id',
    1,
    'Undian Dibatalkan',
    'Undian untuk "{{fanmark_emoji}}" dibatalkan karena pemilik memperpanjang lisensi.',
    'Undian telah dibatalkan',
    true
  );

  -- Create notification rule for this event type
  INSERT INTO notification_rules (
    event_type,
    channel,
    template_id,
    template_version,
    enabled,
    priority,
    delay_seconds
  ) VALUES (
    'lottery_cancelled_by_extension',
    'in_app',
    v_template_id,
    1,
    true,
    5,
    0
  );
END $$;