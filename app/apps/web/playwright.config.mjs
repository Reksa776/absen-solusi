import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.E2E_PORT ?? 3943);
// HTTPS lokal agar cookie sesi __Host-/Secure diuji seperti production.
const baseURL = process.env.E2E_BASE_URL ?? `https://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL,
    ignoreHTTPSErrors: true,
    trace: "off",
    screenshot: "off",
  },
  globalSetup: "e2e/global-setup.mjs",
  globalTeardown: "e2e/global-teardown.mjs",
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
