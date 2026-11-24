-- Alamat lengkap hasil reverse geocoding koordinat GPS kunjungan client.
ALTER TABLE `client_visit_logs` ADD COLUMN `address` TEXT NULL;
