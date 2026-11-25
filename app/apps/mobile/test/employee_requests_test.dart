import 'dart:convert';

import 'package:absensi_mobile/api/api_client.dart';
import 'package:absensi_mobile/screens/employee_requests_screen.dart';
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

Map<String, dynamic> overtimeJson({
  String id = 'o1',
  String date = '2026-11-24',
  String startTime = '18:00',
  String endTime = '20:00',
  int durationMinutes = 120,
  String status = 'PENDING',
}) => {
  'id': id,
  'date': date,
  'startTime': startTime,
  'endTime': endTime,
  'durationMinutes': durationMinutes,
  'reason': 'Menutup laporan bulanan cabang',
  'status': status,
  'rejectionReason': null,
};

Map<String, dynamic> wfhJson({
  String id = 'w1',
  String date = '2026-11-23',
  String status = 'APPROVED',
}) => {
  'id': id,
  'date': date,
  'reason': 'Bekerja dari rumah karena akses kantor terendam banjir',
  'status': status,
  'rejectionReason': null,
};

class RequestsMock {
  RequestsMock({
    this.overtime = const [],
    this.wfh = const [],
    this.submitStatus = 201,
  });

  final List<Map<String, dynamic>> overtime;
  final List<Map<String, dynamic>> wfh;
  final int submitStatus;
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
        if (request.url.path == '/api/overtime/me') {
          return http.Response(jsonEncode({'overtime': overtime}), 200);
        }
        if (request.url.path == '/api/wfh/me') {
          return http.Response(jsonEncode({'wfh': wfh}), 200);
        }
        if (request.url.path == '/api/overtime') {
          if (submitStatus != 201) {
            return http.Response(
              jsonEncode({
                'error': {
                  'code': 'OVERTIME_LIMIT',
                  'message': 'Batas lembur tercapai.',
                },
              }),
              submitStatus,
            );
          }
          final body = jsonDecode(request.body) as Map<String, dynamic>;
          return http.Response(
            jsonEncode(
              overtimeJson(
                id: 'o-new',
                date: body['date'] as String,
                startTime: body['startTime'] as String,
                endTime: body['endTime'] as String,
              ),
            ),
            201,
          );
        }
        if (request.url.path == '/api/wfh') {
          final body = jsonDecode(request.body) as Map<String, dynamic>;
          return http.Response(
            jsonEncode(wfhJson(id: 'w-new', date: body['date'] as String)),
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

Future<void> openScreen(WidgetTester tester, RequestsMock mock) async {
  await tester.pumpWidget(
    MaterialApp(
      home: EmployeeRequestsScreen(
        auth: mock.auth,
        now: () => DateTime(2026, 11, 25, 9),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

Future<void> tapSubmit(WidgetTester tester, String key) async {
  await tester.ensureVisible(find.byKey(Key(key)));
  await tester.pumpAndSettle();
  await tester.tap(find.byKey(Key(key)));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('mode Lembur tampil default dan bisa berpindah ke WFH', (
    tester,
  ) async {
    final mock = RequestsMock();
    await mock.init();
    await openScreen(tester, mock);

    expect(find.text('Pengajuan Lembur'), findsOneWidget);
    expect(find.text('Pengajuan WFH'), findsOneWidget);
    expect(find.byKey(const Key('overtime-date')), findsOneWidget);
    expect(find.text('Tanggal Lembur'), findsOneWidget);
    expect(find.byKey(const Key('overtime-start')), findsOneWidget);
    expect(find.byKey(const Key('overtime-end')), findsOneWidget);
    expect(find.text('Ajukan Lembur'), findsOneWidget);
    expect(find.text('Riwayat Pengajuan Terbaru'), findsOneWidget);
    expect(find.byKey(const Key('request-history-empty')), findsOneWidget);

    await tester.tap(find.byKey(const Key('mode-WFH')));
    await tester.pumpAndSettle();

    expect(find.text('Tanggal WFH'), findsOneWidget);
    expect(find.byKey(const Key('overtime-start')), findsNothing);
    expect(find.byKey(const Key('overtime-end')), findsNothing);
    expect(find.byKey(const Key('wfh-reason')), findsOneWidget);
    expect(find.text('Ajukan WFH'), findsOneWidget);
  });

  testWidgets('durasi lembur dihitung otomatis dan jam terbalik ditolak', (
    tester,
  ) async {
    final mock = RequestsMock();
    await mock.init();
    await openScreen(tester, mock);

    expect(find.text('Estimasi durasi lembur: 2 jam 0 menit'), findsOneWidget);

    await tester.enterText(find.byKey(const Key('overtime-start')), '08:15');
    await tester.enterText(find.byKey(const Key('overtime-end')), '10:45');
    await tester.pump();

    expect(find.text('Estimasi durasi lembur: 2 jam 30 menit'), findsOneWidget);

    await tester.enterText(find.byKey(const Key('overtime-end')), '07:00');
    await tester.pump();

    expect(find.text('Jam selesai harus setelah jam mulai.'), findsOneWidget);

    await tester.enterText(
      find.byKey(const Key('overtime-reason')),
      'Menutup laporan bulanan cabang',
    );
    await tapSubmit(tester, 'overtime-submit');

    expect(mock.postsFor('/api/overtime').isEmpty, isTrue);
  });

  testWidgets('submit lembur mengirim tanggal, jam, dan alasan', (
    tester,
  ) async {
    final mock = RequestsMock();
    await mock.init();
    await openScreen(tester, mock);

    await tester.enterText(find.byKey(const Key('overtime-start')), '18:30');
    await tester.enterText(find.byKey(const Key('overtime-end')), '21:00');
    await tester.enterText(
      find.byKey(const Key('overtime-reason')),
      'Menutup laporan bulanan cabang',
    );
    await tapSubmit(tester, 'overtime-submit');

    final request = mock.postsFor('/api/overtime').single;
    expect(request.headers['authorization'], 'Bearer token-abc');
    final body = jsonDecode(request.body) as Map<String, dynamic>;
    expect(body, {
      'date': '2026-11-25',
      'startTime': '18:30',
      'endTime': '21:00',
      'reason': 'Menutup laporan bulanan cabang',
    });
    expect(find.text('Pengajuan lembur terkirim.'), findsOneWidget);
    expect(find.text('Riwayat Pengajuan Terbaru'), findsOneWidget);
  });

  testWidgets('submit WFH mengirim tanggal dan alasan', (tester) async {
    final mock = RequestsMock();
    await mock.init();
    await openScreen(tester, mock);

    await tester.tap(find.byKey(const Key('mode-WFH')));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const Key('wfh-reason')),
      'Bekerja dari rumah karena akses kantor terendam banjir',
    );
    await tapSubmit(tester, 'wfh-submit');

    final request = mock.postsFor('/api/wfh').single;
    final body = jsonDecode(request.body) as Map<String, dynamic>;
    expect(body, {
      'date': '2026-11-26',
      'reason': 'Bekerja dari rumah karena akses kantor terendam banjir',
    });
    expect(find.text('Pengajuan WFH terkirim.'), findsOneWidget);
  });

  testWidgets('alasan kurang dari 10 karakter tidak dikirim', (tester) async {
    final mock = RequestsMock();
    await mock.init();
    await openScreen(tester, mock);

    await tester.enterText(find.byKey(const Key('overtime-reason')), 'pendek');
    await tapSubmit(tester, 'overtime-submit');

    expect(find.byKey(const Key('request-error')), findsOneWidget);
    expect(find.text('Alasan lembur minimal 10 karakter.'), findsOneWidget);
    expect(mock.postsFor('/api/overtime').isEmpty, isTrue);
  });

  testWidgets('riwayat menampilkan badge jenis, jam, dan status', (
    tester,
  ) async {
    final mock = RequestsMock(overtime: [overtimeJson()], wfh: [wfhJson()]);
    await mock.init();
    await openScreen(tester, mock);

    expect(find.byKey(const Key('history-overtime-o1')), findsOneWidget);
    expect(find.byKey(const Key('history-wfh-w1')), findsOneWidget);
    expect(find.text('Lembur'), findsOneWidget);
    expect(find.text('WFH'), findsOneWidget);
    expect(find.text('18:00 - 20:00 • 2 jam 0 menit'), findsOneWidget);
    expect(find.text('Menunggu'), findsOneWidget);
    expect(find.text('Disetujui'), findsOneWidget);
    expect(find.byKey(const Key('request-history-empty')), findsNothing);
  });

  testWidgets('tidak ada overflow pada lebar layar 360dp', (tester) async {
    tester.view.physicalSize = const Size(360, 740);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final mock = RequestsMock(
      overtime: [
        overtimeJson(),
        overtimeJson(id: 'o2', date: '2026-11-22', status: 'REJECTED'),
      ],
      wfh: [
        wfhJson(),
        wfhJson(id: 'w2', date: '2026-11-20', status: 'PENDING'),
      ],
    );
    await mock.init();
    await openScreen(tester, mock);

    expect(tester.takeException(), isNull);

    await tester.enterText(find.byKey(const Key('overtime-start')), '18:00');
    await tester.enterText(find.byKey(const Key('overtime-end')), '23:59');
    await tester.pump();
    expect(find.textContaining('Estimasi durasi lembur'), findsOneWidget);
    expect(tester.takeException(), isNull);

    await tester.tap(find.byKey(const Key('mode-WFH')));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);

    await tester.drag(find.byType(ListView), const Offset(0, -600));
    await tester.pumpAndSettle();
    await tester.drag(find.byType(ListView), const Offset(0, -600));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('history-wfh-w2')), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
