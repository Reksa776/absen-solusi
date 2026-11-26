import 'dart:async';
import 'dart:convert';

import 'package:absensi_mobile/api/api_client.dart';
import 'package:absensi_mobile/services/auth_service.dart';
import 'package:absensi_mobile/services/live_sync.dart';
import 'package:absensi_mobile/services/push_notification_service.dart';
import 'package:absensi_mobile/services/token_store.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

class FakePushGateway implements PushMessagingGateway {
  FakePushGateway({this.token});

  String? token;
  bool initialized = false;
  bool permissionRequested = false;

  final StreamController<String> tokenRefresh =
      StreamController<String>.broadcast();
  final StreamController<PushMessagePayload> foreground =
      StreamController<PushMessagePayload>.broadcast();
  final StreamController<PushMessagePayload> opened =
      StreamController<PushMessagePayload>.broadcast();

  @override
  Future<void> initialize() async {
    initialized = true;
  }

  @override
  Future<bool> requestPermission() async {
    permissionRequested = true;
    return true;
  }

  @override
  Future<String?> getToken() async => token;

  @override
  Stream<String> get onTokenRefresh => tokenRefresh.stream;

  @override
  Stream<PushMessagePayload> get onMessage => foreground.stream;

  @override
  Stream<PushMessagePayload> get onMessageOpenedApp => opened.stream;

  Future<void> dispose() async {
    await tokenRefresh.close();
    await foreground.close();
    await opened.close();
  }
}

class RecordingPresenter implements ApprovalNotificationPresenter {
  final List<Map<String, Object?>> shown = [];
  bool initialized = false;

  @override
  Future<void> initialize() async {
    initialized = true;
  }

  @override
  Future<void> show({
    required String title,
    required String body,
    Map<String, dynamic> data = const {},
  }) async {
    shown.add({'title': title, 'body': body, 'data': data});
  }
}

class RecordingPushSessionSync implements PushSessionSync {
  int registered = 0;
  int unregistered = 0;

  @override
  Future<void> register(ApiClient api) async {
    registered += 1;
  }

  @override
  Future<void> unregister(ApiClient api) async {
    unregistered += 1;
  }
}

ApiClient pushApi(
  List<http.Request> requests, {
  String sessionToken = 'session-token',
}) {
  final store = MemoryTokenStore();
  store.write(sessionToken);
  return ApiClient(
    baseUrl: 'https://absensi.test',
    tokenStore: store,
    client: MockClient((request) async {
      requests.add(request);
      return http.Response(jsonEncode({'id': 'p1', 'platform': 'android'}), 201);
    }),
  );
}

void main() {
  test('registrasi mengirim token FCM ke backend setelah izin diminta', () async {
    final requests = <http.Request>[];
    final api = pushApi(requests);
    final gateway = FakePushGateway(token: 'fcm-device-token-1');
    final presenter = RecordingPresenter();
    final service = PushNotificationService(
      gateway: gateway,
      presenter: presenter,
    );
    addTearDown(gateway.dispose);

    await service.register(api);

    expect(gateway.initialized, isTrue);
    expect(gateway.permissionRequested, isTrue);
    expect(requests, hasLength(1));
    expect(requests.single.method, 'POST');
    expect(requests.single.url.path, '/api/mobile/push-token');
    final body = jsonDecode(requests.single.body) as Map<String, dynamic>;
    expect(body['token'], 'fcm-device-token-1');
    expect(body['platform'], 'android');
    expect(service.token, 'fcm-device-token-1');
  });

  test('token refresh mengirim ulang token terbaru', () async {
    final requests = <http.Request>[];
    final api = pushApi(requests);
    final gateway = FakePushGateway(token: 'fcm-device-token-1');
    final service = PushNotificationService(
      gateway: gateway,
      presenter: RecordingPresenter(),
    );
    addTearDown(gateway.dispose);

    await service.register(api);
    gateway.token = 'fcm-device-token-2';
    gateway.tokenRefresh.add('fcm-device-token-2');
    await pumpEventQueue();

    expect(requests, hasLength(2));
    final body = jsonDecode(requests.last.body) as Map<String, dynamic>;
    expect(body['token'], 'fcm-device-token-2');
    expect(service.token, 'fcm-device-token-2');
  });

  test('pesan foreground menampilkan notifikasi lokal dan memicu LiveSync', () async {
    final gateway = FakePushGateway(token: 'fcm-device-token-1');
    final presenter = RecordingPresenter();
    final liveSync = LiveSync();
    final service = PushNotificationService(
      gateway: gateway,
      presenter: presenter,
      liveSync: liveSync,
    );
    addTearDown(gateway.dispose);

    final before = liveSync.tick;
    await service.handleForegroundMessage(
      const PushMessagePayload(
        title: 'Cuti disetujui',
        body: 'Pengajuan cuti Anda disetujui penuh.',
        data: {'type': 'leave_result'},
      ),
    );

    expect(presenter.shown, hasLength(1));
    expect(presenter.shown.single['title'], 'Cuti disetujui');
    expect(presenter.shown.single['body'], contains('disetujui'));
    expect(liveSync.tick, greaterThan(before));
  });

  test('pesan foreground kosong diabaikan', () async {
    final gateway = FakePushGateway(token: 'fcm-device-token-1');
    final presenter = RecordingPresenter();
    final service = PushNotificationService(
      gateway: gateway,
      presenter: presenter,
      liveSync: LiveSync(),
    );
    addTearDown(gateway.dispose);

    await service.handleForegroundMessage(
      const PushMessagePayload(title: '  ', body: ''),
    );

    expect(presenter.shown, isEmpty);
  });

  test('logout menghapus token FCM di backend', () async {
    final requests = <http.Request>[];
    final api = pushApi(requests);
    final gateway = FakePushGateway(token: 'fcm-device-token-1');
    final service = PushNotificationService(
      gateway: gateway,
      presenter: RecordingPresenter(),
    );
    addTearDown(gateway.dispose);

    await service.register(api);
    await service.unregister(api);

    expect(requests, hasLength(2));
    expect(requests.last.method, 'DELETE');
    expect(requests.last.url.path, '/api/mobile/push-token');
    final body = jsonDecode(requests.last.body) as Map<String, dynamic>;
    expect(body['token'], 'fcm-device-token-1');
    expect(service.token, isNull);
  });

  test('tanpa token perangkat tidak ada request ke backend', () async {
    final requests = <http.Request>[];
    final api = pushApi(requests);
    final gateway = FakePushGateway();
    final service = PushNotificationService(
      gateway: gateway,
      presenter: RecordingPresenter(),
    );
    addTearDown(gateway.dispose);

    await service.register(api);

    expect(requests, isEmpty);
  });

  test('AuthService mendaftarkan token saat login dan menghapusnya saat logout', () async {
    final push = RecordingPushSessionSync();
    final api = ApiClient(
      baseUrl: 'https://absensi.test',
      tokenStore: MemoryTokenStore(),
      client: MockClient((request) async {
        if (request.url.path == '/api/auth/login') {
          return http.Response(
            jsonEncode({
              'token': 'token-abc',
              'user': {
                'id': 'u1',
                'email': 'a@example.com',
                'name': 'A',
                'status': 'ACTIVE',
              },
              'activeTenantId': 't1',
              'workspaces': [
                {'id': 't1', 'name': 'Tenant A', 'slug': 'tenant-a'},
              ],
            }),
            200,
          );
        }
        return http.Response(jsonEncode({'ok': true}), 200);
      }),
    );
    final auth = AuthService(api: api, pushSync: push);

    expect(await auth.login('a@example.com', 'rahasia'), isTrue);
    expect(push.registered, 1);

    await auth.logout();
    expect(push.unregistered, 1);
  });
}
