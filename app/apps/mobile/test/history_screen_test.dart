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

void main() {
  testWidgets('riwayat merender baris dan status suspicious', (tester) async {
    final auth = await authWith(
      () async => http.Response(
        jsonEncode({
          'attendance': [
            {
              'id': 'a1',
              'type': 'CHECK_IN',
              'timestampServer': '2026-11-19T03:00:00.000Z',
              'distanceMeters': 4,
              'accuracyMeters': 5,
              'isSuspicious': true,
              'photoUrl': '',
            },
          ],
        }),
        200,
      ),
    );
    await tester.pumpWidget(shell(HistoryScreen(auth: auth)));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('history-list')), findsOneWidget);
    expect(find.textContaining('Check-in'), findsOneWidget);
    expect(find.text('Suspicious'), findsOneWidget);
  });

  testWidgets('kartu riwayat membuka form revisi yang terisi otomatis', (
    tester,
  ) async {
    final auth = await authWith(
      () async => http.Response(
        jsonEncode({
          'attendance': [
            {
              'id': 'a1',
              'type': 'CHECK_IN',
              'timestampServer': '2026-11-19T02:10:00.000Z',
              'distanceMeters': 4,
              'accuracyMeters': 5,
              'isSuspicious': false,
              'photoUrl': '',
            },
            {
              'id': 'a2',
              'type': 'CHECK_OUT',
              'timestampServer': '2026-11-19T10:00:00.000Z',
              'distanceMeters': 4,
              'accuracyMeters': 5,
              'isSuspicious': false,
              'photoUrl': '',
            },
          ],
        }),
        200,
      ),
    );
    await tester.pumpWidget(shell(HistoryScreen(auth: auth)));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('history-revise-a1')), findsOneWidget);
    await tester.tap(find.byKey(const Key('history-revise-a1')));
    await tester.pumpAndSettle();

    expect(find.byType(CorrectionFormScreen), findsOneWidget);
    expect(find.byKey(const Key('correction-check-in')), findsOneWidget);
    expect(find.byKey(const Key('correction-check-out')), findsOneWidget);
    expect(find.textContaining('Tercatat: masuk'), findsOneWidget);
    expect(find.byKey(const Key('correction-kind-ADJUST')), findsOneWidget);
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
