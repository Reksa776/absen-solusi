-- Phase 7.3 — pengajuan dan approval lembur.

CREATE TABLE `overtime_requests` (
  `id` CHAR(36) NOT NULL,
  `tenant_id` CHAR(36) NOT NULL,
  `member_id` CHAR(36) NOT NULL,
  `date` DATE NOT NULL,
  `start_time` VARCHAR(5) NOT NULL,
  `end_time` VARCHAR(5) NOT NULL,
  `duration_minutes` INT NOT NULL,
  `reason` VARCHAR(1000) NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  `reviewed_by_member_id` CHAR(36) NULL,
  `reviewed_at` DATETIME(3) NULL,
  `rejection_reason` VARCHAR(1000) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `overtime_requests_tenant_id_id_key` (`tenant_id`, `id`),
  INDEX `overtime_requests_tenant_member_status_idx` (`tenant_id`, `member_id`, `status`),
  INDEX `overtime_requests_tenant_status_created_idx` (`tenant_id`, `status`, `created_at`),
  CONSTRAINT `overtime_requests_tenant_fk` FOREIGN KEY (`tenant_id`) REFERENCES `workspaces` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `overtime_requests_member_fk` FOREIGN KEY (`tenant_id`, `member_id`) REFERENCES `workspace_members` (`tenant_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `overtime_requests_reviewer_fk` FOREIGN KEY (`tenant_id`, `reviewed_by_member_id`) REFERENCES `workspace_members` (`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
