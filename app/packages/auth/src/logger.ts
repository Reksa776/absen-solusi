const SENSITIVE_KEY_PATTERN =
  /(password|passwd|token|secret|authorization|cookie|session|hash|credential|api[_-]?key)/i;

const ARGON2_HASH_PATTERN = /\$argon2[a-z0-9]*\$[^\s"',}]+/gi;
const BEARER_PATTERN = /Bearer\s+[A-Za-z0-9._~+/=-]+/gi;
const SESSION_COOKIE_PATTERN = /(?:__Host-)?aos_session=[^;\s"']+/gi;
const HEX64_PATTERN = /\b[a-f0-9]{64}\b/gi;
const KEY_VALUE_PATTERN = /\b(token|password|passwd|secret|session|hash|authorization|cookie)=([^\s&;"']+)/gi;

export const LOG_REDACTED = "[REDACTED]";

/** Redaksi string bebas: header Authorization, cookie sesi, hash Argon2/SHA-256. */
export function redactLogString(value: string): string {
  return value
    .replace(KEY_VALUE_PATTERN, `$1=${LOG_REDACTED}`)
    .replace(BEARER_PATTERN, `Bearer ${LOG_REDACTED}`)
    .replace(SESSION_COOKIE_PATTERN, `aos_session=${LOG_REDACTED}`)
    .replace(ARGON2_HASH_PATTERN, LOG_REDACTED)
    .replace(HEX64_PATTERN, LOG_REDACTED);
}

export function redactLogValue(value: unknown, depth = 0): unknown {
  if (depth > 8) return LOG_REDACTED;
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return redactLogString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactLogString(value.message),
      stack: value.stack ? redactLogString(value.stack) : undefined,
    };
  }
  if (Array.isArray(value)) return value.map((item) => redactLogValue(item, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SENSITIVE_KEY_PATTERN.test(key)
        ? LOG_REDACTED
        : redactLogValue(nested, depth + 1);
    }
    return out;
  }
  return redactLogString(String(value));
}

export type LogSink = (line: string) => void;

export type Logger = {
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
};

export function createLogger(sink?: LogSink): Logger {
  const write =
    sink ??
    ((line: string) => {
      process.stderr.write(`${line}\n`);
    });

  const emit = (level: string, message: string, fields?: Record<string, unknown>) => {
    const payload = {
      ts: new Date().toISOString(),
      level,
      message: redactLogString(message),
      ...(fields ? { fields: redactLogValue(fields) } : {}),
    };
    write(JSON.stringify(payload));
  };

  return {
    info: (message, fields) => emit("info", message, fields),
    warn: (message, fields) => emit("warn", message, fields),
    error: (message, fields) => emit("error", message, fields),
  };
}

export const logger = createLogger();
