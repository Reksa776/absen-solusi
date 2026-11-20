-- Phase 4 — M3 attendance correction requests (additive only).

ALTER TABLE `attendance_logs`
  ADD COLUMN `is_correction` TINYINT(1) NOT NULL DEFAULT 0;

CREATE TABLE `correction_requests` (
  `id` CHAR(36) NOT NULL,
  `tenant_id` CHAR(36) NOT NULL,
  `member_id` CHAR(36) NOT NULL,
  `attendance_log_id` CHAR(36) NULL,
  `request_type` VARCHAR(20) NOT NULL,
  `requested_timestamp` DATETIME(3) NOT NULL,
  `original_timestamp` DATETIME(3) NULL,
  `reason` VARCHAR(1000) NOT NULL,
  `proof_url` VARCHAR(512) NULL,
  `proof_hash` CHAR(64) NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  `reviewed_by_member_id` CHAR(36) NULL,
  `reviewed_at` DATETIME(3) NULL,
  `rejection_reason` VARCHAR(1000) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `correction_requests_tenant_id_id_key` (`tenant_id`, `id`),
  KEY `correction_requests_tenant_member_status_idx` (`tenant_id`, `member_id`, `status`),
  KEY `correction_requests_tenant_status_created_idx` (`tenant_id`, `status`, `created_at`),
  CONSTRAINT `correction_requests_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `workspaces`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `correction_requests_member_fkey` FOREIGN KEY (`tenant_id`, `member_id`) REFERENCES `workspace_members`(`tenant_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `correction_requests_attendance_log_fkey` FOREIGN KEY (`tenant_id`, `attendance_log_id`) REFERENCES `attendance_logs`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `correction_requests_reviewer_fkey` FOREIGN KEY (`tenant_id`, `reviewed_by_member_id`) REFERENCES `workspace_members`(`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `permissions` (`key`, `description`) VALUES
  ('correction.read', 'Melihat antrian revisi kehadiran'),
  ('correction.review', 'Menyetujui atau menolak revisi kehadiran')
ON DUPLICATE KEY UPDATE `description` = VALUES(`description`);

INSERT IGNORE INTO `role_permissions` (`tenant_id`, `role_id`, `permission_key`)
SELECT `tenant_id`, `id`, 'correction.read'
FROM `roles`
WHERE `key` IN ('WORKSPACE_OWNER', 'WORKSPACE_ADMIN', 'ANALYST');

INSERT IGNORE INTO `role_permissions` (`tenant_id`, `role_id`, `permission_key`)
SELECT `tenant_id`, `id`, 'correction.review'
FROM `roles`
WHERE `key` IN ('WORKSPACE_OWNER', 'WORKSPACE_ADMIN');
