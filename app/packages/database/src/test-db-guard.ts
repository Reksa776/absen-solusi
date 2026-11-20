const FORBIDDEN_DATABASE_NAMES = new Set([
  "absensi",
  "absensi_dev",
  "absensi_prod",
  "absensi_production",
  "mysql",
  "information_schema",
  "performance_schema",
  "sys",
]);

/**
 * Fail-closed untuk test database paket database. Hanya database verifikasi
 * yang dibuat khusus dan disuplai lewat environment eksplisit yang diizinkan.
 */
export function assertIsolatedTestDatabase(
  url: string | undefined,
  label: string,
): void {
  if (process.env.S1_TEST_DB_GUARD !== "1") {
    throw new Error(`${label}: S1_TEST_DB_GUARD=1 wajib untuk test destruktif`);
  }
  const expectedName = process.env.S1_TEST_DB_NAME;
  const expectedHost = process.env.S1_TEST_DB_HOST;
  const expectedPort = process.env.S1_TEST_DB_PORT;
  if (!expectedName || !expectedHost || !expectedPort) {
    throw new Error(`${label}: S1_TEST_DB_NAME/HOST/PORT wajib diisi eksplisit`);
  }
  if (!/^absensi_s1_verify_[a-z0-9]+$/.test(expectedName)) {
    throw new Error(`${label}: nama database verifikasi tidak valid`);
  }
  if (!url) throw new Error(`${label}: URL database wajib diisi`);

  const parsed = new URL(url);
  const databaseName = parsed.pathname.replace(/^\//, "");
  if (parsed.protocol !== "mysql:" && parsed.protocol !== "mariadb:") {
    throw new Error(`${label}: protokol database tidak didukung`);
  }
  if (parsed.hostname !== expectedHost || parsed.port !== expectedPort) {
    throw new Error(`${label}: host/port tidak sama dengan target yang disetujui`);
  }
  if (databaseName !== expectedName) {
    throw new Error(`${label}: nama database tidak sama dengan target yang disetujui`);
  }
  if (FORBIDDEN_DATABASE_NAMES.has(databaseName)) {
    throw new Error(`${label}: database development/production ditolak`);
  }
  if (!parsed.username.startsWith("s1_")) {
    throw new Error(`${label}: user database bukan user verifikasi`);
  }
  if ([...parsed.searchParams.keys()].length > 0) {
    throw new Error(`${label}: parameter koneksi tambahan ditolak`);
  }
}
