import 'dart:convert';

import 'package:absensi_mobile/api/api_client.dart';
import 'package:absensi_mobile/screens/history_screen.dart';
import 'package:absensi_mobile/screens/correction_form_screen.dart';
import 'package:absensi_mobile/services/auth_service.dart';
import 'package:absensi_mobile/services/token_store.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:material_ui/material_ui.dart';

Map<String, dynamic> sessionJson() => {
  'token': 'token-abc',
  'user': {
    'id': 'u1',
    'email': 'a@example.com',
    'name': 'Ayu',
    'status': 'ACTIVE',
  },
  'activeTenantId': 't1',
  'workspaces': [
    {'id': 't1', 'name': 'Tenant A', 'slug': 'tenant-a'},
  ],
};

Future<AuthService> authWith(Future<http.Response> Function() history) async {
  final auth = AuthService(
    api: ApiClient(
      baseUrl: 'https://absensi.test',
      tokenStore: MemoryTokenStore(),
      client: MockClient((request) async {
        if (request.url.path == '/api/auth/login') {
          return http.Response(jsonEncode(sessionJson()), 200);
        }
        if (request.url.path == '/api/attendance/me') return history();
        if (request.url.path == '/api/corrections/me') {
          return http.Response(jsonEncode({'corrections': []}), 200);
        }
        return http.Response('{}', 404);
      }),
    ),
  );
  await auth.login('a@example.com', 'benar');
  return auth;
}

Widget shell(Widget child) => MaterialApp(home: child);

Map<String, dynamic> attendanceRow(
  String id,
  String type,
  String timestamp, {
  bool suspicious = false,
}) => {
  'id': id,
  'type': type,
  'timestampServer': timestamp,
  'distanceMeters': 4,
  'accuracyMeters': 5,
  'isSuspicious': suspicious,
  'photoUrl': '',
  'latitude': -6.7438107,
  'longitude': 108.5515617,
  'deviceName': 'Bandits',
  'deviceId': 'device-abc-1234',
  'deviceModel': 'itel S665L',
  'deviceManufacturer': 'ITEL',
};

String localDayKey(String timestamp) {
  final date = DateTime.parse(timestamp).toLocal();
  String two(int value) => value.toString().padLeft(2, '0');
  return '${date.year}-${two(date.month)}-${two(date.day)}';
}

String localTime(String timestamp) {
  final date = DateTime.parse(timestamp).toLocal();
  String two(int value) => value.toString().padLeft(2, '0');
  return '${two(date.hour)}:${two(date.minute)}';
}

void main() {
  testWidgets('riwayat memisahkan kartu Masuk dan Keluar', (tester) async {
    final auth = await authWith(
      () async => http.Response(
        jsonEncode({
          'attendance': [
            attendanceRow(
              'a1',
              'CHECK_IN',
              '2026-11-19T02:10:00.000Z',
              suspicious: true,
            ),
            attendanceRow('a2', 'CHECK_OUT', '2026-11-19T10:00:00.000Z'),
          ],
        }),
        200,
      ),
    );
    await tester.pumpWidget(shell(HistoryScreen(auth: auth)));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('history-card-CHECK_IN-a1')), findsOneWidget);
    expect(find.byKey(const Key('history-card-CHECK_OUT-a2')), findsOneWidget);
    expect(find.text('Masuk'), findsOneWidget);
    expect(find.text('Keluar'), findsOneWidget);
    expect(find.text('Perlu Tinjau'), findsOneWidget);
  });

  testWidgets('revisi kartu Keluar hanya menampilkan jam keluar', (
    tester,
  ) async {
    final auth = await authWith(
      () async => http.Response(
        jsonEncode({
          'attendance': [
            attendanceRow('a1', 'CHECK_IN', '2026-11-19T02:10:00.000Z'),
            attendanceRow('a2', 'CHECK_OUT', '2026-11-19T10:00:00.000Z'),
          ],
        }),
        200,
      ),
    );
    await tester.pumpWidget(shell(HistoryScreen(auth: auth)));
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('history-revise-a2')));
    await tester.pumpAndSettle();

    expect(find.byType(CorrectionFormScreen), findsOneWidget);
    expect(find.text('Revisi Presensi Keluar'), findsOneWidget);
    expect(find.byKey(const Key('correction-check-out')), findsOneWidget);
    expect(find.byKey(const Key('correction-check-in')), findsNothing);
    expect(find.byKey(const Key('correction-type')), findsNothing);
    expect(
      find.textContaining('Revisi hanya mengubah jam keluar'),
      findsOneWidget,
    );
  });

  testWidgets('kartu Masuk membuka revisi parsial jam masuk', (tester) async {
    final auth = await authWith(
      () async => http.Response(
        jsonEncode({
          'attendance': [
            attendanceRow('a1', 'CHECK_IN', '2026-11-19T02:10:00.000Z'),
            attendanceRow('a2', 'CHECK_OUT', '2026-11-19T10:00:00.000Z'),
          ],
        }),
        200,
      ),
    );
    await tester.pumpWidget(shell(HistoryScreen(auth: auth)));
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('history-revise-a1')));
    await tester.pumpAndSettle();

    expect(find.text('Revisi Presensi Masuk'), findsOneWidget);
    expect(find.byKey(const Key('correction-check-in')), findsOneWidget);
    expect(find.byKey(const Key('correction-check-out')), findsNothing);
    expect(
      find.textContaining('Revisi hanya mengubah jam masuk'),
      findsOneWidget,
    );
  });

  testWidgets('kartu Masuk membuka Detail Aktivitas khusus Masuk', (
    tester,
  ) async {
    const checkInAt = '2026-11-19T02:10:00.000Z';
    const checkOutAt = '2026-11-19T10:00:00.000Z';
    final auth = await authWith(
      () async => http.Response(
        jsonEncode({
          'attendance': [
            attendanceRow('a1', 'CHECK_IN', checkInAt),
            attendanceRow('a2', 'CHECK_OUT', checkOutAt),
          ],
        }),
        200,
      ),
    );
    await tester.pumpWidget(shell(HistoryScreen(auth: auth)));
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('history-detail-CHECK_IN-a1')));
    await tester.pumpAndSettle();

    final detail = find.byKey(const Key('activity-detail'));
    expect(detail, findsOneWidget);
    expect(find.text('Detail Aktivitas'), findsOneWidget);
    expect(
      find.descendant(of: detail, matching: find.text('Masuk')),
      findsOneWidget,
    );
    expect(
      find.descendant(of: detail, matching: find.text('Keluar')),
      findsNothing,
    );
    expect(
      find.descendant(of: detail, matching: find.text(localTime(checkInAt))),
      findsOneWidget,
    );
    expect(
      find.descendant(of: detail, matching: find.text(localTime(checkOutAt))),
      findsNothing,
    );
    expect(
      find.descendant(of: detail, matching: find.text('Lokasi')),
      findsOneWidget,
    );
    expect(find.text('Lihat di Peta'), findsOneWidget);
    expect(find.text('Perangkat'), findsOneWidget);
    expect(find.text('Revisi Kehadiran'), findsOneWidget);
    expect(find.text('Sesuai Spot Presensi'), findsOneWidget);
    expect(find.text('108.5515617'), findsOneWidget);
    expect(find.text('-6.7438107'), findsOneWidget);
    expect(find.text('Bandits'), findsOneWidget);
    expect(find.text('device-abc-1234'), findsOneWidget);
    expect(find.text('itel S665L'), findsOneWidget);
    expect(find.text('ITEL'), findsOneWidget);

    await tester.tap(find.byKey(const Key('activity-detail-revise')));
    await tester.pumpAndSettle();
    expect(find.text('Revisi Presensi Masuk'), findsOneWidget);
    expect(find.byKey(const Key('correction-check-in')), findsOneWidget);
    expect(find.byKey(const Key('correction-check-out')), findsNothing);
  });

  testWidgets('kartu Keluar membuka Detail Aktivitas khusus Keluar', (
    tester,
  ) async {
    const checkInAt = '2026-11-19T02:10:00.000Z';
    const checkOutAt = '2026-11-19T10:00:00.000Z';
    final auth = await authWith(
      () async => http.Response(
        jsonEncode({
          'attendance': [
            attendanceRow('a1', 'CHECK_IN', checkInAt),
            attendanceRow('a2', 'CHECK_OUT', checkOutAt),
          ],
        }),
        200,
      ),
    );
    await tester.pumpWidget(shell(HistoryScreen(auth: auth)));
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('history-detail-CHECK_OUT-a2')));
    await tester.pumpAndSettle();

    final detail = find.byKey(const Key('activity-detail'));
    expect(detail, findsOneWidget);
    expect(
      find.descendant(of: detail, matching: find.text('Keluar')),
      findsOneWidget,
    );
    expect(
      find.descendant(of: detail, matching: find.text('Masuk')),
      findsNothing,
    );
    expect(
      find.descendant(of: detail, matching: find.text(localTime(checkOutAt))),
      findsOneWidget,
    );
    expect(
      find.descendant(of: detail, matching: find.text(localTime(checkInAt))),
      findsNothing,
    );
    expect(find.text('Lokasi'), findsOneWidget);
    expect(find.text('Lihat di Peta'), findsOneWidget);
    expect(find.text('Perangkat'), findsOneWidget);
    expect(find.text('Revisi Kehadiran'), findsOneWidget);

    await tester.tap(find.byKey(const Key('activity-detail-revise')));
    await tester.pumpAndSettle();
    expect(find.text('Revisi Presensi Keluar'), findsOneWidget);
    expect(find.byKey(const Key('correction-check-out')), findsOneWidget);
    expect(find.byKey(const Key('correction-check-in')), findsNothing);
  });

  testWidgets('check-in tanpa check-out tetap punya kartu Keluar kosong', (
    tester,
  ) async {
    const timestamp = '2026-11-19T03:00:00.000Z';
    final day = localDayKey(timestamp);
    final auth = await authWith(
      () async => http.Response(
        jsonEncode({
          'attendance': [attendanceRow('a1', 'CHECK_IN', timestamp)],
        }),
        200,
      ),
    );
    await tester.pumpWidget(shell(HistoryScreen(auth: auth)));
    await tester.pumpAndSettle();

    expect(
      find.byKey(Key('history-card-CHECK_OUT-$day-check-out')),
      findsOneWidget,
    );
    expect(find.text('—'), findsOneWidget);
    await tester.tap(find.byKey(Key('history-revise-$day-check-out')));
    await tester.pumpAndSettle();
    expect(find.text('Revisi Presensi Keluar'), findsOneWidget);
  });

  testWidgets('riwayat kosong menampilkan empty state', (tester) async {
    final auth = await authWith(
      () async => http.Response(jsonEncode({'attendance': []}), 200),
    );
    await tester.pumpWidget(shell(HistoryScreen(auth: auth)));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('history-empty')), findsOneWidget);
  });

  testWidgets('riwayat gagal menampilkan error dan retry', (tester) async {
    final auth = await authWith(
      () async => http.Response(
        jsonEncode({
          'error': {'code': 'INTERNAL_ERROR', 'message': 'gagal'},
        }),
        500,
      ),
    );
    await tester.pumpWidget(shell(HistoryScreen(auth: auth)));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('history-error')), findsOneWidget);
    expect(find.text('Coba lagi'), findsOneWidget);
  });
}
