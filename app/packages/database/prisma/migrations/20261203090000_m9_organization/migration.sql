-- Phase 9 — master divisi & jabatan serta penugasan pada karyawan.
-- Additive: tabel baru dan kolom nullable; tidak ada data lama yang diubah.

CREATE TABLE `divisions` (
  `id` CHAR(36) NOT NULL,
  `tenant_id` CHAR(36) NOT NULL,
  `name` VARCHAR(120) NOT NULL,
  `code` VARCHAR(30) NULL,
  `description` VARCHAR(255) NULL,
  `is_active` BOOLEAN NOT NULL DEFAULT TRUE,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `divisions_tenant_id_id_key` (`tenant_id`, `id`),
  UNIQUE INDEX `divisions_tenant_id_name_key` (`tenant_id`, `name`),
  INDEX `divisions_tenant_active_idx` (`tenant_id`, `is_active`),
  CONSTRAINT `divisions_tenant_fk` FOREIGN KEY (`tenant_id`) REFERENCES `workspaces` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `positions` (
  `id` CHAR(36) NOT NULL,
  `tenant_id` CHAR(36) NOT NULL,
  `division_id` CHAR(36) NULL,
  `name` VARCHAR(120) NOT NULL,
  `code` VARCHAR(30) NULL,
  `description` VARCHAR(255) NULL,
  `is_active` BOOLEAN NOT NULL DEFAULT TRUE,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `positions_tenant_id_id_key` (`tenant_id`, `id`),
  UNIQUE INDEX `positions_tenant_id_name_key` (`tenant_id`, `name`),
  INDEX `positions_tenant_active_idx` (`tenant_id`, `is_active`),
  INDEX `positions_tenant_division_idx` (`tenant_id`, `division_id`),
  CONSTRAINT `positions_tenant_fk` FOREIGN KEY (`tenant_id`) REFERENCES `workspaces` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `positions_division_fk` FOREIGN KEY (`tenant_id`, `division_id`) REFERENCES `divisions` (`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `workspace_members`
  ADD COLUMN `division_id` CHAR(36) NULL,
  ADD COLUMN `position_id` CHAR(36) NULL,
  ADD INDEX `workspace_members_tenant_division_idx` (`tenant_id`, `division_id`),
  ADD INDEX `workspace_members_tenant_position_idx` (`tenant_id`, `position_id`),
  ADD CONSTRAINT `workspace_members_division_fk` FOREIGN KEY (`tenant_id`, `division_id`) REFERENCES `divisions` (`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `workspace_members_position_fk` FOREIGN KEY (`tenant_id`, `position_id`) REFERENCES `positions` (`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;
