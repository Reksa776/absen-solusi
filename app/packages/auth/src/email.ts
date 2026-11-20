import nodemailer, { type Transporter } from "nodemailer";

import {
  renderCorrectionResultEmail,
  renderInvitationEmail,
  renderLateNotificationEmail,
  type EmailTemplateName,
  type RenderedEmail,
} from "./email-templates.js";
import { logger } from "./logger.js";

export type InvitationEmailInput = {
  to: string;
  token: string;
  expiresAt: Date;
  workspaceName?: string | undefined;
  recipientName?: string | undefined;
};

export type CorrectionResultEmailInput = {
  to: string;
  status: "APPROVED" | "REJECTED";
  requestType: string;
  requestedTimestamp: Date;
  rejectionReason?: string | null | undefined;
  workspaceName?: string | undefined;
  recipientName?: string | undefined;
  actionUrl?: string | undefined;
};

export type LateNotificationEmailInput = {
  to: string;
  workDate: string;
  minutesLate: number;
  workspaceName?: string | undefined;
  recipientName?: string | undefined;
  actionUrl?: string | undefined;
};

export interface EmailTransport {
  readonly name: string;
  sendInvitation(input: InvitationEmailInput): Promise<void>;
  sendCorrectionResult(input: CorrectionResultEmailInput): Promise<void>;
  sendLateNotification(input: LateNotificationEmailInput): Promise<void>;
}

export type SentEmail = InvitationEmailInput & { acceptUrl: string };
export type SentCorrectionEmail = CorrectionResultEmailInput;
export type SentLateEmail = LateNotificationEmailInput;

export class MemoryEmailTransport implements EmailTransport {
  readonly name = "memory";
  readonly sent: SentEmail[] = [];
  readonly corrections: SentCorrectionEmail[] = [];
  readonly lateNotifications: SentLateEmail[] = [];

  async sendInvitation(input: InvitationEmailInput): Promise<void> {
    this.sent.push({ ...input, acceptUrl: invitationAcceptUrl(input.token) });
  }

  async sendCorrectionResult(input: CorrectionResultEmailInput): Promise<void> {
    this.corrections.push(input);
  }

  async sendLateNotification(input: LateNotificationEmailInput): Promise<void> {
    this.lateNotifications.push(input);
  }
}

/**
 * Dev-only. Token dan link tidak pernah ditulis ke log; alur lokal memakai
 * echo token lewat respons API (S1_INVITATION_TOKEN_ECHO=true).
 */
export class ConsoleEmailTransport implements EmailTransport {
  readonly name = "console";

  private assertDevOnly(): void {
    if (process.env.NODE_ENV === "production") {
      throw new Error("Console email transport tidak boleh dipakai di production");
    }
  }

  async sendInvitation(input: InvitationEmailInput): Promise<void> {
    this.assertDevOnly();
    logger.info("DEV email (invitation)", {
      to: input.to,
      template: "invitation",
      expiresAt: input.expiresAt.toISOString(),
    });
  }

  async sendCorrectionResult(input: CorrectionResultEmailInput): Promise<void> {
    this.assertDevOnly();
    logger.info("DEV email (correction_result)", {
      to: input.to,
      template: "correction_result",
      status: input.status,
    });
  }

  async sendLateNotification(input: LateNotificationEmailInput): Promise<void> {
    this.assertDevOnly();
    logger.info("DEV email (late_notification)", {
      to: input.to,
      template: "late_notification",
      workDate: input.workDate,
    });
  }
}

export class UnavailableEmailTransport implements EmailTransport {
  readonly name = "unavailable";

  constructor(private readonly reason = "EMAIL_TRANSPORT belum dikonfigurasi untuk production") {}

  private fail(): never {
    throw new Error(this.reason);
  }

  async sendInvitation(_input: InvitationEmailInput): Promise<void> {
    this.fail();
  }

  async sendCorrectionResult(_input: CorrectionResultEmailInput): Promise<void> {
    this.fail();
  }

  async sendLateNotification(_input: LateNotificationEmailInput): Promise<void> {
    this.fail();
  }
}

export type SmtpEmailConfig = {
  host: string;
  port: number;
  secure: boolean;
  from: string;
  user?: string;
  password?: string;
};

function smtpConfigFromEnv(env: NodeJS.ProcessEnv): SmtpEmailConfig | null {
  const host = env.SMTP_HOST?.trim();
  const from = env.FROM_EMAIL?.trim();
  const port = Number(env.SMTP_PORT ?? "");
  if (!host || !from || !Number.isInteger(port) || port <= 0) return null;
  const secure = env.SMTP_SECURE ? env.SMTP_SECURE === "true" : port === 465;
  const user = env.SMTP_USER?.trim();
  const password = env.SMTP_PASSWORD;
  return {
    host,
    port,
    secure,
    from,
    ...(user ? { user } : {}),
    ...(user && password ? { password } : {}),
  };
}

export class SmtpEmailTransport implements EmailTransport {
  readonly name = "smtp";
  private transporter: Transporter | null = null;

  constructor(private readonly config: SmtpEmailConfig) {}

  private connection(): Transporter {
    this.transporter ??= nodemailer.createTransport({
      host: this.config.host,
      port: this.config.port,
      secure: this.config.secure,
      ...(this.config.user && this.config.password
        ? { auth: { user: this.config.user, pass: this.config.password } }
        : {}),
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    });
    return this.transporter;
  }

  private async deliver(rendered: RenderedEmail, to: string): Promise<void> {
    await this.connection().sendMail({
      from: this.config.from,
      to,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
      headers: { "X-Absensi-Template": rendered.template },
    });
    logger.info("email sent", {
      transport: "smtp",
      template: rendered.template,
      recipientDomain: to.split("@")[1] ?? "unknown",
    });
  }

  async sendInvitation(input: InvitationEmailInput): Promise<void> {
    await this.deliver(
      renderInvitationEmail({
        acceptUrl: invitationAcceptUrl(input.token),
        expiresAt: input.expiresAt,
        workspaceName: input.workspaceName,
        recipientName: input.recipientName,
      }),
      input.to,
    );
  }

  async sendCorrectionResult(input: CorrectionResultEmailInput): Promise<void> {
    await this.deliver(renderCorrectionResultEmail(input), input.to);
  }

  async sendLateNotification(input: LateNotificationEmailInput): Promise<void> {
    await this.deliver(renderLateNotificationEmail(input), input.to);
  }

  close(): void {
    this.transporter?.close();
    this.transporter = null;
  }
}

export type EmailProviderName = "resend" | "sendgrid";

export type ProviderEmailConfig = {
  provider: EmailProviderName;
  apiKey: string;
  from: string;
  fetchImpl?: typeof fetch;
};

function providerConfigFromEnv(env: NodeJS.ProcessEnv): ProviderEmailConfig | null {
  const provider = (env.EMAIL_PROVIDER ?? "").trim().toLowerCase();
  const apiKey = env.EMAIL_API_KEY?.trim();
  const from = env.FROM_EMAIL?.trim();
  if ((provider !== "resend" && provider !== "sendgrid") || !apiKey || !from) return null;
  return { provider, apiKey, from };
}

type ProviderPayload = { url: string; body: unknown };

export class ProviderEmailTransport implements EmailTransport {
  readonly name: string;
  private readonly config: ProviderEmailConfig;

  constructor(config: ProviderEmailConfig) {
    this.config = config;
    this.name = `provider:${config.provider}`;
  }

  private payload(rendered: RenderedEmail, to: string): ProviderPayload {
    if (this.config.provider === "resend") {
      return {
        url: "https://api.resend.com/emails",
        body: {
          from: this.config.from,
          to: [to],
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
        },
      };
    }
    return {
      url: "https://api.sendgrid.com/v3/mail/send",
      body: {
        personalizations: [{ to: [{ email: to }] }],
        from: { email: this.config.from },
        subject: rendered.subject,
        content: [
          { type: "text/plain", value: rendered.text },
          { type: "text/html", value: rendered.html },
        ],
      },
    };
  }

  private async deliver(rendered: RenderedEmail, to: string): Promise<void> {
    const { url, body } = this.payload(rendered, to);
    const fetchImpl = this.config.fetchImpl ?? fetch;
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.config.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`Email provider ${this.config.provider} gagal dengan status ${response.status}`);
    }
    logger.info("email sent", {
      transport: this.name,
      template: rendered.template,
      recipientDomain: to.split("@")[1] ?? "unknown",
    });
  }

  async sendInvitation(input: InvitationEmailInput): Promise<void> {
    await this.deliver(
      renderInvitationEmail({
        acceptUrl: invitationAcceptUrl(input.token),
        expiresAt: input.expiresAt,
        workspaceName: input.workspaceName,
        recipientName: input.recipientName,
      }),
      input.to,
    );
  }

  async sendCorrectionResult(input: CorrectionResultEmailInput): Promise<void> {
    await this.deliver(renderCorrectionResultEmail(input), input.to);
  }

  async sendLateNotification(input: LateNotificationEmailInput): Promise<void> {
    await this.deliver(renderLateNotificationEmail(input), input.to);
  }
}

export function appBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return (env.APP_BASE_URL ?? env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

export function invitationAcceptUrl(token: string, env: NodeJS.ProcessEnv = process.env): string {
  const url = new URL("/accept-invitation", appBaseUrl(env));
  url.searchParams.set("token", token);
  return url.toString();
}

export async function sendInvitationEmail(
  transport: EmailTransport,
  input: InvitationEmailInput,
): Promise<void> {
  await transport.sendInvitation(input);
}

export type EmailTransportResolution =
  | { kind: "transport"; transport: EmailTransport }
  | { kind: "unavailable"; reason: string };

/**
 * Resolusi transport dengan fail-closed:
 * - dev tanpa konfigurasi → console (default lama dipertahankan);
 * - production tanpa SMTP/provider lengkap → UnavailableEmailTransport yang
 *   melempar, sehingga tidak pernah diam-diam memakai console.
 */
export function resolveEmailTransport(env: NodeJS.ProcessEnv = process.env): EmailTransportResolution {
  const requested = (env.EMAIL_TRANSPORT ?? "").trim().toLowerCase();

  if (requested === "memory") return { kind: "transport", transport: new MemoryEmailTransport() };
  if (requested === "smtp") {
    const config = smtpConfigFromEnv(env);
    return config
      ? { kind: "transport", transport: new SmtpEmailTransport(config) }
      : { kind: "unavailable", reason: "SMTP_HOST, SMTP_PORT, dan FROM_EMAIL wajib untuk EMAIL_TRANSPORT=smtp" };
  }
  if (requested === "resend" || requested === "sendgrid" || requested === "provider") {
    const config = providerConfigFromEnv(env);
    return config
      ? { kind: "transport", transport: new ProviderEmailTransport(config) }
      : {
          kind: "unavailable",
          reason: "EMAIL_PROVIDER (resend|sendgrid), EMAIL_API_KEY, dan FROM_EMAIL wajib",
        };
  }
  if (requested === "console") {
    return { kind: "transport", transport: new ConsoleEmailTransport() };
  }

  // Tanpa EMAIL_TRANSPORT eksplisit: coba konfigurasi nyata lebih dulu.
  const smtp = smtpConfigFromEnv(env);
  if (smtp) return { kind: "transport", transport: new SmtpEmailTransport(smtp) };
  const provider = providerConfigFromEnv(env);
  if (provider) return { kind: "transport", transport: new ProviderEmailTransport(provider) };

  if (env.NODE_ENV === "production") {
    return {
      kind: "unavailable",
      reason:
        "Production memerlukan EMAIL_TRANSPORT=smtp|resend|sendgrid beserta kredensialnya",
    };
  }
  return { kind: "transport", transport: new ConsoleEmailTransport() };
}

export function createEmailTransportFromEnv(env: NodeJS.ProcessEnv = process.env): EmailTransport {
  const resolved = resolveEmailTransport(env);
  return resolved.kind === "transport"
    ? resolved.transport
    : new UnavailableEmailTransport(resolved.reason);
}

export type { EmailTemplateName, RenderedEmail };
