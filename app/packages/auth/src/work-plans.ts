import { randomUUID } from "node:crypto";

import {
  isUuid,
  withTenant,
  writeAudit,
  type Prisma,
  type TenantContext,
} from "@absensi/database";

import { HttpError } from "./http.js";
import { parseReportDay, startOfUtcDay } from "./reports.js";
import {
  storeWorkPlanAttachment,
  type WorkPlanAttachmentInput,
} from "./work-plan-attachment.js";
import { assertWorkspaceReadClaim } from "./workspaces.js";

/** Mode kerja yang didukung presensi dan pengajuan. */
export const WORK_MODES = ["WFO", "WFH", "WFC"] as const;
export type WorkMode = (typeof WORK_MODES)[number];
export type RemoteWorkMode = "WFH" | "WFC";

export const WORK_PLAN_MAX_ITEMS = 30;
export const WORK_PLAN_ITEM_MAX_LENGTH = 255;
export const WORK_PLAN_LOCATION_MAX_LENGTH = 255;
export const WORK_PLAN_SUMMARY_MAX_LENGTH = 1000;

export type WorkPlanItemSummary = {
  id: string;
  title: string;
  isCompleted: boolean;
  completedAt: string | null;
  proofUrl: string | null;
  sortOrder: number;
};

export type WorkPlanSummary = {
  id: string;
  memberId: string;
  memberName: string | null;
  attendanceId: string | null;
  requestId: string | null;
  workMode: RemoteWorkMode;
  date: string;
  locationNote: string | null;
  planAttachmentUrl: string | null;
  summaryNote: string | null;
  items: WorkPlanItemSummary[];
  completedCount: number;
  totalCount: number;
  createdAt: string;
  updatedAt: string;
};

const WORK_PLAN_INCLUDE = {
  items: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
  member: { include: { user: { select: { name: true } } } },
} satisfies Prisma.WorkPlanInclude;

function canReview(ctx: TenantContext): boolean {
  return (
    ctx.permissions.includes("correction.review") ||
    ctx.permissions.includes("attendance.read") ||
    ctx.permissions.includes("member.manage")
  );
}

/** Terima `WFH`/`WFC` (case-insensitive); nilai lain ditolak. */
export function parseRemoteWorkMode(
  value: unknown,
  fallback: RemoteWorkMode = "WFH",
): RemoteWorkMode {
  if (value === undefined || value === null || value === "") return fallback;
  const normalized = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (normalized === "WFH" || normalized === "WFC") return normalized;
  throw new HttpError(400, "INVALID_WORK_MODE", "Mode kerja harus WFH atau WFC");
}

/** Normalisasi mode kerja presensi; WFO dan OFFICE dianggap sama. */
export function parseAttendanceWorkMode(value: unknown): WorkMode | "OUT_OF_TOWN" {
  if (typeof value !== "string") return "WFO";
  const normalized = value.trim().toUpperCase();
  if (normalized === "WFH") return "WFH";
  if (normalized === "WFC") return "WFC";
  if (normalized === "OUT_OF_TOWN") return "OUT_OF_TOWN";
  return "WFO";
}

export function workPlanDay(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function normalizeLocation(
  value: unknown,
  mode: RemoteWorkMode,
): string | null {
  const text = typeof value === "string" ? value.trim() : "";
  if (text.length > WORK_PLAN_LOCATION_MAX_LENGTH) {
    throw new HttpError(
      400,
      "INVALID_LOCATION",
      `Lokasi kerja maksimal ${WORK_PLAN_LOCATION_MAX_LENGTH} karakter`,
    );
  }
  if (!text) return mode === "WFH" ? "Rumah" : null;
  return text;
}

function normalizeSummary(value: unknown): string | null {
  const text = typeof value === "string" ? value.trim() : "";
  if (text.length > WORK_PLAN_SUMMARY_MAX_LENGTH) {
    throw new HttpError(
      400,
      "INVALID_SUMMARY",
      `Ringkasan rencana maksimal ${WORK_PLAN_SUMMARY_MAX_LENGTH} karakter`,
    );
  }
  return text || null;
}

/** Daftar judul tugas dari array maupun string JSON/form. */
export function parseWorkPlanItemTitles(
  value: unknown,
  options: { required: boolean },
): string[] {
  let raw: unknown = value;
  if (typeof raw === "string") {
    const text = raw.trim();
    if (!text) {
      raw = [];
    } else {
      try {
        raw = JSON.parse(text);
      } catch {
        raw = text.split("\n");
      }
    }
  }
  if (raw === undefined || raw === null) raw = [];
  if (!Array.isArray(raw)) {
    throw new HttpError(400, "INVALID_WORK_PLAN", "Daftar rencana kerja tidak valid");
  }
  const titles: string[] = [];
  for (const item of raw) {
    if (typeof item === "object" && item !== null && "title" in item) {
      const title = (item as { title?: unknown }).title;
      if (typeof title !== "string") {
        throw new HttpError(400, "INVALID_WORK_PLAN", "Judul rencana kerja tidak valid");
      }
      appendTitle(titles, title);
      continue;
    }
    if (typeof item !== "string") {
      throw new HttpError(400, "INVALID_WORK_PLAN", "Judul rencana kerja tidak valid");
    }
    appendTitle(titles, item);
  }
  if (options.required && titles.length === 0) {
    throw new HttpError(
      400,
      "WORK_PLAN_REQUIRED",
      "Rencana kerja minimal 1 tugas untuk WFH atau WFC",
    );
  }
  return titles;
}

function appendTitle(titles: string[], value: string): void {
  const title = value.trim();
  if (!title) return;
  if (title.length > WORK_PLAN_ITEM_MAX_LENGTH) {
    throw new HttpError(
      400,
      "INVALID_WORK_PLAN_ITEM",
      `Judul tugas maksimal ${WORK_PLAN_ITEM_MAX_LENGTH} karakter`,
    );
  }
  if (titles.length >= WORK_PLAN_MAX_ITEMS) {
    throw new HttpError(
      400,
      "WORK_PLAN_TOO_MANY",
      `Rencana kerja maksimal ${WORK_PLAN_MAX_ITEMS} tugas`,
    );
  }
  titles.push(title);
}

function toItemSummary(row: {
  id: string;
  title: string;
  isCompleted: boolean;
  completedAt: Date | null;
  proofUrl: string | null;
  sortOrder: number;
}): WorkPlanItemSummary {
  return {
    id: row.id,
    title: row.title,
    isCompleted: row.isCompleted,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    proofUrl: row.proofUrl,
    sortOrder: row.sortOrder,
  };
}

type WorkPlanRow = Prisma.WorkPlanGetPayload<{ include: typeof WORK_PLAN_INCLUDE }>;

function toSummary(row: WorkPlanRow): WorkPlanSummary {
  const items = row.items.map(toItemSummary);
  return {
    id: row.id,
    memberId: row.memberId,
    memberName: row.member?.user.name ?? null,
    attendanceId: row.attendanceId,
    requestId: row.requestId,
    workMode: row.workMode === "WFC" ? "WFC" : "WFH",
    date: workPlanDay(row.date),
    locationNote: row.locationNote,
    planAttachmentUrl: row.planAttachmentUrl,
    summaryNote: row.summaryNote,
    items,
    completedCount: items.filter((item) => item.isCompleted).length,
    totalCount: items.length,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export type UpsertWorkPlanInput = {
  tenantId: string;
  memberId: string;
  id?: string | null;
  date: Date;
  workMode: RemoteWorkMode;
  locationNote?: string | null;
  summaryNote?: string | null;
  planAttachmentUrl?: string | null;
  attendanceId?: string | null;
  requestId?: string | null;
  items?: string[] | null;
};

/**
 * Buat/perbarui rencana kerja satu hari untuk satu member. Dipakai bersama
 * oleh pengajuan WFH/WFC dan check-in agar keduanya merujuk baris yang sama.
 */
type WorkPlanDb = Pick<Prisma.TransactionClient, "workPlan" | "workPlanItem">;

export async function upsertWorkPlanRecord(
  tx: WorkPlanDb,
  input: UpsertWorkPlanInput,
): Promise<{ id: string }> {
  const existing = await tx.workPlan.findFirst({
    where: { memberId: input.memberId, date: input.date },
    include: { items: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] } },
  });
  const locationNote = normalizeLocation(
    input.locationNote ?? existing?.locationNote,
    input.workMode,
  );
  if (input.workMode === "WFC" && !locationNote) {
    throw new HttpError(
      400,
      "LOCATION_REQUIRED",
      "Nama cafe/coworking/lokasi kerja wajib diisi untuk WFC",
    );
  }
  const summaryNote = normalizeSummary(
    input.summaryNote ?? existing?.summaryNote,
  );
  const planId = existing?.id ?? (input.id && isUuid(input.id) ? input.id : randomUUID());

  const plan = existing
    ? await tx.workPlan.update({
        where: { tenantId_id: { tenantId: input.tenantId, id: existing.id } },
        data: {
          workMode: input.workMode,
          locationNote,
          summaryNote,
          ...(input.planAttachmentUrl !== undefined && input.planAttachmentUrl !== null
            ? { planAttachmentUrl: input.planAttachmentUrl }
            : {}),
          ...(input.attendanceId !== undefined && input.attendanceId !== null
            ? { attendanceId: input.attendanceId }
            : {}),
          ...(input.requestId !== undefined && input.requestId !== null
            ? { requestId: input.requestId }
            : {}),
        },
      })
    : await tx.workPlan.create({
        data: {
          id: planId,
          tenantId: input.tenantId,
          memberId: input.memberId,
          date: input.date,
          workMode: input.workMode,
          locationNote,
          summaryNote,
          planAttachmentUrl: input.planAttachmentUrl ?? null,
          attendanceId: input.attendanceId ?? null,
          requestId: input.requestId ?? null,
        },
      });

  if (input.items && input.items.length > 0) {
    const previous = existing?.items ?? [];
    const used = new Set<string>();
    for (let index = 0; index < input.items.length; index += 1) {
      const title = input.items[index]!;
      const match = previous.find((row) => !used.has(row.id) && row.title === title);
      if (match) {
        used.add(match.id);
        if (match.sortOrder !== index) {
          await tx.workPlanItem.update({
            where: { id: match.id },
            data: { sortOrder: index },
          });
        }
      } else {
        await tx.workPlanItem.create({
          data: {
            id: randomUUID(),
            tenantId: input.tenantId,
            workPlanId: plan.id,
            title,
            sortOrder: index,
          },
        });
      }
    }
    const removed = previous.filter((row) => !used.has(row.id));
    if (removed.length > 0) {
      await tx.workPlanItem.deleteMany({
        where: { id: { in: removed.map((row) => row.id) } },
      });
    }
  }
  return { id: plan.id };
}

export async function getTodayWorkPlan(input: {
  ctx: TenantContext;
  date?: string | undefined;
  now?: Date;
}): Promise<WorkPlanSummary | null> {
  const date = input.date
    ? parseReportDay(input.date, "date")
    : startOfUtcDay(input.now ?? new Date());
  const row = await withTenant(input.ctx, (db) =>
    db.workPlan.findFirst({
      where: { memberId: input.ctx.memberId, date },
      include: WORK_PLAN_INCLUDE,
    }),
  );
  return row ? toSummary(row) : null;
}

export async function saveWorkPlan(input: {
  ctx: TenantContext;
  body: Record<string, unknown>;
  attachment?: WorkPlanAttachmentInput | undefined;
  ip?: string | null;
  userAgent?: string | null;
  now?: Date;
}): Promise<WorkPlanSummary> {
  const mode = parseRemoteWorkMode(input.body.workMode ?? input.body.work_mode);
  const date = input.body.date
    ? parseReportDay(String(input.body.date), "date")
    : startOfUtcDay(input.now ?? new Date());
  const today = startOfUtcDay(input.now ?? new Date());
  if (date.getTime() < today.getTime()) {
    throw new HttpError(400, "INVALID_DATE", "Rencana kerja tidak boleh di masa lalu");
  }
  const items = parseWorkPlanItemTitles(
    input.body.items ?? input.body.workPlanItems ?? input.body.work_plan_items,
    { required: true },
  );
  const planId = randomUUID();
  const stored = input.attachment
    ? await storeWorkPlanAttachment(planId, input.attachment)
    : null;

  const row = await withTenant(input.ctx, (db) =>
    db.$transaction(async (tx) => {
      await upsertWorkPlanRecord(tx, {
        tenantId: input.ctx.tenantId,
        memberId: input.ctx.memberId,
        id: planId,
        date,
        workMode: mode,
        locationNote:
          typeof input.body.locationNote === "string"
            ? input.body.locationNote
            : typeof input.body.location_note === "string"
              ? input.body.location_note
              : null,
        summaryNote:
          typeof input.body.summaryNote === "string"
            ? input.body.summaryNote
            : null,
        planAttachmentUrl: stored?.url ?? null,
        items,
      });
      const saved = await tx.workPlan.findFirstOrThrow({
        where: { memberId: input.ctx.memberId, date },
        include: WORK_PLAN_INCLUDE,
      });
      await writeAudit(
        {
          tenantId: input.ctx.tenantId,
          actorType: "USER",
          actorUserId: input.ctx.userId,
          actorMemberId: input.ctx.memberId,
          action: "work_plan.save",
          resourceType: "work_plan",
          resourceId: saved.id,
          metadata: {
            workMode: mode,
            date: workPlanDay(date),
            itemCount: items.length,
            hasAttachment: Boolean(stored),
          },
          ip: input.ip ?? null,
          userAgent: input.userAgent ?? null,
        },
        tx,
      );
      return saved;
    }),
  );
  return toSummary(row);
}

async function loadOwnedItem(
  ctx: TenantContext,
  itemId: string,
): Promise<{
  item: {
    id: string;
    title: string;
    isCompleted: boolean;
    completedAt: Date | null;
    proofUrl: string | null;
    sortOrder: number;
  };
  plan: { id: string; memberId: string; date: Date; attendanceId: string | null };
}> {
  if (!isUuid(itemId)) {
    throw new HttpError(400, "INVALID_WORK_PLAN_ITEM", "Item rencana kerja tidak valid");
  }
  const row = await withTenant(ctx, (db) =>
    db.workPlanItem.findFirst({
      where: { id: itemId },
      include: {
        workPlan: {
          select: { id: true, memberId: true, date: true, attendanceId: true },
        },
      },
    }),
  );
  if (!row) {
    throw new HttpError(404, "WORK_PLAN_ITEM_NOT_FOUND", "Item rencana kerja tidak ditemukan");
  }
  if (row.workPlan.memberId !== ctx.memberId) {
    throw new HttpError(403, "FORBIDDEN", "Item rencana kerja bukan milik Anda");
  }
  return { item: row, plan: row.workPlan };
}

async function assertPlanOpen(
  tx: Prisma.TransactionClient,
  plan: { memberId: string; date: Date },
): Promise<void> {
  const checkOut = await tx.attendanceLog.findFirst({
    where: { memberId: plan.memberId, workDate: plan.date, type: "CHECK_OUT" },
    select: { id: true },
  });
  if (checkOut) {
    throw new HttpError(
      409,
      "WORK_PLAN_LOCKED",
      "Rencana kerja tidak dapat diubah setelah check-out",
    );
  }
}

export async function addWorkPlanItem(input: {
  ctx: TenantContext;
  planId: string;
  title: string;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<WorkPlanSummary> {
  if (!isUuid(input.planId)) {
    throw new HttpError(400, "INVALID_WORK_PLAN", "Rencana kerja tidak valid");
  }
  const title = input.title.trim();
  if (!title) {
    throw new HttpError(400, "INVALID_WORK_PLAN_ITEM", "Judul tugas wajib diisi");
  }
  if (title.length > WORK_PLAN_ITEM_MAX_LENGTH) {
    throw new HttpError(
      400,
      "INVALID_WORK_PLAN_ITEM",
      `Judul tugas maksimal ${WORK_PLAN_ITEM_MAX_LENGTH} karakter`,
    );
  }
  const saved = await withTenant(input.ctx, (db) =>
    db.$transaction(async (tx) => {
      const plan = await tx.workPlan.findFirst({
        where: { id: input.planId },
        include: { items: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] } },
      });
      if (!plan) {
        throw new HttpError(404, "WORK_PLAN_NOT_FOUND", "Rencana kerja tidak ditemukan");
      }
      if (plan.memberId !== input.ctx.memberId) {
        throw new HttpError(403, "FORBIDDEN", "Rencana kerja bukan milik Anda");
      }
      await assertPlanOpen(tx, plan);
      if (plan.items.length >= WORK_PLAN_MAX_ITEMS) {
        throw new HttpError(
          400,
          "WORK_PLAN_TOO_MANY",
          `Rencana kerja maksimal ${WORK_PLAN_MAX_ITEMS} tugas`,
        );
      }
      await tx.workPlanItem.create({
        data: {
          id: randomUUID(),
          tenantId: input.ctx.tenantId,
          workPlanId: plan.id,
          title,
          sortOrder: plan.items.length,
        },
      });
      await writeAudit(
        {
          tenantId: input.ctx.tenantId,
          actorType: "USER",
          actorUserId: input.ctx.userId,
          actorMemberId: input.ctx.memberId,
          action: "work_plan.item_add",
          resourceType: "work_plan",
          resourceId: plan.id,
          metadata: { date: workPlanDay(plan.date) },
          ip: input.ip ?? null,
          userAgent: input.userAgent ?? null,
        },
        tx,
      );
      return tx.workPlan.findFirstOrThrow({
        where: { id: plan.id },
        include: WORK_PLAN_INCLUDE,
      });
    }),
  );
  return toSummary(saved);
}

export async function updateWorkPlanItem(input: {
  ctx: TenantContext;
  itemId: string;
  body: Record<string, unknown>;
  ip?: string | null;
  userAgent?: string | null;
  now?: Date;
}): Promise<WorkPlanSummary> {
  const title =
    typeof input.body.title === "string" ? input.body.title.trim() : undefined;
  if (title !== undefined && !title) {
    throw new HttpError(400, "INVALID_WORK_PLAN_ITEM", "Judul tugas wajib diisi");
  }
  if (title !== undefined && title.length > WORK_PLAN_ITEM_MAX_LENGTH) {
    throw new HttpError(
      400,
      "INVALID_WORK_PLAN_ITEM",
      `Judul tugas maksimal ${WORK_PLAN_ITEM_MAX_LENGTH} karakter`,
    );
  }
  const completedRaw = input.body.isCompleted ?? input.body.is_completed;
  const isCompleted = typeof completedRaw === "boolean" ? completedRaw : undefined;
  if (isCompleted === undefined && title === undefined) {
    throw new HttpError(
      400,
      "INVALID_WORK_PLAN_ITEM",
      "Kirim isCompleted atau title untuk memperbarui item",
    );
  }

  const saved = await withTenant(input.ctx, (db) =>
    db.$transaction(async (tx) => {
      const owned = await loadOwnedItem(input.ctx, input.itemId);
      await assertPlanOpen(tx, owned.plan);
      await tx.workPlanItem.update({
        where: { id: owned.item.id },
        data: {
          ...(title !== undefined ? { title } : {}),
          ...(isCompleted !== undefined
            ? {
                isCompleted,
                completedAt: isCompleted ? input.now ?? new Date() : null,
              }
            : {}),
        },
      });
      await writeAudit(
        {
          tenantId: input.ctx.tenantId,
          actorType: "USER",
          actorUserId: input.ctx.userId,
          actorMemberId: input.ctx.memberId,
          action: "work_plan.item_update",
          resourceType: "work_plan",
          resourceId: owned.plan.id,
          metadata: {
            itemId: owned.item.id,
            ...(isCompleted !== undefined ? { isCompleted } : {}),
          },
          ip: input.ip ?? null,
          userAgent: input.userAgent ?? null,
        },
        tx,
      );
      return tx.workPlan.findFirstOrThrow({
        where: { id: owned.plan.id },
        include: WORK_PLAN_INCLUDE,
      });
    }),
  );
  return toSummary(saved);
}

export async function deleteWorkPlanItem(input: {
  ctx: TenantContext;
  itemId: string;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<WorkPlanSummary> {
  const saved = await withTenant(input.ctx, (db) =>
    db.$transaction(async (tx) => {
      const owned = await loadOwnedItem(input.ctx, input.itemId);
      await assertPlanOpen(tx, owned.plan);
      const count = await tx.workPlanItem.count({
        where: { workPlanId: owned.plan.id },
      });
      if (count <= 1) {
        throw new HttpError(
          409,
          "WORK_PLAN_LAST_ITEM",
          "Rencana kerja minimal memiliki satu tugas",
        );
      }
      await tx.workPlanItem.delete({ where: { id: owned.item.id } });
      await writeAudit(
        {
          tenantId: input.ctx.tenantId,
          actorType: "USER",
          actorUserId: input.ctx.userId,
          actorMemberId: input.ctx.memberId,
          action: "work_plan.item_delete",
          resourceType: "work_plan",
          resourceId: owned.plan.id,
          metadata: { itemId: owned.item.id },
          ip: input.ip ?? null,
          userAgent: input.userAgent ?? null,
        },
        tx,
      );
      return tx.workPlan.findFirstOrThrow({
        where: { id: owned.plan.id },
        include: WORK_PLAN_INCLUDE,
      });
    }),
  );
  return toSummary(saved);
}

export async function listWorkspaceWorkPlans(input: {
  ctx: TenantContext;
  workspaceId: string;
  date?: string | undefined;
  memberId?: string | undefined;
}): Promise<WorkPlanSummary[]> {
  if (!canReview(input.ctx)) {
    throw new HttpError(403, "FORBIDDEN", "Permission tidak mencukupi");
  }
  assertWorkspaceReadClaim(input.ctx, input.workspaceId);
  if (input.memberId && !isUuid(input.memberId)) {
    throw new HttpError(400, "INVALID_MEMBER", "Karyawan tidak valid");
  }
  const date = input.date ? parseReportDay(input.date, "date") : undefined;
  const rows = await withTenant(input.ctx, (db) =>
    db.workPlan.findMany({
      where: {
        ...(date ? { date } : {}),
        ...(input.memberId ? { memberId: input.memberId } : {}),
      },
      include: WORK_PLAN_INCLUDE,
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      take: 200,
    }),
  );
  return rows.map(toSummary);
}
