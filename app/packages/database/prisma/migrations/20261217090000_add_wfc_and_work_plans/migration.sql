-- Mode kerja WFC pada presensi dan pengajuan WFH/WFC.
ALTER TABLE `attendance_logs` ADD COLUMN `location_note` VARCHAR(255) NULL;

ALTER TABLE `wfh_requests`
    ADD COLUMN `work_mode` VARCHAR(20) NOT NULL DEFAULT 'WFH',
    ADD COLUMN `location_note` VARCHAR(255) NULL,
    ADD COLUMN `plan_attachment_url` VARCHAR(512) NULL,
    ADD COLUMN `plan_attachment_hash` CHAR(64) NULL,
    ADD COLUMN `plan_attachment_file_name` VARCHAR(255) NULL,
    ADD COLUMN `plan_attachment_content_type` VARCHAR(100) NULL;

-- Rencana kerja harian (WFH / WFC) beserta daftar tugasnya.
CREATE TABLE `work_plans` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `member_id` CHAR(36) NOT NULL,
    `attendance_id` CHAR(36) NULL,
    `request_id` CHAR(36) NULL,
    `work_mode` VARCHAR(20) NOT NULL,
    `date` DATE NOT NULL,
    `location_note` VARCHAR(255) NULL,
    `plan_attachment_url` VARCHAR(512) NULL,
    `summary_note` VARCHAR(1000) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `work_plans_attendance_id_key`(`attendance_id`),
    UNIQUE INDEX `work_plans_request_id_key`(`request_id`),
    INDEX `work_plans_tenant_id_date_idx`(`tenant_id`, `date`),
    INDEX `work_plans_tenant_id_work_mode_date_idx`(`tenant_id`, `work_mode`, `date`),
    UNIQUE INDEX `work_plans_tenant_id_id_key`(`tenant_id`, `id`),
    UNIQUE INDEX `work_plans_tenant_id_member_id_date_key`(`tenant_id`, `member_id`, `date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `work_plan_items` (
    `id` CHAR(36) NOT NULL,
    `tenant_id` CHAR(36) NOT NULL,
    `work_plan_id` CHAR(36) NOT NULL,
    `title` VARCHAR(255) NOT NULL,
    `is_completed` BOOLEAN NOT NULL DEFAULT false,
    `completed_at` DATETIME(3) NULL,
    `proof_url` VARCHAR(512) NULL,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `work_plan_items_work_plan_id_sort_order_idx`(`work_plan_id`, `sort_order`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `work_plans` ADD CONSTRAINT `work_plans_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `workspaces`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `work_plans` ADD CONSTRAINT `work_plans_tenant_id_member_id_fkey` FOREIGN KEY (`tenant_id`, `member_id`) REFERENCES `workspace_members`(`tenant_id`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `work_plans` ADD CONSTRAINT `work_plans_attendance_id_fkey` FOREIGN KEY (`attendance_id`) REFERENCES `attendance_logs`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `work_plans` ADD CONSTRAINT `work_plans_request_id_fkey` FOREIGN KEY (`request_id`) REFERENCES `wfh_requests`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `work_plan_items` ADD CONSTRAINT `work_plan_items_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `workspaces`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `work_plan_items` ADD CONSTRAINT `work_plan_items_work_plan_id_fkey` FOREIGN KEY (`work_plan_id`) REFERENCES `work_plans`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
