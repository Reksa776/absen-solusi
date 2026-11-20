import 'dart:convert';

import 'package:absensi_mobile/api/api_client.dart';
import 'package:absensi_mobile/screens/main_shell_screen.dart';
import 'package:absensi_mobile/services/auth_service.dart';
import 'package:absensi_mobile/services/token_store.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:material_ui/material_ui.dart';

const officeJson = {
  'id': 'o1',
  'name': 'HQ',
  'latitude': -6.2,
  'longitude': 106.8,
  'radiusMeters': 100,
  'timezone': 'Asia/Jakarta',
  'workStart': '09:00',
  'workEnd': '17:00',
  'isActive': true,
};

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
    {
      'id': 't1',
      'name': 'Tenant A',
      'slug': 'tenant-a',
      'roleKeys': ['VIEWER'],
    },
  ],
};

Future<AuthService> buildAuth() async {
  final auth = AuthService(
    api: ApiClient(
      baseUrl: 'https://absensi.test',
      tokenStore: MemoryTokenStore(),
      client: MockClient((request) async {
        final path = request.url.path;
        if (path == '/api/auth/login') {
          return http.Response(jsonEncode(sessionJson()), 200);
        }
        if (path == '/api/attendance/office') {
          return http.Response(jsonEncode({'office': officeJson}), 200);
        }
        if (path == '/api/attendance/me') {
          return http.Response(jsonEncode({'attendance': []}), 200);
        }
        if (path == '/api/wfh/me') {
          return http.Response(jsonEncode({'wfh': []}), 200);
        }
        if (path == '/api/corrections/me') {
          return http.Response(jsonEncode({'corrections': []}), 200);
        }
        if (path == '/api/overtime/me') {
          return http.Response(jsonEncode({'overtime': []}), 200);
        }
        if (path == '/api/auth/logout') {
          return http.Response(jsonEncode({'ok': true}), 200);
        }
        return http.Response(jsonEncode({'ok': true}), 200);
      }),
    ),
  );
  await auth.login('a@example.com', 'benar');
  return auth;
}

Widget shell(AuthService auth) => MaterialApp(home: MainShellScreen(auth: auth));

/// Pump terbatas: shell memuat data asinkron sekaligus animasi indikator,
/// jadi pumpAndSettle tidak dipakai agar tidak menunggu animasi tanpa akhir.
Future<void> settle(WidgetTester tester) async {
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 450));
}

void main() {
  testWidgets('shell menampilkan empat tab dengan Absen sebagai awal', (
    tester,
  ) async {
    final auth = await buildAuth();
    await tester.pumpWidget(shell(auth));
    await settle(tester);

    expect(find.byKey(const Key('main-nav')), findsOneWidget);
    expect(find.byKey(const Key('nav-absen')), findsOneWidget);
    expect(find.byKey(const Key('nav-riwayat')), findsOneWidget);
    expect(find.byKey(const Key('nav-pengajuan')), findsOneWidget);
    expect(find.byKey(const Key('nav-profil')), findsOneWidget);
    expect(find.text('Status hari ini'), findsOneWidget);
    expect(find.byKey(const Key('attendance-submit')), findsOneWidget);
  });

  testWidgets('berpindah tab memuat konten dan kembali tanpa kehilangan state', (
    tester,
  ) async {
    final auth = await buildAuth();
    await tester.pumpWidget(shell(auth));
    await settle(tester);

    await tester.tap(find.byKey(const Key('nav-riwayat')));
    await settle(tester);
    expect(find.byKey(const Key('history-empty')), findsOneWidget);
    expect(find.byKey(const Key('history-month-CURRENT')), findsOneWidget);
    expect(find.byKey(const Key('history-status-SUSPICIOUS')), findsOneWidget);

    await tester.tap(find.byKey(const Key('nav-pengajuan')));
    await settle(tester);
    expect(find.byKey(const Key('requests-create')), findsOneWidget);
    expect(find.byKey(const Key('requests-segment-CORRECTION')), findsOneWidget);
    expect(find.byKey(const Key('requests-empty')), findsOneWidget);

    await tester.tap(find.byKey(const Key('nav-profil')));
    await settle(tester);
    expect(find.byKey(const Key('profile-app-version')), findsOneWidget);
    expect(find.byKey(const Key('profile-check-update')), findsOneWidget);
    expect(find.byKey(const Key('profile-logout')), findsOneWidget);
    expect(find.byKey(const Key('profile-schedule')), findsOneWidget);
    expect(find.byKey(const Key('profile-reminder-toggle')), findsOneWidget);
    expect(find.text('Ayu'), findsOneWidget);
    expect(find.text('HQ'), findsOneWidget);

    await tester.tap(find.byKey(const Key('nav-absen')));
    await settle(tester);
    expect(find.text('Status hari ini'), findsOneWidget);
    expect(find.byKey(const Key('attendance-submit')), findsOneWidget);
  });

  testWidgets('tombol buat pengajuan membuka pilihan jenis pengajuan', (
    tester,
  ) async {
    final auth = await buildAuth();
    await tester.pumpWidget(shell(auth));
    await settle(tester);

    await tester.tap(find.byKey(const Key('nav-pengajuan')));
    await settle(tester);
    await tester.tap(find.byKey(const Key('requests-create')));
    await settle(tester);

    expect(find.byKey(const Key('create-CORRECTION')), findsOneWidget);
    expect(find.byKey(const Key('create-OVERTIME')), findsOneWidget);
    expect(find.byKey(const Key('create-WFH')), findsOneWidget);
  });

  testWidgets('logout dari tab profil mengakhiri sesi', (tester) async {
    final auth = await buildAuth();
    await tester.pumpWidget(shell(auth));
    await settle(tester);

    await tester.tap(find.byKey(const Key('nav-profil')));
    await settle(tester);
    await tester.ensureVisible(find.byKey(const Key('profile-logout')));
    await tester.pump();
    await tester.tap(find.byKey(const Key('profile-logout')));
    await settle(tester);

    expect(auth.isAuthenticated, isFalse);
  });
}
