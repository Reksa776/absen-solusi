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
  "/api/workspaces/:id/attendance/settings": {
    kind: "methods",
    methods: {
      GET: { kind: "permission", permission: "attendance.read" },
      PATCH: { kind: "permission", permission: "member.manage" },
    },
  },
  "/api/workspaces/:id/attendance/records": {
    kind: "permission",
    permission: "attendance.read",
  },
  "/api/workspaces/:id/attendance/records/export": {
    kind: "permission",
    permission: "attendance.read",
  },
  "/api/workspaces/:id/attendance/approvals": {
    kind: "permission",
    permission: "correction.review",
  },
  "/api/workspaces/:id/attendance/approvals/:attendanceId": {
    kind: "permission",
    permission: "correction.review",
  },
  "/api/notifications/register-device": {
    kind: "permission",
    permission: "workspace.read",
  },
  "/api/mobile/push-token": {
    kind: "methods",
    methods: {
      POST: { kind: "permission", permission: "workspace.read" },
      DELETE: { kind: "permission", permission: "workspace.read" },
    },
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
  "/api/workspaces/:id/overtime/settings": {
    kind: "methods",
    methods: {
      GET: { kind: "permission", permission: "correction.review" },
      PATCH: { kind: "permission", permission: "correction.review" },
    },
  },
  "/api/workspaces/:id/overtime/schedules": {
    kind: "methods",
    methods: {
      GET: { kind: "permission", permission: "correction.review" },
      POST: { kind: "permission", permission: "correction.review" },
    },
  },
  "/api/workspaces/:id/overtime/schedules/:scheduleId": {
    kind: "permission",
    permission: "correction.review",
  },
  "/api/wfh": { kind: "permission", permission: "workspace.read" },
  "/api/wfh/me": { kind: "permission", permission: "workspace.read" },
  "/api/wfh/:id": { kind: "permission", permission: "correction.review" },
  "/api/wfh/:id/plan": { kind: "permission", permission: "workspace.read" },
  "/api/workspaces/:id/wfh": {
    kind: "permission",
    permission: "correction.review",
  },
  "/api/workspaces/:id/wfh/:requestId/review": {
    kind: "permission",
    permission: "correction.review",
  },
  "/api/workspaces/:id/work-plans": {
    kind: "permission",
    permission: "attendance.read",
  },
  "/api/mobile/work-plans": {
    kind: "methods",
    methods: {
      GET: { kind: "permission", permission: "workspace.read" },
      POST: { kind: "permission", permission: "workspace.read" },
    },
  },
  "/api/mobile/work-plans/today": {
    kind: "permission",
    permission: "workspace.read",
  },
  "/api/mobile/work-plans/items/:itemId": {
    kind: "methods",
    methods: {
      PATCH: { kind: "permission", permission: "workspace.read" },
      DELETE: { kind: "permission", permission: "workspace.read" },
    },
  },
  "/api/work-plans": {
    kind: "methods",
    methods: {
      GET: { kind: "permission", permission: "workspace.read" },
      POST: { kind: "permission", permission: "workspace.read" },
    },
  },
  "/api/work-plans/today": {
    kind: "permission",
    permission: "workspace.read",
  },
  "/api/work-plans/:planId/attachment": {
    kind: "permission",
    permission: "workspace.read",
  },
  "/api/permits": { kind: "permission", permission: "workspace.read" },
  "/api/permits/me": { kind: "permission", permission: "workspace.read" },
  "/api/permits/:id": { kind: "permission", permission: "correction.review" },
  "/api/permits/:id/proof": { kind: "permission", permission: "workspace.read" },
  "/api/workspaces/:id/permits": {
    kind: "permission",
    permission: "correction.review",
  },
  "/api/leave": { kind: "permission", permission: "workspace.read" },
  "/api/leave/me": { kind: "permission", permission: "workspace.read" },
  "/api/leave/balance": { kind: "permission", permission: "workspace.read" },
  "/api/leave/:id": { kind: "permission", permission: "correction.review" },
  "/api/workspaces/:id/leave": {
    kind: "permission",
    permission: "correction.review",
  },
  "/api/workspaces/:id/leave/report": {
    kind: "permission",
    permission: "correction.review",
  },
  "/api/workspaces/:id/leave/settings": {
    kind: "methods",
    methods: {
      GET: { kind: "permission", permission: "correction.review" },
      PATCH: { kind: "permission", permission: "correction.review" },
    },
  },
  "/api/workspaces/:id/leave/balances/initialize": {
    kind: "permission",
    permission: "correction.review",
  },
  "/api/workspaces/:id/warning-letters": {
    kind: "methods",
    methods: {
      GET: { kind: "permission", permission: "member.read" },
      POST: { kind: "permission", permission: "member.manage" },
    },
  },
  "/api/warning-letters/me": {
    kind: "permission",
    permission: "workspace.read",
  },
  "/api/warning-letters/:id/acknowledge": {
    kind: "permission",
    permission: "workspace.read",
  },
  "/api/workspaces/:id/broadcasts": {
    kind: "methods",
    methods: {
      GET: { kind: "permission", permission: "member.read" },
      POST: { kind: "permission", permission: "member.manage" },
    },
  },
  "/api/workspaces/:id/broadcasts/:broadcastId/publish": {
    kind: "permission",
    permission: "member.manage",
  },
  "/api/broadcasts/me": {
    kind: "permission",
    permission: "workspace.read",
  },
  "/api/workspaces/:id/shifts": {
    kind: "permission",
    permission: "office.manage",
  },
  "/api/workspaces/:id/shifts/:shiftId": {
    kind: "permission",
    permission: "office.manage",
  },
  "/api/workspaces/:id/work-patterns": {
    kind: "methods",
    methods: {
      GET: { kind: "permission", permission: "member.read" },
      POST: { kind: "permission", permission: "member.manage" },
    },
  },
  "/api/workspaces/:id/work-patterns/:patternId": {
    kind: "permission",
    permission: "member.manage",
  },
  "/api/workspaces/:id/work-pattern-assignments": {
    kind: "methods",
    methods: {
      GET: { kind: "permission", permission: "member.read" },
      POST: { kind: "permission", permission: "member.manage" },
    },
  },
  "/api/workspaces/:id/work-pattern-assignments/:memberId": {
    kind: "permission",
    permission: "member.manage",
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
  "/api/workspaces/:id/holidays/import-national": {
    kind: "permission",
    permission: "workspace.manage",
  },
  "/api/workspaces/:id/divisions": {
    kind: "methods",
    methods: {
      GET: { kind: "permission", permission: "member.read" },
      POST: { kind: "permission", permission: "member.manage" },
    },
  },
  "/api/workspaces/:id/divisions/:divisionId": {
    kind: "permission",
    permission: "member.manage",
  },
  "/api/workspaces/:id/positions": {
    kind: "methods",
    methods: {
      GET: { kind: "permission", permission: "member.read" },
      POST: { kind: "permission", permission: "member.manage" },
    },
  },
  "/api/workspaces/:id/positions/:positionId": {
    kind: "permission",
    permission: "member.manage",
  },
  "/api/workspaces/:id/members/:memberId/organization": {
    kind: "permission",
    permission: "member.manage",
  },
  "/api/workspaces/:id/members/:memberId/employee": {
    kind: "permission",
    permission: "member.manage",
  },
  "/api/mobile/profile": {
    kind: "permission",
    permission: "workspace.read",
  },
  "/api/mobile/device": {
    kind: "permission",
    permission: "workspace.read",
  },
  "/api/mobile/profile/photo": {
    kind: "permission",
    permission: "workspace.read",
  },
  "/api/mobile/company/logo": {
    kind: "permission",
    permission: "workspace.read",
  },
  "/api/workspaces/:id/devices": {
    kind: "permission",
    permission: "member.read",
  },
  "/api/workspaces/:id/devices/:deviceId": {
    kind: "permission",
    permission: "member.manage",
  },
  "/api/workspaces/:id/devices/:deviceId/approve": {
    kind: "permission",
    permission: "member.manage",
  },
  "/api/workspaces/:id/devices/:deviceId/reject": {
    kind: "permission",
    permission: "member.manage",
  },
  "/api/workspaces/:id/members/:memberId/devices/reset": {
    kind: "permission",
    permission: "member.manage",
  },
  "/api/workspaces/:id/settings/mobile": {
    kind: "methods",
    methods: {
      GET: { kind: "permission", permission: "member.read" },
      PATCH: { kind: "permission", permission: "member.manage" },
    },
  },
  "/api/workspaces/:id/profile-photos": {
    kind: "permission",
    permission: "correction.review",
  },
  "/api/workspaces/:id/profile-photos/:memberId": {
    kind: "permission",
    permission: "correction.review",
  },
  "/api/workspaces/:id/members/:memberId/photo": {
    kind: "permission",
    permission: "workspace.read",
  },
  "/api/workspaces/:id/attendance-review": {
    kind: "permission",
    permission: "correction.review",
  },
  "/api/workspaces/:id/attendance/summary": {
    kind: "permission",
    permission: "attendance.read",
  },
  "/api/workspaces/:id/attendance/summary/export": {
    kind: "permission",
    permission: "attendance.read",
  },
  "/api/workspaces/:id/attendance/summary/export.xlsx": {
    kind: "permission",
    permission: "attendance.read",
  },
  "/api/workspaces/:id/attendance/:attendanceId/review": {
    kind: "permission",
    permission: "correction.review",
  },
  "/api/workspaces/:id/approval-workflows": {
    kind: "methods",
    methods: {
      GET: { kind: "permission", permission: "member.read" },
      POST: { kind: "permission", permission: "member.manage" },
    },
  },
  "/api/workspaces/:id/approval-workflows/:requestType": {
    kind: "permission",
    permission: "member.manage",
  },
  "/api/workspaces/:id/app-release": {
    kind: "methods",
    methods: {
      GET: { kind: "permission", permission: "workspace.manage" },
      POST: { kind: "permission", permission: "workspace.manage" },
    },
  },
  "/api/workspaces/:id/clients": {
    kind: "methods",
    methods: {
      GET: { kind: "permission", permission: "attendance.read" },
      POST: { kind: "permission", permission: "member.manage" },
    },
  },
  "/api/workspaces/:id/clients/:clientId": {
    kind: "permission",
    permission: "member.manage",
  },
  "/api/workspaces/:id/client-visits": {
    kind: "methods",
    methods: {
      GET: { kind: "permission", permission: "attendance.read" },
      POST: { kind: "permission", permission: "member.manage" },
    },
  },
  "/api/workspaces/:id/client-visits/logs": {
    kind: "permission",
    permission: "attendance.read",
  },
  "/api/workspaces/:id/client-visits/export.xlsx": {
    kind: "permission",
    permission: "attendance.read",
  },
  "/api/workspaces/:id/client-visits/logs/:logId/review": {
    kind: "permission",
    permission: "member.manage",
  },
  "/api/workspaces/:id/client-visits/logs/:logId/photo": {
    kind: "permission",
    permission: "workspace.read",
  },
  "/api/workspaces/:id/client-visits/summary": {
    kind: "permission",
    permission: "attendance.read",
  },
  "/api/workspaces/:id/client-visits/insights": {
    kind: "permission",
    permission: "attendance.read",
  },
  "/api/workspaces/:id/client-visits/settings": {
    kind: "methods",
    methods: {
      GET: { kind: "permission", permission: "attendance.read" },
      PATCH: { kind: "permission", permission: "member.manage" },
    },
  },
  "/api/workspaces/:id/work-projections": {
    kind: "permission",
    permission: "attendance.read",
  },
  "/api/workspaces/:id/work-projections/:projectionId/review": {
    kind: "permission",
    permission: "member.manage",
  },
  "/api/workspaces/:id/settings/company": {
    kind: "methods",
    methods: {
      GET: { kind: "permission", permission: "workspace.read" },
      PATCH: { kind: "permission", permission: "workspace.manage" },
    },
  },
  "/api/workspaces/:id/settings/company/logo": {
    kind: "methods",
    methods: {
      GET: { kind: "permission", permission: "workspace.read" },
      POST: { kind: "permission", permission: "workspace.manage" },
      DELETE: { kind: "permission", permission: "workspace.manage" },
    },
  },
  "/api/workspaces/:id/payroll/settings": {
    kind: "permission",
    permission: "member.manage",
  },
  "/api/workspaces/:id/payroll/compensations": {
    kind: "permission",
    permission: "member.manage",
  },
  "/api/workspaces/:id/payroll/compensations/:memberId": {
    kind: "permission",
    permission: "member.manage",
  },
  "/api/workspaces/:id/payroll/preview": {
    kind: "permission",
    permission: "member.manage",
  },
  "/api/workspaces/:id/payroll/runs": {
    kind: "permission",
    permission: "member.manage",
  },
  "/api/workspaces/:id/payroll/runs/:runId": {
    kind: "permission",
    permission: "member.manage",
  },
  "/api/workspaces/:id/payroll/runs/:runId/finalize": {
    kind: "permission",
    permission: "member.manage",
  },
  "/api/workspaces/:id/payroll/runs/:runId/pay": {
    kind: "permission",
    permission: "member.manage",
  },
  "/api/workspaces/:id/payroll/runs/:runId/csv": {
    kind: "permission",
    permission: "member.manage",
  },
  "/api/workspaces/:id/payroll/slips/:runId": {
    kind: "permission",
    permission: "member.manage",
  },
  "/api/mobile/client-visits": {
    kind: "permission",
    permission: "workspace.read",
  },
  "/api/mobile/client-visits/:scheduleId": {
    kind: "permission",
    permission: "workspace.read",
  },
  "/api/mobile/client-visits/logs/:logId/photo": {
    kind: "permission",
    permission: "workspace.read",
  },
  "/api/mobile/work-projections": {
    kind: "permission",
    permission: "workspace.read",
  },
  "/api/mobile/work-projections/:projectionId": {
    kind: "permission",
    permission: "workspace.read",
  },
  "/api/mobile/payslips": {
    kind: "permission",
    permission: "workspace.read",
  },
  "/api/mobile/payslips/:runId": {
    kind: "permission",
    permission: "workspace.read",
  },
  "/api/mobile/overtime/schedules": {
    kind: "permission",
    permission: "workspace.read",
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
