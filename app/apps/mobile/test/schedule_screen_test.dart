import 'dart:convert';

import 'package:absensi_mobile/api/api_client.dart';
import 'package:absensi_mobile/screens/schedule_screen.dart';
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

Map<String, dynamic> scheduleJson() {
  final year = DateTime.now().year;
  return {
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
      'name': 'Pola kantor pusat',
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
    'holidays': [
      {
        'id': 'h1',
        'date': '$year-08-17',
        'name': 'Libur Nasional Kemerdekaan',
        'type': 'NATIONAL',
      },
      {
        'id': 'h2',
        'date': '$year-12-24',
        'name': 'Cuti bersama kantor',
        'type': 'COMPANY',
      },
    ],
  };
}

Future<AuthService> buildAuth() async {
  final auth = AuthService(
    api: ApiClient(
      baseUrl: 'https://absensi.test',
      tokenStore: MemoryTokenStore(),
      client: MockClient((request) async {
        if (request.url.path == '/api/auth/login') {
          return http.Response(jsonEncode(sessionJson()), 200);
        }
        if (request.url.path == '/api/mobile/schedule') {
          return http.Response(jsonEncode(scheduleJson()), 200);
        }
        return http.Response('{}', 404);
      }),
    ),
  );
  await auth.login('a@example.com', 'benar');
  return auth;
}

void main() {
  testWidgets('jadwal menampilkan tujuh hari dan hari libur', (tester) async {
    final auth = await buildAuth();
    await tester.pumpWidget(
      MaterialApp(home: ScheduleScreen(auth: auth)),
    );
    await tester.pumpAndSettle();

    expect(find.text('Jam Kerja Mingguan'), findsOneWidget);
    expect(find.byKey(const Key('schedule-day-1')), findsOneWidget);
    expect(find.byKey(const Key('schedule-day-0')), findsOneWidget);
    expect(find.text('Hari kerja'), findsNWidgets(5));
    expect(find.text('Libur rutin'), findsNWidgets(2));
    expect(find.text('09:00–17:00'), findsWidgets);
    await tester.scrollUntilVisible(
      find.byKey(const Key('schedule-holidays')),
      300,
    );
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('schedule-holidays')), findsOneWidget);
    expect(find.text('Libur Nasional Kemerdekaan'), findsOneWidget);
    expect(find.text('Libur nasional'), findsOneWidget);
    expect(find.text('Libur perusahaan'), findsOneWidget);
  });
}
