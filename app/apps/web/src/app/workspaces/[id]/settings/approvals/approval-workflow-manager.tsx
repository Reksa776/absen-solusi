"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { ROLE_LABELS, type RoleKey } from "@absensi/permissions";

const CSRF_COOKIE = "aos_csrf";

const REQUEST_TYPES = [
  ["CORRECTION", "Koreksi presensi"],
  ["LEAVE", "Cuti"],
  ["PERMIT", "Izin"],
  ["OVERTIME", "Lembur"],
  ["OUT_OF_TOWN", "Dinas luar kota"],
] as const;

type Candidate = { memberId: string; name: string; email: string };
type Step = {
  id: string;
  level: number;
  approverRoleKey: string;
  approverMemberIds: string[];
  approvers: Candidate[];
};
type Workflow = {
  id: string;
  requestType: string;
  isActive: boolean;
  steps: Step[];
};
type DraftStep = { memberIds: string[]; approverRoleKey: string };

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

function initialSteps(workflow: Workflow | undefined): DraftStep[] {
  if (workflow && workflow.steps.length > 0) {
    return workflow.steps.map((step) => ({
      memberIds: step.approverMemberIds,
      approverRoleKey: step.approverRoleKey,
    }));
  }
  return [{ memberIds: [], approverRoleKey: "WORKSPACE_ADMIN" }];
}

export function ApprovalWorkflowManager({
  workspaceId,
  workflows,
  candidates,
  canManage,
}: {
  workspaceId: string;
  workflows: Workflow[];
  candidates: Candidate[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [requestType, setRequestType] = useState("CORRECTION");
  const [steps, setSteps] = useState<DraftStep[]>(() =>
    initialSteps(workflows.find((row) => row.requestType === "CORRECTION")),
  );
  const [queries, setQueries] = useState<string[]>(() =>
    initialSteps(workflows.find((row) => row.requestType === "CORRECTION")).map(
      () => "",
    ),
  );
  const [isActive, setIsActive] = useState(
    workflows.find((row) => row.requestType === "CORRECTION")?.isActive ?? true,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const byId = new Map(candidates.map((row) => [row.memberId, row]));

  function selectType(next: string) {
    const workflow = workflows.find((row) => row.requestType === next);
    const nextSteps = initialSteps(workflow);
    setRequestType(next);
    setSteps(nextSteps);
    setQueries(nextSteps.map(() => ""));
    setIsActive(workflow?.isActive ?? true);
    setError(null);
    setNotice(null);
  }

  function addMember(index: number, memberId: string) {
    setSteps((current) =>
      current.map((step, i) =>
        i === index && !step.memberIds.includes(memberId)
          ? { ...step, memberIds: [...step.memberIds, memberId] }
          : step,
      ),
    );
    setQueries((current) => current.map((value, i) => (i === index ? "" : value)));
  }

  function removeMember(index: number, memberId: string) {
    setSteps((current) =>
      current.map((step, i) =>
        i === index
          ? {
              ...step,
              memberIds: step.memberIds.filter((id) => id !== memberId),
            }
          : step,
      ),
    );
  }

  function addLevel() {
    if (steps.length >= 5) return;
    setSteps((current) => [
      ...current,
      { memberIds: [], approverRoleKey: "WORKSPACE_ADMIN" },
    ]);
    setQueries((current) => [...current, ""]);
  }

  function removeLevel(index: number) {
    if (steps.length <= 1) return;
    setSteps((current) => current.filter((_, i) => i !== index));
    setQueries((current) => current.filter((_, i) => i !== index));
  }

  async function save() {
    if (steps.some((step) => step.memberIds.length === 0)) {
      setError("Pilih minimal satu karyawan pada setiap level approver.");
      return;
    }
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
            steps: steps.map((step) => ({
              approverMemberIds: step.memberIds,
            })),
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
        "Hapus alur ini? Review akan kembali memakai fallback HR Admin/Owner.",
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
      setSteps([{ memberIds: [], approverRoleKey: "WORKSPACE_ADMIN" }]);
      setQueries([""]);
      setIsActive(true);
      router.refresh();
    } catch {
      setError("Tidak dapat menghubungi server.");
    } finally {
      setBusy(false);
    }
  }

  function matches(index: number): Candidate[] {
    const query = (queries[index] ?? "").trim().toLowerCase();
    const selected = new Set(steps[index]?.memberIds ?? []);
    return candidates
      .filter((row) => !selected.has(row.memberId))
      .filter((row) => {
        if (!query) return true;
        return (
          row.name.toLowerCase().includes(query) ||
          row.email.toLowerCase().includes(query)
        );
      })
      .slice(0, 6);
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
              Level 1 disetujui lebih dulu. Salah satu karyawan pada level aktif
              dapat menyetujui atau menolak.
            </p>
          </div>
          <span className={configured ? "badge badge--green" : "badge badge--neutral"}>
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
          {steps.map((step, index) => {
            const options = matches(index);
            return (
              <div className="approver-step" key={`${requestType}-${index}`}>
                <div className="approver-step-head">
                  <span className="badge badge--neutral">L{index + 1}</span>
                  <strong>Approver level {index + 1}</strong>
                  <button
                    type="button"
                    className="btn btn--danger btn--sm"
                    onClick={() => removeLevel(index)}
                    disabled={!canManage || steps.length <= 1 || busy}
                  >
                    Hapus level
                  </button>
                </div>
                <div className="approver-chips">
                  {step.memberIds.length === 0 ? (
                    <span className="section-note">
                      Belum ada karyawan.{" "}
                      {step.approverRoleKey
                        ? `Alur lama memakai role ${ROLE_LABELS[step.approverRoleKey as RoleKey] ?? step.approverRoleKey}.`
                        : "Pilih karyawan di bawah."}
                    </span>
                  ) : null}
                  {step.memberIds.map((memberId) => {
                    const member = byId.get(memberId);
                    return (
                      <span className="approver-chip" key={memberId}>
                        <span>
                          <strong>{member?.name ?? "Karyawan"}</strong>
                          <small>{member?.email ?? memberId}</small>
                        </span>
                        <button
                          type="button"
                          aria-label={`Hapus ${member?.name ?? "approver"}`}
                          onClick={() => removeMember(index, memberId)}
                          disabled={!canManage || busy}
                        >
                          ×
                        </button>
                      </span>
                    );
                  })}
                </div>
                {canManage ? (
                  <div className="autocomplete">
                    <label className="field">
                      Cari karyawan
                      <input
                        value={queries[index] ?? ""}
                        onChange={(event) =>
                          setQueries((current) =>
                            current.map((value, i) =>
                              i === index ? event.target.value : value,
                            ),
                          )
                        }
                        placeholder="Ketik nama atau email karyawan"
                        disabled={busy}
                      />
                    </label>
                    {options.length > 0 ? (
                      <ul className="autocomplete-list">
                        {options.map((row) => (
                          <li key={row.memberId}>
                            <button
                              type="button"
                              onClick={() => addMember(index, row.memberId)}
                            >
                              <strong>{row.name}</strong>
                              <span>{row.email}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="section-note">Tidak ada karyawan yang cocok.</p>
                    )}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>

        {canManage ? (
          <div className="btn-row" style={{ marginTop: "0.9rem" }}>
            <button type="button" className="btn btn--primary" onClick={save} disabled={busy}>
              {busy ? "Menyimpan…" : "Simpan alur"}
            </button>
            <button
              type="button"
              className="btn btn--secondary"
              onClick={addLevel}
              disabled={busy || steps.length >= 5}
            >
              Tambah level
            </button>
            {configured ? (
              <button type="button" className="btn btn--danger" onClick={remove} disabled={busy}>
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
                      .map((step) => {
                        const names =
                          step.approvers.length > 0
                            ? step.approvers.map((entry) => entry.name).join(", ")
                            : ROLE_LABELS[step.approverRoleKey as RoleKey] ??
                              step.approverRoleKey;
                        return `L${step.level} ${names}`;
                      })
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
