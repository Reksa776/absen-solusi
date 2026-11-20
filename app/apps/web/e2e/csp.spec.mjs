import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

const authDir = join(dirname(fileURLToPath(import.meta.url)), ".auth");
const session = JSON.parse(readFileSync(join(authDir, "session.json"), "utf8"));
const authFile = join(authDir, "state.json");

function watchCsp(page) {
  const violations = [];
  page.on("console", (message) => {
    const text = message.text();
    if (message.type() === "error" && /Content Security Policy|Refused to/i.test(text)) {
      violations.push(text);
    }
  });
  page.on("pageerror", (error) => {
    if (/Content Security Policy|Refused to/i.test(error.message)) {
      violations.push(error.message);
    }
  });
  return violations;
}

function assertNonceHeader(csp) {
  expect(csp).toBeTruthy();
  expect(csp).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
  expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
}

test.describe("sign-in", () => {
  test("E2E-1: sign-in memakai CSP nonce dan terhidrasi tanpa pelanggaran", async ({ page }) => {
    const violations = watchCsp(page);
    const response = await page.goto("/sign-in");
    expect(response).toBeTruthy();
    assertNonceHeader(response.headers()["content-security-policy"]);

    await page.getByLabel("Email").fill("tidak-ada@example.com");
    await page.getByLabel("Password").fill("SalahSekali123!");
    await page.getByRole("button", { name: "Masuk" }).click();

    // Alert hanya muncul dari kode klien setelah fetch gagal → bukti hidrasi.
    await expect(page.getByRole("alert")).toBeVisible({ timeout: 15_000 });
    expect(violations).toEqual([]);
  });

  test("E2E-2: form sign-in membuat sesi cookie dan mengalihkan ke beranda", async ({
    page,
  }) => {
    const violations = watchCsp(page);
    await page.goto("/sign-in");
    await page.getByLabel("Email").fill(session.email);
    await page.getByLabel("Password").fill(session.password);
    await page.getByRole("button", { name: "Masuk" }).click();

    await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"), { timeout: 20_000 });
    const cookies = await page.context().cookies();
    expect(cookies.some((cookie) => cookie.name.includes("aos_session"))).toBe(true);
    expect(violations).toEqual([]);
  });
});

test.describe("halaman terautentikasi", () => {
  test.use({ storageState: authFile });

  test("E2E-3: dashboard workspace merender tanpa pelanggaran CSP", async ({ page }) => {
    const violations = watchCsp(page);
    const response = await page.goto(`/workspaces/${session.tenantId}/dashboard`);
    expect(response).toBeTruthy();
    assertNonceHeader(response.headers()["content-security-policy"]);
    await expect(page.getByRole("heading", { name: "Dashboard hari ini" })).toBeVisible();
    expect(violations).toEqual([]);
  });

  test("E2E-4: antrian revisi merender tanpa pelanggaran CSP", async ({ page }) => {
    const violations = watchCsp(page);
    const response = await page.goto(`/workspaces/${session.tenantId}/corrections`);
    expect(response).toBeTruthy();
    assertNonceHeader(response.headers()["content-security-policy"]);
    await expect(page.getByRole("heading", { name: "Antrian revisi kehadiran" })).toBeVisible();
    expect(violations).toEqual([]);
  });
});
