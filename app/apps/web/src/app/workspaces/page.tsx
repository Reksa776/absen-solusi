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
    <main
      style={{
        fontFamily: "system-ui, sans-serif",
        maxWidth: "48rem",
        margin: "0 auto",
        padding: "3rem 1.5rem",
        lineHeight: 1.6,
      }}
    >
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h1 style={{ fontSize: "1.5rem", marginBottom: 0 }}>Workspace</h1>
          <p style={{ margin: 0, color: "#555" }}>{user.email}</p>
        </div>
        <SignOutButton />
      </header>

      {params.error === "forbidden" ? (
        <p role="alert" style={{ color: "#b00020" }}>
          Anda tidak memiliki akses ke workspace tersebut.
        </p>
      ) : null}

      <section style={{ marginTop: "1.5rem" }}>
        <WorkspaceSwitcher
          workspaces={workspaces.map((workspace) => ({ id: workspace.id, name: workspace.name }))}
          activeTenantId={session.activeTenantId}
        />
        <ul style={{ paddingLeft: "1.2rem" }}>
          {workspaces.map((workspace) => (
            <li key={workspace.id} style={{ marginBottom: "0.75rem" }}>
              <strong>{workspace.name}</strong>
              <br />
              <span style={{ color: "#555" }}>role: {workspace.roleKeys.join(", ") || "—"}</span>
              <br />
              <Link href={`/workspaces/${workspace.id}/members`}>Lihat member</Link>
              {ctx?.permissions.includes("attendance.read") && workspace.id === ctx.tenantId ? (
                <>
                  {" · "}
                  <Link href={`/workspaces/${workspace.id}/dashboard`}>Dashboard</Link>
                </>
              ) : null}
              {ctx?.permissions.includes("correction.read") && workspace.id === ctx.tenantId ? (
                <>
                  {" · "}
                  <Link href={`/workspaces/${workspace.id}/corrections`}>Revisi kehadiran</Link>
                </>
              ) : null}
              {ctx?.permissions.includes("audit.read") && workspace.id === ctx.tenantId ? (
                <>
                  {" · "}
                  <Link href={`/workspaces/${workspace.id}/audit`}>Audit log</Link>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
