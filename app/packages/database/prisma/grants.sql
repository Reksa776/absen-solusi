-- Grant DB Phase 1.
-- 12 tabel DML penuh untuk akun runtime; audit_logs hanya SELECT + INSERT.
-- Jalankan sebagai akun migration (root instance dev lokal) setelah M1 deploy.

REVOKE ALL PRIVILEGES ON `absensi_dev`.* FROM 'absensi_app'@'127.0.0.1';
REVOKE ALL PRIVILEGES ON `absensi_dev`.* FROM 'absensi_app'@'localhost';

GRANT SELECT, INSERT, UPDATE, DELETE ON `absensi_dev`.`users` TO 'absensi_app'@'127.0.0.1';
GRANT SELECT, INSERT, UPDATE, DELETE ON `absensi_dev`.`sessions` TO 'absensi_app'@'127.0.0.1';
GRANT SELECT, INSERT, UPDATE, DELETE ON `absensi_dev`.`workspaces` TO 'absensi_app'@'127.0.0.1';
GRANT SELECT, INSERT, UPDATE, DELETE ON `absensi_dev`.`workspace_members` TO 'absensi_app'@'127.0.0.1';
GRANT SELECT, INSERT, UPDATE, DELETE ON `absensi_dev`.`roles` TO 'absensi_app'@'127.0.0.1';
GRANT SELECT, INSERT, UPDATE, DELETE ON `absensi_dev`.`permissions` TO 'absensi_app'@'127.0.0.1';
GRANT SELECT, INSERT, UPDATE, DELETE ON `absensi_dev`.`role_permissions` TO 'absensi_app'@'127.0.0.1';
GRANT SELECT, INSERT, UPDATE, DELETE ON `absensi_dev`.`member_roles` TO 'absensi_app'@'127.0.0.1';
GRANT SELECT, INSERT, UPDATE, DELETE ON `absensi_dev`.`workspace_invitations` TO 'absensi_app'@'127.0.0.1';
GRANT SELECT, INSERT, UPDATE, DELETE ON `absensi_dev`.`background_jobs` TO 'absensi_app'@'127.0.0.1';
GRANT SELECT, INSERT, UPDATE, DELETE ON `absensi_dev`.`background_job_attempts` TO 'absensi_app'@'127.0.0.1';
GRANT SELECT, INSERT, UPDATE, DELETE ON `absensi_dev`.`office_locations` TO 'absensi_app'@'127.0.0.1';
GRANT SELECT, INSERT, UPDATE, DELETE ON `absensi_dev`.`attendance_logs` TO 'absensi_app'@'127.0.0.1';
GRANT SELECT, INSERT, UPDATE, DELETE ON `absensi_dev`.`correction_requests` TO 'absensi_app'@'127.0.0.1';
GRANT SELECT, INSERT, UPDATE, DELETE ON `absensi_dev`.`workspace_holidays` TO 'absensi_app'@'127.0.0.1';
GRANT SELECT, INSERT ON `absensi_dev`.`audit_logs` TO 'absensi_app'@'127.0.0.1';

GRANT SELECT, INSERT, UPDATE, DELETE ON `absensi_dev`.`users` TO 'absensi_app'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE ON `absensi_dev`.`sessions` TO 'absensi_app'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE ON `absensi_dev`.`workspaces` TO 'absensi_app'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE ON `absensi_dev`.`workspace_members` TO 'absensi_app'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE ON `absensi_dev`.`roles` TO 'absensi_app'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE ON `absensi_dev`.`permissions` TO 'absensi_app'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE ON `absensi_dev`.`role_permissions` TO 'absensi_app'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE ON `absensi_dev`.`member_roles` TO 'absensi_app'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE ON `absensi_dev`.`workspace_invitations` TO 'absensi_app'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE ON `absensi_dev`.`background_jobs` TO 'absensi_app'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE ON `absensi_dev`.`background_job_attempts` TO 'absensi_app'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE ON `absensi_dev`.`office_locations` TO 'absensi_app'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE ON `absensi_dev`.`attendance_logs` TO 'absensi_app'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE ON `absensi_dev`.`correction_requests` TO 'absensi_app'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE ON `absensi_dev`.`workspace_holidays` TO 'absensi_app'@'localhost';
GRANT SELECT, INSERT ON `absensi_dev`.`audit_logs` TO 'absensi_app'@'localhost';

FLUSH PRIVILEGES;
