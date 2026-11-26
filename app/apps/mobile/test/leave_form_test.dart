import 'dart:convert';

import 'package:absensi_mobile/api/api_client.dart';
import 'package:absensi_mobile/screens/leave_form_screen.dart';
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

Map<String, dynamic> scheduleJson() => {
  'office': {
    'id': 'o1',
    'name': 'Kantor Pusat',
    'timezone': 'Asia/Jakarta',
    'radiusMeters': 100,
    'workStart': '09:00',
    'workEnd': '17:00',
  },
  'workPattern': {'id': 'p1', 'name': 'Reguler', 'timezone': 'Asia/Jakarta'},
  'weekly': [
    for (var day = 0; day < 7; day++)
      {
        'dayOfWeek': day,
        'label': 'Hari $day',
        'isWorkday': day >= 1 && day <= 5,
        'startTime': '09:00',
        'endTime': '17:00',
        'earliestCheckInMinutes': 120,
        'lateToleranceMinutes': 15,
      },
  ],
  'holidays': const [],
};

class LeaveMock {
  LeaveMock({this.remainingDays = 12, this.entitledDays = 12});

  final int remainingDays;
  final int entitledDays;
  final List<http.Request> requests = [];

  late AuthService auth;

  Future<void> init() async {
    final client = ApiClient(
      baseUrl: 'https://absensi.test',
      tokenStore: MemoryTokenStore(),
      client: MockClient((request) async {
        requests.add(request);
        if (request.url.path == '/api/auth/login') {
          return http.Response(jsonEncode(sessionJson()), 200);
        }
        if (request.url.path == '/api/leave/balance') {
          return http.Response(
            jsonEncode({
              'year': 2026,
              'entitledDays': entitledDays,
              'usedDays': entitledDays - remainingDays,
              'remainingDays': remainingDays,
            }),
            200,
          );
        }
        if (request.url.path == '/api/mobile/schedule') {
          return http.Response(jsonEncode(scheduleJson()), 200);
        }
        if (request.url.path == '/api/leave') {
          final body = jsonDecode(request.body) as Map<String, dynamic>;
          return http.Response(
            jsonEncode({
              'id': 'l-new',
              'leaveType': body['leaveType'],
              'startDate': body['startDate'],
              'endDate': body['endDate'],
              'workingDays': 11,
              'reason': body['reason'],
              'status': 'PENDING',
              'currentApprovalLevel': 0,
              'createdAt': '2026-11-26T00:00:00.000Z',
              'rejectionReason': null,
            }),
            201,
          );
        }
        return http.Response('{}', 404);
      }),
    );
    auth = AuthService(api: client);
    await auth.login('a@example.com', 'benar');
  }

  Iterable<http.Request> postsFor(String path) => requests.where(
    (request) => request.method == 'POST' && request.url.path == path,
  );
}

Future<void> openForm(
  WidgetTester tester,
  LeaveMock mock, {
  DateTime? start,
  DateTime? end,
}) async {
  tester.view.physicalSize = const Size(800, 1600);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: Builder(
          builder: (context) => TextButton(
            onPressed: () => Navigator.of(context).push(
              MaterialPageRoute(
                builder: (_) => LeaveFormScreen(
                  auth: mock.auth,
                  now: () => DateTime(2026, 11, 26, 9),
                  initialStart: start,
                  initialEnd: end,
                ),
              ),
            ),
            child: const Text('buka'),
          ),
        ),
      ),
    ),
  );
  await tester.tap(find.text('buka'));
  await tester.pumpAndSettle();
}

String? textOf(WidgetTester tester, String key) {
  final finder = find.byKey(Key(key));
  if (finder.evaluate().isEmpty) return null;
  return tester.widget<Text>(finder).data;
}

void main() {
  testWidgets('rentang 26/11/2026 - 10/12/2026 menampilkan 11 hari kerja', (
    tester,
  ) async {
    final mock = LeaveMock();
    await mock.init();
    await openForm(
      tester,
      mock,
      start: DateTime(2026, 11, 26),
      end: DateTime(2026, 12, 10),
    );

    expect(textOf(tester, 'leave-duration'), 'Diajukan: 11 hari kerja');
    expect(
      textOf(tester, 'leave-remaining'),
      'Sisa cuti setelah pengajuan: 1 / 12 hari',
    );
    expect(find.byKey(const Key('leave-warning')), findsNothing);
    final submit = tester.widget<FilledButton>(
      find.byKey(const Key('leave-submit')),
    );
    expect(submit.onPressed, isNotNull);
  });

  testWidgets('pengajuan melebihi kuota memunculkan peringatan dan blokir kirim', (
    tester,
  ) async {
    final mock = LeaveMock();
    await mock.init();
    await openForm(
      tester,
      mock,
      start: DateTime(2026, 11, 26),
      end: DateTime(2026, 12, 14),
    );

    expect(textOf(tester, 'leave-duration'), 'Diajukan: 13 hari kerja');
    expect(
      textOf(tester, 'leave-warning'),
      'Jumlah hari cuti (13 hari) melebihi sisa kuota cuti Anda (12 hari).',
    );
    expect(textOf(tester, 'leave-remaining'), 'Sisa cuti setelah pengajuan: 0 / 12 hari');
    final submit = tester.widget<FilledButton>(
      find.byKey(const Key('leave-submit')),
    );
    expect(submit.onPressed, isNull);
  });

  testWidgets('rentang akhir pekan ditolak dengan 0 hari kerja', (tester) async {
    final mock = LeaveMock();
    await mock.init();
    await openForm(
      tester,
      mock,
      start: DateTime(2026, 11, 28),
      end: DateTime(2026, 11, 29),
    );

    expect(textOf(tester, 'leave-duration'), 'Diajukan: 0 hari kerja');
    expect(
      textOf(tester, 'leave-warning'),
      'Rentang tanggal yang dipilih tidak mencakup hari kerja (0 hari).',
    );
    final submit = tester.widget<FilledButton>(
      find.byKey(const Key('leave-submit')),
    );
    expect(submit.onPressed, isNull);
  });

  testWidgets('mengubah tanggal selesai memperbarui hari dan peringatan', (
    tester,
  ) async {
    final mock = LeaveMock();
    await mock.init();
    await openForm(
      tester,
      mock,
      start: DateTime(2026, 11, 26),
      end: DateTime(2026, 12, 10),
    );

    await tester.tap(find.byKey(const Key('leave-end-date')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('14'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('OK'));
    await tester.pumpAndSettle();

    expect(textOf(tester, 'leave-duration'), 'Diajukan: 13 hari kerja');
    expect(find.byKey(const Key('leave-warning')), findsOneWidget);
    expect(
      tester
          .widget<FilledButton>(find.byKey(const Key('leave-submit')))
          .onPressed,
      isNull,
    );
  });

  testWidgets('pengajuan valid mengirim tanggal dan alasan', (tester) async {
    final mock = LeaveMock();
    await mock.init();
    await openForm(
      tester,
      mock,
      start: DateTime(2026, 11, 26),
      end: DateTime(2026, 12, 10),
    );

    await tester.enterText(
      find.byKey(const Key('leave-reason')),
      'Cuti tahunan keluarga di akhir tahun',
    );
    await tester.tap(find.byKey(const Key('leave-submit')));
    await tester.pumpAndSettle();

    final request = mock.postsFor('/api/leave').single;
    final body = jsonDecode(request.body) as Map<String, dynamic>;
    expect(body['leaveType'], 'CUTI_TAHUNAN');
    expect(body['startDate'], '2026-11-26');
    expect(body['endDate'], '2026-12-10');
    expect(body['reason'], 'Cuti tahunan keluarga di akhir tahun');
  });

  testWidgets('cuti non-tahunan tidak memotong kuota tahunan', (tester) async {
    final mock = LeaveMock();
    await mock.init();
    await openForm(
      tester,
      mock,
      start: DateTime(2026, 11, 26),
      end: DateTime(2026, 12, 14),
    );

    await tester.tap(find.byKey(const Key('leave-type')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Cuti khusus').last);
    await tester.pumpAndSettle();

    expect(textOf(tester, 'leave-remaining'), isNull);
    expect(find.byKey(const Key('leave-remaining-note')), findsOneWidget);
    expect(find.byKey(const Key('leave-warning')), findsNothing);
  });
}
