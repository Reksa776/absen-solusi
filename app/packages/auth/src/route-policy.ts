import type { PermissionKey } from "@absensi/permissions";

/**
 * Deklarasi kebijakan setiap route /api. Test H memindai folder route dan
 * memastikan setiap method yang diekspor punya entri di sini.
 */
export const API_ROUTE_METHODS = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
] as const;

export type ApiRouteMethod = (typeof API_ROUTE_METHODS)[number];

export type ApiRoutePolicy =
  | { kind: "public"; reason: string }
  | { kind: "authenticated"; reason: string }
  | { kind: "permission"; permission: PermissionKey }
  | { kind: "methods"; methods: Partial<Record<ApiRouteMethod, ApiRoutePolicy>> };

export const API_ROUTE_POLICIES: Record<string, ApiRoutePolicy> = {
  "/api/health": { kind: "public", reason: "liveness probe" },
  "/api/health/ready": { kind: "public", reason: "readiness probe (database + katalog permission)" },
  "/api/mobile/schedule": { kind: "permission", permission: "workspace.read" },
  "/api/mobile/version": {
    kind: "public",
    reason: "metadata rilis aplikasi untuk cek pembaruan di perangkat",
  },
  "/api/mobile/apk/latest": {
    kind: "public",
    reason: "unduhan APK rilis resmi yang dipasang pengguna",
  },
  "/api/auth/register": { kind: "public", reason: "bootstrap user pertama" },
  "/api/auth/login": { kind: "public", reason: "login (rate limited + CSRF cookie mode)" },
  "/api/auth/login/2fa": {
    kind: "public",
    reason: "challenge token bertanda tangan dan berumur pendek adalah kredensial",
  },
  "/api/auth/2fa/setup": {
    kind: "permission",
    permission: "workspace.read",
  },
  "/api/auth/2fa/verify-setup": {
    kind: "permission",
    permission: "workspace.read",
  },
  "/api/auth/2fa/disable": {
    kind: "permission",
    permission: "workspace.read",
  },
  "/api/auth/csrf": { kind: "public", reason: "menerbitkan token double-submit" },
  "/api/auth/logout": { kind: "authenticated", reason: "mencabut sesi sendiri" },
  "/api/auth/me": { kind: "authenticated", reason: "identitas sesi sendiri" },
  "/api/auth/active-workspace": {
    kind: "authenticated",
    reason: "pindah active_tenant_id dengan validasi membership",
  },
  "/api/invitations/accept": {
    kind: "public",
    reason: "token undangan adalah kredensial; existing user tetap wajib login",
  },
  "/api/workspaces": {
    kind: "methods",
    methods: {
      GET: { kind: "authenticated", reason: "daftar workspace milik user" },
      POST: { kind: "authenticated", reason: "user membuat workspace miliknya" },
    },
  },
  "/api/workspaces/:id/members": {
    kind: "methods",
    methods: {
      GET: { kind: "permission", permission: "member.read" },
      POST: { kind: "permission", permission: "member.invite" },
    },
  },
  "/api/workspaces/:id/members/direct": {
    kind: "permission",
    permission: "member.invite",
  },
  "/api/workspaces/:id/members/:memberId/password": {
    kind: "permission",
    permission: "member.manage",
  },
  "/api/workspaces/:id/members/:memberId/role": {
    kind: "permission",
    permission: "role.manage",
  },
  "/api/workspaces/:id/members/:memberId/office": {
    kind: "permission",
    permission: "office.manage",
  },
  "/api/workspaces/:id/ownership/transfer": {
    kind: "permission",
    permission: "workspace.manage",
  },
  "/api/workspaces/:id/audit": {
    kind: "permission",
    permission: "audit.read",
  },
  "/api/attendance/check-in": { kind: "permission", permission: "workspace.read" },
  "/api/attendance/check-out": { kind: "permission", permission: "workspace.read" },
  "/api/attendance/me": { kind: "permission", permission: "workspace.read" },
  "/api/attendance/office": { kind: "permission", permission: "workspace.read" },
  "/api/attendance/:id/photo": {
    kind: "permission",
    permission: "workspace.read",
  },
  "/api/workspaces/:id/attendance": {
    kind: "permission",
    permission: "attendance.read",
  },
  "/api/notifications/register-device": {
    kind: "permission",
    permission: "workspace.read",
  },
  "/api/notifications/me": {
    kind: "permission",
    permission: "workspace.read",
  },
  "/api/notifications/:id/read": {
    kind: "permission",
    permission: "workspace.read",
  },
  "/api/notifications/read-all": {
    kind: "permission",
    permission: "workspace.read",
  },
  "/api/corrections": { kind: "permission", permission: "workspace.read" },
  "/api/corrections/me": { kind: "permission", permission: "workspace.read" },
  "/api/corrections/:id": { kind: "permission", permission: "correction.review" },
  "/api/corrections/:id/proof": { kind: "permission", permission: "workspace.read" },
  "/api/workspaces/:id/corrections": {
    kind: "permission",
    permission: "correction.read",
  },
  "/api/workspaces/:id/corrections/bulk": {
    kind: "permission",
    permission: "correction.review",
  },
  "/api/workspaces/:id/dashboard/today": {
    kind: "permission",
    permission: "attendance.read",
  },
  "/api/workspaces/:id/reports/monthly": {
    kind: "permission",
    permission: "attendance.read",
  },
  "/api/workspaces/:id/reports/monthly/export": {
    kind: "permission",
    permission: "attendance.read",
  },
  "/api/workspaces/:id/reports/late-stats": {
    kind: "permission",
    permission: "attendance.read",
  },
  "/api/workspaces/:id/reports/payroll-summary": {
    kind: "permission",
    permission: "attendance.read",
  },
  "/api/workspaces/:id/reports/payroll-summary/export": {
    kind: "permission",
    permission: "attendance.read",
  },
  "/api/workspaces/:id/office": {
    kind: "methods",
    methods: {
      GET: { kind: "permission", permission: "office.manage" },
      POST: { kind: "permission", permission: "office.manage" },
    },
  },
  "/api/workspaces/:id/office/:officeId": {
    kind: "permission",
    permission: "office.manage",
  },
  "/api/overtime": { kind: "permission", permission: "workspace.read" },
  "/api/overtime/me": { kind: "permission", permission: "workspace.read" },
  "/api/overtime/:id": { kind: "permission", permission: "correction.review" },
  "/api/workspaces/:id/overtime": {
    kind: "permission",
    permission: "correction.review",
  },
  "/api/wfh": { kind: "permission", permission: "workspace.read" },
  "/api/wfh/me": { kind: "permission", permission: "workspace.read" },
  "/api/wfh/:id": { kind: "permission", permission: "correction.review" },
  "/api/workspaces/:id/wfh": {
    kind: "permission",
    permission: "correction.review",
  },
  "/api/workspaces/:id/shifts": {
    kind: "permission",
    permission: "office.manage",
  },
  "/api/workspaces/:id/shifts/:shiftId": {
    kind: "permission",
    permission: "office.manage",
  },
  "/api/workspaces/:id/shift-assignments": {
    kind: "permission",
    permission: "office.manage",
  },
  "/api/workspaces/:id/holidays": {
    kind: "permission",
    permission: "workspace.manage",
  },
  "/api/workspaces/:id/holidays/:holidayId": {
    kind: "permission",
    permission: "workspace.manage",
  },
  "/api/workspaces/:id/app-release": {
    kind: "methods",
    methods: {
      GET: { kind: "permission", permission: "workspace.manage" },
      POST: { kind: "permission", permission: "workspace.manage" },
    },
  },
};

/** Ubah path file Next.js menjadi pola route: [id] → :id. */
export function routePatternFromFile(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, "/");
  const marker = "/app/api/";
  const index = normalized.lastIndexOf(marker);
  const apiPath = index >= 0 ? normalized.slice(index + "/app".length) : normalized;
  return apiPath
    .replace(/\/route\.tsx?$/, "")
    .replace(/\/route\.jsx?$/, "")
    .replace(/\[([^\]]+)\]/g, ":$1");
}
