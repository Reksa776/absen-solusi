import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { API_ROUTE_POLICIES, routePatternFromFile } from "@absensi/auth";

const apiRoot = new URL("../src/app/api", import.meta.url).pathname;

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, files);
    else if (/^route\.tsx?$/.test(entry)) files.push(full);
  }
  return files;
}

const METHOD_PATTERN = /\bexport\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g;

function exportedMethods(file) {
  return [...readFileSync(file, "utf8").matchAll(METHOD_PATTERN)].map((match) => match[1]);
}

function scanRoutes() {
  return walk(apiRoot).map((file) => ({
    route: routePatternFromFile(file),
    methods: exportedMethods(file),
  }));
}

test("setiap method route /api di apps/web punya policy dan sebaliknya", () => {
  const routes = scanRoutes();
  assert.ok(routes.length >= 10, `route terdeteksi: ${routes.map((r) => r.route).join(", ")}`);
  for (const { route, methods } of routes) {
    const policy = API_ROUTE_POLICIES[route];
    assert.ok(policy, `route ${route} tanpa policy`);
    assert.ok(methods.length > 0, `route ${route} tidak mengekspor method HTTP`);
    if (policy.kind === "methods") {
      for (const method of methods) {
        assert.ok(policy.methods[method], `route ${route} method ${method} tanpa policy`);
      }
    }
  }
  const known = new Set(routes.map((entry) => entry.route));
  for (const declared of Object.keys(API_ROUTE_POLICIES)) {
    assert.ok(known.has(declared), `policy ${declared} tanpa file route`);
  }
});

test("route publik dibatasi health/ready/login/register/csrf", () => {
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
    "/api/mobile/apk/latest",
    "/api/mobile/version",
  ]);
});
