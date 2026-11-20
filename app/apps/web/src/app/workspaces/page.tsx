import Link from "next/link";
import { redirect } from "next/navigation";

import { SignOutButton } from "../sign-out-button";
import { requirePagePermission } from "@/lib/page-auth";
import { dashboardPath } from "@/lib/web-access";
import { WorkspaceSwitcher } from "./workspace-switcher";

export const dynamic = "force-dynamic";

export default async function WorkspacesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { user, session, workspaces, ctx } = await requirePagePermission();
  const params = await searchParams;
  const active = workspaces.find((workspace) => workspace.id === session.activeTenantId) ?? workspaces[0];
  if (active) redirect(dashboardPath(active.id));

  return (
    <main className="centered-shell">
      <section className="centered-card">
        <header className="page-head" style={{ marginBottom: "1rem" }}>
          <div>
            <p className="eyebrow">Akses workspace</p>
            <h1>Workspace</h1>
            <p className="page-subtitle" style={{ marginTop: "0.2rem" }}>
              {user.email}
            </p>
          </div>
          <SignOutButton />
        </header>

        {params.error === "forbidden" ? (
          <p role="alert" className="alert">
            Anda tidak memiliki akses ke workspace tersebut.
          </p>
        ) : null}

        <WorkspaceSwitcher
          workspaces={workspaces.map((workspace) => ({ id: workspace.id, name: workspace.name }))}
          activeTenantId={session.activeTenantId}
        />

        <ul className="stack" style={{ listStyle: "none", padding: 0, margin: "1rem 0 0" }}>
          {workspaces.map((workspace) => (
            <li key={workspace.id} className="card card-pad">
              <strong style={{ fontFamily: "var(--font-sans)" }}>{workspace.name}</strong>
              <span className="cell-sub muted" style={{ display: "block", fontSize: "0.78rem" }}>
                role: {workspace.roleKeys.join(", ") || "—"}
              </span>
              <div className="action-links" style={{ marginTop: "0.4rem" }}>
                <Link href={`/workspaces/${workspace.id}/members`}>Lihat member</Link>
                {ctx?.permissions.includes("attendance.read") && workspace.id === ctx.tenantId ? (
                  <Link href={`/workspaces/${workspace.id}/dashboard`}>Dashboard</Link>
                ) : null}
                {ctx?.permissions.includes("correction.read") && workspace.id === ctx.tenantId ? (
                  <Link href={`/workspaces/${workspace.id}/corrections`}>Revisi kehadiran</Link>
                ) : null}
                {ctx?.permissions.includes("audit.read") && workspace.id === ctx.tenantId ? (
                  <Link href={`/workspaces/${workspace.id}/audit`}>Audit log</Link>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
