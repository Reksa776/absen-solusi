import 'dart:convert';

import 'package:absensi_mobile/api/api_client.dart';
import 'package:absensi_mobile/services/push_service.dart';
import 'package:absensi_mobile/services/token_store.dart';
import 'package:absensi_mobile/widgets/push_notification_listener.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:material_ui/material_ui.dart';

void main() {
  testWidgets('push masuk ditampilkan sebagai banner dan bisa ditutup', (
    tester,
  ) async {
    final service = MemoryPushService();
    addTearDown(service.dispose);

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: PushNotificationListener(
            service: service,
            child: const Text('beranda'),
          ),
        ),
      ),
    );

    expect(find.byKey(const Key('push-banner')), findsNothing);

    service.emit(
      const PushMessage(
        title: 'Revisi disetujui',
        body: 'Data kehadiran Anda sudah diperbarui.',
      ),
    );
    await tester.pump();

    expect(find.byKey(const Key('push-banner')), findsOneWidget);
    expect(find.textContaining('Revisi disetujui'), findsOneWidget);
    expect(find.textContaining('Data kehadiran'), findsOneWidget);

    await tester.tap(find.byKey(const Key('push-banner-dismiss')));
    await tester.pump();
    expect(find.byKey(const Key('push-banner')), findsNothing);
  });

  test('registrar mendaftarkan token perangkat ke backend', () async {
    final requests = <http.Request>[];
    final store = MemoryTokenStore();
    await store.write('session-token');
    final api = ApiClient(
      baseUrl: 'https://absensi.test',
      tokenStore: store,
      client: MockClient((request) async {
        requests.add(request);
        return http.Response(jsonEncode({'id': 'd1', 'platform': 'ANDROID'}), 201);
      }),
    );

    await PushRegistrar.register(
      api,
      MemoryPushService(token: 'device-token-123'),
    );

    expect(requests, hasLength(1));
    expect(requests.single.url.path, '/api/notifications/register-device');
    final body = jsonDecode(requests.single.body) as Map<String, dynamic>;
    expect(body['token'], 'device-token-123');
    expect(body['platform'], 'ANDROID');
  });

  test('registrar tidak memanggil API saat token perangkat tidak tersedia', () async {
    final requests = <http.Request>[];
    final api = ApiClient(
      baseUrl: 'https://absensi.test',
      tokenStore: MemoryTokenStore(),
      client: MockClient((request) async {
        requests.add(request);
        return http.Response('{}', 201);
      }),
    );

    await PushRegistrar.register(api, const NoopPushService());
    expect(requests, isEmpty);
  });
}
