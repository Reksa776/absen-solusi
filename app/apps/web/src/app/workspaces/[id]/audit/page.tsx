import Link from "next/link";
import { redirect } from "next/navigation";

import { listAuditLogs } from "@absensi/auth";

import { requirePagePermission } from "@/lib/page-auth";

export const dynamic = "force-dynamic";

export default async function AuditPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ action?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const { ctx } = await requirePagePermission("audit.read");
  if (!ctx || ctx.tenantId !== id) redirect("/workspaces?error=forbidden");
  const result = await listAuditLogs({
    ctx,
    workspaceId: id,
    action: query.action?.trim() || undefined,
  });

  return (
    <main
      style={{
        fontFamily: "system-ui, sans-serif",
        maxWidth: "72rem",
        margin: "0 auto",
        padding: "3rem 1.5rem",
        lineHeight: 1.6,
      }}
    >
      <p>
        <Link href="/workspaces">← Workspace</Link>
      </p>
      <h1 style={{ fontSize: "1.5rem" }}>Audit log</h1>
      <form method="get" style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
        <input
          name="action"
          placeholder="filter action, mis. member.invite"
          defaultValue={query.action ?? ""}
          style={{ padding: "0.5rem", minWidth: "18rem" }}
        />
        <button type="submit" style={{ padding: "0.6rem" }}>
          Filter
        </button>
      </form>
      <p style={{ color: "#555" }}>{result.pagination.total} entri</p>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
        <thead>
          <tr>
            {["Waktu", "Action", "Actor", "Resource", "Metadata"].map((label) => (
              <th key={label} style={{ textAlign: "left", borderBottom: "1px solid #ccc", padding: "0.5rem" }}>
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.logs.map((log) => (
            <tr key={log.id}>
              <td style={{ padding: "0.5rem", whiteSpace: "nowrap" }}>{log.createdAt}</td>
              <td style={{ padding: "0.5rem" }}>{log.action}</td>
              <td style={{ padding: "0.5rem" }}>{log.actorUserId ?? log.actorType}</td>
              <td style={{ padding: "0.5rem" }}>
                {log.resourceType}:{log.resourceId ?? "—"}
              </td>
              <td style={{ padding: "0.5rem", maxWidth: "26rem", overflowWrap: "anywhere" }}>
                {JSON.stringify(log.metadata)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
