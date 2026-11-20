import assert from "node:assert/strict";
import test from "node:test";

import { holidayTypeForName } from "./mobile-schedule.js";

test("libur nasional dan cuti bersama dikenali dari nama", () => {
  assert.equal(holidayTypeForName("Libur Nasional Kemerdekaan"), "NATIONAL");
  assert.equal(holidayTypeForName("Cuti Bersama Natal"), "NATIONAL");
  assert.equal(holidayTypeForName("libur nasional tahun baru"), "NATIONAL");
});

test("libur perusahaan menjadi jenis COMPANY", () => {
  assert.equal(holidayTypeForName("Libur perusahaan"), "COMPANY");
  assert.equal(holidayTypeForName("Anniversary kantor"), "COMPANY");
});
