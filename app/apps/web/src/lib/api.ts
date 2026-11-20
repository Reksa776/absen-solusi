import { enforceUserRateLimit, errorResponse, HttpError, logger } from "@absensi/auth";

export function handleRouteError(error: unknown): Response {
  if (error instanceof HttpError) return errorResponse(error);
  logger.error("unhandled route error", { error });
  return errorResponse(error);
}

export function appendSetCookies(response: Response, cookies: string[]): Response {
  for (const cookie of cookies) response.headers.append("set-cookie", cookie);
  return response;
}

export async function assertWorkspaceWriteLimit(
  userId: string,
  bucket:
    | "workspace.create"
    | "workspace.invite"
    | "workspace.role"
    | "workspace.switch"
    | "workspace.office"
    | "correction.bulk",
): Promise<void> {
  const outcome = await enforceUserRateLimit({ userId, bucket });
  if (!outcome.allowed) {
    throw new HttpError(outcome.status, "RATE_LIMITED", outcome.message, outcome.retryAfterSeconds);
  }
}
