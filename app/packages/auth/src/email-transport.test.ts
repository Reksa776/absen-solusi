import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";

import { SMTPServer } from "smtp-server";

import {
  createEmailTransportFromEnv,
  invitationAcceptUrl,
  MemoryEmailTransport,
  ProviderEmailTransport,
  resolveEmailTransport,
  SmtpEmailTransport,
  UnavailableEmailTransport,
} from "./email.js";
import {
  escapeHtml,
  renderCorrectionResultEmail,
  renderInvitationEmail,
  renderLateNotificationEmail,
} from "./email-templates.js";

function captureStderr(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const original = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: string | Uint8Array) => {
    lines.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString());
    return true;
  }) as typeof process.stderr.write;
  return { lines, restore: () => { process.stderr.write = original; } };
}

test("E1: template undangan memuat nama, workspace, dan link accept", () => {
  const rendered = renderInvitationEmail({
    acceptUrl: "https://absensi.example.com/accept-invitation?token=rahasia",
    expiresAt: new Date("2026-12-01T10:00:00Z"),
    workspaceName: "PT Solusi",
    recipientName: "Sinta",
  });
  assert.equal(rendered.template, "invitation");
  assert.match(rendered.subject, /PT Solusi/);
  assert.match(rendered.text, /Halo Sinta/);
  assert.match(rendered.html, /accept-invitation\?token=rahasia/);
  assert.match(rendered.text, /2026-12-01 10:00 UTC/);
});

test("E2: template hasil revisi menampilkan alasan penolakan hanya saat reject", () => {
  const rejected = renderCorrectionResultEmail({
    status: "REJECTED",
    requestType: "CHECK_IN",
    requestedTimestamp: new Date("2026-11-20T01:00:00Z"),
    rejectionReason: "Bukti tidak terbaca",
    recipientName: "Budi",
  });
  assert.match(rejected.subject, /ditolak/);
  assert.match(rejected.text, /Alasan penolakan: Bukti tidak terbaca/);

  const approved = renderCorrectionResultEmail({
    status: "APPROVED",
    requestType: "CHECK_OUT",
    requestedTimestamp: new Date("2026-11-20T09:00:00Z"),
    rejectionReason: "tidak dipakai",
  });
  assert.match(approved.subject, /disetujui/);
  assert.doesNotMatch(approved.text, /tidak dipakai/);
});

test("E3: template keterlambatan dan escaping HTML", () => {
  const rendered = renderLateNotificationEmail({
    workDate: "2026-11-20",
    minutesLate: 25,
    recipientName: "<script>alert(1)</script>",
  });
  assert.match(rendered.text, /25 menit/);
  assert.doesNotMatch(rendered.html, /<script>/);
  assert.equal(escapeHtml('a"b<c'), "a&quot;b&lt;c");
});

test("E4: SMTP server in-process menerima email undangan dengan link benar", async () => {
  const received: Array<{ raw: string; envelope: string[] }> = [];
  const server = new SMTPServer({
    authOptional: true,
    disabledCommands: ["STARTTLS", "AUTH"],
    onData(stream, session, callback) {
      const chunks: Buffer[] = [];
      stream.on("data", (chunk: Buffer) => chunks.push(chunk));
      stream.on("end", () => {
        const mailFrom = session.envelope.mailFrom;
        received.push({
          raw: Buffer.concat(chunks).toString(),
          envelope: [
            mailFrom ? mailFrom.address : "",
            ...(session.envelope.rcptTo ?? []).map((item) => item.address),
          ],
        });
        callback();
      });
    },
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.server.address() as AddressInfo).port;

  const transport = new SmtpEmailTransport({
    host: "127.0.0.1",
    port,
    secure: false,
    from: "noreply@absensi.example.com",
  });
  try {
    await transport.sendInvitation({
      to: "baru@example.com",
      token: "token-smtp-uji",
      expiresAt: new Date("2026-12-01T00:00:00Z"),
      workspaceName: "PT Solusi",
    });
  } finally {
    transport.close();
    server.close();
  }

  assert.equal(received.length, 1);
  assert.equal(received[0]?.envelope[1], "baru@example.com");
  assert.match(received[0]?.raw ?? "", /token-smtp-uji/);
  assert.match(received[0]?.raw ?? "", /Subject: Undangan bergabung/);
});

test("E5: kegagalan SMTP melempar error agar pemanggil dapat mencatat tanpa token", async () => {
  const transport = new SmtpEmailTransport({
    host: "127.0.0.1",
    port: 1,
    secure: false,
    from: "noreply@absensi.example.com",
  });
  await assert.rejects(
    () => transport.sendCorrectionResult({
      to: "x@example.com",
      status: "APPROVED",
      requestType: "CHECK_IN",
      requestedTimestamp: new Date(),
    }),
  );
  transport.close();
});

test("E6: provider HTTP mengirim Authorization dan payload yang benar", async () => {
  const seen: Array<{ auth: string | undefined; body: string }> = [];
  const server: Server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      seen.push({
        auth: request.headers.authorization,
        body: Buffer.concat(chunks).toString(),
      });
      response.writeHead(200, { "content-type": "application/json" });
      response.end("{}");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;

  const transport = new ProviderEmailTransport({
    provider: "resend",
    apiKey: "test-key",
    from: "noreply@absensi.example.com",
    fetchImpl: ((input: string | URL, init?: RequestInit) =>
      fetch(new URL(input.toString().replace("https://api.resend.com", `http://127.0.0.1:${port}`)), init)) as typeof fetch,
  });
  try {
    await transport.sendInvitation({
      to: "baru@example.com",
      token: "token-provider",
      expiresAt: new Date("2026-12-01T00:00:00Z"),
    });
  } finally {
    server.close();
  }

  assert.equal(seen.length, 1);
  assert.equal(seen[0]?.auth, "Bearer test-key");
  assert.match(seen[0]?.body ?? "", /token-provider/);
  assert.match(seen[0]?.body ?? "", /"to":\["baru@example.com"\]/);
});

test("E7: production tanpa konfigurasi fail-closed, dev tetap console", async () => {
  const production = createEmailTransportFromEnv({ NODE_ENV: "production" });
  assert.ok(production instanceof UnavailableEmailTransport);
  await assert.rejects(() =>
    production.sendInvitation({
      to: "a@example.com",
      token: "t",
      expiresAt: new Date(),
    }),
  );

  const dev = createEmailTransportFromEnv({ NODE_ENV: "development" });
  assert.equal(dev.name, "console");

  const smtpEnv = createEmailTransportFromEnv({
    NODE_ENV: "production",
    SMTP_HOST: "smtp.example.com",
    SMTP_PORT: "587",
    FROM_EMAIL: "noreply@example.com",
    SMTP_USER: "user",
    SMTP_PASSWORD: "pass",
  });
  assert.equal(smtpEnv.name, "smtp");

  const providerEnv = createEmailTransportFromEnv({
    NODE_ENV: "production",
    EMAIL_PROVIDER: "sendgrid",
    EMAIL_API_KEY: "key",
    FROM_EMAIL: "noreply@example.com",
  });
  assert.equal(providerEnv.name, "provider:sendgrid");
});

test("E8: EMAIL_TRANSPORT=smtp dengan env tidak lengkap fail-closed", () => {
  const resolved = resolveEmailTransport({ NODE_ENV: "production", EMAIL_TRANSPORT: "smtp" });
  assert.equal(resolved.kind, "unavailable");
});

test("E9: transport console tidak menulis token ke log", async () => {
  const capture = captureStderr();
  try {
    const transport = createEmailTransportFromEnv({ NODE_ENV: "development", EMAIL_TRANSPORT: "console" });
    await transport.sendInvitation({
      to: "baru@example.com",
      token: "token-sangat-rahasia",
      expiresAt: new Date("2026-12-01T00:00:00Z"),
    });
    await transport.sendCorrectionResult({
      to: "baru@example.com",
      status: "REJECTED",
      requestType: "CHECK_IN",
      requestedTimestamp: new Date(),
      rejectionReason: "alasan rahasia",
    });
  } finally {
    capture.restore();
  }
  const joined = capture.lines.join("\n");
  assert.doesNotMatch(joined, /token-sangat-rahasia/);
  assert.doesNotMatch(joined, /alasan rahasia/);
  assert.match(joined, /"template":"invitation"/);
});

test("E10: memory transport merekam undangan dan hasil revisi", async () => {
  const transport = new MemoryEmailTransport();
  await transport.sendInvitation({
    to: "a@example.com",
    token: "abc",
    expiresAt: new Date("2026-12-01T00:00:00Z"),
  });
  await transport.sendCorrectionResult({
    to: "a@example.com",
    status: "APPROVED",
    requestType: "CHECK_IN",
    requestedTimestamp: new Date("2026-11-20T00:00:00Z"),
  });
  assert.equal(transport.sent[0]?.acceptUrl, invitationAcceptUrl("abc"));
  assert.equal(transport.corrections.length, 1);
  assert.equal(transport.lateNotifications.length, 0);
});
