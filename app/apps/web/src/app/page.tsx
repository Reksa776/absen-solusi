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
    <main
      style={{
        fontFamily: "system-ui, sans-serif",
        maxWidth: "40rem",
        margin: "0 auto",
        padding: "4rem 1.5rem",
        lineHeight: 1.6,
      }}
    >
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1 style={{ fontSize: "1.5rem" }}>Aplikasi Absensi</h1>
        <SignOutButton />
      </header>
      <p>
        Masuk sebagai <strong>{user?.name ?? "pengguna"}</strong> ({user?.email}).
      </p>
      <p>Belum ada workspace aktif. Hubungi Admin/HR untuk penugasan perusahaan.</p>
    </main>
  );
}
