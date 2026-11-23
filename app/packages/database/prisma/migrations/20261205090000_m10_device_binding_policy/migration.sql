ALTER TABLE `workspaces`
  ADD COLUMN `auto_approve_first_device` BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE `member_devices`
  ADD COLUMN `approved_by_member_id` CHAR(36) NULL,
  ADD INDEX `member_devices_approver_idx` (`tenant_id`, `member_id`, `approved_by_member_id`);

UPDATE `member_devices`
SET `platform` = UPPER(`platform`)
WHERE `platform` IN ('Android', 'iOS');

UPDATE `member_devices`
SET `platform` = 'UNKNOWN'
WHERE `platform` NOT IN ('ANDROID', 'IOS', 'UNKNOWN');
