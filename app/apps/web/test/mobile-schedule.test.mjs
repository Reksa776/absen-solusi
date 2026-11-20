import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after, before } from "node:test";

import {
  adminClient,
  resetDatabase,
  seedMember,
  seedTenant,
} from "../../../packages/auth/dist/test-support.js";
import { createTenantContext } from "../../../packages/database/dist/index.js";
import { getMobileSchedule } from "../../../packages/auth/dist/mobile-schedule.js";

let db;
let tenant;
let ctx;

before(async () => {
  db = adminClient();
  await resetDatabase(db);
  tenant = await seedTenant(db, { name: "Jadwal A" });
  const employee = await seedMember(db, tenant.tenantId, tenant.roles.VIEWER);
  ctx = createTenantContext({
    tenantId: tenant.tenantId,
    userId: employee.userId,
    memberId: employee.memberId,
    roleKeys: ["VIEWER"],
    permissions: ["workspace.read"],
  });

  await db.officeLocation.create({
    data: {
      id: randomUUID(),
      tenantId: tenant.tenantId,
      name: "HQ Jakarta",
      latitude: -6.2,
      longitude: 106.8,
      radiusMeters: 120,
      timezone: "Asia/Jakarta",
      workStart: "08:30",
      workEnd: "17:30",
    },
  });
  const shift = await db.workShift.create({
    data: {
      id: randomUUID(),
      tenantId: tenant.tenantId,
      name: "Reguler",
      startTime: "09:00",
      endTime: "17:00",
      lateToleranceMinutes: 20,
    },
  });
  await db.memberShift.create({
    data: {
      id: randomUUID(),
      tenantId: tenant.tenantId,
      memberId: employee.memberId,
      shiftId: shift.id,
      workDate: null,
    },
  });
  const year = new Date().getUTCFullYear();
  await db.workspaceHoliday.createMany({
    data: [
      {
        id: randomUUID(),
        tenantId: tenant.tenantId,
        date: new Date(`${year}-08-17T00:00:00.000Z`),
        name: "Libur Nasional Kemerdekaan",
      },
      {
        id: randomUUID(),
        tenantId: tenant.tenantId,
        date: new Date(`${year}-12-24T00:00:00.000Z`),
        name: "Libur perusahaan akhir tahun",
      },
    ],
  });
});

after(async () => {
  if (!db) return;
  await resetDatabase(db);
  await db.$disconnect();
});

test("jadwal mobile memakai shift karyawan dan kantor aktif", async () => {
  const schedule = await getMobileSchedule({ ctx });

  assert.equal(schedule.office?.name, "HQ Jakarta");
  assert.equal(schedule.office?.timezone, "Asia/Jakarta");
  assert.equal(schedule.shift?.name, "Reguler");
  assert.equal(schedule.weekly.length, 7);
  assert.deepEqual(
    schedule.weekly.map((day) => day.label),
    ["Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu", "Minggu"],
  );
  assert.deepEqual(
    schedule.weekly.map((day) => day.isWorkday),
    [true, true, true, true, true, false, false],
  );
  for (const day of schedule.weekly) {
    assert.equal(day.startTime, "09:00");
    assert.equal(day.endTime, "17:00");
    assert.equal(day.lateToleranceMinutes, 20);
  }
});

test("hari libur tahun berjalan diberi jenis nasional atau perusahaan", async () => {
  const schedule = await getMobileSchedule({ ctx });
  assert.equal(schedule.holidays.length, 2);
  assert.equal(schedule.holidays[0]?.type, "NATIONAL");
  assert.equal(schedule.holidays[0]?.date, `${new Date().getUTCFullYear()}-08-17`);
  assert.equal(schedule.holidays[1]?.type, "COMPANY");
});

test("tidak ada kebocoran libur dari tenant lain", async () => {
  const other = await seedTenant(db, { name: "Jadwal B" });
  const otherMember = await seedMember(db, other.tenantId, other.roles.VIEWER);
  await db.workspaceHoliday.create({
    data: {
      id: randomUUID(),
      tenantId: other.tenantId,
      date: new Date(`${new Date().getUTCFullYear()}-01-02T00:00:00.000Z`),
      name: "Libur tenant lain",
    },
  });
  const otherCtx = createTenantContext({
    tenantId: other.tenantId,
    userId: otherMember.userId,
    memberId: otherMember.memberId,
    roleKeys: ["VIEWER"],
    permissions: ["workspace.read"],
  });
  const schedule = await getMobileSchedule({ ctx: otherCtx });
  assert.equal(schedule.holidays.length, 1);
  assert.equal(schedule.holidays[0]?.name, "Libur tenant lain");
  assert.equal(schedule.shift, null);
  // Tanpa shift, jadwal memakai jam kantor sebagai fallback.
  assert.equal(schedule.weekly[0]?.startTime, "09:00");
});
