import { createHash, randomUUID } from "node:crypto";

import { systemDb } from "./client.js";
import type { PrismaClient } from "./generated/prisma/client.js";

export const AUDIT_ACTION_MAX_LENGTH = 64;
export const AUDIT_RESOURCE_TYPE_MAX_LENGTH = 64;
export const AUDIT_REQUEST_ID_MAX_LENGTH = 64;
export const AUDIT_USER_AGENT_MAX_LENGTH = 255;
export const REDACTED = "[REDACTED]";

export class AuditInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuditInputError";
  }
}

const SENSITIVE_KEY_PATTERN =
  /(password|passwd|token|secret|authorization|cookie|session|hash|credential|api[_-]?key)/i;

export function isForbiddenMetadataKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERN.test(key);
}

type JsonLike = string | number | boolean | null | JsonLike[] | { [key: string]: JsonLike };

/** Buang field sensitif secara rekursif sebelum metadata ditulis. */
export function sanitizeMetadata(
  meta?: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (meta === null || meta === undefined) return null;
  const walk = (value: unknown, depth: number): JsonLike => {
    if (depth > 8) return REDACTED;
    if (value === null || value === undefined) return null;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      return value;
    }
    if (value instanceof Date) return value.toISOString();
    if (Array.isArray(value)) return value.map((item) => walk(item, depth + 1));
    if (typeof value === "object") {
      const out: Record<string, JsonLike> = {};
      for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
        out[key] = isForbiddenMetadataKey(key) ? REDACTED : walk(nested, depth + 1);
      }
      return out;
    }
    return String(value);
  };
  return walk(meta, 0) as Record<string, unknown>;
}

/** SHA-256 32 byte dari alamat IP; plaintext tidak pernah disimpan. */
export function hashIp(ip: string | null | undefined): Uint8Array<ArrayBuffer> | null {
  if (!ip) return null;
  const digest = createHash("sha256").update(ip).digest();
  return new Uint8Array(digest);
}

export type AuditActorType = "USER" | "SYSTEM" | "SUPER_ADMIN";

export type WriteAuditInput = {
  tenantId: string;
  actorType: AuditActorType;
  actorUserId?: string | null;
  actorMemberId?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  metadata?: Record<string, unknown> | null;
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
};

function assertToken(value: string, max: number, label: string): void {
  if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(value)) {
    throw new AuditInputError(`${label} harus berformat domain.verb`);
  }
  if (value.length > max) {
    throw new AuditInputError(`${label} melebihi ${max} karakter`);
  }
}

export type AuditWriter = Pick<PrismaClient, "auditLog">;

/**
 * Writer audit dapat memakai systemDb() (best-effort) atau transaction client
 * untuk aksi berisiko yang harus rollback bila audit gagal.
 */
export async function writeAudit(
  input: WriteAuditInput,
  client: AuditWriter = systemDb(),
): Promise<string> {
  if (!input.tenantId) throw new AuditInputError("tenantId wajib diisi");
  assertToken(input.action, AUDIT_ACTION_MAX_LENGTH, "action");
  if (!/^[a-z][a-z0-9_.]*$/.test(input.resourceType)) {
    throw new AuditInputError("resourceType harus berupa token huruf kecil");
  }
  if (input.resourceType.length > AUDIT_RESOURCE_TYPE_MAX_LENGTH) {
    throw new AuditInputError(`resourceType melebihi ${AUDIT_RESOURCE_TYPE_MAX_LENGTH} karakter`);
  }
  if (input.requestId && input.requestId.length > AUDIT_REQUEST_ID_MAX_LENGTH) {
    throw new AuditInputError("requestId terlalu panjang");
  }

  const id = randomUUID();
  const metadata = sanitizeMetadata(input.metadata);

  // SYSTEM: audit_logs hanya menerima INSERT; writer ini satu-satunya jalur tulis.
  await client.auditLog.create({
    data: {
      id,
      tenantId: input.tenantId,
      actorType: input.actorType,
      actorUserId: input.actorUserId ?? null,
      actorMemberId: input.actorMemberId ?? null,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId ?? null,
      metadata: metadata as never,
      ipHash: hashIp(input.ip),
      userAgent: input.userAgent?.slice(0, AUDIT_USER_AGENT_MAX_LENGTH) ?? null,
      requestId: input.requestId ?? null,
    },
  });

  return id;
}
