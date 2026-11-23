-- Workforce policy — pola kerja, pengaturan presensi, jadwal & pengaturan lembur.
-- Additive: tabel baru dan dua kolom nullable/default pada attendance_logs.

CREATE TABLE `work_patterns` (
  `id` CHAR(36) NOT NULL,
  `tenant_id` CHAR(36) NOT NULL,
  `name` VARCHAR(120) NOT NULL,
  `timezone` VARCHAR(64) NOT NULL DEFAULT 'UTC',
  `is_active` BOOLEAN NOT NULL DEFAULT TRUE,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `work_patterns_tenant_id_id_key` (`tenant_id`, `id`),
  UNIQUE INDEX `work_patterns_tenant_id_name_key` (`tenant_id`, `name`),
  INDEX `work_patterns_tenant_active_idx` (`tenant_id`, `is_active`),
  CONSTRAINT `work_patterns_tenant_fk` FOREIGN KEY (`tenant_id`) REFERENCES `workspaces` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `work_pattern_days` (
  `id` CHAR(36) NOT NULL,
  `tenant_id` CHAR(36) NOT NULL,
  `work_pattern_id` CHAR(36) NOT NULL,
  `day_of_week` INTEGER NOT NULL,
  `is_workday` BOOLEAN NOT NULL DEFAULT TRUE,
  `start_time` VARCHAR(5) NOT NULL,
  `end_time` VARCHAR(5) NOT NULL,
  `earliest_check_in_minutes` INTEGER NOT NULL DEFAULT 120,
  `late_tolerance_minutes` INTEGER NOT NULL DEFAULT 15,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `work_pattern_days_tenant_id_id_key` (`tenant_id`, `id`),
  UNIQUE INDEX `work_pattern_days_pattern_day_key` (`tenant_id`, `work_pattern_id`, `day_of_week`),
  INDEX `work_pattern_days_tenant_day_idx` (`tenant_id`, `day_of_week`),
  CONSTRAINT `work_pattern_days_tenant_fk` FOREIGN KEY (`tenant_id`) REFERENCES `workspaces` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `work_pattern_days_pattern_fk` FOREIGN KEY (`tenant_id`, `work_pattern_id`) REFERENCES `work_patterns` (`tenant_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE,
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `work_pattern_assignments` (
  `id` CHAR(36) NOT NULL,
  `tenant_id` CHAR(36) NOT NULL,
  `member_id` CHAR(36) NOT NULL,
  `work_pattern_id` CHAR(36) NOT NULL,
  `assigned_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `work_pattern_assignments_tenant_id_id_key` (`tenant_id`, `id`),
  UNIQUE INDEX `work_pattern_assignments_member_key` (`tenant_id`, `member_id`),
  INDEX `work_pattern_assignments_pattern_idx` (`tenant_id`, `work_pattern_id`),
  CONSTRAINT `work_pattern_assignments_tenant_fk` FOREIGN KEY (`tenant_id`) REFERENCES `workspaces` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `work_pattern_assignments_member_fk` FOREIGN KEY (`tenant_id`, `member_id`) REFERENCES `workspace_members` (`tenant_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `work_pattern_assignments_pattern_fk` FOREIGN KEY (`tenant_id`, `work_pattern_id`) REFERENCES `work_patterns` (`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `attendance_settings` (
  `id` CHAR(36) NOT NULL,
  `tenant_id` CHAR(36) NOT NULL,
  `default_late_tolerance_minutes` INTEGER NOT NULL DEFAULT 15,
  `earliest_check_in_minutes` INTEGER NOT NULL DEFAULT 120,
  `max_check_out_minutes` INTEGER NOT NULL DEFAULT 240,
  `require_selfie` BOOLEAN NOT NULL DEFAULT TRUE,
  `gps_radius_policy` VARCHAR(20) NOT NULL DEFAULT 'STRICT',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `attendance_settings_tenant_id_key` (`tenant_id`),
  UNIQUE INDEX `attendance_settings_tenant_id_id_key` (`tenant_id`, `id`),
  CONSTRAINT `attendance_settings_tenant_fk` FOREIGN KEY (`tenant_id`) REFERENCES `workspaces` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `overtime_settings` (
  `id` CHAR(36) NOT NULL,
  `tenant_id` CHAR(36) NOT NULL,
  `min_duration_minutes` INTEGER NOT NULL DEFAULT 30,
  `rounding_minutes` INTEGER NOT NULL DEFAULT 15,
  `max_daily_minutes` INTEGER NOT NULL DEFAULT 240,
  `max_monthly_minutes` INTEGER NOT NULL DEFAULT 4800,
  `weekday_multiplier` DOUBLE NOT NULL DEFAULT 1.5,
  `holiday_multiplier` DOUBLE NOT NULL DEFAULT 2,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `overtime_settings_tenant_id_key` (`tenant_id`),
  UNIQUE INDEX `overtime_settings_tenant_id_id_key` (`tenant_id`, `id`),
  CONSTRAINT `overtime_settings_tenant_fk` FOREIGN KEY (`tenant_id`) REFERENCES `workspaces` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `overtime_schedules` (
  `id` CHAR(36) NOT NULL,
  `tenant_id` CHAR(36) NOT NULL,
  `member_id` CHAR(36) NOT NULL,
  `date` DATE NOT NULL,
  `start_time` VARCHAR(5) NOT NULL,
  `end_time` VARCHAR(5) NOT NULL,
  `duration_minutes` INTEGER NOT NULL,
  `notes` VARCHAR(1000) NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'PLANNED',
  `created_by_member_id` CHAR(36) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `overtime_schedules_tenant_id_id_key` (`tenant_id`, `id`),
  INDEX `overtime_schedules_date_status_idx` (`tenant_id`, `date`, `status`),
  INDEX `overtime_schedules_member_date_idx` (`tenant_id`, `member_id`, `date`),
  CONSTRAINT `overtime_schedules_tenant_fk` FOREIGN KEY (`tenant_id`) REFERENCES `workspaces` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `overtime_schedules_member_fk` FOREIGN KEY (`tenant_id`, `member_id`) REFERENCES `workspace_members` (`tenant_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `overtime_schedules_creator_fk` FOREIGN KEY (`tenant_id`, `created_by_member_id`) REFERENCES `workspace_members` (`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `attendance_logs`
  ADD COLUMN `notes` VARCHAR(500) NULL,
  ADD COLUMN `face_verified` BOOLEAN NOT NULL DEFAULT FALSE;
