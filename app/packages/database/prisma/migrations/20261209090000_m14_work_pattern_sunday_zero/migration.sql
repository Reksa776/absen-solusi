-- Pola Kerja memakai pemetaan JavaScript: Minggu=0, Senin=1 ... Sabtu=6.
-- Data lama yang menyimpan Minggu sebagai 7 dipetakan ke 0 tanpa menghapus baris.
UPDATE `work_pattern_days`
SET `day_of_week` = 0
WHERE `day_of_week` = 7;
