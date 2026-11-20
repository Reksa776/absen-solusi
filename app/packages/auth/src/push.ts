import { logger } from "./logger.js";

export type PushMessage = {
  title: string;
  body: string;
  data?: Record<string, string> | undefined;
};

export type PushDeliveryResult = { delivered: number; failed: number };

export interface PushTransport {
  readonly name: string;
  send(tokens: readonly string[], message: PushMessage): Promise<PushDeliveryResult>;
}

export class MemoryPushTransport implements PushTransport {
  readonly name = "memory";
  readonly sent: Array<{ token: string; message: PushMessage }> = [];
  private readonly failing: ReadonlySet<string>;

  constructor(options: { failingTokens?: readonly string[] } = {}) {
    this.failing = new Set(options.failingTokens ?? []);
  }

  async send(tokens: readonly string[], message: PushMessage): Promise<PushDeliveryResult> {
    let delivered = 0;
    let failed = 0;
    for (const token of tokens) {
      if (this.failing.has(token)) {
        failed += 1;
        continue;
      }
      this.sent.push({ token, message });
      delivered += 1;
    }
    return { delivered, failed };
  }
}

export class UnavailablePushTransport implements PushTransport {
  readonly name = "unavailable";

  constructor(private readonly reason = "PUSH_TRANSPORT belum dikonfigurasi untuk production") {}

  async send(): Promise<PushDeliveryResult> {
    throw new Error(this.reason);
  }
}

export type FcmPushConfig = {
  projectId: string;
  accessToken: string | (() => Promise<string>);
  fetchImpl?: typeof fetch;
};

/**
 * FCM HTTP v1 diterima lewat satu message:send per token. Token perangkat
 * tidak pernah ditulis ke log; kegagalan dilaporkan sebagai hitungan.
 */
export class FcmPushTransport implements PushTransport {
  readonly name = "fcm";

  constructor(private readonly config: FcmPushConfig) {}

  private async bearer(): Promise<string> {
    return typeof this.config.accessToken === "function"
      ? this.config.accessToken()
      : this.config.accessToken;
  }

  async send(tokens: readonly string[], message: PushMessage): Promise<PushDeliveryResult> {
    const fetchImpl = this.config.fetchImpl ?? fetch;
    const endpoint = `https://fcm.googleapis.com/v1/projects/${this.config.projectId}/messages:send`;
    const authorization = `Bearer ${await this.bearer()}`;
    let delivered = 0;
    let failed = 0;
    for (const token of tokens) {
      try {
        const response = await fetchImpl(endpoint, {
          method: "POST",
          headers: { authorization, "content-type": "application/json" },
          body: JSON.stringify({
            message: {
              token,
              notification: { title: message.title, body: message.body },
              ...(message.data ? { data: message.data } : {}),
            },
          }),
        });
        if (response.ok) delivered += 1;
        else failed += 1;
      } catch (error) {
        failed += 1;
        logger.error("push delivery failed", { transport: "fcm", error });
      }
    }
    if (delivered > 0) {
      logger.info("push sent", { transport: "fcm", delivered, failed });
    }
    return { delivered, failed };
  }
}

export type PushTransportResolution =
  | { kind: "transport"; transport: PushTransport }
  | { kind: "unavailable"; reason: string };

export function resolvePushTransport(env: NodeJS.ProcessEnv = process.env): PushTransportResolution {
  const requested = (env.PUSH_TRANSPORT ?? "").trim().toLowerCase();
  const accessToken = env.FCM_ACCESS_TOKEN?.trim();
  const projectId = env.FCM_PROJECT_ID?.trim();

  if (requested === "memory") return { kind: "transport", transport: new MemoryPushTransport() };
  if (requested === "fcm" || (!requested && projectId && accessToken)) {
    return projectId && accessToken
      ? { kind: "transport", transport: new FcmPushTransport({ projectId, accessToken }) }
      : { kind: "unavailable", reason: "PUSH_TRANSPORT=fcm memerlukan FCM_PROJECT_ID dan FCM_ACCESS_TOKEN" };
  }
  if (env.NODE_ENV === "production") {
    return { kind: "unavailable", reason: "Production memerlukan PUSH_TRANSPORT=fcm beserta kredensialnya" };
  }
  // Dev default: transport memory agar alur dapat diuji tanpa kredensial FCM.
  return { kind: "transport", transport: new MemoryPushTransport() };
}

export function createPushTransportFromEnv(env: NodeJS.ProcessEnv = process.env): PushTransport {
  const resolved = resolvePushTransport(env);
  return resolved.kind === "transport"
    ? resolved.transport
    : new UnavailablePushTransport(resolved.reason);
}
