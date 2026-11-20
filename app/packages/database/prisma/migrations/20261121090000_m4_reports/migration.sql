-- Phase 5 — M4 reports: hari libur workspace + index laporan (additive only).

CREATE TABLE `workspace_holidays` (
  `tenant_id` CHAR(36) NOT NULL,
  `id` CHAR(36) NOT NULL,
  `date` DATE NOT NULL,
  `name` VARCHAR(120) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`tenant_id`, `id`),
  UNIQUE KEY `workspace_holidays_tenant_date_key` (`tenant_id`, `date`),
  KEY `workspace_holidays_tenant_date_idx` (`tenant_id`, `date`),
  CONSTRAINT `workspace_holidays_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `workspaces`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX `attendance_logs_tenant_workdate_idx`
  ON `attendance_logs` (`tenant_id`, `work_date`);

CREATE INDEX `attendance_logs_tenant_member_workdate_idx`
  ON `attendance_logs` (`tenant_id`, `member_id`, `work_date`);

CREATE INDEX `attendance_logs_tenant_type_workdate_idx`
  ON `attendance_logs` (`tenant_id`, `type`, `work_date`);

-- correction_requests_tenant_status_created_idx sudah dibuat pada M3
-- (`20261120090000_m3_corrections`). Tidak dibuat ulang agar migrasi additive
-- tidak gagal dengan duplicate key name.
