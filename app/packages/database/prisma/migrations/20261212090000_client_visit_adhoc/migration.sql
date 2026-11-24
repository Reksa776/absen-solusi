-- Additive: kunjungan client ad-hoc tidak wajib terikat jadwal/master client.
ALTER TABLE `client_visit_logs`
  MODIFY `schedule_id` CHAR(36) NULL,
  MODIFY `client_id` CHAR(36) NULL,
  MODIFY `distance_meters` DOUBLE NULL,
  MODIFY `is_inside_radius` BOOLEAN NULL,
  ADD COLUMN `client_name` VARCHAR(160) NULL;

CREATE INDEX `client_visit_logs_tenant_id_client_name_idx`
  ON `client_visit_logs`(`tenant_id`, `client_name`);
