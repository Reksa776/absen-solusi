"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";

const CSRF_COOKIE = "aos_csrf";

type ReleaseVersion = {
  latestVersion: string;
  buildNumber: number;
  forceUpdate: boolean;
  changelog: string;
  downloadUrl: string;
};

type ApkInfo = { sizeBytes: number; updatedAt: string } | null;

function readCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1] ?? "") : null;
}

async function csrfToken(): Promise<string> {
  const existing = readCookie(CSRF_COOKIE);
  if (existing) return existing;
  const response = await fetch("/api/auth/csrf", { credentials: "same-origin" });
  const body = (await response.json()) as { csrfToken?: string };
  if (!body.csrfToken) throw new Error("CSRF token tidak tersedia");
  return body.csrfToken;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
}

export function AppReleaseManager({
  workspaceId,
  version,
  apk,
}: {
  workspaceId: string;
  version: ReleaseVersion;
  apk: ApkInfo;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [latestVersion, setLatestVersion] = useState(version.latestVersion);
  const [buildNumber, setBuildNumber] = useState(String(version.buildNumber));
  const [changelog, setChangelog] = useState(version.changelog);
  const [forceUpdate, setForceUpdate] = useState(version.forceUpdate);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) {
      setError("Pilih berkas APK terlebih dahulu.");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const token = await csrfToken();
      const form = new FormData();
      form.set("latestVersion", latestVersion.trim());
      form.set("buildNumber", buildNumber.trim());
      form.set("changelog", changelog);
      form.set("forceUpdate", forceUpdate ? "true" : "false");
      form.set("apk", file);
      const response = await fetch(
        `/api/workspaces/${workspaceId}/app-release`,
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "x-csrf-token": token },
          body: form,
        },
      );
      const body = (await response.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      if (!response.ok) {
        setError(body.error?.message ?? "Unggahan APK gagal.");
        return;
      }
      setNotice(
        `Rilis ${latestVersion} tersimpan. Aplikasi akan menawarkan pembaruan ini pada pembukaan berikutnya.`,
      );
      setFile(null);
      if (inputRef.current) inputRef.current.value = "";
      router.refresh();
    } catch {
      setError("Tidak dapat menghubungi server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <div className="table-wrap">
        <div className="table-head">
          <div>
            <h2 className="section-title">Rilis aktif</h2>
            <p className="section-note">
              Aplikasi membandingkan build number perangkat dengan nilai ini.
            </p>
          </div>
          <span className={apk ? "badge badge--green" : "badge badge--yellow"}>
            {apk ? "APK tersedia" : "Belum ada APK"}
          </span>
        </div>
        <div className="table-scroll">
          <table className="data">
            <tbody>
              <tr>
                <th>Versi terbaru</th>
                <td className="mono nowrap">
                  {version.latestVersion} (build {version.buildNumber})
                </td>
              </tr>
              <tr>
                <th>Pembaruan wajib</th>
                <td>
                  <span
                    className={
                      version.forceUpdate
                        ? "badge badge--yellow"
                        : "badge badge--muted"
                    }
                  >
                    {version.forceUpdate ? "Ya" : "Tidak"}
                  </span>
                </td>
              </tr>
              <tr>
                <th>Berkas APK</th>
                <td className="mono nowrap">
                  {apk
                    ? `${formatBytes(apk.sizeBytes)} · ${formatDate(apk.updatedAt)}`
                    : "Belum diunggah"}
                </td>
              </tr>
              <tr>
                <th>Catatan rilis</th>
                <td>{version.changelog || "—"}</td>
              </tr>
              <tr>
                <th>Unduhan</th>
                <td>
                  {apk ? (
                    <a className="btn btn--sm" href="/api/mobile/apk/latest">
                      Unduh APK
                    </a>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <form onSubmit={submit} className="form-card">
        <div className="table-head">
          <div>
            <h2 className="section-title">Unggah rilis baru</h2>
            <p className="section-note">
              APK ditandatangani dengan build release. Naikkan build number setiap
              unggahan.
            </p>
          </div>
        </div>
        <div className="form-row">
          <label className="field" style={{ flex: "1 1 10rem" }}>
            Versi terbaru
            <input
              type="text"
              required
              inputMode="numeric"
              placeholder="1.1.0"
              pattern="\d+\.\d+\.\d+"
              value={latestVersion}
              onChange={(event) => setLatestVersion(event.target.value)}
            />
          </label>
          <label className="field" style={{ flex: "1 1 8rem" }}>
            Build number
            <input
              type="number"
              required
              min={1}
              step={1}
              value={buildNumber}
              onChange={(event) => setBuildNumber(event.target.value)}
            />
          </label>
          <label className="field" style={{ flex: "1 1 16rem" }}>
            Berkas APK
            <input
              ref={inputRef}
              type="file"
              required
              accept=".apk,application/vnd.android.package-archive"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          </label>
        </div>
        <div className="form-row">
          <label className="field" style={{ flex: "1 1 100%" }}>
            Catatan rilis
            <textarea
              rows={3}
              maxLength={4000}
              placeholder="Perbaikan kamera selfie, peningkatan akurasi GPS, dll."
              value={changelog}
              onChange={(event) => setChangelog(event.target.value)}
            />
          </label>
        </div>
        <div className="form-row">
          <label className="field" style={{ flex: "1 1 18rem" }}>
            <span>
              <input
                type="checkbox"
                checked={forceUpdate}
                onChange={(event) => setForceUpdate(event.target.checked)}
              />{" "}
              Wajib diperbarui (tombol “Nanti” disembunyikan)
            </span>
          </label>
          <button type="submit" className="btn btn--primary" disabled={busy}>
            {busy ? "Mengunggah…" : "Unggah rilis APK"}
          </button>
        </div>
        {file ? (
          <p className="section-note">
            {file.name} · {formatBytes(file.size)}
          </p>
        ) : null}
      </form>

      {error ? (
        <p role="alert" className="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="notice">
          {notice}
        </p>
      ) : null}
    </section>
  );
}
