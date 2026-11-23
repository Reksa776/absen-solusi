"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { ROLE_KEYS, ROLE_LABELS, type RoleKey } from "@absensi/permissions";

const CSRF_COOKIE = "aos_csrf";

const REQUEST_TYPES = [
  ["CORRECTION", "Koreksi presensi"],
  ["LEAVE", "Cuti"],
  ["PERMIT", "Izin"],
  ["OVERTIME", "Lembur"],
  ["OUT_OF_TOWN", "Dinas luar kota"],
] as const;

type Step = { level: number; approverRoleKey: string };
type Workflow = {
  id: string;
  requestType: string;
  isActive: boolean;
  steps: Step[];
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

function initialSteps(workflow: Workflow | undefined): string[] {
  if (workflow && workflow.steps.length > 0) {
    return workflow.steps.map((step) => step.approverRoleKey);
  }
  return ["WORKSPACE_ADMIN"];
}

export function ApprovalWorkflowManager({
  workspaceId,
  workflows,
  canManage,
}: {
  workspaceId: string;
  workflows: Workflow[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [requestType, setRequestType] = useState("CORRECTION");
  const [roles, setRoles] = useState<string[]>(() =>
    initialSteps(workflows.find((row) => row.requestType === "CORRECTION")),
  );
  const [isActive, setIsActive] = useState(
    workflows.find((row) => row.requestType === "CORRECTION")?.isActive ?? true,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function selectType(next: string) {
    setRequestType(next);
    const workflow = workflows.find((row) => row.requestType === next);
    setRoles(initialSteps(workflow));
    setIsActive(workflow?.isActive ?? true);
    setError(null);
    setNotice(null);
  }

  function setLevel(index: number, roleKey: string) {
    setRoles((current) => current.map((role, i) => (i === index ? roleKey : role)));
  }

  function addLevel() {
    if (roles.length >= 5) return;
    setRoles((current) => [...current, "WORKSPACE_ADMIN"]);
  }

  function removeLevel(index: number) {
    if (roles.length <= 1) return;
    setRoles((current) => current.filter((_, i) => i !== index));
  }

  async function save() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const token = await csrfToken();
      const response = await fetch(
        `/api/workspaces/${workspaceId}/approval-workflows`,
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json", "x-csrf-token": token },
          body: JSON.stringify({
            requestType,
            isActive,
            steps: roles.map((approverRoleKey) => ({ approverRoleKey })),
          }),
        },
      );
      const body = (await response.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      if (!response.ok) {
        setError(body.error?.message ?? "Alur gagal disimpan.");
        return;
      }
      setNotice("Alur persetujuan disimpan.");
      router.refresh();
    } catch {
      setError("Tidak dapat menghubungi server.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!workflows.some((row) => row.requestType === requestType)) return;
    if (
      !window.confirm(
        "Hapus alur ini? Review akan kembali memakai perilaku fallback HR Admin/Owner.",
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const token = await csrfToken();
      const response = await fetch(
        `/api/workspaces/${workspaceId}/approval-workflows/${requestType}`,
        {
          method: "DELETE",
          credentials: "same-origin",
          headers: { "x-csrf-token": token },
        },
      );
      const body = (await response.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      if (!response.ok) {
        setError(body.error?.message ?? "Alur gagal dihapus.");
        return;
      }
      setNotice("Alur dihapus. Fallback HR Admin/Owner kembali aktif.");
      setRoles(["WORKSPACE_ADMIN"]);
      setIsActive(true);
      router.refresh();
    } catch {
      setError("Tidak dapat menghubungi server.");
    } finally {
      setBusy(false);
    }
  }

  const configured = workflows.find((row) => row.requestType === requestType);

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

      <div className="form-card">
        <div className="card-head" style={{ padding: "0 0 0.85rem", borderBottom: "none" }}>
          <div>
            <h2 className="section-title">
              {configured ? "Edit alur" : "Buat alur"}{" "}
              {REQUEST_TYPES.find(([value]) => value === requestType)?.[1]}
            </h2>
            <p className="section-note">
              Level 1 disetujui lebih dulu, lalu berlanjut ke level berikutnya.
            </p>
          </div>
          <span
            className={
              configured ? "badge badge--green" : "badge badge--neutral"
            }
          >
            {configured ? "Terpasang" : "Fallback"}
          </span>
        </div>

        <div className="form-grid">
          <label className="field">
            Jenis pengajuan
            <select value={requestType} onChange={(event) => selectType(event.target.value)}>
              {REQUEST_TYPES.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="field--check">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(event) => setIsActive(event.target.checked)}
              disabled={!canManage}
            />
            Alur aktif
          </label>
        </div>

        <div className="stack" style={{ marginTop: "0.9rem" }}>
          {roles.map((role, index) => (
            <div
              key={`${requestType}-${index}`}
              style={{
                display: "grid",
                gridTemplateColumns: "3.5rem 1fr auto",
                gap: "0.6rem",
                alignItems: "end",
              }}
            >
              <span className="badge badge--neutral">L{index + 1}</span>
              <label className="field">
                Approver level {index + 1}
                <select
                  value={role}
                  onChange={(event) => setLevel(index, event.target.value)}
                  disabled={!canManage}
                >
                  {ROLE_KEYS.map((key: RoleKey) => (
                    <option key={key} value={key}>
                      {ROLE_LABELS[key]}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="btn btn--danger btn--sm"
                onClick={() => removeLevel(index)}
                disabled={!canManage || roles.length <= 1 || busy}
              >
                Hapus
              </button>
            </div>
          ))}
        </div>

        {canManage ? (
          <div className="btn-row" style={{ marginTop: "0.9rem" }}>
            <button
              type="button"
              className="btn btn--primary"
              onClick={save}
              disabled={busy}
            >
              {busy ? "Menyimpan…" : "Simpan alur"}
            </button>
            <button
              type="button"
              className="btn btn--secondary"
              onClick={addLevel}
              disabled={busy || roles.length >= 5}
            >
              Tambah level
            </button>
            {configured ? (
              <button
                type="button"
                className="btn btn--danger"
                onClick={remove}
                disabled={busy}
              >
                Hapus alur
              </button>
            ) : null}
          </div>
        ) : (
          <p className="section-note" style={{ marginTop: "0.8rem" }}>
            Hanya admin dengan izin kelola karyawan yang dapat mengubah alur.
          </p>
        )}
      </div>

      <div className="table-wrap">
        <div className="table-head">
          <div>
            <h2 className="section-title">Alur terkonfigurasi</h2>
            <p className="section-note">
              <span className="num">{workflows.length}</span> dari 5 jenis pengajuan
            </p>
          </div>
        </div>
        <div className="table-scroll">
          <table className="data">
            <thead>
              <tr>
                <th>Jenis</th>
                <th>Urutan approver</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {workflows.length === 0 ? (
                <tr>
                  <td colSpan={3} className="empty">
                    Belum ada alur. Semua pengajuan memakai persetujuan HR Admin/Owner.
                  </td>
                </tr>
              ) : null}
              {workflows.map((workflow) => (
                <tr key={workflow.id}>
                  <td>
                    <span className="cell-title">
                      {REQUEST_TYPES.find(([value]) => value === workflow.requestType)?.[1] ??
                        workflow.requestType}
                    </span>
                  </td>
                  <td>
                    {workflow.steps
                      .map(
                        (step) =>
                          `L${step.level} ${ROLE_LABELS[step.approverRoleKey as RoleKey] ?? step.approverRoleKey}`,
                      )
                      .join(" → ")}
                  </td>
                  <td>
                    <span
                      className={
                        workflow.isActive ? "badge badge--green" : "badge badge--neutral"
                      }
                    >
                      {workflow.isActive ? "Aktif" : "Nonaktif"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
