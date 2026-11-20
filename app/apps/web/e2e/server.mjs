import { readFileSync } from "node:fs";
import { createServer } from "node:https";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import next from "next";

// HTTPS lokal: cookie sesi production memakai prefix __Host- + Secure, jadi
// E2E harus berjalan di origin https agar atribut cookie diuji apa adanya.
const here = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.E2E_PORT ?? 3943);

const app = next({ dev: false, dir: join(here, "..") });
await app.prepare();

createServer(
  {
    key: readFileSync(join(here, ".auth", "key.pem")),
    cert: readFileSync(join(here, ".auth", "cert.pem")),
  },
  (request, response) => app.getRequestHandler()(request, response),
).listen(port, "127.0.0.1", () => {
  process.stderr.write(`e2e https server listening on ${port}\n`);
});
