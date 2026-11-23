-- Phase B — izin kerja, cuti, surat peringatan, dan broadcast pengumuman.
-- Additive: tabel baru; tidak ada data lama yang diubah atau dihapus.

CREATE TABLE `work_permits` (
  `id` CHAR(36) NOT NULL,
  `tenant_id` CHAR(36) NOT NULL,
  `member_id` CHAR(36) NOT NULL,
  `permit_type` VARCHAR(30) NOT NULL,
  `start_date` DATE NOT NULL,
  `end_date` DATE NOT NULL,
  `reason` VARCHAR(1000) NOT NULL,
  `proof_url` VARCHAR(512) NULL,
  `proof_hash` CHAR(64) NULL,
  `proof_content_type` VARCHAR(100) NULL,
  `proof_file_name` VARCHAR(255) NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  `current_approval_level` INTEGER NOT NULL DEFAULT 0,
  `reviewed_by_member_id` CHAR(36) NULL,
  `reviewed_at` DATETIME(3) NULL,
  `rejection_reason` VARCHAR(1000) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `work_permits_tenant_id_id_key` (`tenant_id`, `id`),
  INDEX `work_permits_member_start_idx` (`tenant_id`, `member_id`, `start_date`),
  INDEX `work_permits_status_created_idx` (`tenant_id`, `status`, `created_at`),
  CONSTRAINT `work_permits_tenant_fk` FOREIGN KEY (`tenant_id`) REFERENCES `workspaces` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `work_permits_member_fk` FOREIGN KEY (`tenant_id`, `member_id`) REFERENCES `workspace_members` (`tenant_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `work_permits_reviewer_fk` FOREIGN KEY (`tenant_id`, `reviewed_by_member_id`) REFERENCES `workspace_members` (`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `leave_policies` (
  `id` CHAR(36) NOT NULL,
  `tenant_id` CHAR(36) NOT NULL,
  `annual_quota_days` INTEGER NOT NULL DEFAULT 12,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `leave_policies_tenant_id_key` (`tenant_id`),
  UNIQUE INDEX `leave_policies_tenant_id_id_key` (`tenant_id`, `id`),
  CONSTRAINT `leave_policies_tenant_fk` FOREIGN KEY (`tenant_id`) REFERENCES `workspaces` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `member_leave_balances` (
  `id` CHAR(36) NOT NULL,
  `tenant_id` CHAR(36) NOT NULL,
  `member_id` CHAR(36) NOT NULL,
  `year` INTEGER NOT NULL,
  `entitled_days` INTEGER NOT NULL DEFAULT 0,
  `used_days` INTEGER NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `member_leave_balances_tenant_id_id_key` (`tenant_id`, `id`),
  UNIQUE INDEX `member_leave_balances_member_year_key` (`tenant_id`, `member_id`, `year`),
  INDEX `member_leave_balances_year_idx` (`tenant_id`, `year`),
  CONSTRAINT `member_leave_balances_tenant_fk` FOREIGN KEY (`tenant_id`) REFERENCES `workspaces` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `member_leave_balances_member_fk` FOREIGN KEY (`tenant_id`, `member_id`) REFERENCES `workspace_members` (`tenant_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE,
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `leave_requests` (
  `id` CHAR(36) NOT NULL,
  `tenant_id` CHAR(36) NOT NULL,
  `member_id` CHAR(36) NOT NULL,
  `leave_type` VARCHAR(30) NOT NULL,
  `start_date` DATE NOT NULL,
  `end_date` DATE NOT NULL,
  `working_days` INTEGER NOT NULL,
  `reason` VARCHAR(1000) NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  `current_approval_level` INTEGER NOT NULL DEFAULT 0,
  `reviewed_by_member_id` CHAR(36) NULL,
  `reviewed_at` DATETIME(3) NULL,
  `rejection_reason` VARCHAR(1000) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `leave_requests_tenant_id_id_key` (`tenant_id`, `id`),
  INDEX `leave_requests_member_start_idx` (`tenant_id`, `member_id`, `start_date`),
  INDEX `leave_requests_status_created_idx` (`tenant_id`, `status`, `created_at`),
  CONSTRAINT `leave_requests_tenant_fk` FOREIGN KEY (`tenant_id`) REFERENCES `workspaces` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `leave_requests_member_fk` FOREIGN KEY (`tenant_id`, `member_id`) REFERENCES `workspace_members` (`tenant_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `leave_requests_reviewer_fk` FOREIGN KEY (`tenant_id`, `reviewed_by_member_id`) REFERENCES `workspace_members` (`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `warning_letters` (
  `id` CHAR(36) NOT NULL,
  `tenant_id` CHAR(36) NOT NULL,
  `member_id` CHAR(36) NOT NULL,
  `level` VARCHAR(10) NOT NULL,
  `letter_number` VARCHAR(80) NOT NULL,
  `issued_at` DATE NOT NULL,
  `valid_until` DATE NOT NULL,
  `violation_reason` VARCHAR(1000) NOT NULL,
  `acknowledged_at` DATETIME(3) NULL,
  `issued_by_member_id` CHAR(36) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `warning_letters_tenant_id_id_key` (`tenant_id`, `id`),
  UNIQUE INDEX `warning_letters_letter_number_key` (`tenant_id`, `letter_number`),
  INDEX `warning_letters_member_valid_idx` (`tenant_id`, `member_id`, `valid_until`),
  INDEX `warning_letters_issued_idx` (`tenant_id`, `issued_at`),
  CONSTRAINT `warning_letters_tenant_fk` FOREIGN KEY (`tenant_id`) REFERENCES `workspaces` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `warning_letters_member_fk` FOREIGN KEY (`tenant_id`, `member_id`) REFERENCES `workspace_members` (`tenant_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `warning_letters_issuer_fk` FOREIGN KEY (`tenant_id`, `issued_by_member_id`) REFERENCES `workspace_members` (`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `broadcast_messages` (
  `id` CHAR(36) NOT NULL,
  `tenant_id` CHAR(36) NOT NULL,
  `title` VARCHAR(160) NOT NULL,
  `content` VARCHAR(2000) NOT NULL,
  `audience_type` VARCHAR(20) NOT NULL DEFAULT 'ALL',
  `division_id` CHAR(36) NULL,
  `location_id` CHAR(36) NULL,
  `priority` VARCHAR(20) NOT NULL DEFAULT 'NORMAL',
  `published_at` DATETIME(3) NULL,
  `created_by_member_id` CHAR(36) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `broadcast_messages_tenant_id_id_key` (`tenant_id`, `id`),
  INDEX `broadcast_messages_published_idx` (`tenant_id`, `published_at`),
  INDEX `broadcast_messages_audience_idx` (`tenant_id`, `audience_type`),
  CONSTRAINT `broadcast_messages_tenant_fk` FOREIGN KEY (`tenant_id`) REFERENCES `workspaces` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `broadcast_messages_division_fk` FOREIGN KEY (`tenant_id`, `division_id`) REFERENCES `divisions` (`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `broadcast_messages_location_fk` FOREIGN KEY (`tenant_id`, `location_id`) REFERENCES `office_locations` (`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `broadcast_messages_creator_fk` FOREIGN KEY (`tenant_id`, `created_by_member_id`) REFERENCES `workspace_members` (`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
