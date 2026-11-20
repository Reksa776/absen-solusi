import {
  createTenantContext,
  resolveMemberPermissions,
  systemDb,
  type TenantContext,
} from "@absensi/database";
import {
  loadWorkspacesForUser,
  sessionCookieName,
  validateSession,
} from "@absensi/auth";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export type PageSession = {
  session: NonNullable<Awaited<ReturnType<typeof validateSession>>>;
  user: { id: string; email: string; name: string; status: string };
  workspaces: Awaited<ReturnType<typeof loadWorkspacesForUser>>;
  ctx: TenantContext | null;
};

/**
 * Halaman admin selalu mengambil tenant dari session cookie, bukan dari URL.
 * Permission diperiksa terhadap membership ACTIVE pada active_tenant_id.
 */
export async function requirePagePermission(permission?: string): Promise<PageSession> {
  const token = (await cookies()).get(sessionCookieName())?.value;
  const session = token ? await validateSession(token) : null;
  if (!session) redirect("/sign-in");

  // SYSTEM: identitas user untuk sesi yang sudah tervalidasi.
  const user = await systemDb().user.findUnique({ where: { id: session.userId } });
  if (!user || user.status !== "ACTIVE") redirect("/sign-in");

  const workspaces = await loadWorkspacesForUser(user.id);
  if (!session.activeTenantId) {
    return { session, user: { id: user.id, email: user.email, name: user.name, status: user.status }, workspaces, ctx: null };
  }

  // SYSTEM: membership diverifikasi sebelum tenant context dibentuk.
  const member = await systemDb().workspaceMember.findFirst({
    where: {
      tenantId: session.activeTenantId,
      userId: user.id,
      status: "ACTIVE",
      workspace: { status: "ACTIVE" },
    },
  });
  if (!member) redirect("/workspaces?error=forbidden");

  const access = await resolveMemberPermissions(systemDb(), session.activeTenantId, member.id);
  if (permission && !access.permissions.includes(permission)) {
    redirect("/workspaces?error=forbidden");
  }
  const ctx = createTenantContext({
    tenantId: session.activeTenantId,
    userId: user.id,
    memberId: member.id,
    roleKeys: access.roleKeys,
    permissions: access.permissions,
  });

  return {
    session,
    user: { id: user.id, email: user.email, name: user.name, status: user.status },
    workspaces,
    ctx,
  };
}
