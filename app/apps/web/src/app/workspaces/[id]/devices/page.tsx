import { redirect } from "next/navigation";

import { listMemberDevices } from "@absensi/auth";

import { requirePagePermission } from "@/lib/page-auth";
import { DeviceManager } from "./device-manager";

export const dynamic = "force-dynamic";

export default async function DevicesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { ctx } = await requirePagePermission("member.read");
  if (!ctx || ctx.tenantId !== id) redirect("/workspaces?error=forbidden");
  const devices = await listMemberDevices({ ctx, workspaceId: id });
  const pending = devices.filter((device) => device.status === "PENDING").length;
  const approved = devices.filter((device) => device.status === "APPROVED").length;
  const revoked = devices.filter((device) => device.status === "REVOKED").length;

  const summary = [
    { label: "Menunggu persetujuan", value: pending, tone: "yellow" },
    { label: "Perangkat aktif", value: approved, tone: "green" },
    { label: "Dicabut", value: revoked, tone: "red" },
  ] as const;

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Keamanan presensi</p>
          <h1 className="page-title">Persetujuan perangkat</h1>
          <p className="page-subtitle">
            Perangkat baru diblokir dari check-in sampai disetujui Admin HR.
            Perangkat pertama karyawan otomatis aktif sesuai pengaturan workspace.
          </p>
        </div>
        <span className={pending > 0 ? "badge badge--yellow" : "badge badge--green"}>
          <span className="num">{pending}</span> menunggu
        </span>
      </div>

      <div className="summary-grid">
        {summary.map((item) => (
          <div key={item.label} className="card summary-cell">
            <p className="section-note" style={{ margin: 0 }}>
              {item.label}
            </p>
            <p
              className="num"
              style={{
                margin: "0.3rem 0 0",
                fontSize: "1.65rem",
                fontWeight: 600,
                color:
                  item.tone === "green"
                    ? "var(--green-700)"
                    : item.tone === "red"
                      ? "var(--danger)"
                      : "var(--yellow-ink)",
              }}
            >
              {item.value}
            </p>
          </div>
        ))}
      </div>

      <DeviceManager workspaceId={id} devices={devices} />
    </main>
  );
}
