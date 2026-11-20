-- Phase 8.3 — retry absensi mobile tanpa membuat log ganda.

ALTER TABLE `attendance_logs`
  ADD COLUMN `idempotency_key` VARCHAR(128) NULL;

CREATE UNIQUE INDEX `attendance_logs_tenant_member_idempotency_key`
  ON `attendance_logs` (`tenant_id`, `member_id`, `idempotency_key`);
