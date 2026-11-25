import 'dart:convert';

import 'package:absensi_mobile/api/api_client.dart';
import 'package:absensi_mobile/screens/main_shell_screen.dart';
import 'package:absensi_mobile/services/auth_service.dart';
import 'package:absensi_mobile/services/live_sync.dart';
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

Map<String, dynamic> scheduleJson() => {
  'office': {
    'id': 'o1',
    'name': 'HQ',
    'timezone': 'Asia/Jakarta',
    'radiusMeters': 100,
    'workStart': '09:00',
    'workEnd': '17:00',
  },
  'workPattern': {
    'id': 'p1',
    'name': 'Pola kantor',
    'timezone': 'Asia/Jakarta',
  },
  'weekly': [
    for (final entry in const [
      (1, 'Senin'),
      (2, 'Selasa'),
      (3, 'Rabu'),
      (4, 'Kamis'),
      (5, 'Jumat'),
      (6, 'Sabtu'),
      (0, 'Minggu'),
    ])
      {
        'dayOfWeek': entry.$1,
        'label': entry.$2,
        'isWorkday': entry.$1 >= 1 && entry.$1 <= 5,
        'startTime': '09:00',
        'endTime': '17:00',
        'lateToleranceMinutes': 15,
      },
  ],
  'holidays': [],
};

Future<AuthService> buildAuth({void Function(String path)? onRequest}) async {
  final auth = AuthService(
    api: ApiClient(
      baseUrl: 'https://absensi.test',
      tokenStore: MemoryTokenStore(),
      client: MockClient((request) async {
        final path = request.url.path;
        onRequest?.call(path);
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
        if (path == '/api/mobile/schedule') {
          return http.Response(jsonEncode(scheduleJson()), 200);
        }
        if (path == '/api/notifications/me') {
          return http.Response(
            jsonEncode({'notifications': [], 'unreadCount': 2}),
            200,
          );
        }
        if (path == '/api/leave/balance') {
          return http.Response(
            jsonEncode({
              'year': 2026,
              'entitledDays': 12,
              'usedDays': 3,
              'remainingDays': 9,
            }),
            200,
          );
        }
        if (path == '/api/mobile/device') {
          return http.Response(jsonEncode({'device': null}), 200);
        }
        if (path == '/api/mobile/profile/photo') {
          return http.Response(jsonEncode({'status': 'NONE'}), 200);
        }
        return http.Response(jsonEncode({'ok': true}), 200);
      }),
    ),
  );
  await auth.login('a@example.com', 'benar');
  return auth;
}

Widget shell(AuthService auth) =>
    MaterialApp(home: MainShellScreen(auth: auth));

/// Pump terbatas: shell memuat data asinkron sekaligus animasi indikator,
/// jadi pumpAndSettle tidak dipakai agar tidak menunggu animasi tanpa akhir.
Future<void> settle(WidgetTester tester) async {
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 450));
}

void main() {
  testWidgets('shell menampilkan empat tab dengan Beranda sebagai awal', (
    tester,
  ) async {
    final auth = await buildAuth();
    await tester.pumpWidget(shell(auth));
    await settle(tester);

    expect(find.byKey(const Key('main-nav')), findsOneWidget);
    expect(find.byKey(const Key('nav-beranda')), findsOneWidget);
    expect(find.byKey(const Key('nav-jadwal')), findsOneWidget);
    expect(find.byKey(const Key('nav-aktivitas')), findsOneWidget);
    expect(find.byKey(const Key('nav-pesan')), findsOneWidget);
    expect(find.byType(Badge), findsOneWidget);
    expect(find.text('Jadwal Anda Hari Ini'), findsOneWidget);
    expect(find.text('Ringkasan Kehadiran'), findsOneWidget);
    expect(find.byKey(const Key('attendance-submit')), findsOneWidget);
    expect(find.byKey(const Key('home-leave-quota')), findsOneWidget);
    expect(find.byKey(const Key('home-timezone')), findsOneWidget);
  });

  testWidgets(
    'berpindah tab memuat konten dan kembali tanpa kehilangan state',
    (tester) async {
      final auth = await buildAuth();
      await tester.pumpWidget(shell(auth));
      await settle(tester);

      await tester.tap(find.byKey(const Key('nav-jadwal')));
      await settle(tester);
      expect(find.byKey(const Key('schedule-segment-0')), findsOneWidget);
      expect(find.byKey(const Key('schedule-today')), findsOneWidget);

      await tester.tap(find.byKey(const Key('nav-aktivitas')));
      await settle(tester);
      expect(find.byKey(const Key('history-empty')), findsOneWidget);
      expect(find.byKey(const Key('activity-period-MONTH')), findsOneWidget);
      expect(find.byKey(const Key('activity-stat-present')), findsOneWidget);

      await tester.tap(find.byKey(const Key('nav-pesan')));
      await settle(tester);
      expect(find.byKey(const Key('messages-segment-0')), findsOneWidget);
      expect(find.byKey(const Key('messages-filter-ALL')), findsOneWidget);
      await tester.tap(find.byKey(const Key('messages-segment-1')));
      await settle(tester);
      expect(find.byKey(const Key('requests-empty')), findsOneWidget);

      await tester.tap(find.byKey(const Key('nav-beranda')));
      await settle(tester);
      expect(find.text('Jadwal Anda Hari Ini'), findsOneWidget);
      expect(find.byKey(const Key('attendance-submit')), findsOneWidget);
    },
  );

  testWidgets('menu layanan Beranda bisa dilipat dan dibuka', (tester) async {
    final auth = await buildAuth();
    await tester.pumpWidget(shell(auth));
    await settle(tester);

    expect(find.byKey(const Key('service-lembur')), findsOneWidget);
    expect(find.byKey(const Key('service-profil')), findsNothing);

    await tester.ensureVisible(find.byKey(const Key('home-services-toggle')));
    await tester.pump();
    await tester.tap(find.byKey(const Key('home-services-toggle')));
    await settle(tester);

    expect(find.byKey(const Key('service-kunjungan')), findsOneWidget);
    expect(find.byKey(const Key('service-profil')), findsOneWidget);
    expect(find.text('Kunjungan Klien'), findsOneWidget);
    expect(find.text('Tutup'), findsOneWidget);
  });

  testWidgets('layout empat tab aman pada lebar 360dp', (tester) async {
    tester.view.physicalSize = const Size(360, 800);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(() {
      tester.view.resetPhysicalSize();
      tester.view.resetDevicePixelRatio();
    });

    final auth = await buildAuth();
    await tester.pumpWidget(shell(auth));
    await settle(tester);
    expect(tester.takeException(), isNull);
    expect(find.byKey(const Key('attendance-submit')), findsOneWidget);

    await tester.ensureVisible(find.byKey(const Key('home-services-toggle')));
    await tester.pump();
    await tester.tap(find.byKey(const Key('home-services-toggle')));
    await settle(tester);
    expect(tester.takeException(), isNull);
    expect(find.byKey(const Key('service-profil')), findsOneWidget);

    await tester.tap(find.byKey(const Key('nav-jadwal')));
    await settle(tester);
    expect(tester.takeException(), isNull);

    await tester.tap(find.byKey(const Key('nav-aktivitas')));
    await settle(tester);
    expect(tester.takeException(), isNull);

    await tester.tap(find.byKey(const Key('nav-pesan')));
    await settle(tester);
    expect(tester.takeException(), isNull);
  });

  testWidgets('avatar membuka profil lengkap dan logout mengakhiri sesi', (
    tester,
  ) async {
    final auth = await buildAuth();
    await tester.pumpWidget(shell(auth));
    await settle(tester);

    await tester.tap(find.byKey(const Key('home-profile')));
    await settle(tester);
    await settle(tester);

    expect(find.byKey(const Key('profile-app-version')), findsOneWidget);
    expect(find.byKey(const Key('profile-check-update')), findsOneWidget);
    expect(find.byKey(const Key('profile-logout')), findsOneWidget);
    expect(find.byKey(const Key('profile-schedule')), findsOneWidget);
    expect(find.byKey(const Key('profile-reminder-toggle')), findsOneWidget);
    expect(find.text('Ayu'), findsOneWidget);
    expect(find.text('HQ'), findsOneWidget);

    await tester.ensureVisible(find.byKey(const Key('profile-logout')));
    await tester.pump();
    await tester.tap(find.byKey(const Key('profile-logout')));
    await settle(tester);

    expect(auth.isAuthenticated, isFalse);
  });

  testWidgets('timer 12 detik menyegarkan data tanpa aksi pengguna', (
    tester,
  ) async {
    LiveSync.instance.reset();
    final calls = <String>[];
    final auth = await buildAuth(onRequest: calls.add);
    await tester.pumpWidget(shell(auth));
    await settle(tester);

    final before = calls.where((path) => path == '/api/attendance/me').length;
    await tester.pump(const Duration(seconds: 12));
    await settle(tester);

    expect(
      calls.where((path) => path == '/api/attendance/me').length,
      greaterThan(before),
    );
    expect(LiveSync.instance.tick, greaterThan(0));
  });

  testWidgets('pindah tab memicu sinkronisasi langsung', (tester) async {
    LiveSync.instance.reset();
    final auth = await buildAuth();
    await tester.pumpWidget(shell(auth));
    await settle(tester);

    final before = LiveSync.instance.tick;
    await tester.tap(find.byKey(const Key('nav-jadwal')));
    await settle(tester);

    expect(LiveSync.instance.tick, greaterThan(before));
    expect(find.byKey(const Key('schedule-today')), findsOneWidget);
  });

  testWidgets('timer berhenti saat aplikasi di background dan saat dispose', (
    tester,
  ) async {
    LiveSync.instance.reset();
    final auth = await buildAuth();
    await tester.pumpWidget(shell(auth));
    await settle(tester);

    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
    await tester.pump();
    final paused = LiveSync.instance.tick;
    await tester.pump(const Duration(seconds: 30));
    expect(LiveSync.instance.tick, paused);

    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await settle(tester);
    expect(LiveSync.instance.tick, greaterThan(paused));

    final resumed = LiveSync.instance.tick;
    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pump();
    await tester.pump(const Duration(seconds: 30));
    expect(LiveSync.instance.tick, resumed);
  });
}
