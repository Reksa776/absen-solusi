-- Phase A — device binding, profile photo approval, luar kota review,
-- mobile settings, dan alur persetujuan berjenjang.
-- Additive: semua kolom baru nullable/default; tidak ada data lama yang dihapus.

ALTER TABLE `workspaces`
  ADD COLUMN `require_device_approval` BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE `workspace_members`
  ADD COLUMN `photo_url` VARCHAR(512) NULL,
  ADD COLUMN `photo_status` VARCHAR(20) NOT NULL DEFAULT 'NONE',
  ADD COLUMN `photo_submitted_at` DATETIME(3) NULL,
  ADD COLUMN `photo_reviewed_at` DATETIME(3) NULL,
  ADD COLUMN `photo_reviewed_by_member_id` CHAR(36) NULL,
  ADD COLUMN `photo_rejection_reason` VARCHAR(500) NULL,
  ADD INDEX `workspace_members_photo_status_idx` (`tenant_id`, `photo_status`);

ALTER TABLE `attendance_logs`
  ADD COLUMN `out_of_radius` BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN `out_of_town_reason` VARCHAR(500) NULL,
  ADD COLUMN `approval_status` VARCHAR(20) NOT NULL DEFAULT 'APPROVED',
  ADD COLUMN `current_approval_level` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `reviewed_by_member_id` CHAR(36) NULL,
  ADD COLUMN `reviewed_at` DATETIME(3) NULL,
  ADD COLUMN `rejection_reason` VARCHAR(500) NULL,
  ADD INDEX `attendance_logs_approval_idx` (`tenant_id`, `approval_status`, `created_at`);

CREATE TABLE `member_devices` (
  `id` CHAR(36) NOT NULL,
  `tenant_id` CHAR(36) NOT NULL,
  `member_id` CHAR(36) NOT NULL,
  `device_id` VARCHAR(128) NOT NULL,
  `device_name` VARCHAR(120) NOT NULL,
  `platform` VARCHAR(20) NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  `last_seen_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `approved_at` DATETIME(3) NULL,
  `revoked_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `member_devices_tenant_id_id_key` (`tenant_id`, `id`),
  UNIQUE INDEX `member_devices_member_device_key` (`tenant_id`, `member_id`, `device_id`),
  INDEX `member_devices_status_idx` (`tenant_id`, `status`, `last_seen_at`),
  INDEX `member_devices_member_status_idx` (`tenant_id`, `member_id`, `status`),
  CONSTRAINT `member_devices_tenant_fk` FOREIGN KEY (`tenant_id`) REFERENCES `workspaces` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `member_devices_member_fk` FOREIGN KEY (`tenant_id`, `member_id`) REFERENCES `workspace_members` (`tenant_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE,
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `approval_workflows` (
  `id` CHAR(36) NOT NULL,
  `tenant_id` CHAR(36) NOT NULL,
  `request_type` VARCHAR(30) NOT NULL,
  `is_active` BOOLEAN NOT NULL DEFAULT TRUE,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `approval_workflows_tenant_type_key` (`tenant_id`, `request_type`),
  UNIQUE INDEX `approval_workflows_tenant_id_id_key` (`tenant_id`, `id`),
  CONSTRAINT `approval_workflows_tenant_fk` FOREIGN KEY (`tenant_id`) REFERENCES `workspaces` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `approval_steps` (
  `id` CHAR(36) NOT NULL,
  `tenant_id` CHAR(36) NOT NULL,
  `workflow_id` CHAR(36) NOT NULL,
  `level` INTEGER NOT NULL,
  `approver_role_key` VARCHAR(40) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `approval_steps_workflow_level_key` (`tenant_id`, `workflow_id`, `level`),
  INDEX `approval_steps_workflow_idx` (`tenant_id`, `workflow_id`),
  CONSTRAINT `approval_steps_workflow_fk` FOREIGN KEY (`tenant_id`, `workflow_id`) REFERENCES `approval_workflows` (`tenant_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE,
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
