import 'dart:convert';

import 'package:absensi_mobile/api/api_client.dart';
import 'package:absensi_mobile/screens/correction_history_screen.dart';
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

Map<String, dynamic> correctionJson({
  required String id,
  required String status,
  String requestType = 'CHECK_IN',
  String? rejectionReason,
}) => {
  'id': id,
  'memberId': 'm1',
  'attendanceLogId': null,
  'requestType': requestType,
  'requestedTimestamp': '2026-11-19T02:00:00.000Z',
  'originalTimestamp': null,
  'reason': 'Lupa check-in karena jaringan kantor terputus',
  'proofUrl': null,
  'status': status,
  'reviewedByMemberId': null,
  'reviewedAt': null,
  'rejectionReason': rejectionReason,
  'createdAt': '2026-11-19T03:00:00.000Z',
  'updatedAt': '2026-11-19T03:00:00.000Z',
};

class HistoryMock {
  HistoryMock({this.statusCode = 200});

  final int statusCode;
  final List<Uri> requested = [];

  late AuthService auth;

  Future<void> init(List<Map<String, dynamic>> rows) async {
    final client = ApiClient(
      baseUrl: 'https://absensi.test',
      tokenStore: MemoryTokenStore(),
      client: MockClient((request) async {
        if (request.url.path == '/api/auth/login') {
          return http.Response(jsonEncode(sessionJson()), 200);
        }
        if (request.url.path == '/api/corrections/me') {
          requested.add(request.url);
          if (statusCode != 200) {
            return http.Response(
              jsonEncode({
                'error': {'code': 'REQUEST_FAILED', 'message': 'gagal'},
              }),
              statusCode,
            );
          }
          final filter = request.url.queryParameters['status'];
          final filtered = filter == null
              ? rows
              : rows.where((row) => row['status'] == filter).toList();
          return http.Response(jsonEncode({'corrections': filtered}), 200);
        }
        return http.Response('{}', 404);
      }),
    );
    auth = AuthService(api: client);
    await auth.login('a@example.com', 'benar');
  }
}

Widget shell(Widget child) => MaterialApp(home: child);

void main() {
  testWidgets('riwayat revisi merender status dan alasan penolakan', (tester) async {
    final mock = HistoryMock();
    await mock.init([
      correctionJson(id: 'c1', status: 'PENDING'),
      correctionJson(
        id: 'c2',
        status: 'REJECTED',
        requestType: 'CHECK_OUT',
        rejectionReason: 'Bukti tidak sesuai tanggal absensi',
      ),
      correctionJson(id: 'c3', status: 'APPROVED'),
    ]);
    await tester.pumpWidget(shell(CorrectionHistoryScreen(auth: mock.auth)));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('correction-list')), findsOneWidget);
    expect(find.text('Menunggu'), findsWidgets);
    expect(find.text('Disetujui'), findsWidgets);
    expect(find.text('Ditolak'), findsWidgets);
    expect(
      find.text('Alasan penolakan: Bukti tidak sesuai tanggal absensi'),
      findsOneWidget,
    );
    expect(find.textContaining('Check-out'), findsOneWidget);
  });

  testWidgets('riwayat revisi kosong menampilkan empty state', (tester) async {
    final mock = HistoryMock();
    await mock.init(const []);
    await tester.pumpWidget(shell(CorrectionHistoryScreen(auth: mock.auth)));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('correction-empty')), findsOneWidget);
  });

  testWidgets('riwayat revisi gagal menampilkan error dan retry', (tester) async {
    final mock = HistoryMock(statusCode: 500);
    await mock.init(const []);
    await tester.pumpWidget(shell(CorrectionHistoryScreen(auth: mock.auth)));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('correction-error')), findsOneWidget);
    expect(find.text('Coba lagi'), findsOneWidget);
  });

  testWidgets('filter status mengirim query dan menyaring list', (tester) async {
    final mock = HistoryMock();
    await mock.init([
      correctionJson(id: 'c1', status: 'PENDING'),
      correctionJson(id: 'c2', status: 'REJECTED'),
    ]);
    await tester.pumpWidget(shell(CorrectionHistoryScreen(auth: mock.auth)));
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('correction-filter-REJECTED')));
    await tester.pumpAndSettle();

    expect(mock.requested.last.queryParameters['status'], 'REJECTED');
    expect(
      find.text('Lupa check-in karena jaringan kantor terputus'),
      findsOneWidget,
    );

    await tester.tap(find.byKey(const Key('correction-filter-ALL')));
    await tester.pumpAndSettle();
    expect(mock.requested.last.queryParameters.containsKey('status'), isFalse);
    expect(
      find.text('Lupa check-in karena jaringan kantor terputus'),
      findsNWidgets(2),
    );
  });
}
