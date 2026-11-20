-- Phase 7.7 — inbox notifikasi in-app per member.

CREATE TABLE `in_app_notifications` (
  `id` CHAR(36) NOT NULL,
  `tenant_id` CHAR(36) NOT NULL,
  `member_id` CHAR(36) NOT NULL,
  `type` VARCHAR(40) NOT NULL,
  `title` VARCHAR(160) NOT NULL,
  `body` VARCHAR(1000) NOT NULL,
  `link_url` VARCHAR(512) NULL,
  `is_read` BOOLEAN NOT NULL DEFAULT FALSE,
  `read_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `in_app_notifications_tenant_id_id_key` (`tenant_id`, `id`),
  INDEX `in_app_notifications_tenant_member_read_created_idx` (`tenant_id`, `member_id`, `is_read`, `created_at`),
  INDEX `in_app_notifications_tenant_member_created_idx` (`tenant_id`, `member_id`, `created_at`),
  CONSTRAINT `in_app_notifications_tenant_fk` FOREIGN KEY (`tenant_id`) REFERENCES `workspaces` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `in_app_notifications_member_fk` FOREIGN KEY (`tenant_id`, `member_id`) REFERENCES `workspace_members` (`tenant_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE,
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
