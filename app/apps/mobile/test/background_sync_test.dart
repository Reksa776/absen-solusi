import 'dart:convert';

import 'package:absensi_mobile/api/api_client.dart';
import 'package:absensi_mobile/models/in_app_notification.dart';
import 'package:absensi_mobile/screens/login_screen.dart';
import 'package:absensi_mobile/services/auth_service.dart';
import 'package:absensi_mobile/services/background_sync_platform.dart';
import 'package:absensi_mobile/services/background_sync_service.dart';
import 'package:absensi_mobile/services/token_store.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:material_ui/material_ui.dart';

const baseUrl = 'http://103.93.132.214:3013';

Map<String, dynamic> profileJson() => {
  'user': {'id': 'u1', 'email': 'a@example.com', 'name': 'A', 'status': 'ACTIVE'},
  'activeTenantId': 't1',
  'workspaces': [
    {'id': 't1', 'name': 'Tenant A', 'slug': 'tenant-a'},
  ],
};

InAppNotification notification(
  String id, {
  bool isRead = false,
  String type = 'LEAVE_APPROVED',
}) {
  return InAppNotification(
    id: id,
    type: type,
    title: 'Pengajuan disetujui',
    body: 'Notifikasi $id',
    isRead: isRead,
    createdAt: DateTime.utc(2026, 11, 25, 8),
  );
}

String inboxBody(List<InAppNotification> items, {int unreadCount = 0}) {
  return jsonEncode({
    'notifications': [
      for (final item in items)
        {
          'id': item.id,
          'type': item.type,
          'title': item.title,
          'body': item.body,
          'linkUrl': item.linkUrl,
          'isRead': item.isRead,
          'createdAt': item.createdAt.toIso8601String(),
        },
    ],
    'unreadCount': unreadCount,
  });
}

class RecordingAlertNotifier implements AlertNotifier {
  final List<InAppNotification> shown = <InAppNotification>[];

  @override
  Future<void> show(InAppNotification item) async {
    shown.add(item);
  }
}

ApiClient buildApi(
  MemoryTokenStore store, {
  void Function(http.Request request)? onRequest,
}) {
  return ApiClient(
    baseUrl: baseUrl,
    tokenStore: store,
    client: MockClient((request) async {
      onRequest?.call(request);
      switch (request.url.path) {
        case '/api/auth/login':
          return http.Response(
            jsonEncode({...profileJson(), 'token': 'token-abc'}),
            200,
          );
        case '/api/auth/logout':
          return http.Response(jsonEncode({'ok': true}), 200);
        case '/api/auth/me':
          return http.Response(jsonEncode(profileJson()), 200);
        case '/api/notifications/me':
          return http.Response(inboxBody(const []), 200);
        default:
          return http.Response('{}', 404);
      }
    }),
  );
}

void main() {
  test('login menyimpan token & baseUrl ke SharedPreferences latar dan '
      'logout menghapusnya', () async {
    final store = MemoryTokenStore();
    final platform = MemoryBackgroundSyncPlatform();
    final notifier = RecordingAlertNotifier();
    final controller = BackgroundSyncController(
      platform: platform,
      notifier: notifier,
      clientFactory: () => MockClient(
        (_) async => http.Response(inboxBody(const []), 200),
      ),
      interval: const Duration(minutes: 5),
    );
    final auth = AuthService(api: buildApi(store), backgroundSync: controller);

    expect(await auth.login('a@example.com', 'rahasia'), isTrue);
    expect(platform.token, 'token-abc');
    expect(platform.baseUrl, baseUrl);
    expect(platform.serviceRunning, isTrue);
    expect(controller.isPolling, isTrue);

    await auth.logout();
    expect(platform.token, isNull);
    expect(platform.baseUrl, isNull);
    expect(platform.serviceRunning, isFalse);
    expect(controller.isPolling, isFalse);
  });

  test('pemulihan sesi saat startup ikut menyinkronkan kredensial latar',
      () async {
    final store = MemoryTokenStore();
    await store.write('token-restore');
    final platform = MemoryBackgroundSyncPlatform();
    final controller = BackgroundSyncController(
      platform: platform,
      notifier: RecordingAlertNotifier(),
      clientFactory: () => MockClient(
        (_) async => http.Response(inboxBody(const []), 200),
      ),
      interval: const Duration(minutes: 5),
    );
    final auth = AuthService(api: buildApi(store), backgroundSync: controller);

    expect(await auth.restore(), isTrue);
    expect(platform.token, 'token-restore');
    expect(platform.baseUrl, baseUrl);
    expect(platform.serviceRunning, isTrue);

    await auth.logout();
    expect(platform.token, isNull);
    expect(platform.serviceRunning, isFalse);
  });

  test('poller memanggil GET /api/notifications/me, memunculkan alert baru, '
      'dan mendeduplikasi ID', () async {
    final platform = MemoryBackgroundSyncPlatform()..seenIds = ['notif-0'];
    final notifier = RecordingAlertNotifier();
    final requests = <http.Request>[];
    final poller = BackgroundAlertPoller(
      client: MockClient((request) async {
        requests.add(request);
        return http.Response(
          inboxBody([
            notification('notif-0'),
            notification('notif-1'),
            notification('notif-2'),
          ], unreadCount: 3),
          200,
        );
      }),
      platform: platform,
      notifier: notifier,
      baseUrl: baseUrl,
      token: 'token-abc',
    );

    final fresh = await poller.tick();

    expect(requests, hasLength(1));
    expect(requests.single.method, 'GET');
    expect(requests.single.url.path, '/api/notifications/me');
    expect(requests.single.headers['authorization'], 'Bearer token-abc');
    expect(fresh.map((item) => item.id), ['notif-1', 'notif-2']);
    expect(notifier.shown.map((item) => item.id), ['notif-1', 'notif-2']);
    expect(platform.seenIds, containsAll(['notif-0', 'notif-1', 'notif-2']));

    await poller.tick();
    expect(requests, hasLength(2));
    expect(notifier.shown.map((item) => item.id), ['notif-1', 'notif-2']);
    expect(poller.alertCount, 2);
  });

  test('poller tidak menampilkan apa pun saat token kosong', () async {
    final requests = <http.Request>[];
    final notifier = RecordingAlertNotifier();
    final poller = BackgroundAlertPoller(
      client: MockClient((request) async {
        requests.add(request);
        return http.Response(inboxBody(const []), 200);
      }),
      platform: MemoryBackgroundSyncPlatform(),
      notifier: notifier,
      baseUrl: baseUrl,
      token: '',
    );

    expect(await poller.tick(), isEmpty);
    expect(requests, isEmpty);
    expect(notifier.shown, isEmpty);
  });

  test('poller menahan kegagalan server tanpa melempar dan tanpa alert',
      () async {
    final notifier = RecordingAlertNotifier();
    final poller = BackgroundAlertPoller(
      client: MockClient(
        (_) async => http.Response(jsonEncode({'error': 'boom'}), 500),
      ),
      platform: MemoryBackgroundSyncPlatform(),
      notifier: notifier,
      baseUrl: baseUrl,
      token: 'token-abc',
    );

    expect(await poller.tick(), isEmpty);
    expect(notifier.shown, isEmpty);
  });

  test('start langsung memutar detak pertama dan stop menghentikan timer',
      () async {
    var calls = 0;
    final poller = BackgroundAlertPoller(
      client: MockClient((_) async {
        calls++;
        return http.Response(inboxBody(const []), 200);
      }),
      platform: MemoryBackgroundSyncPlatform(),
      notifier: RecordingAlertNotifier(),
      baseUrl: baseUrl,
      token: 'token-abc',
      interval: const Duration(milliseconds: 20),
    );

    await poller.start();
    await Future<void>.delayed(const Duration(milliseconds: 5));
    expect(calls, 1);
    expect(poller.isRunning, isTrue);

    await Future<void>.delayed(const Duration(milliseconds: 60));
    expect(calls, greaterThan(1));

    poller.stop();
    final afterStop = calls;
    await Future<void>.delayed(const Duration(milliseconds: 60));
    expect(calls, afterStop);
    expect(poller.isRunning, isFalse);
  });

  test('channel alert memakai Importance.max, prioritas tinggi, suara, dan '
      'getar', () {
    final android = LocalAlertNotifier.details.android;
    expect(android, isNotNull);
    expect(android!.channelId, 'approval_alerts_high');
    expect(android.importance, Importance.max);
    expect(android.priority, Priority.high);
    expect(android.playSound, isTrue);
    expect(android.enableVibration, isTrue);
  });

  testWidgets('login dari layar masuk menyalakan service dan menyimpan '
      'kredensial latar', (tester) async {
    final store = MemoryTokenStore();
    final platform = MemoryBackgroundSyncPlatform();
    final controller = BackgroundSyncController(
      platform: platform,
      notifier: RecordingAlertNotifier(),
      clientFactory: () => MockClient(
        (_) async => http.Response(inboxBody(const []), 200),
      ),
      interval: const Duration(minutes: 5),
    );
    final auth = AuthService(api: buildApi(store), backgroundSync: controller);

    await tester.pumpWidget(
      MaterialApp(home: LoginScreen(auth: auth, onLoggedIn: () {})),
    );
    await tester.pump();

    await tester.enterText(
      find.byKey(const Key('login-email')),
      'a@example.com',
    );
    await tester.enterText(
      find.byKey(const Key('login-password')),
      'rahasia',
    );
    await tester.tap(find.byKey(const Key('login-submit')));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 200));

    expect(auth.isAuthenticated, isTrue);
    expect(platform.token, 'token-abc');
    expect(platform.baseUrl, baseUrl);
    expect(platform.serviceRunning, isTrue);

    await auth.logout();
    await tester.pump();
    expect(platform.token, isNull);
    expect(platform.serviceRunning, isFalse);
  });
}
