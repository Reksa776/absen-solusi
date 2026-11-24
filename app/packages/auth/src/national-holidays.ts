/**
 * Hari libur nasional Indonesia (SKB 3 Menteri) yang dipakai sebagai data
 * referensi saat admin menekan "Muat Hari Libur Nasional". Tanggal cuti
 * bersama tidak dimasukkan agar workspace tetap dapat menambahkannya sendiri.
 */
export type NationalHoliday = { date: string; name: string };

const HOLIDAYS: Record<number, NationalHoliday[]> = {
  2025: [
    { date: "2025-01-01", name: "Tahun Baru 2025" },
    { date: "2025-01-27", name: "Isra Mikraj Nabi Muhammad" },
    { date: "2025-01-29", name: "Tahun Baru Imlek" },
    { date: "2025-03-29", name: "Hari Suci Nyepi" },
    { date: "2025-03-31", name: "Idul Fitri" },
    { date: "2025-04-01", name: "Idul Fitri" },
    { date: "2025-04-18", name: "Wafat Isa Almasih" },
    { date: "2025-04-20", name: "Hari Paskah" },
    { date: "2025-05-01", name: "Hari Buruh Internasional" },
    { date: "2025-05-12", name: "Kenaikan Isa Almasih" },
    { date: "2025-05-29", name: "Kenaikan Isa Almasih" },
    { date: "2025-06-01", name: "Hari Lahir Pancasila" },
    { date: "2025-06-06", name: "Idul Adha" },
    { date: "2025-06-27", name: "Tahun Baru Islam 1447 H" },
    { date: "2025-08-17", name: "Hari Kemerdekaan Republik Indonesia" },
    { date: "2025-09-05", name: "Maulid Nabi Muhammad" },
    { date: "2025-12-25", name: "Hari Raya Natal" },
  ],
  2026: [
    { date: "2026-01-01", name: "Tahun Baru 2026" },
    { date: "2026-01-16", name: "Isra Mikraj Nabi Muhammad" },
    { date: "2026-02-17", name: "Tahun Baru Imlek" },
    { date: "2026-03-19", name: "Hari Suci Nyepi" },
    { date: "2026-03-20", name: "Idul Fitri" },
    { date: "2026-03-21", name: "Idul Fitri" },
    { date: "2026-04-03", name: "Wafat Isa Almasih" },
    { date: "2026-04-05", name: "Hari Paskah" },
    { date: "2026-05-01", name: "Hari Buruh Internasional" },
    { date: "2026-05-14", name: "Kenaikan Isa Almasih" },
    { date: "2026-05-27", name: "Idul Adha" },
    { date: "2026-06-01", name: "Hari Lahir Pancasila" },
    { date: "2026-06-16", name: "Tahun Baru Islam 1448 H" },
    { date: "2026-08-17", name: "Hari Kemerdekaan Republik Indonesia" },
    { date: "2026-08-25", name: "Maulid Nabi Muhammad" },
    { date: "2026-12-25", name: "Hari Raya Natal" },
  ],
  2027: [
    { date: "2027-01-01", name: "Tahun Baru 2027" },
    { date: "2027-01-05", name: "Isra Mikraj Nabi Muhammad" },
    { date: "2027-02-06", name: "Tahun Baru Imlek" },
    { date: "2027-03-08", name: "Hari Suci Nyepi" },
    { date: "2027-03-09", name: "Idul Fitri" },
    { date: "2027-03-10", name: "Idul Fitri" },
    { date: "2027-03-26", name: "Wafat Isa Almasih" },
    { date: "2027-03-28", name: "Hari Paskah" },
    { date: "2027-05-01", name: "Hari Buruh Internasional" },
    { date: "2027-05-06", name: "Kenaikan Isa Almasih" },
    { date: "2027-05-17", name: "Idul Adha" },
    { date: "2027-06-01", name: "Hari Lahir Pancasila" },
    { date: "2027-06-06", name: "Tahun Baru Islam 1449 H" },
    { date: "2027-08-17", name: "Hari Kemerdekaan Republik Indonesia" },
    { date: "2027-08-15", name: "Maulid Nabi Muhammad" },
    { date: "2027-12-25", name: "Hari Raya Natal" },
  ],
};

export function nationalHolidaysForYear(year: number): NationalHoliday[] | null {
  return HOLIDAYS[year] ?? null;
}
