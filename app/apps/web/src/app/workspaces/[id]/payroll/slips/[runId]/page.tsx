import { redirect } from "next/navigation";
import { getCompanyProfile, getPayrollSlip } from "@absensi/auth";
import { requirePagePermission } from "@/lib/page-auth";
import { PrintButton } from "@/components/phase-c-forms";

export const dynamic = "force-dynamic";

const money = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });
const monthName = new Intl.DateTimeFormat("id-ID", { month: "long", year: "numeric", timeZone: "UTC" });

export default async function PayslipPrintPage({ params, searchParams }: { params: Promise<{ id: string; runId: string }>; searchParams: Promise<{ memberId?: string }> }) {
  const { id, runId } = await params;
  const query = await searchParams;
  const { ctx } = await requirePagePermission("member.manage");
  if (!ctx || ctx.tenantId !== id) redirect("/workspaces?error=forbidden");
  if (!query.memberId) redirect(`/workspaces/${id}/payroll/reports`);
  const [slip, company] = await Promise.all([
    getPayrollSlip({ ctx, workspaceId: id, runId, memberId: query.memberId }),
    getCompanyProfile({ ctx, workspaceId: id }),
  ]);
  const item = slip.item;
  const rows: Array<[string, number]> = [
    ["Gaji pokok", item.baseSalary],
    ["Tunjangan hadir", item.attendanceAllowance],
    ["Tunjangan transport", item.transportAllowance],
    ["Tunjangan makan", item.mealAllowance],
    [`Lembur (${item.overtimeMinutes} menit)`, item.overtimePay],
    ["Potongan keterlambatan", -item.lateDeduction],
    [`Potongan ${item.spLevel ?? "SP"}`, -item.spDeduction],
  ];
  return (
    <main className="page page--narrow" style={{ background: "#fff" }}>
      <div className="page-head"><div><p className="eyebrow">Slip gaji</p><h1 className="page-title">{company.legalName}</h1><p className="page-subtitle">{monthName.format(new Date(Date.UTC(slip.periodYear, slip.periodMonth - 1, 1)))} · {slip.status}</p></div><PrintButton /></div>
      <div className="card card-pad stack-lg">
        <div><div className="kpi-label">Karyawan</div><div className="cell-title" style={{ fontSize: "1rem" }}>{item.memberName}</div><div className="cell-sub">{item.memberEmail} · {item.divisionName ?? "Tanpa divisi"}</div></div>
        <table className="data"><tbody>{rows.map(([label, value]) => <tr key={label}><td>{label}</td><td className="num" style={{ textAlign: "right" }}>{money.format(value)}</td></tr>)}<tr><td><strong>Bruto</strong></td><td className="num" style={{ textAlign: "right" }}><strong>{money.format(item.grossPay)}</strong></td></tr><tr><td><strong>Total potongan</strong></td><td className="num" style={{ textAlign: "right" }}><strong>{money.format(item.totalDeductions)}</strong></td></tr><tr><td><strong>Take home pay</strong></td><td className="num" style={{ textAlign: "right", fontSize: "1rem" }}><strong>{money.format(item.netPay)}</strong></td></tr></tbody></table>
        <p className="section-note">Cuti {item.leaveDays} hari · izin {item.permitDays} hari · telat {item.lateMinutes} menit ({item.lateIncidents} kejadian). {slip.paidAt ? `Dibayar ${new Intl.DateTimeFormat("id-ID", { dateStyle: "long" }).format(new Date(slip.paidAt))}.` : "Belum dibayar."}</p>
      </div>
    </main>
  );
}
