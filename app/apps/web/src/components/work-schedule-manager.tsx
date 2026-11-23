"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { sendJson } from "@/lib/browser-api";
import {
  WorkPatternEditor,
  type WorkPatternRow,
} from "@/components/work-pattern-manager";

type Assignment = {
  id: string;
  memberId: string;
  memberName: string;
  memberEmail: string;
  divisionName: string | null;
  workPatternId: string;
  workPatternName: string;
  isActive: boolean;
};

type Member = { id: string; name: string; divisionName: string | null };

export function WorkScheduleManager({
  workspaceId,
  patterns,
  assignments,
  members,
  canManage,
}: {
  workspaceId: string;
  patterns: WorkPatternRow[];
  assignments: Assignment[];
  members: Member[];
  canManage: boolean;
}) {
  const router = useRouter();
  const activePatterns = patterns.filter((pattern) => pattern.isActive);
  const [modal, setModal] = useState(false);
  const [memberId, setMemberId] = useState(members[0]?.id ?? "");
  const [workPatternId, setWorkPatternId] = useState(activePatterns[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function assign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await sendJson(`/api/workspaces/${workspaceId}/work-pattern-assignments`, "POST", {
        memberId,
        workPatternId,
      });
      setNotice("Penugasan pola kerja disimpan.");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Penugasan gagal disimpan.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(assignment: Assignment) {
    if (!window.confirm(`Hapus penugasan ${assignment.memberName}?`)) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await sendJson(
        `/api/workspaces/${workspaceId}/work-pattern-assignments/${assignment.memberId}`,
        "DELETE",
      );
      setNotice("Penugasan dihapus.");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Penugasan gagal dihapus.");
    } finally {
      setBusy(false);
    }
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

      <div className="card card-pad" style={{ marginBottom: "1.25rem" }}>
        <div className="table-head" style={{ padding: 0, border: "none" }}>
          <div>
            <h2 className="section-title">Penugasan pola kerja</h2>
            <p className="section-note">
              Satu karyawan memiliki satu pola kerja aktif. Penugasan baru menggantikan pola sebelumnya.
            </p>
          </div>
          {canManage ? (
            <button type="button" className="btn btn--accent" onClick={() => setModal(true)}>
              Tambah Pola Kerja
            </button>
          ) : null}
        </div>
        {canManage ? (
          <form onSubmit={assign} className="form-row" style={{ marginTop: "0.9rem" }}>
            <label className="field" style={{ flex: "1 1 14rem" }}>
              Karyawan
              <select value={memberId} onChange={(event) => setMemberId(event.target.value)}>
                {members.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                    {member.divisionName ? ` - ${member.divisionName}` : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="field" style={{ flex: "1 1 14rem" }}>
              Pola kerja
              <select
                value={workPatternId}
                onChange={(event) => setWorkPatternId(event.target.value)}
              >
                {activePatterns.map((pattern) => (
                  <option key={pattern.id} value={pattern.id}>
                    {pattern.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              className="btn btn--primary"
              disabled={busy || !memberId || !workPatternId}
            >
              Simpan penugasan
            </button>
          </form>
        ) : null}
      </div>

      <div className="table-wrap">
        <div className="table-head">
          <div>
            <h2 className="section-title">Jadwal hari kerja aktif</h2>
            <p className="section-note">
              <span className="num">{assignments.length}</span> karyawan memiliki pola kerja
            </p>
          </div>
        </div>
        <div className="table-scroll">
          <table className="data">
            <thead>
              <tr>
                {["Karyawan", "Divisi", "Pola kerja", "Status", "Aksi"].map((label) => (
                  <th key={label}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {assignments.length === 0 ? (
                <tr>
                  <td colSpan={5} className="empty">
                    Belum ada penugasan. Pilih karyawan dan pola kerja di atas.
                  </td>
                </tr>
              ) : null}
              {assignments.map((assignment) => (
                <tr key={assignment.id}>
                  <td>
                    <span className="cell-title">{assignment.memberName}</span>
                    <span className="cell-sub">{assignment.memberEmail}</span>
                  </td>
                  <td>{assignment.divisionName ?? "—"}</td>
                  <td>{assignment.workPatternName}</td>
                  <td>
                    <span
                      className={
                        assignment.isActive ? "badge badge--green" : "badge badge--neutral"
                      }
                    >
                      {assignment.isActive ? "Aktif" : "Pola nonaktif"}
                    </span>
                  </td>
                  <td>
                    {canManage ? (
                      <button
                        type="button"
                        className="btn btn--danger btn--sm"
                        onClick={() => remove(assignment)}
                        disabled={busy}
                      >
                        Hapus
                      </button>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {modal ? (
        <div className="modal-backdrop" role="presentation">
          <div className="modal modal--wide" role="dialog" aria-modal="true" aria-label="Tambah pola kerja">
            <div className="modal-head">
              <div>
                <h2>Tambah Pola Kerja</h2>
                <p className="modal-sub">
                  Pola baru langsung tersedia untuk ditugaskan setelah disimpan.
                </p>
              </div>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => setModal(false)}
                aria-label="Tutup"
              >
                Tutup
              </button>
            </div>
            <WorkPatternEditor
              workspaceId={workspaceId}
              onSaved={() => {
                setModal(false);
                setNotice("Pola kerja baru ditambahkan.");
                router.refresh();
              }}
              onCancel={() => setModal(false)}
            />
          </div>
        </div>
      ) : null}
    </section>
  );
}
