import assert from "node:assert/strict";
import test from "node:test";

import { HttpError } from "./http.js";
import { calculateWorkingDays, parseLeaveDay } from "./leave.js";

function utc(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

test("cuti 2026-11-26 s/d 2026-12-10 dihitung 11 hari kerja", () => {
  const start = utc("2026-11-26");
  const end = utc("2026-12-10");
  assert.equal(calculateWorkingDays(start, end, new Set()), 11);
  assert.equal(
    calculateWorkingDays(start, end, new Set(), new Set([1, 2, 3, 4, 5])),
    11,
  );
});

test("pola kerja tanpa hari aktif tetap memakai fallback Senin-Jumat", () => {
  const start = utc("2026-11-26");
  const end = utc("2026-12-10");
  assert.equal(calculateWorkingDays(start, end, new Set(), new Set()), 11);
});

test("hari libur workspace dikurangkan dari jumlah hari kerja", () => {
  const start = utc("2026-11-26");
  const end = utc("2026-12-10");
  assert.equal(
    calculateWorkingDays(start, end, new Set(["2026-12-08"])),
    10,
  );
});

test("pola kerja Sabtu aktif ikut dihitung sebagai hari kerja", () => {
  const start = utc("2026-11-26");
  const end = utc("2026-11-28");
  assert.equal(calculateWorkingDays(start, end, new Set()), 2);
  assert.equal(
    calculateWorkingDays(start, end, new Set(), new Set([1, 2, 3, 4, 5, 6])),
    3,
  );
});

test("tanggal ISO dinormalisasi ke hari kalender WIB", () => {
  assert.equal(
    parseLeaveDay("2026-11-25T17:00:00.000Z", "startDate").toISOString(),
    "2026-11-26T00:00:00.000Z",
  );
  assert.equal(
    parseLeaveDay("2026-11-26T00:00:00.000Z", "startDate").toISOString(),
    "2026-11-26T00:00:00.000Z",
  );
  assert.equal(
    parseLeaveDay("2026-11-26", "startDate").toISOString(),
    "2026-11-26T00:00:00.000Z",
  );
});

test("format tanggal selain ISO ditolak dengan INVALID_DATE", () => {
  assert.throws(
    () => parseLeaveDay("26/11/2026", "startDate"),
    (error: unknown) =>
      error instanceof HttpError && error.code === "INVALID_DATE",
  );
});
