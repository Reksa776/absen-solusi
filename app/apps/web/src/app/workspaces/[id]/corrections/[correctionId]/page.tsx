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
    <main
      style={{
        fontFamily: "system-ui, sans-serif",
        maxWidth: "56rem",
        margin: "0 auto",
        padding: "3rem 1.5rem",
        lineHeight: 1.6,
      }}
    >
      <p>
        <Link href={`/workspaces/${id}/corrections`}>← Antrian revisi</Link>
      </p>
      <h1 style={{ fontSize: "1.5rem" }}>Detail revisi</h1>
      <p style={{ color: "#555" }}>
        {correction.member.name} · {correction.member.email}
      </p>

      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "1.5rem" }}>
        <tbody>
          {[
            ["Tipe", typeLabel(correction.requestType)],
            ["Status", statusLabel(correction.status)],
            ["Alasan", correction.reason],
            ["Diajukan", stamp(correction.createdAt)],
          ].map(([label, value]) => (
            <tr key={label}>
              <th
                scope="row"
                style={{ textAlign: "left", padding: "0.5rem", borderBottom: "1px solid #eee", width: "10rem" }}
              >
                {label}
              </th>
              <td style={{ padding: "0.5rem", borderBottom: "1px solid #eee" }}>{value}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 style={{ fontSize: "1.15rem" }}>Perbandingan waktu absensi</h2>
      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "1.5rem" }}>
        <thead>
          <tr>
            <th style={{ textAlign: "left", borderBottom: "1px solid #ccc", padding: "0.5rem" }}>
              Sebelum
            </th>
            <th style={{ textAlign: "left", borderBottom: "1px solid #ccc", padding: "0.5rem" }}>
              Sesudah
            </th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style={{ padding: "0.5rem" }}>{stamp(correction.originalTimestamp)}</td>
            <td style={{ padding: "0.5rem" }}>{stamp(correction.requestedTimestamp)}</td>
          </tr>
        </tbody>
      </table>

      <h2 style={{ fontSize: "1.15rem" }}>Bukti</h2>
      {correction.proofUrl ? (
        isImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/corrections/${correction.id}/proof`}
            alt="Bukti revisi"
            style={{ maxWidth: "100%", borderRadius: "0.5rem" }}
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
        <p style={{ color: "#555" }}>Tidak ada bukti dilampirkan.</p>
      )}

      {correction.status === "REJECTED" ? (
        <>
          <h2 style={{ fontSize: "1.15rem" }}>Alasan penolakan</h2>
          <p role="alert" style={{ color: "#b00020" }}>
            {correction.rejectionReason ?? "—"}
          </p>
        </>
      ) : null}

      <h2 style={{ fontSize: "1.15rem" }}>Riwayat audit terkait</h2>
      <p style={{ color: "#555" }}>Read-only, {audit.pagination.total} entri.</p>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
        <thead>
          <tr>
            {["Waktu", "Action", "Actor", "Metadata"].map((label) => (
              <th
                key={label}
                style={{ textAlign: "left", borderBottom: "1px solid #ccc", padding: "0.5rem" }}
              >
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {audit.logs.map((log) => (
            <tr key={log.id}>
              <td style={{ padding: "0.5rem", whiteSpace: "nowrap" }}>{stamp(log.createdAt)}</td>
              <td style={{ padding: "0.5rem" }}>{log.action}</td>
              <td style={{ padding: "0.5rem" }}>{log.actorMemberId ?? log.actorType}</td>
              <td
                style={{ padding: "0.5rem", maxWidth: "26rem", overflowWrap: "anywhere" }}
              >
                {JSON.stringify(log.metadata)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
