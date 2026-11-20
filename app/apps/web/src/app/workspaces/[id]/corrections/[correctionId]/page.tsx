import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { HttpError, getWorkspaceCorrection, listAuditLogs } from "@absensi/auth";

import { requirePagePermission } from "@/lib/page-auth";

export const dynamic = "force-dynamic";

function stamp(value: string | null): string {
  if (!value) return "—";
  return `${value.slice(0, 16).replace("T", " ")} UTC`;
}

function typeLabel(value: string): string {
  return value === "CHECK_OUT" ? "Check-out" : "Check-in";
}

function statusLabel(value: string): string {
  if (value === "APPROVED") return "Disetujui";
  if (value === "REJECTED") return "Ditolak";
  return "Menunggu";
}

function statusBadge(value: string): string {
  if (value === "APPROVED") return "badge badge--green";
  if (value === "REJECTED") return "badge badge--red";
  return "badge badge--yellow";
}

export default async function CorrectionDetailPage({
  params,
}: {
  params: Promise<{ id: string; correctionId: string }>;
}) {
  const { id, correctionId } = await params;
  const { ctx } = await requirePagePermission("correction.read");
  if (!ctx || ctx.tenantId !== id) redirect("/workspaces?error=forbidden");

  const correction = await getWorkspaceCorrection({
    ctx,
    workspaceId: id,
    correctionId,
  }).catch((error: unknown) => {
    if (error instanceof HttpError && error.status === 404) notFound();
    throw error;
  });

  const audit = await listAuditLogs({
    ctx,
    workspaceId: id,
    resourceId: correctionId,
    limit: 50,
  });
  const isImage =
    correction.proofUrl !== null && !correction.proofUrl.toLowerCase().endsWith(".pdf");

  return (
    <main className="page page--narrow">
      <Link href={`/workspaces/${id}/corrections`} className="back-link">
        ← Antrian revisi
      </Link>

      <div className="page-head">
        <div>
          <p className="eyebrow">Detail revisi</p>
          <h1 className="page-title">Detail revisi</h1>
          <p className="page-subtitle">
            {correction.member.name} · {correction.member.email}
          </p>
        </div>
        <span className={statusBadge(correction.status)}>{statusLabel(correction.status)}</span>
      </div>

      <div className="card card-pad" style={{ marginBottom: "1.25rem" }}>
        <div className="form-grid">
          <div>
            <div className="kpi-label">Tipe</div>
            <div>{typeLabel(correction.requestType)}</div>
          </div>
          <div>
            <div className="kpi-label">Status</div>
            <div>{statusLabel(correction.status)}</div>
          </div>
          <div>
            <div className="kpi-label">Diajukan</div>
            <div className="mono">{stamp(correction.createdAt)}</div>
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <div className="kpi-label">Alasan</div>
            <div>{correction.reason}</div>
          </div>
        </div>
      </div>

      <h2 className="section-title" style={{ marginBottom: "0.5rem" }}>
        Perbandingan waktu absensi
      </h2>
      <div className="table-wrap" style={{ marginBottom: "1.25rem" }}>
        <div className="table-scroll">
          <table className="data">
            <thead>
              <tr>
                <th>Sebelum</th>
                <th>Sesudah</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="mono">{stamp(correction.originalTimestamp)}</td>
                <td className="mono">{stamp(correction.requestedTimestamp)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <h2 className="section-title" style={{ marginBottom: "0.5rem" }}>
        Bukti revisi
      </h2>
      {correction.proofUrl ? (
        isImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/corrections/${correction.id}/proof`}
            alt="Bukti revisi"
            style={{
              maxWidth: "100%",
              borderRadius: "10px",
              border: "1px solid var(--line)",
            }}
          />
        ) : (
          <p>
            <a
              href={`/api/corrections/${correction.id}/proof`}
              target="_blank"
              rel="noreferrer"
            >
              Buka bukti PDF
            </a>
          </p>
        )
      ) : (
        <p className="muted">Tidak ada bukti dilampirkan.</p>
      )}

      {correction.status === "REJECTED" ? (
        <>
          <h2 className="section-title" style={{ marginTop: "1.25rem" }}>
            Alasan penolakan
          </h2>
          <p role="alert" className="alert" style={{ marginTop: "0.5rem" }}>
            {correction.rejectionReason ?? "—"}
          </p>
        </>
      ) : null}

      <h2 className="section-title" style={{ marginTop: "1.25rem" }}>
        Riwayat audit terkait
      </h2>
      <p className="section-note" style={{ marginBottom: "0.6rem" }}>
        Read-only, {audit.pagination.total} entri.
      </p>
      <div className="table-wrap">
        <div className="table-scroll">
          <table className="data">
            <thead>
              <tr>
                {["Waktu", "Action", "Actor", "Metadata"].map((label) => (
                  <th key={label}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {audit.logs.length === 0 ? (
                <tr>
                  <td colSpan={4} className="empty">
                    Belum ada audit terkait revisi ini.
                  </td>
                </tr>
              ) : null}
              {audit.logs.map((log) => (
                <tr key={log.id}>
                  <td className="mono nowrap">{stamp(log.createdAt)}</td>
                  <td>{log.action}</td>
                  <td>{log.actorMemberId ?? log.actorType}</td>
                  <td className="mono" style={{ maxWidth: "26rem", overflowWrap: "anywhere" }}>
                    {JSON.stringify(log.metadata)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
