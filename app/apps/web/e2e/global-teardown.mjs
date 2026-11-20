import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const authDir = join(dirname(fileURLToPath(import.meta.url)), ".auth");

export default async function globalTeardown() {
  let pid = 0;
  try {
    pid = Number(readFileSync(join(authDir, "server.pid"), "utf8"));
  } catch {
    return;
  }
  for (const signal of ["SIGTERM", "SIGKILL"]) {
    try {
      process.kill(-pid, signal);
      break;
    } catch {
      try {
        process.kill(pid, signal);
        break;
      } catch {
        // proses sudah berhenti
      }
    }
  }
}
