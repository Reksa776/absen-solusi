-- Multi-sesi presensi: satu karyawan boleh memiliki banyak check-in/check-out
-- pada tanggal yang sama. Idempotensi tetap dijaga oleh idempotency_key.
DROP INDEX `attendance_logs_tenant_member_date_type_key` ON `attendance_logs`;
