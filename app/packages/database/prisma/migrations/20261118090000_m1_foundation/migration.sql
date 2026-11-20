-- Phase 1 — M1 foundation (aplikasi absensi).
-- 12 tabel DML + audit_logs append-only (SELECT/INSERT saja untuk akun runtime).
-- Dijalankan sebagai akun migration (root instance dev lokal).

CREATE TABLE `users` (
  `id` CHAR(36) NOT NULL,
  `email` VARCHAR(255) NOT NULL,
  `password_hash` VARCHAR(255) NOT NULL,
  `name` VARCHAR(120) NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `users_email_key` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `sessions` (
  `id` CHAR(36) NOT NULL,
  `user_id` CHAR(36) NOT NULL,
  `token_hash` CHAR(64) NOT NULL,
  `active_tenant_id` CHAR(36) NULL,
  `ip_hash` VARBINARY(32) NULL,
  `user_agent` VARCHAR(255) NULL,
  `last_seen_at` DATETIME(3) NOT NULL,
  `expires_at` DATETIME(3) NOT NULL,
  `revoked_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `sessions_token_hash_key` (`token_hash`),
  KEY `sessions_user_id_idx` (`user_id`),
  CONSTRAINT `sessions_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `workspaces` (
  `id` CHAR(36) NOT NULL,
  `name` VARCHAR(120) NOT NULL,
  `slug` VARCHAR(80) NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `workspaces_slug_key` (`slug`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `workspace_members` (
  `id` CHAR(36) NOT NULL,
  `tenant_id` CHAR(36) NOT NULL,
  `user_id` CHAR(36) NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  `joined_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `workspace_members_tenant_id_user_id_key` (`tenant_id`, `user_id`),
  UNIQUE KEY `workspace_members_tenant_id_id_key` (`tenant_id`, `id`),
  KEY `workspace_members_user_id_idx` (`user_id`),
  CONSTRAINT `workspace_members_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `workspaces`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `workspace_members_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `roles` (
  `id` CHAR(36) NOT NULL,
  `tenant_id` CHAR(36) NOT NULL,
  `key` VARCHAR(40) NOT NULL,
  `name` VARCHAR(80) NOT NULL,
  `is_system` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `roles_tenant_id_key_key` (`tenant_id`, `key`),
  UNIQUE KEY `roles_tenant_id_id_key` (`tenant_id`, `id`),
  CONSTRAINT `roles_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `workspaces`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `permissions` (
  `key` VARCHAR(64) NOT NULL,
  `description` VARCHAR(255) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `role_permissions` (
  `tenant_id` CHAR(36) NOT NULL,
  `role_id` CHAR(36) NOT NULL,
  `permission_key` VARCHAR(64) NOT NULL,
  PRIMARY KEY (`tenant_id`, `role_id`, `permission_key`),
  KEY `role_permissions_permission_key_idx` (`permission_key`),
  CONSTRAINT `role_permissions_role_fkey` FOREIGN KEY (`tenant_id`, `role_id`) REFERENCES `roles`(`tenant_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `role_permissions_permission_key_fkey` FOREIGN KEY (`permission_key`) REFERENCES `permissions`(`key`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `member_roles` (
  `tenant_id` CHAR(36) NOT NULL,
  `member_id` CHAR(36) NOT NULL,
  `role_id` CHAR(36) NOT NULL,
  `assigned_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`tenant_id`, `member_id`, `role_id`),
  KEY `member_roles_tenant_id_role_id_idx` (`tenant_id`, `role_id`),
  CONSTRAINT `member_roles_member_fkey` FOREIGN KEY (`tenant_id`, `member_id`) REFERENCES `workspace_members`(`tenant_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `member_roles_role_fkey` FOREIGN KEY (`tenant_id`, `role_id`) REFERENCES `roles`(`tenant_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `workspace_invitations` (
  `id` CHAR(36) NOT NULL,
  `tenant_id` CHAR(36) NOT NULL,
  `email` VARCHAR(255) NOT NULL,
  `role_id` CHAR(36) NOT NULL,
  `token_hash` CHAR(64) NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  `expires_at` DATETIME(3) NOT NULL,
  `invited_by_user_id` CHAR(36) NOT NULL,
  `accepted_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `workspace_invitations_token_hash_key` (`token_hash`),
  UNIQUE KEY `workspace_invitations_tenant_id_id_key` (`tenant_id`, `id`),
  KEY `workspace_invitations_tenant_id_email_idx` (`tenant_id`, `email`),
  CONSTRAINT `workspace_invitations_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `workspaces`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `workspace_invitations_role_fkey` FOREIGN KEY (`tenant_id`, `role_id`) REFERENCES `roles`(`tenant_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `workspace_invitations_invited_by_user_id_fkey` FOREIGN KEY (`invited_by_user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `audit_logs` (
  `id` CHAR(36) NOT NULL,
  `tenant_id` CHAR(36) NOT NULL,
  `actor_type` VARCHAR(20) NOT NULL,
  `actor_user_id` CHAR(36) NULL,
  `actor_member_id` CHAR(36) NULL,
  `action` VARCHAR(64) NOT NULL,
  `resource_type` VARCHAR(64) NOT NULL,
  `resource_id` VARCHAR(64) NULL,
  `metadata` JSON NULL,
  `ip_hash` VARBINARY(32) NULL,
  `user_agent` VARCHAR(255) NULL,
  `request_id` VARCHAR(64) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `audit_logs_tenant_id_created_at_idx` (`tenant_id`, `created_at`),
  KEY `audit_logs_tenant_id_action_idx` (`tenant_id`, `action`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `background_jobs` (
  `id` CHAR(36) NOT NULL,
  `tenant_id` CHAR(36) NOT NULL,
  `type` VARCHAR(64) NOT NULL,
  `payload` JSON NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  `idempotency_key` VARCHAR(128) NOT NULL,
  `run_at` DATETIME(3) NOT NULL,
  `attempts` INT NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `background_jobs_idempotency_key_key` (`idempotency_key`),
  KEY `background_jobs_tenant_id_status_idx` (`tenant_id`, `status`),
  CONSTRAINT `background_jobs_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `workspaces`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `background_job_attempts` (
  `id` CHAR(36) NOT NULL,
  `job_id` CHAR(36) NOT NULL,
  `attempt` INT NOT NULL,
  `status` VARCHAR(20) NOT NULL,
  `error` VARCHAR(1000) NULL,
  `started_at` DATETIME(3) NOT NULL,
  `finished_at` DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  KEY `background_job_attempts_job_id_idx` (`job_id`),
  CONSTRAINT `background_job_attempts_job_id_fkey` FOREIGN KEY (`job_id`) REFERENCES `background_jobs`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Katalog permission global (27 baris), sumbernya sama dengan @absensi/permissions.
INSERT INTO `permissions` (`key`, `description`) VALUES
  ('workspace.read', 'Melihat workspace'),
  ('workspace.manage', 'Mengelola pengaturan workspace'),
  ('member.read', 'Melihat daftar member'),
  ('member.invite', 'Mengundang member'),
  ('member.manage', 'Mengelola status member'),
  ('role.manage', 'Mengubah role member'),
  ('creator.read', 'Melihat creator'),
  ('creator.write', 'Menulis data creator'),
  ('creator.delete', 'Menghapus creator'),
  ('creator.assign', 'Menugaskan creator ke BD'),
  ('creator.blacklist', 'Memasukkan creator ke blacklist'),
  ('creator.export', 'Mengekspor data creator'),
  ('campaign.read', 'Melihat campaign'),
  ('campaign.write', 'Menulis campaign'),
  ('campaign.publish', 'Mempublikasikan campaign'),
  ('campaign.delete', 'Menghapus campaign'),
  ('shop.read', 'Melihat shop'),
  ('shop.connect', 'Menghubungkan shop'),
  ('shop.disconnect', 'Memutus shop'),
  ('shop.sync', 'Sinkronisasi shop'),
  ('analytics.read', 'Melihat analytics'),
  ('analytics.export', 'Mengekspor analytics'),
  ('outreach.read', 'Melihat outreach'),
  ('outreach.send', 'Mengirim outreach'),
  ('audit.read', 'Melihat audit log'),
  ('job.read', 'Melihat background job'),
  ('job.retry', 'Mengulang background job');
