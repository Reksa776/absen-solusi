import { Prisma, type PrismaClient } from "./generated/prisma/client.js";
import { systemDb } from "./client.js";
import { CrossTenantAccessError, type TenantContext } from "./tenancy.js";

export class TenantModelAccessError extends Error {
  constructor(model: string) {
    super(`Model ${model} tidak boleh diakses lewat withTenant()`);
    this.name = "TenantModelAccessError";
  }
}

export class TenantAppendOnlyError extends Error {
  constructor(action: string) {
    super(`audit_logs bersifat append-only; ${action} ditolak`);
    this.name = "TenantAppendOnlyError";
  }
}

/** Field yang menjadi identitas tenant pada sebuah model. */
export function tenantFieldForModel(model: string): "id" | "tenantId" {
  return model === "Workspace" ? "id" : "tenantId";
}

/**
 * Mutasi data yang mencoba menulis identitas tenant ditolak. Untuk `create`
 * dan `create` pada upsert, nilai top-level tetap diizinkan karena extension
 * akan menimpanya; nilai nested tetap ditolak.
 */
export class TenantWriteScopeError extends Error {
  readonly model: string;
  readonly operation: string;
  readonly field: string;

  constructor(model: string, operation: string, field: string) {
    super(
      `withTenant: operasi ${model}.${operation} ditolak; field ${field} tidak boleh ditulis dari data`,
    );
    this.name = "TenantWriteScopeError";
    this.model = model;
    this.operation = operation;
    this.field = field;
  }
}

/** Nested write tidak melewati extension tenant, jadi harus ditolak. */
export class TenantNestedWriteError extends Error {
  readonly model: string;
  readonly operation: string;
  readonly path: string;

  constructor(model: string, operation: string, path: string) {
    super(
      `withTenant: operasi ${model}.${operation} ditolak; nested write di ${path} harus lewat extension tenant`,
    );
    this.name = "TenantNestedWriteError";
    this.model = model;
    this.operation = operation;
    this.path = path;
  }
}

/** Raw query tidak dapat difilter oleh extension tenant. */
export class TenantRawQueryError extends Error {
  constructor(method: string) {
    super(
      `withTenant: ${method} ditolak; raw query dapat melewati filter tenant. Gunakan operasi Prisma model atau systemDb() dengan alasan SYSTEM.`,
    );
    this.name = "TenantRawQueryError";
  }
}

/** Tabel tenant-scoped; Workspace adalah agregat tenant itu sendiri. */
const TENANT_MODELS = new Set([
  "Workspace",
  "WorkspaceMember",
  "WorkspaceInvitation",
  "Role",
  "RolePermission",
  "MemberRole",
  "AuditLog",
  "OfficeLocation",
  "AttendanceLog",
  "CorrectionRequest",
  "DeviceToken",
  "WorkspaceHoliday",
  "Division",
  "Position",
  "MemberDevice",
  "ApprovalWorkflow",
  "ApprovalStep",
  "ApprovalStepApprover",
  "WorkShift",
  "MemberShift",
  "OvertimeRequest",
  "WfhRequest",
  "InAppNotification",
  "WorkPermit",
  "LeavePolicy",
  "MemberLeaveBalance",
  "LeaveRequest",
  "WarningLetter",
  "BroadcastMessage",
  "CompanyProfile",
  "Client",
  "ClientVisitSetting",
  "ClientVisitSchedule",
  "ClientVisitLog",
  "WorkProjection",
  "PayrollSetting",
  "MemberCompensation",
  "PayrollRun",
  "PayrollItem",
  "WorkPattern",
  "WorkPatternDay",
  "WorkPatternAssignment",
  "AttendanceSetting",
  "OvertimeSetting",
  "OvertimeSchedule",
  "BackgroundJob",
  // BackgroundJobAttempt tidak punya tenant_id; akses harus lewat BackgroundJob.
]);

const READ_OPERATIONS = new Set([
  "findMany",
  "findFirst",
  "findFirstOrThrow",
  "findUnique",
  "findUniqueOrThrow",
  "count",
  "aggregate",
  "groupBy",
]);

const NESTED_WRITE_KEYS = new Set([
  "create",
  "createMany",
  "update",
  "updateMany",
  "upsert",
  "delete",
  "deleteMany",
  "connect",
  "connectOrCreate",
  "disconnect",
  "set",
]);

function tenantWhere(model: string, tenantId: string): Record<string, unknown> {
  return model === "Workspace" ? { id: tenantId } : { tenantId };
}

function mergeWhere(
  model: string,
  tenantId: string,
  where: Record<string, unknown> | undefined,
): Record<string, unknown> {
  // Nilai tenant dari pemanggil selalu ditimpa, bukan digabung.
  return { ...(where ?? {}), ...tenantWhere(model, tenantId) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertNoNestedWrite(
  model: string,
  operation: string,
  value: unknown,
  path: string,
  depth: number,
  allowTopLevelTenant: boolean,
): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      assertNoNestedWrite(model, operation, entry, `${path}[${index}]`, depth, allowTopLevelTenant),
    );
    return;
  }
  if (!isRecord(value)) return;

  const tenantField = tenantFieldForModel(model);
  for (const [key, child] of Object.entries(value)) {
    const childPath = path ? `${path}.${key}` : key;
    if (key === tenantField && !(depth === 0 && allowTopLevelTenant)) {
      throw new TenantWriteScopeError(model, operation, tenantField);
    }
    if (depth > 0 && NESTED_WRITE_KEYS.has(key)) {
      throw new TenantNestedWriteError(model, operation, childPath);
    }
    assertNoNestedWrite(
      model,
      operation,
      child,
      childPath,
      depth + 1,
      allowTopLevelTenant,
    );
  }
}

/**
 * Extension tenant: setiap operasi pada model tenant-scoped otomatis diberi
 * filter tenant_id; model di luar allowlist ditolak. Data mutasi juga
 * diperiksa agar identitas tenant tidak dapat dipindahkan.
 */
function tenantExtension(ctx: TenantContext) {
  return Prisma.defineExtension({
    name: "withTenant",
    query: {
      $allModels: {
        async $allOperations(this: unknown, params: {
          model: string;
          operation: string;
          args: Record<string, unknown>;
          query: (args: unknown) => Promise<unknown>;
        }) {
          const { model, operation, args, query } = params;
          if (!TENANT_MODELS.has(model)) throw new TenantModelAccessError(model);

          if (READ_OPERATIONS.has(operation)) {
            return query({ ...args, where: mergeWhere(model, ctx.tenantId, args.where as never) });
          }

          if (operation === "create") {
            assertNoNestedWrite(model, operation, args.data, "data", 0, true);
            const data = {
              ...((args.data as Record<string, unknown>) ?? {}),
              ...tenantWhere(model, ctx.tenantId),
            };
            return query({ ...args, data });
          }

          if (operation === "createMany") {
            assertNoNestedWrite(model, operation, args.data, "data", 0, true);
            const rows = Array.isArray(args.data) ? args.data : [args.data];
            return query({
              ...args,
              data: rows.map((row) => ({
                ...(row as Record<string, unknown>),
                ...tenantWhere(model, ctx.tenantId),
              })),
            });
          }

          if (operation === "updateMany" || operation === "deleteMany") {
            if (model === "AuditLog") throw new TenantAppendOnlyError(operation);
            if (operation === "updateMany") {
              assertNoNestedWrite(model, operation, args.data, "data", 0, false);
            }
            return query({ ...args, where: mergeWhere(model, ctx.tenantId, args.where as never) });
          }

          if (operation === "update" || operation === "delete" || operation === "upsert") {
            if (model === "AuditLog") throw new TenantAppendOnlyError(operation);
            const where = mergeWhere(model, ctx.tenantId, args.where as never);

            if (operation === "update") {
              assertNoNestedWrite(model, operation, args.data, "data", 0, false);
            }
            if (operation === "upsert") {
              assertNoNestedWrite(model, "upsert.update", args.update, "update", 0, false);
              assertNoNestedWrite(model, "upsert.create", args.create, "create", 0, true);
            }

            try {
              // `where` unik selalu menyertakan tenant_id; baris tenant lain
              // tidak akan cocok dan Prisma mengembalikan P2025.
              return await query(
                operation === "upsert"
                  ? {
                      ...args,
                      where,
                      create: {
                        ...((args.create as Record<string, unknown>) ?? {}),
                        ...tenantWhere(model, ctx.tenantId),
                      },
                    }
                  : { ...args, where },
              );
            } catch (error) {
              if (
                error instanceof Prisma.PrismaClientKnownRequestError &&
                error.code === "P2025"
              ) {
                throw new CrossTenantAccessError();
              }
              throw error;
            }
          }

          throw new TenantModelAccessError(`${model}.${operation}`);
        },
      },
    },
  });
}

export type TenantDb = PrismaClient;

const RAW_METHODS = new Set([
  "$queryRaw",
  "$queryRawUnsafe",
  "$executeRaw",
  "$executeRawUnsafe",
]);

/**
 * Proxy ini menolak raw query pada client dengan tenant context. Raw query
 * tidak bisa difilter otomatis; pemanggil harus memakai operasi model atau
 * systemDb() dengan alasan SYSTEM yang eksplisit.
 */
function guardRawQueries(client: PrismaClient): PrismaClient {
  return new Proxy(client, {
    get(target, property, receiver) {
      if (typeof property === "string" && RAW_METHODS.has(property)) {
        return () => {
          throw new TenantRawQueryError(property);
        };
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as PrismaClient;
}

/**
 * Klien Prisma yang terikat ke satu tenant. Tidak ada overload tanpa context
 * dan tidak ada flag opt-out.
 */
export async function withTenant<T>(
  ctx: TenantContext,
  work: (db: TenantDb) => Promise<T>,
): Promise<T> {
  // SYSTEM: base client hanya fondasi extension; seluruh query yang diterima
  // `work` melewati extension tenant di atas. Raw query ditolak oleh proxy.
  const scoped = systemDb().$extends(tenantExtension(ctx)) as unknown as PrismaClient;
  return work(guardRawQueries(scoped));
}
