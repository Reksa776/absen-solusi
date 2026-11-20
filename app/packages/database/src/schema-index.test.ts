import assert from "node:assert/strict";
import test from "node:test";

import { createPrismaClient } from "./client.js";
import { assertIsolatedTestDatabase } from "./test-db-guard.js";

type IndexColumn = { indexName: string; columnName: string; seq: number };

test("S-1: audit_logs memiliki index (tenant_id, resource_id)", async () => {
  assert.ok(process.env.DATABASE_URL, "DATABASE_URL wajib untuk test admin");
  assertIsolatedTestDatabase(process.env.DATABASE_URL, "DATABASE_URL");
  const db = createPrismaClient(process.env.DATABASE_URL);
  try {
    const rows = (await db.$queryRawUnsafe(
      `SELECT INDEX_NAME AS indexName, COLUMN_NAME AS columnName, SEQ_IN_INDEX AS seq
       FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'audit_logs'
       ORDER BY INDEX_NAME, SEQ_IN_INDEX`,
    )) as IndexColumn[];
    const grouped = new Map<string, string[]>();
    for (const row of rows) {
      const columns = grouped.get(row.indexName) ?? [];
      columns.push(String(row.columnName));
      grouped.set(row.indexName, columns);
    }
    const found = [...grouped.values()].some(
      (columns) => columns.length === 2 && columns[0] === "tenant_id" && columns[1] === "resource_id",
    );
    assert.equal(found, true, `index audit (tenant_id, resource_id) tidak ada: ${JSON.stringify([...grouped])}`);
  } finally {
    await db.$disconnect();
  }
});
