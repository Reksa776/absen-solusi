# Phase 3 — GPS, Photo & Geofence Readiness Report

**Date:** 2026-11-19  
**Status:** **NOT READY TO START**  
**Implementation:** none  
**Migrations:** none  
**Purpose:** readiness assessment only

---

## 1. Readiness Summary

Phase 3 depends on a completed Phase 2, an approved attendance/time model, mobile permission policy, storage/upload design, and privacy decisions. None of those are complete.

The committed foundation provides useful primitives:

- session authentication and Bearer support;
- CSRF for cookie mode;
- tenant-scoped database extension and audit logging;
- role/permission catalog;
- workspace/member/invitation foundation.

It does **not** yet provide attendance, location, photo, geofence, office-location, or mobile capture features.

---

## 2. Readiness Matrix

| Area | Current state | Required before implementation |
|---|---|---|
| GPS acquisition | No Phase 3 code | Android client design, permission flow, accuracy requirements, timeout/fallback policy |
| Android permissions | No mobile implementation in this checkpoint | Precise vs approximate location, background policy, denial/`Don't ask again` UX |
| Accuracy and spoofing | Undefined | Server-side accuracy threshold, mocked-location signals, device attestation decision, manual review policy |
| Offline behavior | Undefined | Queue/retry rules, clock trust, duplicate protection, sync conflict policy |
| Photo capture | Undefined | Camera vs gallery policy, metadata stripping, image size/compression, required evidence |
| Photo upload | No storage dependency found | Storage provider, signed upload/download, content validation, malware/abuse controls, retention |
| Geofence representation | Undefined | Point/radius vs polygon, coordinate system, accuracy buffer, multiple office locations |
| Server-side validation | No attendance model or endpoint | Authoritative time, distance calculation, tolerance, duplicate/absent rules, audit |
| Timezone/time | No office-settings model | Workspace timezone, work hours, overnight shifts, DST policy, server clock authority |
| Database model | 12 foundation tables only | Attendance, location evidence, photo object metadata, office locations/settings, indexes, tenant keys |
| Tenant isolation | Foundation passes T1–T9 | Every Phase 3 table and query must use the same tenant rules; new SYSTEM call sites need review |
| API contract | Undefined | Clock-in/out, evidence upload, status/history, idempotency, error codes, mobile versioning |
| Android integration | No Phase 3 client | API client, token storage, offline DB, permission/camera/location lifecycle |
| Privacy/retention | Undefined | Photo/location notice, consent basis, retention, deletion/export, access review |
| Testing | No Phase 3 tests | Unit, DB isolation, fake-location, upload security, timezone/DST, offline, E2E device tests |

---

## 3. Architecture Decisions Required

### 3.1 Attendance authority

- Is the server the sole authority for attendance time?
- What happens when the device clock is wrong or offline?
- Are late/early/absent decisions computed at write time or in a reporting job?

### 3.2 Location policy

- Minimum accuracy and maximum age of a location fix.
- Whether mocked locations are rejected outright or flagged for review.
- Whether geofence checks use one point/radius or polygons.
- How GPS drift near a boundary is handled.
- Whether location is required for every attendance action.

### 3.3 Photo policy

- Mandatory live camera or gallery allowed.
- Required image format, dimensions, compression, and metadata removal.
- Whether a photo is evidence, profile data, or both.
- Storage provider and signed-URL lifetime.
- Retention and deletion rules.

### 3.4 Time and office model

- Workspace vs office-location timezone.
- Work schedules, breaks, holidays, overnight shifts, and DST.
- Whether attendance is per employee, per location, or both.
- Relationship to Task 2.7 office settings.

### 3.5 Mobile and offline model

- Android framework and minimum SDK.
- Secure token storage.
- Offline queue and retry limits.
- Anti-replay/idempotency keys.
- How users see pending vs accepted attendance.

### 3.6 Privacy and compliance

- Employee notice and consent.
- Location/photo retention periods.
- Access controls and audit review.
- Data-subject deletion/export process.
- Whether location is collected outside an attendance action.

---

## 4. Proposed Database Shape (Not Approved)

This is a discussion outline, not a migration:

- `office_locations`: tenant, name, coordinates, radius/polygon, timezone, active status.
- `attendance_records`: tenant, member, event type, server timestamp, device timestamp, status, idempotency key.
- `attendance_evidence`: attendance ID, photo object key, hash, capture metadata, upload status.
- `attendance_location_evidence`: coordinates, accuracy, captured time, geofence result, spoof signal.

All tenant-scoped tables need composite tenant keys, indexes for time-range queries, and a migration with isolated verification. No schema is approved.

---

## 5. API and Security Requirements

- Bearer token flow for mobile; CSRF remains required for cookie web flows.
- Tenant context must come from the session, never a client-supplied tenant ID.
- Upload endpoints need size/type limits, signed URLs or server-mediated uploads, and malware/abuse controls.
- Attendance writes need idempotency and transaction boundaries.
- Never trust client timestamps, coordinates, or MIME types without server checks.
- Do not log raw tokens, photo bytes, precise coordinates, or signed URLs.
- Rate-limit attendance and upload endpoints separately from login/workspace routes.
- Audit attendance/geofence/photo actions without sensitive payloads.
- Define retention and deletion jobs, including object storage and database metadata.

---

## 6. Testing Strategy

- Unit tests for distance, geofence boundaries, accuracy filters, and timezone/DST.
- DB tests for tenant isolation, idempotency, and transaction rollback.
- Upload tests for type spoofing, size limits, malformed images, and unauthorized access.
- Fake-location and clock-skew tests.
- Offline queue/retry and duplicate-submission tests.
- Android instrumentation/E2E on representative devices.
- Retention/deletion verification.
- Security review of storage URLs, photo access, and location leakage.

No Phase 3 test was created.

---

## 7. Blocking Prerequisites

1. Phase 2 complete, including approved Unit 2B, UI, and office/time model.
2. S-3/S-4 resolved.
3. Task 2.7 timezone/work-hours/location design approved.
4. TD-2-R1 role/attendance permission catalog approved.
5. Photo storage provider and retention policy approved.
6. Android location/camera/permission and spoofing policy approved.
7. Privacy notice and data-retention decisions approved.
8. Phase 3 schema/migration plan reviewed and tested on a disposable database.

---

## 8. Verdict

**NOT READY.**

Phase 3 should not start. No Phase 3 source code, dependency, schema, migration, or API was created. The next decision is to complete Phase 2 and approve the outstanding product/security policies.
