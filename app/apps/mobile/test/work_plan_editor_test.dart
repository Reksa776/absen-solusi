import 'dart:convert';
import 'dart:typed_data';

import 'package:absensi_mobile/api/api_client.dart';
import 'package:absensi_mobile/services/token_store.dart';
import 'package:absensi_mobile/widgets/work_plan_editor.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:material_ui/material_ui.dart';

/// PNG 1x1 valid agar `Image.memory` pada pratinjau bisa didekode.
final Uint8List planImageBytes = base64Decode(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
);

const String extractPath = '/api/mobile/work-plans/extract-from-image';

class EditorMock {
  EditorMock({this.items = const [], this.status = 200});

  final List<String> items;
  final int status;
  final List<http.Request> requests = [];

  late final ApiClient api;

  Future<void> init() async {
    final store = MemoryTokenStore();
    await store.write('token-abc');
    api = ApiClient(
      baseUrl: 'https://absensi.test',
      tokenStore: store,
      client: MockClient((request) async {
        requests.add(request);
        if (request.url.path == extractPath) {
          if (status != 200) {
            return http.Response(
              jsonEncode({
                'error': {
                  'code': 'INVALID_IMAGE_TYPE',
                  'message': 'Gambar tidak valid',
                },
              }),
              status,
            );
          }
          return http.Response(
            jsonEncode({'items': items, 'source': 'ocr'}),
            200,
          );
        }
        return http.Response('{}', 404);
      }),
    );
  }

  Iterable<http.Request> get extractRequests =>
      requests.where((request) => request.url.path == extractPath);
}

Future<WorkPlanDraft> pumpEditor(
  WidgetTester tester, {
  required EditorMock mock,
  List<String> items = const [],
}) async {
  final draft = WorkPlanDraft(items: items);
  draft.attachmentBytes = planImageBytes;
  draft.attachmentName = 'rencana.png';
  addTearDown(draft.dispose);
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: SingleChildScrollView(
          child: WorkPlanEditor(
            draft: draft,
            workMode: 'WFH',
            api: mock.api,
          ),
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
  return draft;
}

Future<void> tapGenerate(WidgetTester tester) async {
  final button = find.byKey(const Key('work-plan-generate-from-image'));
  await tester.ensureVisible(button);
  await tester.pumpAndSettle();
  // Ekstraksi memakai file sementara + HTTP: butuh event loop nyata.
  await tester.runAsync(() async {
    await tester.tap(button);
    await tester.pump();
    await Future<void>.delayed(const Duration(milliseconds: 150));
  });
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('generate mengisi to-do list dari gambar', (tester) async {
    final mock = EditorMock(
      items: ['Menyusun laporan penjualan', 'Menyiapkan materi meeting klien'],
    );
    await mock.init();
    final draft = await pumpEditor(tester, mock: mock);

    expect(draft.titles, isEmpty);
    expect(find.text('0 tugas'), findsOneWidget);

    await tapGenerate(tester);

    expect(draft.titles, [
      'Menyusun laporan penjualan',
      'Menyiapkan materi meeting klien',
    ]);
    expect(find.byKey(const Key('work-plan-item-1')), findsOneWidget);
    expect(find.text('2 tugas'), findsOneWidget);
    expect(
      find.textContaining('2 tugas berhasil dibuat dari gambar'),
      findsOneWidget,
    );

    final request = mock.extractRequests.single;
    expect(request.headers['authorization'], 'Bearer token-abc');
    expect(request.headers['content-type'], contains('multipart/form-data'));
  });

  testWidgets('item manual tetap ada dan hasil generate ditambahkan', (
    tester,
  ) async {
    final mock = EditorMock(items: ['Membalas email vendor']);
    await mock.init();
    final draft = await pumpEditor(tester, mock: mock);

    await tester.enterText(
      find.byKey(const Key('work-plan-item-0')),
      'Rapat koordinasi pagi',
    );
    await tester.pump();
    expect(draft.titles, ['Rapat koordinasi pagi']);

    await tapGenerate(tester);

    expect(draft.titles, ['Rapat koordinasi pagi', 'Membalas email vendor']);
    expect(
      find.textContaining('1 tugas berhasil dibuat dari gambar'),
      findsOneWidget,
    );
  });

  testWidgets('gambar tanpa teks terbaca memberi pesan dan input manual jalan', (
    tester,
  ) async {
    final mock = EditorMock(items: const []);
    await mock.init();
    final draft = await pumpEditor(tester, mock: mock);

    await tapGenerate(tester);

    expect(draft.titles, isEmpty);
    expect(
      find.textContaining('belum memuat teks rencana kerja'),
      findsOneWidget,
    );

    await tester.enterText(
      find.byKey(const Key('work-plan-item-0')),
      'Menyusun ringkasan harian',
    );
    await tester.pump();
    expect(draft.titles, ['Menyusun ringkasan harian']);
  });

  testWidgets('tambah dan hapus tugas manual tetap berfungsi', (tester) async {
    final mock = EditorMock(items: const []);
    await mock.init();
    final draft = await pumpEditor(tester, mock: mock);

    await tester.tap(find.byKey(const Key('work-plan-add-item')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('work-plan-item-1')), findsOneWidget);

    await tester.enterText(
      find.byKey(const Key('work-plan-item-0')),
      'Tugas pertama',
    );
    await tester.enterText(
      find.byKey(const Key('work-plan-item-1')),
      'Tugas kedua',
    );
    await tester.pump();
    expect(draft.titles, ['Tugas pertama', 'Tugas kedua']);

    await tester.tap(find.byKey(const Key('work-plan-remove-0')));
    await tester.pumpAndSettle();
    expect(draft.titles, ['Tugas kedua']);
  });
}
