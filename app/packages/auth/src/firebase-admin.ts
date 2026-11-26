import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getMessaging, type Messaging } from "firebase-admin/messaging";

import { logger } from "./logger.js";

/**
 * Kredensial Firebase Admin tidak pernah ditulis di kode. File service
 * account dibaca dari FIREBASE_SERVICE_ACCOUNT_PATH (default relatif ke cwd,
 * yaitu apps/web saat server berjalan) dan ketiadaannya bukan error fatal:
 * alur approval tetap berjalan, hanya push yang dilewati.
 */
export const FIREBASE_SERVICE_ACCOUNT_ENV = "FIREBASE_SERVICE_ACCOUNT_PATH";
export const DEFAULT_FIREBASE_SERVICE_ACCOUNT_PATH = "./firebase-service-account.json";

export type FirebaseServiceAccount = {
  projectId: string;
  clientEmail: string;
  privateKey: string;
};

export function firebaseServiceAccountPath(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env[FIREBASE_SERVICE_ACCOUNT_ENV]?.trim();
  return configured && configured.length > 0
    ? configured
    : DEFAULT_FIREBASE_SERVICE_ACCOUNT_PATH;
}

export function loadFirebaseServiceAccount(
  env: NodeJS.ProcessEnv = process.env,
): FirebaseServiceAccount | null {
  const path = firebaseServiceAccountPath(env);
  const absolute = isAbsolute(path) ? path : resolve(process.cwd(), path);
  try {
    const raw = readFileSync(absolute, "utf8");
    const parsed = JSON.parse(raw) as {
      project_id?: unknown;
      client_email?: unknown;
      private_key?: unknown;
    };
    if (
      typeof parsed.project_id !== "string" ||
      typeof parsed.client_email !== "string" ||
      typeof parsed.private_key !== "string"
    ) {
      logger.error("firebase service account tidak lengkap", { path: absolute });
      return null;
    }
    return {
      projectId: parsed.project_id,
      clientEmail: parsed.client_email,
      // JSON menyimpan newline sebagai \n literal.
      privateKey: parsed.private_key.replace(/\\n/g, "\n"),
    };
  } catch {
    // File belum ada saat test/development: push dinonaktifkan diam-diam.
    return null;
  }
}

let cachedMessaging: Messaging | null | undefined;

export function getFirebaseMessaging(env: NodeJS.ProcessEnv = process.env): Messaging | null {
  if (cachedMessaging !== undefined) return cachedMessaging;
  if (getApps().length === 0) {
    const account = loadFirebaseServiceAccount(env);
    if (!account) {
      cachedMessaging = null;
      return null;
    }
    try {
      initializeApp({
        credential: cert({
          projectId: account.projectId,
          clientEmail: account.clientEmail,
          privateKey: account.privateKey,
        }),
      });
    } catch (error) {
      logger.error("firebase admin init failed", { error });
      cachedMessaging = null;
      return null;
    }
  }
  try {
    cachedMessaging = getMessaging();
  } catch (error) {
    logger.error("firebase messaging unavailable", { error });
    cachedMessaging = null;
  }
  return cachedMessaging;
}

/** Hanya untuk test: paksa pembacaan ulang service account. */
export function resetFirebaseMessagingForTests(): void {
  cachedMessaging = undefined;
}
