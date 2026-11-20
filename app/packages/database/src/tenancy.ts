// Tenant context bertanda (branded): hanya bisa dibuat lewat createTenantContext()
// setelah membership diverifikasi server-side.

declare const tenantContextBrand: unique symbol;

export type TenantContext = {
  readonly tenantId: string;
  readonly userId: string;
  readonly memberId: string;
  readonly roleKeys: readonly string[];
  readonly permissions: readonly string[];
  readonly [tenantContextBrand]: true;
};

export type TenantContextInput = {
  tenantId: string;
  userId: string;
  memberId: string;
  roleKeys: readonly string[];
  permissions: readonly string[];
};

export class TenantContextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TenantContextError";
  }
}

export class CrossTenantAccessError extends Error {
  constructor(message = "Akses lintas tenant ditolak") {
    super(message);
    this.name = "CrossTenantAccessError";
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

export function createTenantContext(input: TenantContextInput): TenantContext {
  if (!input.tenantId || !isUuid(input.tenantId)) {
    throw new TenantContextError("tenantId tidak valid");
  }
  if (!input.userId || !isUuid(input.userId)) {
    throw new TenantContextError("userId tidak valid");
  }
  if (!input.memberId || !isUuid(input.memberId)) {
    throw new TenantContextError("memberId tidak valid");
  }
  return Object.freeze({
    ...input,
    roleKeys: Object.freeze([...input.roleKeys]),
    permissions: Object.freeze([...input.permissions]),
  }) as unknown as TenantContext;
}

export function hasPermission(ctx: TenantContext, permission: string): boolean {
  return ctx.permissions.includes(permission);
}

export function tenantScope(ctx: TenantContext): { tenantId: string } {
  return { tenantId: ctx.tenantId };
}

export function assertSameTenant(
  ctx: TenantContext,
  rowTenantId: string | null | undefined,
): void {
  if (!rowTenantId || rowTenantId !== ctx.tenantId) {
    throw new CrossTenantAccessError();
  }
}
