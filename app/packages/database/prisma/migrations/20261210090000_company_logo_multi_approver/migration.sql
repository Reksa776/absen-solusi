-- Additive migration: company logo metadata, approval-level tracking for
-- correction/overtime, and name-based multi-approver assignments.
ALTER TABLE `company_profiles`
  ADD COLUMN `logo_url` VARCHAR(512) NULL,
  ADD COLUMN `logo_storage_key` VARCHAR(512) NULL;

ALTER TABLE `correction_requests`
  ADD COLUMN `current_approval_level` INT NOT NULL DEFAULT 0;

ALTER TABLE `overtime_requests`
  ADD COLUMN `current_approval_level` INT NOT NULL DEFAULT 0;

CREATE TABLE `approval_step_approvers` (
  `id` CHAR(36) NOT NULL,
  `tenant_id` CHAR(36) NOT NULL,
  `step_id` CHAR(36) NOT NULL,
  `member_id` CHAR(36) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  UNIQUE INDEX `approval_step_approvers_tenant_id_step_id_member_id_key` (`tenant_id`, `step_id`, `member_id`),
  INDEX `approval_step_approvers_tenant_id_member_id_idx` (`tenant_id`, `member_id`),
  INDEX `approval_step_approvers_step_id_idx` (`step_id`),
  CONSTRAINT `approval_step_approvers_tenant_id_fkey`
    FOREIGN KEY (`tenant_id`) REFERENCES `workspaces` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `approval_step_approvers_step_id_fkey`
    FOREIGN KEY (`step_id`) REFERENCES `approval_steps` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `approval_step_approvers_tenant_id_member_id_fkey`
    FOREIGN KEY (`tenant_id`, `member_id`) REFERENCES `workspace_members` (`tenant_id`, `id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
