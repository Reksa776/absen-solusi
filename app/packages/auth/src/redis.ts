import { createConnection, type Socket } from "node:net";

export class RedisUnavailableError extends Error {
  constructor(message = "Redis tidak tersedia") {
    super(message);
    this.name = "RedisUnavailableError";
  }
}

class RedisReplyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RedisReplyError";
  }
}

type PendingReply = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

function parseUrl(url: string): {
  host: string;
  port: number;
  username: string | undefined;
  password: string | undefined;
  db: number;
} {
  const parsed = new URL(url);
  if (parsed.protocol !== "redis:") throw new RedisUnavailableError("REDIS_URL harus redis://");
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 6379),
    username: parsed.username ? decodeURIComponent(parsed.username) : undefined,
    password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
    db: Number(parsed.pathname.replace(/^\//, "") || 0),
  };
}

/** Klien RESP minimal: cukup untuk EVAL/PING rate limiter. */
export class RedisConnection {
  private readonly url: string;
  private socket: Socket | null = null;
  private connectPromise: Promise<void> | null = null;
  private buffer = Buffer.alloc(0);
  private pending: PendingReply[] = [];
  private closed = false;

  constructor(url: string) {
    this.url = url;
  }

  async connect(): Promise<void> {
    if (this.socket && !this.closed) return;
    this.connectPromise ??= new Promise<void>((resolve, reject) => {
      const target = parseUrl(this.url);
      const socket = createConnection({ host: target.host, port: target.port });
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new RedisUnavailableError("Koneksi Redis timeout"));
      }, 1500);
      socket.once("connect", async () => {
        clearTimeout(timer);
        this.socket = socket;
        this.closed = false;
        socket.on("data", (chunk) => this.onData(Buffer.from(chunk)));
        socket.on("error", (error) => this.fail(error));
        socket.on("close", () => this.fail(new RedisUnavailableError("Koneksi Redis tertutup")));
        try {
          const commands: string[][] = [];
          if (target.password) {
            commands.push(
              target.username
                ? ["AUTH", target.username, target.password]
                : ["AUTH", target.password],
            );
          }
          if (target.db) commands.push(["SELECT", String(target.db)]);
          commands.push(["PING"]);
          for (const command of commands) await this.send(command);
          resolve();
        } catch (error) {
          reject(error instanceof Error ? error : new RedisUnavailableError());
        }
      });
      socket.once("error", (error) => {
        clearTimeout(timer);
        reject(new RedisUnavailableError(error.message));
      });
    });
    try {
      await this.connectPromise;
    } catch (error) {
      this.connectPromise = null;
      throw error;
    }
  }

  private fail(error: Error): void {
    this.closed = true;
    this.socket?.destroy();
    this.socket = null;
    for (const pending of this.pending.splice(0)) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
  }

  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.pending.length > 0) {
      let parsed: { value: unknown; next: number };
      try {
        const result = this.parse(this.buffer, 0);
        if (!result) return;
        parsed = result;
      } catch (error) {
        this.fail(error instanceof Error ? error : new RedisUnavailableError());
        return;
      }
      this.buffer = this.buffer.subarray(parsed.next);
      const pending = this.pending.shift();
      if (!pending) return;
      clearTimeout(pending.timer);
      if (parsed.value instanceof RedisReplyError) pending.reject(parsed.value);
      else pending.resolve(parsed.value);
    }
  }

  private parse(
    buffer: Buffer,
    offset: number,
  ): { value: unknown; next: number } | null {
    const lineEnd = buffer.indexOf("\r\n", offset);
    if (lineEnd < 0) return null;
    const marker = String.fromCharCode(buffer[offset] ?? 0);
    const line = buffer.subarray(offset + 1, lineEnd).toString();
    const next = lineEnd + 2;
    if (marker === "+") return { value: line, next };
    if (marker === "-") return { value: new RedisReplyError(line), next };
    if (marker === ":") return { value: Number(line), next };
    if (marker === "$") {
      const length = Number(line);
      if (length === -1) return { value: null, next };
      if (buffer.length < next + length + 2) return null;
      return {
        value: buffer.subarray(next, next + length).toString(),
        next: next + length + 2,
      };
    }
    if (marker === "*") {
      const count = Number(line);
      if (count === -1) return { value: null, next };
      const values: unknown[] = [];
      let cursor = next;
      for (let index = 0; index < count; index += 1) {
        const item = this.parse(buffer, cursor);
        if (!item) return null;
        values.push(item.value);
        cursor = item.next;
      }
      return { value: values, next: cursor };
    }
    throw new RedisUnavailableError("Balasan Redis tidak dikenal");
  }

  private send(args: string[]): Promise<unknown> {
    if (this.closed || !this.socket) {
      return Promise.reject(new RedisUnavailableError("Koneksi Redis tidak aktif"));
    }
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.fail(new RedisUnavailableError("Perintah Redis timeout"));
      }, 1500);
      this.pending.push({ resolve, reject, timer });
      const parts = [`*${args.length}\r\n`];
      for (const arg of args) parts.push(`$${Buffer.byteLength(arg)}\r\n${arg}\r\n`);
      this.socket?.write(parts.join(""));
    });
  }

  async command(args: string[]): Promise<unknown> {
    await this.connect();
    return this.send(args);
  }

  close(): void {
    this.closed = true;
    this.socket?.end();
    this.socket = null;
    for (const pending of this.pending.splice(0)) {
      clearTimeout(pending.timer);
      pending.reject(new RedisUnavailableError("Koneksi Redis ditutup"));
    }
  }
}
