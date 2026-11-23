import 'package:absensi_mobile/models/attendance_log.dart';
import 'package:absensi_mobile/models/office_location.dart';
import 'package:absensi_mobile/models/organization.dart';
import 'package:absensi_mobile/models/session.dart';
import 'package:absensi_mobile/services/token_store.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('AttendanceLog mem-parse status dan URL foto', () {
    final log = AttendanceLog.fromJson({
      'id': 'a1',
      'type': 'CHECK_OUT',
      'timestampServer': '2026-11-19T10:00:00.000Z',
      'distanceMeters': 12,
      'accuracyMeters': 4,
      'isSuspicious': true,
      'photoUrl': '/uploads/attendance/a.jpg',
    });
    expect(log.isCheckOut, isTrue);
    expect(log.isCheckIn, isFalse);
    expect(log.label, 'Check-out');
    expect(log.isSuspicious, isTrue);
    expect(log.photoUrl, '/uploads/attendance/a.jpg');
  });

  test('AttendanceLog mem-parse status dinas luar kota dan approval', () {
    final log = AttendanceLog.fromJson({
      'id': 'a2',
      'type': 'CHECK_IN',
      'timestampServer': '2026-11-19T03:00:00.000Z',
      'distanceMeters': 4200,
      'accuracyMeters': 6,
      'isSuspicious': false,
      'photoUrl': '/uploads/attendance/a.jpg',
      'workMode': 'OUT_OF_TOWN',
      'outOfRadius': true,
      'outOfTownReason': 'Dinas ke Bandung',
      'approvalStatus': 'PENDING',
      'currentApprovalLevel': 1,
    });
    expect(log.isOutOfTown, isTrue);
    expect(log.outOfRadius, isTrue);
    expect(log.isApprovalPending, isTrue);
    expect(log.currentApprovalLevel, 1);
    expect(log.outOfTownReason, 'Dinas ke Bandung');
  });

  test('OfficeLocation mem-parse angka dan default timezone', () {
    final office = OfficeLocation.fromJson({
      'id': 'o1',
      'name': 'HQ',
      'latitude': -6.2,
      'longitude': 106.8,
      'radiusMeters': 100,
      'workStart': '09:00',
      'workEnd': '17:00',
    });
    expect(office.radiusMeters, 100);
    expect(office.timezone, 'UTC');
    expect(office.isActive, isTrue);
  });

  test('SessionProfile mem-parse user dan workspace', () {
    final profile = SessionProfile.fromJson({
      'user': {'id': 'u1', 'email': 'a@example.com', 'name': 'A', 'status': 'ACTIVE'},
      'activeTenantId': 't1',
      'workspaces': [
        {'id': 't1', 'name': 'Tenant A', 'slug': 'tenant-a', 'roleKeys': ['VIEWER']},
      ],
    });
    expect(profile.user.name, 'A');
    expect(profile.workspaces.single.roleKeys, ['VIEWER']);
  });

  test('OrganizationProfile mem-parse divisi dan jabatan opsional', () {
    final assigned = OrganizationProfile.fromJson({
      'memberId': 'm1',
      'division': {'id': 'd1', 'name': 'Operasional'},
      'position': {'id': 'p1', 'name': 'Supervisor', 'divisionId': 'd1'},
    });
    expect(assigned.hasAssignment, isTrue);
    expect(assigned.division?.name, 'Operasional');
    expect(assigned.position?.divisionId, 'd1');

    final empty = OrganizationProfile.fromJson({
      'memberId': 'm2',
      'division': null,
      'position': null,
    });
    expect(empty.hasAssignment, isFalse);
    expect(empty.division, isNull);
  });

  test('MemoryTokenStore menyimpan dan menghapus token', () async {
    final store = MemoryTokenStore();
    expect(await store.read(), isNull);
    await store.write('abc');
    expect(await store.read(), 'abc');
    await store.clear();
    expect(await store.read(), isNull);
  });
}
