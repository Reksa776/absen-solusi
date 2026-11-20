-- Phase 8.2 — konfigurasi TOTP 2FA pada user platform.

ALTER TABLE `users`
  ADD COLUMN `two_factor_secret` VARCHAR(512) NULL,
  ADD COLUMN `two_factor_enabled` BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN `two_factor_backup_codes_hash` JSON NULL;
