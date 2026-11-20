-- Phase 6.5a — alamat kantor + permission pengelolaan kantor (additive only).

ALTER TABLE `office_locations`
  ADD COLUMN `address` VARCHAR(255) NULL AFTER `name`;

INSERT INTO `permissions` (`key`, `description`) VALUES
  ('office.manage', 'Mengelola lokasi, radius, timezone, dan jam kerja kantor')
ON DUPLICATE KEY UPDATE `description` = VALUES(`description`);

INSERT IGNORE INTO `role_permissions` (`tenant_id`, `role_id`, `permission_key`)
SELECT `tenant_id`, `id`, 'office.manage'
FROM `roles`
WHERE `key` IN ('WORKSPACE_OWNER', 'WORKSPACE_ADMIN');
