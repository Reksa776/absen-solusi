import 'package:absensi_mobile/models/attendance_log.dart';
import 'package:absensi_mobile/models/office_location.dart';
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

  test('MemoryTokenStore menyimpan dan menghapus token', () async {
    final store = MemoryTokenStore();
    expect(await store.read(), isNull);
    await store.write('abc');
    expect(await store.read(), 'abc');
    await store.clear();
    expect(await store.read(), isNull);
  });
}
