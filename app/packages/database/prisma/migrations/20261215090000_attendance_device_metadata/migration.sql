-- Metadata perangkat per log presensi agar detail aktivitas menampilkan
-- identitas perangkat yang benar-benar dipakai saat check-in/check-out.
ALTER TABLE `attendance_logs`
  ADD COLUMN `device_name` VARCHAR(120) NULL,
  ADD COLUMN `device_id` VARCHAR(128) NULL,
  ADD COLUMN `device_model` VARCHAR(120) NULL,
  ADD COLUMN `device_manufacturer` VARCHAR(120) NULL;
