import assert from "node:assert/strict";
import test from "node:test";

import {
  invitationAcceptUrl,
  MemoryEmailTransport,
  sendInvitationEmail,
} from "./email.js";

test("B5-1: email undangan memuat link dengan token dan tujuan yang benar", async () => {
  const transport = new MemoryEmailTransport();
  await sendInvitationEmail(transport, {
    to: "baru@example.com",
    token: "token-mentah-uji",
    expiresAt: new Date("2026-12-01T00:00:00Z"),
  });

  assert.equal(transport.sent.length, 1);
  const sent = transport.sent[0];
  assert.equal(sent?.to, "baru@example.com");
  assert.match(sent?.acceptUrl ?? "", /\/accept-invitation\?token=token-mentah-uji$/);
});

test("B5-2: base URL undangan dapat dikonfigurasi tanpa hardcode kredensial", () => {
  const url = invitationAcceptUrl("abc", { APP_BASE_URL: "https://absensi.example.com/" });
  assert.equal(url, "https://absensi.example.com/accept-invitation?token=abc");
});
