-- Phase 7.4 — WFH dengan approval dan flag mode kerja pada absensi.

CREATE TABLE `wfh_requests` (
  `id` CHAR(36) NOT NULL,
  `tenant_id` CHAR(36) NOT NULL,
  `member_id` CHAR(36) NOT NULL,
  `date` DATE NOT NULL,
  `reason` VARCHAR(1000) NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  `reviewed_by_member_id` CHAR(36) NULL,
  `reviewed_at` DATETIME(3) NULL,
  `rejection_reason` VARCHAR(1000) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `wfh_requests_tenant_id_id_key` (`tenant_id`, `id`),
  INDEX `wfh_requests_tenant_member_date_idx` (`tenant_id`, `member_id`, `date`),
  INDEX `wfh_requests_tenant_status_created_idx` (`tenant_id`, `status`, `created_at`),
  CONSTRAINT `wfh_requests_tenant_fk` FOREIGN KEY (`tenant_id`) REFERENCES `workspaces` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `wfh_requests_member_fk` FOREIGN KEY (`tenant_id`, `member_id`) REFERENCES `workspace_members` (`tenant_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `wfh_requests_reviewer_fk` FOREIGN KEY (`tenant_id`, `reviewed_by_member_id`) REFERENCES `workspace_members` (`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `attendance_logs`
  ADD COLUMN `work_mode` VARCHAR(20) NOT NULL DEFAULT 'OFFICE';
