-- Phase 6 — index audit per resource untuk filter resourceId (additive only).

CREATE INDEX `audit_logs_tenant_resource_idx`
  ON `audit_logs` (`tenant_id`, `resource_id`);
