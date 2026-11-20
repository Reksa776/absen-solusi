-- Phase 6 — M5 device tokens untuk push notification (additive only).

CREATE TABLE `device_tokens` (
  `id` CHAR(36) NOT NULL,
  `tenant_id` CHAR(36) NOT NULL,
  `member_id` CHAR(36) NOT NULL,
  `token` VARCHAR(512) NOT NULL,
  `platform` VARCHAR(20) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `device_tokens_tenant_token_key` (`tenant_id`, `token`),
  UNIQUE KEY `device_tokens_tenant_id_id_key` (`tenant_id`, `id`),
  KEY `device_tokens_tenant_member_idx` (`tenant_id`, `member_id`),
  CONSTRAINT `device_tokens_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `workspaces`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `device_tokens_member_fkey` FOREIGN KEY (`tenant_id`, `member_id`) REFERENCES `workspace_members`(`tenant_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
