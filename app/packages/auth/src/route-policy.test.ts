import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  API_ROUTE_METHODS,
  API_ROUTE_POLICIES,
  routePatternFromFile,
  type ApiRouteMethod,
} from "./route-policy.js";

const apiRoot = fileURLToPath(new URL("../../../apps/web/src/app/api", import.meta.url));

function walk(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, files);
    else if (/^route\.tsx?$/.test(entry)) files.push(full);
  }
  return files;
}

const METHOD_PATTERN = /\bexport\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g;

function exportedMethods(file: string): string[] {
  return [...readFileSync(file, "utf8").matchAll(METHOD_PATTERN)].map(
    (match) => match[1] as string,
  );
}

type ScannedRoute = { route: string; methods: string[] };

function scanRoutes(): ScannedRoute[] {
  return walk(apiRoot).map((file) => ({
    route: routePatternFromFile(file),
    methods: exportedMethods(file),
  }));
}

test("H1: setiap method pada setiap route /api punya deklarasi kebijakan", () => {
  const routes = scanRoutes();
  assert.ok(routes.length >= 10, `route terdeteksi: ${routes.map((r) => r.route).join(", ")}`);
  for (const { route, methods } of routes) {
    const policy = API_ROUTE_POLICIES[route];
    assert.ok(policy, `route ${route} belum punya policy`);
    assert.ok(methods.length > 0, `route ${route} tidak mengekspor method HTTP`);
    if (policy.kind === "methods") {
      for (const method of methods) {
        assert.ok(
          policy.methods[method as ApiRouteMethod],
          `route ${route} method ${method} belum punya policy`,
        );
      }
    }
  }
});

test("H2: registry tidak menyimpan route yang sudah tidak ada", () => {
  const routes = new Set(scanRoutes().map((entry) => entry.route));
  for (const declared of Object.keys(API_ROUTE_POLICIES)) {
    assert.ok(routes.has(declared), `policy ${declared} tidak punya file route`);
  }
});

test("H3: hanya health/login/register/csrf/ready/accept-invitation yang publik", () => {
  const publicRoutes = Object.entries(API_ROUTE_POLICIES)
    .filter(([, policy]) => policy.kind === "public")
    .map(([route]) => route)
    .sort();
  assert.deepEqual(publicRoutes, [
    "/api/auth/csrf",
    "/api/auth/login",
    "/api/auth/login/2fa",
    "/api/auth/register",
    "/api/health",
    "/api/health/ready",
    "/api/invitations/accept",
  ]);
});

test("H4: policy dibedakan per method untuk route workspace", () => {
  assert.deepEqual(API_ROUTE_POLICIES["/api/workspaces"], {
    kind: "methods",
    methods: {
      GET: { kind: "authenticated", reason: "daftar workspace milik user" },
      POST: { kind: "authenticated", reason: "user membuat workspace miliknya" },
    },
  });
  assert.deepEqual(API_ROUTE_POLICIES["/api/workspaces/:id/members"], {
    kind: "methods",
    methods: {
      GET: { kind: "permission", permission: "member.read" },
      POST: { kind: "permission", permission: "member.invite" },
    },
  });
  assert.deepEqual(API_ROUTE_POLICIES["/api/workspaces/:id/members/:memberId/role"], {
    kind: "permission",
    permission: "role.manage",
  });
  assert.deepEqual(API_ROUTE_POLICIES["/api/workspaces/:id/ownership/transfer"], {
    kind: "permission",
    permission: "workspace.manage",
  });
});

test("H5: routePatternFromFile memetakan segmen dinamis", () => {
  assert.equal(
    routePatternFromFile("/x/apps/web/src/app/api/workspaces/[id]/members/[memberId]/role/route.ts"),
    "/api/workspaces/:id/members/:memberId/role",
  );
});

test("H6: policy per-method tidak mendeklarasikan method yang tidak diekspor", () => {
  const routes = new Map(scanRoutes().map((entry) => [entry.route, entry]));
  for (const [route, policy] of Object.entries(API_ROUTE_POLICIES)) {
    if (policy.kind !== "methods") continue;
    const scanned = routes.get(route);
    assert.ok(scanned, `policy ${route} tidak punya file route`);
    for (const method of Object.keys(policy.methods)) {
      assert.ok(
        (API_ROUTE_METHODS as readonly string[]).includes(method),
        `method ${method} tidak dikenal`,
      );
      assert.ok(
        scanned.methods.includes(method),
        `policy ${route} mendeklarasikan ${method} yang tidak diekspor`,
      );
    }
  }
});
