import {
  loadWorkspacesForUser,
  sessionCookieName,
  validateSession,
} from "@absensi/auth";
import { systemDb } from "@absensi/database";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { SignOutButton } from "./sign-out-button";
import { dashboardPath, isEmployeeOnlyRoles } from "@/lib/web-access";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const token = (await cookies()).get(sessionCookieName())?.value;
  const session = token ? await validateSession(token) : null;
  if (!session) redirect("/sign-in");

  const workspaces = await loadWorkspacesForUser(session.userId);
  const active = workspaces.find((workspace) => workspace.id === session.activeTenantId) ?? workspaces[0];
  if (active) {
    if (isEmployeeOnlyRoles(active.roleKeys)) redirect("/web-access-denied");
    redirect(dashboardPath(active.id));
  }
  // SYSTEM: data user untuk sesi yang sudah tervalidasi.
  const user = await systemDb().user.findUnique({ where: { id: session.userId } });

  return (
    <main className="centered-shell">
      <section className="centered-card">
        <div className="brand" style={{ padding: "0 0 1rem" }}>
          <span className="brand-mark" aria-hidden="true">
            A
          </span>
          <div>
            <div className="brand-title">Absensi Admin</div>
            <div className="brand-sub">{user?.email}</div>
          </div>
        </div>
        <h1>Belum ada workspace aktif</h1>
        <p>
          Masuk sebagai <strong>{user?.name ?? "pengguna"}</strong>. Hubungi Admin/HR
          untuk penugasan perusahaan agar dashboard dapat dibuka.
        </p>
        <div className="btn-row">
          <SignOutButton />
        </div>
      </section>
    </main>
  );
}
