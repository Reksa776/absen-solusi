-- Phase 3 — M2 attendance and office geofence (additive only).

CREATE TABLE `office_locations` (
  `id` CHAR(36) NOT NULL,
  `tenant_id` CHAR(36) NOT NULL,
  `name` VARCHAR(120) NOT NULL,
  `latitude` DOUBLE NOT NULL,
  `longitude` DOUBLE NOT NULL,
  `radius_meters` INT NOT NULL,
  `timezone` VARCHAR(64) NOT NULL DEFAULT 'UTC',
  `work_start` VARCHAR(5) NOT NULL,
  `work_end` VARCHAR(5) NOT NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `office_locations_tenant_id_id_key` (`tenant_id`, `id`),
  KEY `office_locations_tenant_id_is_active_idx` (`tenant_id`, `is_active`),
  CONSTRAINT `office_locations_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `workspaces`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `attendance_logs` (
  `id` CHAR(36) NOT NULL,
  `tenant_id` CHAR(36) NOT NULL,
  `member_id` CHAR(36) NOT NULL,
  `work_date` DATE NOT NULL,
  `type` VARCHAR(20) NOT NULL,
  `timestamp_server` DATETIME(3) NOT NULL,
  `latitude` DOUBLE NOT NULL,
  `longitude` DOUBLE NOT NULL,
  `accuracy_meters` DOUBLE NOT NULL,
  `distance_meters` DOUBLE NOT NULL,
  `is_mock_location` TINYINT(1) NOT NULL,
  `is_suspicious` TINYINT(1) NOT NULL DEFAULT 0,
  `photo_url` VARCHAR(512) NOT NULL,
  `photo_hash` CHAR(64) NOT NULL,
  `device_info` VARCHAR(255) NULL,
  `ip_hash` VARBINARY(32) NULL,
  `user_agent` VARCHAR(255) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `attendance_logs_tenant_id_id_key` (`tenant_id`, `id`),
  UNIQUE KEY `attendance_logs_tenant_member_date_type_key` (`tenant_id`, `member_id`, `work_date`, `type`),
  KEY `attendance_logs_tenant_id_timestamp_server_idx` (`tenant_id`, `timestamp_server`),
  KEY `attendance_logs_tenant_member_timestamp_idx` (`tenant_id`, `member_id`, `timestamp_server`),
  CONSTRAINT `attendance_logs_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `workspaces`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `attendance_logs_member_fkey` FOREIGN KEY (`tenant_id`, `member_id`) REFERENCES `workspace_members`(`tenant_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `permissions` (`key`, `description`) VALUES
  ('attendance.read', 'Melihat riwayat absensi workspace')
ON DUPLICATE KEY UPDATE `description` = VALUES(`description`);

INSERT IGNORE INTO `role_permissions` (`tenant_id`, `role_id`, `permission_key`)
SELECT `tenant_id`, `id`, 'attendance.read'
FROM `roles`
WHERE `key` IN ('WORKSPACE_OWNER', 'WORKSPACE_ADMIN', 'ANALYST');
