import { randomUUID } from "node:crypto";

import { systemDb } from "./client.js";
import { writeAudit, type WriteAuditInput } from "./audit.js";
import type { PrismaClient } from "./generated/prisma/client.js";

export const AUDIT_OUTBOX_TYPE = "audit.outbox";
export const AUDIT_OUTBOX_RETRY_DELAY_MS = 60_000;

/**
 * Aksi non-risiko boleh kehilangan audit sesaat, tetapi tidak boleh hilang
 * permanen. Payload disimpan di background_jobs; retry memakai writeAudit yang
 * sama sehingga redaksi metadata tetap berlaku.
 */
export async function enqueueAuditOutbox(
  input: WriteAuditInput,
  client: PrismaClient = systemDb(),
): Promise<string> {
  const id = randomUUID();
  await client.backgroundJob.create({
    data: {
      id,
      tenantId: input.tenantId,
      type: AUDIT_OUTBOX_TYPE,
      payload: input as never,
      status: "PENDING",
      idempotencyKey: `audit-outbox:${id}`,
      runAt: new Date(),
    },
  });
  return id;
}

export type RetryAuditOutboxResult = {
  attempted: number;
  completed: number;
  failed: number;
};

export async function retryAuditOutbox(
  options: { limit?: number; now?: Date; client?: PrismaClient } = {},
): Promise<RetryAuditOutboxResult> {
  const client = options.client ?? systemDb();
  const now = options.now ?? new Date();
  const jobs = await client.backgroundJob.findMany({
    where: {
      type: AUDIT_OUTBOX_TYPE,
      status: "PENDING",
      runAt: { lte: now },
    },
    orderBy: [{ runAt: "asc" }, { createdAt: "asc" }],
    take: options.limit ?? 50,
  });

  let completed = 0;
  let failed = 0;
  for (const job of jobs) {
    try {
      await writeAudit(job.payload as unknown as WriteAuditInput, client);
      await client.backgroundJob.update({
        where: { id: job.id },
        data: { status: "COMPLETED", attempts: { increment: 1 } },
      });
      completed += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 1000) : "audit retry failed";
      await client.backgroundJob.update({
        where: { id: job.id },
        data: {
          attempts: { increment: 1 },
          runAt: new Date(now.getTime() + AUDIT_OUTBOX_RETRY_DELAY_MS),
        },
      });
      await client.backgroundJobAttempt.create({
        data: {
          id: randomUUID(),
          jobId: job.id,
          attempt: job.attempts + 1,
          status: "FAILED",
          error: message,
          startedAt: now,
          finishedAt: new Date(),
        },
      });
      failed += 1;
    }
  }

  return { attempted: jobs.length, completed, failed };
}
