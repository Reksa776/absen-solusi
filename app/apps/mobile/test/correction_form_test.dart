import 'dart:convert';
import 'dart:typed_data';

import 'package:absensi_mobile/api/api_client.dart';
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

Map<String, dynamic> correctionJson({String status = 'PENDING'}) => {
  'id': 'c1',
  'memberId': 'm1',
  'attendanceLogId': null,
  'requestType': 'CHECK_IN',
  'requestedTimestamp': '2026-11-19T02:00:00.000Z',
  'originalTimestamp': null,
  'reason': 'Lupa check-in karena jaringan kantor terputus',
  'proofUrl': null,
  'status': status,
  'reviewedByMemberId': null,
  'reviewedAt': null,
  'rejectionReason': null,
  'createdAt': '2026-11-19T03:00:00.000Z',
  'updatedAt': '2026-11-19T03:00:00.000Z',
};

class CorrectionMock {
  CorrectionMock({this.submitStatus = 201, this.submitCode = ''});

  final int submitStatus;
  final String submitCode;
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
        if (request.url.path == '/api/corrections') {
          if (submitStatus != 201) {
            return http.Response(
              jsonEncode({
                'error': {'code': submitCode, 'message': 'Revisi ditolak.'},
              }),
              submitStatus,
            );
          }
          return http.Response(jsonEncode(correctionJson()), 201);
        }
        if (request.url.path == '/api/corrections/me') {
          return http.Response(jsonEncode({'corrections': []}), 200);
        }
        return http.Response('{}', 404);
      }),
    );
    auth = AuthService(api: client);
    await auth.login('a@example.com', 'benar');
  }

  Iterable<http.Request> get submits =>
      requests.where((request) => request.url.path == '/api/corrections');
}

Future<void> openForm(
  WidgetTester tester,
  AuthService auth, {
  Uint8List? proof,
}) async {
  await tester.pumpWidget(
    MaterialApp(
      home: Builder(
        builder: (context) => Scaffold(
          body: Center(
            child: ElevatedButton(
              key: const Key('open-form'),
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute<void>(
                  builder: (_) => CorrectionFormScreen(
                    auth: auth,
                    photoTaker: proof == null ? null : (_) async => proof,
                  ),
                ),
              ),
              child: const Text('Buka'),
            ),
          ),
        ),
      ),
    ),
  );
  await tester.tap(find.byKey(const Key('open-form')));
  await tester.pumpAndSettle();
}

Future<void> submit(WidgetTester tester) async {
  await tester.ensureVisible(find.byKey(const Key('correction-submit')));
  await tester.tap(find.byKey(const Key('correction-submit')));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('form revisi merender tanggal, tipe, alasan, dan bukti', (
    tester,
  ) async {
    final mock = CorrectionMock();
    await mock.init();
    await openForm(tester, mock.auth);

    expect(find.text('Ajukan Revisi'), findsOneWidget);
    expect(find.byKey(const Key('correction-date')), findsOneWidget);
    expect(find.byKey(const Key('correction-type')), findsOneWidget);
    expect(find.byKey(const Key('correction-reason')), findsOneWidget);
    expect(find.byKey(const Key('correction-proof')), findsOneWidget);
    expect(find.text('Kirim pengajuan'), findsOneWidget);
  });

  testWidgets('alasan kurang dari 10 karakter ditolak sebelum request', (
    tester,
  ) async {
    final mock = CorrectionMock();
    await mock.init();
    await openForm(tester, mock.auth);

    await tester.enterText(
      find.byKey(const Key('correction-reason')),
      'pendek',
    );
    await submit(tester);

    expect(find.byKey(const Key('correction-validation')), findsOneWidget);
    expect(find.text('Alasan revisi minimal 10 karakter.'), findsOneWidget);
    expect(mock.submits.isEmpty, isTrue);
  });

  testWidgets('submit valid mengirim POST JSON dan menutup form', (
    tester,
  ) async {
    final mock = CorrectionMock();
    await mock.init();
    await openForm(tester, mock.auth);

    await tester.enterText(
      find.byKey(const Key('correction-reason')),
      'Lupa check-in karena jaringan kantor terputus',
    );
    await submit(tester);

    final request = mock.submits.single;
    expect(request.method, 'POST');
    expect(request.headers['authorization'], 'Bearer token-abc');
    expect(request.headers['content-type'], contains('application/json'));
    final body = jsonDecode(request.body) as Map<String, dynamic>;
    expect(body['requestType'], 'CHECK_IN');
    expect(body['reason'], 'Lupa check-in karena jaringan kantor terputus');
    expect(body.containsKey('proof'), isFalse);
    expect(find.byKey(const Key('open-form')), findsOneWidget);
    expect(find.text('Pengajuan revisi terkirim.'), findsOneWidget);
  });

  testWidgets('bukti dilampirkan dalam multipart', (tester) async {
    final mock = CorrectionMock();
    await mock.init();
    await openForm(
      tester,
      mock.auth,
      proof: Uint8List.fromList([0xff, 0xd8, 0xff, 0xd9]),
    );

    await tester.ensureVisible(find.byKey(const Key('correction-proof')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('correction-proof')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('correction-proof-attached')), findsOneWidget);

    await tester.enterText(
      find.byKey(const Key('correction-reason')),
      'Lupa check-in karena jaringan kantor terputus',
    );
    await submit(tester);

    final request = mock.submits.single;
    expect(request.headers['content-type'], contains('multipart/form-data'));
    final raw = latin1.decode(request.bodyBytes);
    expect(raw, contains('name="proof"'));
    expect(raw, contains('filename="bukti.jpg"'));
  });

  testWidgets('error WINDOW_EXCEEDED ditampilkan jelas', (tester) async {
    final mock = CorrectionMock(
      submitStatus: 400,
      submitCode: 'WINDOW_EXCEEDED',
    );
    await mock.init();
    await openForm(tester, mock.auth);

    await tester.enterText(
      find.byKey(const Key('correction-reason')),
      'Lupa check-in karena jaringan kantor terputus',
    );
    await submit(tester);

    expect(find.byKey(const Key('correction-error')), findsOneWidget);
    expect(
      find.text('Revisi hanya bisa diajukan maksimal 7 hari ke belakang.'),
      findsOneWidget,
    );
    expect(find.byKey(const Key('open-form')), findsNothing);
  });
}
