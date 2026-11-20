/**
 * Template email minimal (HTML + plain text). Tidak ada token, hash, atau
 * kredensial di dalam template selain link yang memang dibutuhkan penerima.
 */

export type EmailTemplateName =
  | "invitation"
  | "correction_result"
  | "late_notification";

export type RenderedEmail = {
  template: EmailTemplateName;
  subject: string;
  text: string;
  html: string;
};

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char);
}

function greeting(name?: string): string {
  const trimmed = name?.trim();
  return trimmed ? `Halo ${trimmed},` : "Halo,";
}

function workspacePhrase(workspaceName?: string): string {
  const trimmed = workspaceName?.trim();
  return trimmed ? ` di ${trimmed}` : "";
}

function layout(input: { heading: string; paragraphs: string[]; action?: { label: string; url: string } }): string {
  const body = input.paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("");
  const action = input.action
    ? `<p><a href="${escapeHtml(input.action.url)}">${escapeHtml(input.action.label)}</a></p>`
    : "";
  return [
    "<!doctype html>",
    '<html lang="id"><body style="font-family:system-ui,sans-serif;line-height:1.6;color:#111">',
    `<h1 style="font-size:1.15rem">${escapeHtml(input.heading)}</h1>`,
    body,
    action,
    '<p style="color:#555;font-size:0.85rem">Email ini dikirim otomatis oleh aplikasi absensi.</p>',
    "</body></html>",
  ].join("");
}

export function renderInvitationEmail(input: {
  acceptUrl: string;
  expiresAt: Date;
  workspaceName?: string | undefined;
  recipientName?: string | undefined;
}): RenderedEmail {
  const expires = input.expiresAt.toISOString().slice(0, 16).replace("T", " ") + " UTC";
  const text = [
    greeting(input.recipientName),
    `Anda diundang bergabung${workspacePhrase(input.workspaceName)}.`,
    `Terima undangan: ${input.acceptUrl}`,
    `Tautan berlaku sampai ${expires}.`,
  ].join("\n\n");
  return {
    template: "invitation",
    subject: `Undangan bergabung${input.workspaceName ? ` ke ${input.workspaceName}` : ""}`,
    text,
    html: layout({
      heading: "Undangan bergabung",
      paragraphs: [
        greeting(input.recipientName),
        `Anda diundang bergabung${workspacePhrase(input.workspaceName)}.`,
        `Tautan berlaku sampai ${expires}.`,
      ],
      action: { label: "Terima undangan", url: input.acceptUrl },
    }),
  };
}

export function renderCorrectionResultEmail(input: {
  status: "APPROVED" | "REJECTED";
  requestType: string;
  requestedTimestamp: Date;
  rejectionReason?: string | null | undefined;
  workspaceName?: string | undefined;
  recipientName?: string | undefined;
  actionUrl?: string | undefined;
}): RenderedEmail {
  const approved = input.status === "APPROVED";
  const typeLabel = input.requestType === "CHECK_OUT" ? "check-out" : "check-in";
  const stamp = input.requestedTimestamp.toISOString().slice(0, 16).replace("T", " ") + " UTC";
  const paragraphs = [
    greeting(input.recipientName),
    approved
      ? `Pengajuan revisi ${typeLabel} untuk ${stamp}${workspacePhrase(input.workspaceName)} telah disetujui.`
      : `Pengajuan revisi ${typeLabel} untuk ${stamp}${workspacePhrase(input.workspaceName)} ditolak.`,
  ];
  const reason = input.rejectionReason?.trim();
  if (!approved && reason) paragraphs.push(`Alasan penolakan: ${reason}`);
  paragraphs.push(
    approved
      ? "Data kehadiran sudah diperbarui."
      : "Silakan ajukan revisi baru bila data masih perlu diperbaiki.",
  );
  return {
    template: "correction_result",
    subject: approved ? "Revisi kehadiran disetujui" : "Revisi kehadiran ditolak",
    text: paragraphs.join("\n\n"),
    html: layout({
      heading: approved ? "Revisi kehadiran disetujui" : "Revisi kehadiran ditolak",
      paragraphs,
      ...(input.actionUrl
        ? { action: { label: "Lihat riwayat revisi", url: input.actionUrl } }
        : {}),
    }),
  };
}

export function renderLateNotificationEmail(input: {
  workDate: string;
  minutesLate: number;
  workspaceName?: string | undefined;
  recipientName?: string | undefined;
  actionUrl?: string | undefined;
}): RenderedEmail {
  const paragraphs = [
    greeting(input.recipientName),
    `Absensi ${input.workDate}${workspacePhrase(input.workspaceName)} tercatat terlambat ${input.minutesLate} menit.`,
    "Mohon lengkapi absensi tepat waktu berikutnya.",
  ];
  return {
    template: "late_notification",
    subject: `Keterlambatan absensi ${input.workDate}`,
    text: paragraphs.join("\n\n"),
    html: layout({
      heading: "Keterlambatan absensi",
      paragraphs,
      ...(input.actionUrl
        ? { action: { label: "Buka riwayat absensi", url: input.actionUrl } }
        : {}),
    }),
  };
}
