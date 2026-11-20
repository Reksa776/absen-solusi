-- Phase 7.1 — multi-lokasi kantor dan penugasan kantor per member.

ALTER TABLE `workspace_members`
  ADD COLUMN `office_location_id` CHAR(36) NULL;

ALTER TABLE `attendance_logs`
  ADD COLUMN `office_location_id` CHAR(36) NULL;

ALTER TABLE `workspace_members`
  ADD INDEX `workspace_members_tenant_office_idx` (`tenant_id`, `office_location_id`),
  ADD CONSTRAINT `workspace_members_tenant_office_fk`
    FOREIGN KEY (`tenant_id`, `office_location_id`)
    REFERENCES `office_locations` (`tenant_id`, `id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `attendance_logs`
  ADD INDEX `attendance_logs_tenant_office_idx` (`tenant_id`, `office_location_id`),
  ADD CONSTRAINT `attendance_logs_tenant_office_fk`
    FOREIGN KEY (`tenant_id`, `office_location_id`)
    REFERENCES `office_locations` (`tenant_id`, `id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;
