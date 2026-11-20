import { existsSync, statSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

export type MobileReleaseVersion = {
  latestVersion: string;
  buildNumber: number;
  forceUpdate: boolean;
  changelog: string;
  downloadUrl: string;
};

export const APK_FILENAME = "absensi-mobile.apk";
export const VERSION_FILENAME = "version.json";

export const DEFAULT_MOBILE_VERSION: MobileReleaseVersion = {
  latestVersion: "1.0.0",
  buildNumber: 1,
  forceUpdate: false,
  changelog: "",
  downloadUrl: "",
};

/**
 * Folder rilis: MOBILE_RELEASE_DIR bila diset, jika tidak `storage/releases`
 * di root repo. Server dapat berjalan dari root repo maupun `apps/web`, jadi
 * kedua kandidat diperiksa sebelum memilih default.
 */
export function releaseDirectory(): string {
  const configured = process.env.MOBILE_RELEASE_DIR?.trim();
  if (configured) return resolve(configured);
  const candidates = [
    resolve(process.cwd(), "storage", "releases"),
    resolve(process.cwd(), "..", "..", "storage", "releases"),
  ];
  for (const candidate of candidates) {
    if (existsSync(dirname(candidate))) return candidate;
  }
  return candidates[0] as string;
}

export function versionFilePath(): string {
  return join(releaseDirectory(), VERSION_FILENAME);
}

export function apkFilePath(): string {
  return join(releaseDirectory(), APK_FILENAME);
}

function text(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

/** Metadata dari klien/berkas selalu dinormalisasi agar endpoint stabil. */
export function normalizeMobileVersion(raw: unknown): MobileReleaseVersion {
  if (raw === null || typeof raw !== "object") {
    return { ...DEFAULT_MOBILE_VERSION };
  }
  const value = raw as Record<string, unknown>;
  const latest = text(value.latestVersion, "").trim();
  const parsedBuild =
    typeof value.buildNumber === "number"
      ? value.buildNumber
      : Number(text(value.buildNumber, ""));
  return {
    latestVersion: /^\d+(\.\d+){0,3}$/.test(latest)
      ? latest
      : DEFAULT_MOBILE_VERSION.latestVersion,
    buildNumber:
      Number.isInteger(parsedBuild) && parsedBuild > 0
        ? parsedBuild
        : DEFAULT_MOBILE_VERSION.buildNumber,
    forceUpdate: value.forceUpdate === true,
    changelog: text(value.changelog, "").slice(0, 4000),
    downloadUrl: text(value.downloadUrl, "").trim(),
  };
}

export async function readMobileVersion(): Promise<MobileReleaseVersion> {
  try {
    const content = await readFile(versionFilePath(), "utf8");
    return normalizeMobileVersion(JSON.parse(content));
  } catch {
    return { ...DEFAULT_MOBILE_VERSION };
  }
}

export async function writeMobileVersion(
  input: MobileReleaseVersion,
): Promise<MobileReleaseVersion> {
  const version = normalizeMobileVersion(input);
  await mkdir(releaseDirectory(), { recursive: true });
  const target = versionFilePath();
  const temporary = `${target}.tmp`;
  await writeFile(temporary, JSON.stringify(version, null, 2), "utf8");
  await rename(temporary, target);
  return version;
}

export function apkInfo(): { size: number; updatedAt: Date } | null {
  try {
    const stats = statSync(apkFilePath());
    return stats.isFile() ? { size: stats.size, updatedAt: stats.mtime } : null;
  } catch {
    return null;
  }
}

export async function storeApk(bytes: Uint8Array): Promise<{ size: number }> {
  await mkdir(releaseDirectory(), { recursive: true });
  const target = apkFilePath();
  const temporary = `${target}.tmp`;
  await writeFile(temporary, bytes);
  await rename(temporary, target);
  return { size: bytes.byteLength };
}
