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
    <main className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Jejak aktivitas</p>
          <h1 className="page-title">Audit log</h1>
          <p className="page-subtitle">{result.pagination.total} entri · read-only</p>
        </div>
      </div>

      <form method="get" className="toolbar">
        <label className="field" style={{ minWidth: "18rem" }}>
          Filter action
          <input
            name="action"
            placeholder="mis. member.invite"
            defaultValue={query.action ?? ""}
          />
        </label>
        <button type="submit" className="btn btn--primary">
          Filter
        </button>
      </form>

      <div className="table-wrap">
        <div className="table-scroll">
          <table className="data">
            <thead>
              <tr>
                {["Waktu", "Action", "Actor", "Resource", "Metadata"].map((label) => (
                  <th key={label}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.logs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="empty">
                    Belum ada aktivitas yang tercatat.
                  </td>
                </tr>
              ) : null}
              {result.logs.map((log) => (
                <tr key={log.id}>
                  <td className="mono nowrap">{log.createdAt}</td>
                  <td>
                    <span className="badge badge--neutral">{log.action}</span>
                  </td>
                  <td>{log.actorUserId ?? log.actorType}</td>
                  <td>
                    {log.resourceType}:{log.resourceId ?? "—"}
                  </td>
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
