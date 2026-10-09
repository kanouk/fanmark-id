-- Restore source-equivalent per-entry status audits inside the existing coupon
-- command transaction. Other writers record their own audits; unchanged coupon
-- markers must not cause a second audit when an entry is reused later.
CREATE TRIGGER extension_coupon_lottery_status_audit
BEFORE UPDATE ON fanmark_lottery_entries
WHEN OLD.entry_status = 'pending'
  AND NEW.entry_status = 'cancelled_by_extension'
  AND NEW.coupon_extension_command_id IS NOT NULL
  AND NEW.coupon_extension_command_id IS NOT OLD.coupon_extension_command_id
BEGIN
  SELECT RAISE(ABORT, 'coupon_lottery_audit_command_invalid')
  WHERE NOT EXISTS (
    SELECT 1 FROM extension_coupon_application_commands command
    WHERE command.id = NEW.coupon_extension_command_id
      AND command.license_id = NEW.license_id
      AND command.fanmark_id = NEW.fanmark_id
      AND command.status = 'processing'
      AND command.applied_at = NEW.updated_at
      AND command.applied_at = NEW.cancelled_at
      AND NEW.cancellation_reason = 'license_extended'
  );

  INSERT INTO audit_logs (
    user_id, action, resource_type, resource_id, request_id, metadata, created_at
  ) VALUES (
    NEW.user_id, 'LOTTERY_ENTRY_STATUS_CHANGED', 'fanmark_lottery_entry', NEW.id,
    NEW.coupon_extension_command_id,
    json_object(
      'old_status', OLD.entry_status,
      'new_status', NEW.entry_status,
      'cancellation_reason', NEW.cancellation_reason
    ),
    NEW.updated_at
  );

  SELECT RAISE(ABORT, 'coupon_lottery_audit_missing')
  WHERE (
    SELECT COUNT(*) FROM audit_logs audit
    WHERE audit.user_id = NEW.user_id
      AND audit.action = 'LOTTERY_ENTRY_STATUS_CHANGED'
      AND audit.resource_type = 'fanmark_lottery_entry'
      AND audit.resource_id = NEW.id
      AND audit.request_id = NEW.coupon_extension_command_id
      AND audit.created_at = NEW.updated_at
      AND audit.metadata = json_object(
        'old_status', OLD.entry_status,
        'new_status', NEW.entry_status,
        'cancellation_reason', NEW.cancellation_reason
      )
  ) != 1;
END;
