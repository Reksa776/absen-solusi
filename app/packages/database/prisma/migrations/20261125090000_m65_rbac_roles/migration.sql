-- Phase 6.5d — role domain absensi untuk workspace yang sudah ada (additive only).

INSERT INTO `roles` (`id`, `tenant_id`, `key`, `name`, `is_system`, `created_at`)
SELECT UUID(), w.`id`, 'HR', 'HR', 1, NOW(3)
FROM `workspaces` w
WHERE NOT EXISTS (
  SELECT 1 FROM `roles` r WHERE r.`tenant_id` = w.`id` AND r.`key` = 'HR'
);

INSERT INTO `roles` (`id`, `tenant_id`, `key`, `name`, `is_system`, `created_at`)
SELECT UUID(), w.`id`, 'EMPLOYEE', 'Employee', 1, NOW(3)
FROM `workspaces` w
WHERE NOT EXISTS (
  SELECT 1 FROM `roles` r WHERE r.`tenant_id` = w.`id` AND r.`key` = 'EMPLOYEE'
);

INSERT IGNORE INTO `role_permissions` (`tenant_id`, `role_id`, `permission_key`)
SELECT r.`tenant_id`, r.`id`, p.`key`
FROM `roles` r
CROSS JOIN (
  SELECT 'workspace.read' AS `key`
  UNION ALL SELECT 'member.read'
  UNION ALL SELECT 'office.manage'
  UNION ALL SELECT 'attendance.read'
  UNION ALL SELECT 'correction.read'
  UNION ALL SELECT 'correction.review'
  UNION ALL SELECT 'audit.read'
) p
WHERE r.`key` = 'HR';

INSERT IGNORE INTO `role_permissions` (`tenant_id`, `role_id`, `permission_key`)
SELECT r.`tenant_id`, r.`id`, 'workspace.read'
FROM `roles` r
WHERE r.`key` = 'EMPLOYEE';
