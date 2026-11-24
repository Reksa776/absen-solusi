import assert from "node:assert/strict";
import test from "node:test";

import { calculateWorkingDays } from "../../../packages/auth/dist/leave.js";
import {
  evaluateAttendanceSchedule,
  workPatternRuleFor,
  createWorkPatternRuleIndex,
} from "../../../packages/auth/dist/work-pattern-schedule.js";

const saturdayRule = {
  workPatternId: "pattern-1",
  workPatternName: "Kantor Sabtu Pendek",
  timezone: "Asia/Jakarta",
  dayOfWeek: 6,
  isWorkday: true,
  startTime: "08:00",
  endTime: "13:00",
  earliestCheckInMinutes: 90,
  lateToleranceMinutes: 10,
};

test("Sabtu aktif: check-in dalam toleransi ON_TIME, lewat toleransi LATE", () => {
  const onTime = evaluateAttendanceSchedule({
    type: "CHECK_IN",
    at: new Date("2026-11-07T01:10:00.000Z"),
    rule: saturdayRule,
    timezone: "Asia/Jakarta",
  });
  assert.deepEqual(onTime, { status: "ON_TIME", lateMinutes: 0, earlyLeaveMinutes: 0 });

  const late = evaluateAttendanceSchedule({
    type: "CHECK_IN",
    at: new Date("2026-11-07T01:11:00.000Z"),
    rule: saturdayRule,
    timezone: "Asia/Jakarta",
  });
  assert.equal(late.status, "LATE");
  assert.equal(late.lateMinutes, 1);
});

test("Sabtu aktif: check-out sebelum 13:00 menghasilkan EARLY_LEAVE", () => {
  const early = evaluateAttendanceSchedule({
    type: "CHECK_OUT",
    at: new Date("2026-11-07T05:30:00.000Z"),
    rule: saturdayRule,
    timezone: "Asia/Jakarta",
  });
  assert.equal(early.status, "EARLY_LEAVE");
  assert.equal(early.earlyLeaveMinutes, 30);
});

test("Minggu non-workday menghasilkan OFF_DAY", () => {
  const sundayRule = {
    ...saturdayRule,
    dayOfWeek: 0,
    isWorkday: false,
  };
  const result = evaluateAttendanceSchedule({
    type: "CHECK_IN",
    at: new Date("2026-11-08T01:00:00.000Z"),
    rule: sundayRule,
    timezone: "Asia/Jakarta",
  });
  assert.equal(result.status, "OFF_DAY");
});

test("cuti menghitung Sabtu yang aktif pada Pola Kerja", () => {
  const start = new Date("2026-11-02T00:00:00.000Z");
  const end = new Date("2026-11-08T00:00:00.000Z");
  const workdays = new Set([1, 2, 3, 4, 5, 6]);
  assert.equal(calculateWorkingDays(start, end, new Set(), workdays), 6);
  assert.equal(calculateWorkingDays(start, end, new Set()), 5);
});

test("resolver memakai hari Senin-Minggu dari Pola Kerja", () => {
  const index = createWorkPatternRuleIndex([
    {
      memberId: "member-1",
      workPattern: {
        id: "pattern-1",
        name: "Kantor Sabtu Pendek",
        timezone: "Asia/Jakarta",
        days: [
          {
            dayOfWeek: 6,
            isWorkday: true,
            startTime: "08:00",
            endTime: "13:00",
            earliestCheckInMinutes: 90,
            lateToleranceMinutes: 10,
          },
        ],
      },
    },
  ]);
  const saturday = workPatternRuleFor(
    index,
    "member-1",
    new Date("2026-11-07T00:00:00.000Z"),
  );
  assert.equal(saturday?.startTime, "08:00");
  assert.equal(saturday?.endTime, "13:00");
  assert.equal(
    workPatternRuleFor(index, "member-1", new Date("2026-11-08T00:00:00.000Z")),
    null,
  );
});
