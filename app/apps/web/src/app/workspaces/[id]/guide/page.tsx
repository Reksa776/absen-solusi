import { redirect } from "next/navigation";

import { requirePagePermission } from "@/lib/page-auth";

export const dynamic = "force-dynamic";

export default async function GuidePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ctx } = await requirePagePermission("workspace.read");
  if (!ctx || ctx.tenantId !== id) redirect("/workspaces?error=forbidden");

  const setup = [
    ["Perusahaan & kalender", "Lengkapi profil perusahaan, hari libur, dan pengaturan mobile.", "settings/company"],
    ["Struktur karyawan", "Buat divisi, jabatan, lokasi kehadiran, lalu data karyawan dan role.", "divisions"],
    ["Pola kerja", "Susun jam Senin-Minggu, termasuk Sabtu, lalu tugaskan pola kerja aktif ke setiap karyawan.", "work-schedules"],
    ["Kebijakan presensi", "Atur toleransi, jendela check-in/out, wajib selfie, dan mode radius GPS.", "attendance/settings"],
    ["Alur persetujuan", "Tentukan approver berjenjang untuk izin, cuti, lembur, dan presensi luar kota.", "settings/approvals"],
  ] as const;
  const daily = [
    ["Kehadiran", "Pantau kehadiran harian, ringkasan bulanan, review luar kota, dan antrean persetujuan presensi.", "attendance"],
    ["Rekap catatan", "Telusuri koordinat, jarak, perangkat, status wajah, foto, dan catatan setiap transaksi.", "attendance/notes"],
    ["Lembur", "Review pengajuan, buat surat tugas lembur, dan atur batas/pengali tarif yang dipakai payroll.", "overtime"],
    ["Izin & cuti", "Tinjau izin kerja, kelola permohonan cuti, laporan, dan kuota tahunan.", "permits"],
  ] as const;
  const field = [
    ["Kunjungan & proyeksi", "Kelola client, jadwal, log GPS+foto, virtualisasi, ringkasan, AI insight, dan proyeksi pekerjaan.", "client-visits"],
    ["Broadcast & SP", "Kirim pengumuman dan surat peringatan yang terhubung ke aplikasi karyawan.", "broadcasts"],
    ["Gaji", "Preview perhitungan, finalkan, catat pembayaran, unduh laporan, dan cetak slip gaji.", "payroll"],
  ] as const;
  const employee = [
    ["Absensi", "Check-in/out dengan GPS dan kamera depan. Perangkat harus disetujui Admin HR."],
    ["Pengajuan", "Ajukan revisi, lembur, WFH, izin, dan cuti. Jadwal lembur dari admin tampil di tab Lembur."],
    ["Kunjungan & proyeksi", "Lihat jadwal client hari ini, catat kunjungan dengan foto, dan perbarui progres pekerjaan."],
    ["Profil", "Baca surat peringatan, pengumuman, dan slip gaji yang sudah difinalkan."],
  ] as const;

  const Section = ({
    title,
    note,
    rows,
    numbered,
  }: {
    title: string;
    note: string;
    rows: ReadonlyArray<readonly [string, string, string?]>;
    numbered?: boolean;
  }) => (
    <section className="card">
      <div className="card-head">
        <div>
          <h2 className="section-title">{title}</h2>
          <p className="section-note">{note}</p>
        </div>
      </div>
      <div className="card-pad stack">
        {rows.map(([heading, body, slug], index) => (
          <div key={heading} className="notification">
            <div className="notification-head">
              <strong>
                {numbered ? <span className="num">{index + 1}. </span> : null}
                {heading}
              </strong>
              {slug ? <a href={`/workspaces/${id}/${slug}`}>Buka</a> : null}
            </div>
            <p>{body}</p>
          </div>
        ))}
      </div>
    </section>
  );

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Panduan</p>
          <h1 className="page-title">Alur kerja Admin HR &amp; karyawan</h1>
          <p className="page-subtitle">
            Urutan operasional dari setup workspace sampai penggajian. Semua modul memakai data
            MariaDB workspace aktif, RBAC, dan audit log.
          </p>
        </div>
      </div>
      <div className="stack-lg">
        <Section title="Setup awal" note="Lakukan berurutan saat workspace baru." rows={setup} numbered />
        <Section title="Operasional harian" note="Aktivitas rutin Admin HR." rows={daily} />
        <Section title="Kunjungan, pengumuman & gaji" note="Modul lapangan dan periode payroll." rows={field} />
        <Section title="Aplikasi karyawan" note="Alur utama di Android dan iOS." rows={employee} numbered />
        <section className="card card-pad">
          <h2 className="section-title">Kebijakan data</h2>
          <p className="section-note">
            Foto presensi dan kunjungan disajikan lewat endpoint ber-otorisasi, bukan direktori
            publik. AI insight dihitung deterministik dari data kunjungan nyata tanpa API eksternal.
            Pengaturan lembur dan presensi hanya berlaku pada workspace aktif.
          </p>
        </section>
      </div>
    </main>
  );
}
