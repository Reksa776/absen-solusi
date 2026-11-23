"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const CSRF_COOKIE = "aos_csrf";

type Device = {
  id: string;
  deviceId: string;
  deviceName: string;
  platform: string;
  status: string;
  lastSeenAt: string;
  member: { id: string; name: string; email: string };
};

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

function statusBadge(status: string) {
  if (status === "APPROVED") return "badge badge--green";
  if (status === "PENDING") return "badge badge--yellow";
  return "badge badge--red";
}

function statusLabel(status: string) {
  if (status === "APPROVED") return "Aktif";
  if (status === "PENDING") return "Menunggu";
  return "Dicabut";
}

export function DeviceManager({
  workspaceId,
  devices,
}: {
  workspaceId: string;
  devices: Device[];
}) {
  const router = useRouter();
  const [filter, setFilter] = useState("PENDING");
  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const query = search.trim().toLowerCase();
  const visible = devices.filter((device) => {
    if (filter !== "ALL" && device.status !== filter) return false;
    if (!query) return true;
    return [device.member.name, device.member.email, device.deviceName, device.deviceId]
      .join(" ")
      .toLowerCase()
      .includes(query);
  });

  async function post(path: string, success: string, busyKey: string) {
    setBusyId(busyKey);
    setError(null);
    setNotice(null);
    try {
      const token = await csrfToken();
      const response = await fetch(path, {
        method: "POST",
        credentials: "same-origin",
        headers: { "x-csrf-token": token },
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      if (!response.ok) {
        setError(body.error?.message ?? "Perangkat gagal diperbarui.");
        return;
      }
      setNotice(success);
      router.refresh();
    } catch {
      setError("Tidak dapat menghubungi server.");
    } finally {
      setBusyId(null);
    }
  }

  async function approve(device: Device) {
    await post(
      `/api/workspaces/${workspaceId}/devices/${device.id}/approve`,
      `Perangkat ${device.member.name} disetujui.`,
      device.id,
    );
  }

  async function reject(device: Device) {
    const revoking = device.status === "APPROVED";
    if (
      !window.confirm(
        revoking
          ? `Cabut perangkat ${device.member.name}? Perangkat tidak bisa dipakai absen lagi.`
          : `Tolak perangkat baru ${device.member.name}?`,
      )
    ) {
      return;
    }
    await post(
      `/api/workspaces/${workspaceId}/devices/${device.id}/reject`,
      revoking
        ? `Perangkat ${device.member.name} dicabut.`
        : `Perangkat ${device.member.name} ditolak.`,
      device.id,
    );
  }

  async function resetMember(device: Device) {
    if (
      !window.confirm(
        `Reset semua perangkat aktif ${device.member.name}? Karyawan harus login ulang dari perangkat baru.`,
      )
    ) {
      return;
    }
    await post(
      `/api/workspaces/${workspaceId}/members/${device.member.id}/devices/reset`,
      `Semua perangkat aktif ${device.member.name} direset.`,
      `member-${device.member.id}`,
    );
  }

  return (
    <section>
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

      <div className="toolbar" role="group" aria-label="Filter status perangkat">
        {[
          { value: "PENDING", label: "Menunggu" },
          { value: "APPROVED", label: "Aktif" },
          { value: "REVOKED", label: "Dicabut" },
          { value: "ALL", label: "Semua" },
        ].map((option) => (
          <button
            key={option.value}
            type="button"
            className={
              filter === option.value
                ? "btn btn--primary btn--sm"
                : "btn btn--secondary btn--sm"
            }
            onClick={() => setFilter(option.value)}
          >
            {option.label}
          </button>
        ))}
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Cari karyawan atau perangkat"
          aria-label="Cari karyawan atau perangkat"
          style={{
            marginLeft: "auto",
            minWidth: "15rem",
            padding: "0.45rem 0.65rem",
            border: "1px solid var(--line)",
            borderRadius: "8px",
            background: "var(--surface)",
            color: "var(--ink)",
            fontSize: "0.82rem",
          }}
        />
      </div>

      <div className="table-wrap">
        <div className="table-head">
          <div>
            <h2 className="section-title">Perangkat karyawan</h2>
            <p className="section-note">
              <span className="num">{visible.length}</span> perangkat pada filter ini
            </p>
          </div>
        </div>
        <div className="table-scroll">
          <table className="data">
            <thead>
              <tr>
                <th>Karyawan</th>
                <th>Perangkat</th>
                <th>Platform</th>
                <th>Terakhir aktif</th>
                <th>Status</th>
                <th>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 ? (
                <tr>
                  <td colSpan={6} className="empty">
                    Tidak ada perangkat pada filter ini.
                  </td>
                </tr>
              ) : null}
              {visible.map((device) => {
                const busy = busyId === device.id || busyId === `member-${device.member.id}`;
                return (
                  <tr key={device.id}>
                    <td>
                      <span className="cell-title">{device.member.name}</span>
                      <span className="cell-sub">{device.member.email}</span>
                    </td>
                    <td>
                      <span className="cell-title">{device.deviceName}</span>
                      <span className="cell-sub mono">{device.deviceId}</span>
                    </td>
                    <td>{device.platform}</td>
                    <td className="mono">
                      {new Date(device.lastSeenAt).toLocaleString("id-ID")}
                    </td>
                    <td>
                      <span className={statusBadge(device.status)}>
                        {statusLabel(device.status)}
                      </span>
                    </td>
                    <td>
                      <div className="btn-row">
                        {device.status !== "APPROVED" ? (
                          <button
                            type="button"
                            className="btn btn--primary btn--sm"
                            disabled={busy}
                            onClick={() => approve(device)}
                          >
                            Setujui
                          </button>
                        ) : null}
                        {device.status !== "REVOKED" ? (
                          <button
                            type="button"
                            className="btn btn--danger btn--sm"
                            disabled={busy}
                            onClick={() => reject(device)}
                          >
                            {device.status === "APPROVED" ? "Cabut" : "Tolak"}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="btn btn--secondary btn--sm"
                          disabled={busy}
                          onClick={() => resetMember(device)}
                        >
                          Reset karyawan
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
