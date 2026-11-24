import 'dart:convert';
import 'dart:typed_data';

import 'package:absensi_mobile/api/api_client.dart';
import 'package:absensi_mobile/models/attendance_log.dart';
import 'package:absensi_mobile/services/token_store.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

void main() {
  test('login memakai bearer mode dan menyimpan token di store', () async {
    late http.Request captured;
    final store = MemoryTokenStore();
    final client = ApiClient(
      baseUrl: 'https://absensi.test',
      tokenStore: store,
      client: MockClient((request) async {
        captured = request;
        return http.Response(
          jsonEncode({
            'token': 'token-abc',
            'user': {
              'id': 'u1',
              'email': 'a@example.com',
              'name': 'A',
              'status': 'ACTIVE',
            },
            'activeTenantId': 't1',
            'workspaces': [
              {
                'id': 't1',
                'name': 'Tenant A',
                'slug': 'tenant-a',
                'memberId': 'm1',
                'roleKeys': ['WORKSPACE_OWNER'],
              },
            ],
          }),
          200,
          headers: {'content-type': 'application/json'},
        );
      }),
    );

    final result = await client.login('a@example.com', 'rahasia');
    expect(captured.url.path, '/api/auth/login');
    expect(captured.headers['x-auth-mode'], 'bearer');
    expect(
      captured.headers['x-device-platform'],
      isIn(['ANDROID', 'IOS', 'UNKNOWN']),
    );
    expect(captured.headers['x-device-id']?.length, greaterThanOrEqualTo(8));
    expect(captured.headers['x-device-name'], isNotEmpty);
    expect(result.user.email, 'a@example.com');
    expect(result.workspaces.single.name, 'Tenant A');
    expect(await store.read(), 'token-abc');
  });

  test('me mengirim Bearer dan mem-parse workspace', () async {
    final store = MemoryTokenStore();
    await store.write('token-abc');
    late http.Request captured;
    final client = ApiClient(
      baseUrl: 'https://absensi.test',
      tokenStore: store,
      client: MockClient((request) async {
        captured = request;
        return http.Response(
          jsonEncode({
            'user': {
              'id': 'u1',
              'email': 'a@example.com',
              'name': 'A',
              'status': 'ACTIVE',
            },
            'activeTenantId': 't1',
            'workspaces': [
              {'id': 't1', 'name': 'Tenant A', 'slug': 'tenant-a'},
            ],
          }),
          200,
        );
      }),
    );

    final profile = await client.me();
    expect(captured.headers['authorization'], 'Bearer token-abc');
    expect(profile.activeTenantId, 't1');
    expect(profile.workspaces.single.id, 't1');
  });

  test('error API diterjemahkan menjadi ApiException', () async {
    final store = MemoryTokenStore();
    await store.write('token-abc');
    final client = ApiClient(
      baseUrl: 'https://absensi.test',
      tokenStore: store,
      client: MockClient(
        (_) async => http.Response(
          jsonEncode({
            'error': {
              'code': 'GEOFENCE_VIOLATION',
              'message': 'Di luar radius',
            },
          }),
          403,
        ),
      ),
    );

    await expectLater(
      client.attendanceHistory(),
      throwsA(
        isA<ApiException>()
            .having((error) => error.statusCode, 'status', 403)
            .having((error) => error.code, 'code', 'GEOFENCE_VIOLATION'),
      ),
    );
  });

  test('check-in mengirim multipart dan mem-parse attendance', () async {
    final store = MemoryTokenStore();
    await store.write('token-abc');
    late http.Request captured;
    final client = ApiClient(
      baseUrl: 'https://absensi.test',
      tokenStore: store,
      client: MockClient((request) async {
        captured = request;
        return http.Response(
          jsonEncode({
            'id': 'a1',
            'type': 'CHECK_IN',
            'timestampServer': '2026-11-19T03:00:00.000Z',
            'distanceMeters': 12.5,
            'accuracyMeters': 5,
            'isSuspicious': false,
            'photoUrl': '/uploads/attendance/a.jpg',
          }),
          201,
        );
      }),
    );

    final result = await client.checkIn(
      latitude: -6.2,
      longitude: 106.8,
      accuracyMeters: 5,
      isMockLocation: false,
      photoBytes: Uint8List.fromList([1, 2, 3]),
      deviceInfo: 'android',
    );

    expect(captured.method, 'POST');
    expect(captured.url.path, '/api/attendance/check-in');
    expect(captured.headers['authorization'], 'Bearer token-abc');
    expect(captured.body, contains('is_mock_location'));
    expect(result, isA<AttendanceLog>());
    expect(result.distanceMeters, 12.5);
  });

  test('riwayat memakai query tanggal dan hanya mem-parse list', () async {
    final store = MemoryTokenStore();
    await store.write('token-abc');
    late http.Request captured;
    final client = ApiClient(
      baseUrl: 'https://absensi.test',
      tokenStore: store,
      client: MockClient((request) async {
        captured = request;
        return http.Response(
          jsonEncode({
            'attendance': [
              {
                'id': 'a1',
                'type': 'CHECK_IN',
                'timestampServer': '2026-11-19T03:00:00.000Z',
                'distanceMeters': 3,
                'accuracyMeters': 5,
                'isSuspicious': true,
                'photoUrl': '/uploads/attendance/a.jpg',
              },
            ],
          }),
          200,
        );
      }),
    );

    final rows = await client.attendanceHistory(
      from: DateTime(2026, 11, 1),
      to: DateTime(2026, 11, 19),
    );
    expect(captured.url.queryParameters, {
      'from': '2026-11-01',
      'to': '2026-11-19',
    });
    expect(rows.single.isSuspicious, isTrue);
  });
}
