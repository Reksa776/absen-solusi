import 'dart:convert';

import 'package:absensi_mobile/api/api_client.dart';
import 'package:absensi_mobile/models/in_app_notification.dart';
import 'package:absensi_mobile/screens/login_screen.dart';
import 'package:absensi_mobile/services/auth_service.dart';
import 'package:absensi_mobile/services/background_sync_platform.dart';
import 'package:absensi_mobile/services/background_sync_service.dart';
import 'package:absensi_mobile/services/permission_onboarding_service.dart';
import 'package:absensi_mobile/services/token_store.dart';
import 'package:flutter/services.dart';
import 'package:absensi_mobile/screens/messages_tab.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:material_ui/material_ui.dart';

const baseUrl = 'http://103.93.132.214:3013';

class FakeNotificationPermission implements NotificationPermissionGateway {
  FakeNotificationPermission({this.granted = false});

  bool granted;
  int requests = 0;

  @override
  Future<bool> isNotificationGranted() async => granted;

  @override
  Future<bool> requestNotification() async {
    requests++;
    granted = true;
    return true;
  }
}

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
  TestWidgetsFlutterBinding.ensureInitialized();

  test('login menyinkronkan token & baseUrl ke native, lalu logout '
      'menghentikan service dan menghapus kredensial', () async {
    final store = MemoryTokenStore();
    final platform = MemoryBackgroundSyncPlatform();
    final controller = BackgroundSyncController(
      platform: platform,
      clientFactory: () => MockClient(
        (_) async => http.Response(inboxBody(const []), 200),
      ),
    );
    final auth = AuthService(api: buildApi(store), backgroundSync: controller);

    expect(await auth.login('a@example.com', 'rahasia'), isTrue);
    expect(platform.token, 'token-abc');
    expect(platform.baseUrl, baseUrl);
    expect(platform.serviceRunning, isTrue);
    expect(platform.startCount, 1);
    expect(controller.isRunning, isTrue);

    await auth.logout();
    expect(platform.token, isNull);
    expect(platform.baseUrl, isNull);
    expect(platform.serviceRunning, isFalse);
    expect(platform.stopCount, 1);
    expect(platform.seenIds, isEmpty);
    expect(controller.isRunning, isFalse);
  });

  test('Dart tidak lagi memutar loop polling; hanya satu request penandaan '
      'notifikasi lama saat login', () async {
    final platform = MemoryBackgroundSyncPlatform();
    final requests = <http.Request>[];
    final controller = BackgroundSyncController(
      platform: platform,
      clientFactory: () => MockClient((request) async {
        requests.add(request);
        return http.Response(inboxBody(const []), 200);
      }),
    );
    final auth = AuthService(
      api: buildApi(MemoryTokenStore()),
      backgroundSync: controller,
    );

    expect(await auth.login('a@example.com', 'rahasia'), isTrue);
    expect(requests.map((request) => request.url.path), ['/api/notifications/me']);
    expect(requests.single.headers['authorization'], 'Bearer token-abc');

    // Sebelumnya Timer.periodic 10 detik mengulang request tiap 10 detik.
    await Future<void>.delayed(const Duration(milliseconds: 250));
    expect(requests, hasLength(1));
  });

  test('notifikasi yang sudah ada sebelum login ditandai sudah dilihat agar '
      'tidak berbunyi sebagai alert baru', () async {
    final platform = MemoryBackgroundSyncPlatform();
    final controller = BackgroundSyncController(
      platform: platform,
      clientFactory: () => MockClient(
        (_) async => http.Response(
          inboxBody([
            notification('notif-lama-1'),
            notification('notif-lama-2'),
          ]),
          200,
        ),
      ),
    );
    final auth = AuthService(
      api: buildApi(MemoryTokenStore()),
      backgroundSync: controller,
    );

    expect(await auth.login('a@example.com', 'rahasia'), isTrue);
    expect(platform.seenIds, ['notif-lama-1', 'notif-lama-2']);
    expect(platform.token, 'token-abc');
    expect(platform.serviceRunning, isTrue);

    await auth.logout();
    expect(platform.seenIds, isEmpty);
  });

  test('ID yang sudah tercatat dari native tidak ditimpa saat sesi dipulihkan',
      () async {
    final store = MemoryTokenStore();
    await store.write('token-restore');
    final platform = MemoryBackgroundSyncPlatform()
      ..seenIds = ['notif-lama-1'];
    var requests = 0;
    final controller = BackgroundSyncController(
      platform: platform,
      clientFactory: () => MockClient((_) async {
        requests++;
        return http.Response(inboxBody([notification('notif-lama-2')]), 200);
      }),
    );
    final auth = AuthService(api: buildApi(store), backgroundSync: controller);

    expect(await auth.restore(), isTrue);
    expect(platform.token, 'token-restore');
    expect(platform.baseUrl, baseUrl);
    expect(platform.serviceRunning, isTrue);
    expect(requests, 0);
    expect(platform.seenIds, ['notif-lama-1']);

    await auth.logout();
    expect(platform.token, isNull);
    expect(platform.serviceRunning, isFalse);
  });

  test('penandaan notifikasi lama mempertahankan ID terbaru saja', () async {
    final platform = MemoryBackgroundSyncPlatform();
    final controller = BackgroundSyncController(
      platform: platform,
      maxSeenIds: 2,
      clientFactory: () => MockClient(
        (_) async => http.Response(
          inboxBody([
            notification('baru-1'),
            notification('baru-2'),
            notification('baru-3'),
          ]),
          200,
        ),
      ),
    );
    final auth = AuthService(
      api: buildApi(MemoryTokenStore()),
      backgroundSync: controller,
    );

    expect(await auth.login('a@example.com', 'rahasia'), isTrue);
    expect(platform.seenIds, ['baru-1', 'baru-2']);

    await auth.logout();
  });

  test('login tetap berhasil dan service tetap menyala walau penandaan '
      'notifikasi lama gagal', () async {
    final platform = MemoryBackgroundSyncPlatform();
    final controller = BackgroundSyncController(
      platform: platform,
      clientFactory: () => MockClient(
        (_) async => http.Response(jsonEncode({'error': 'boom'}), 500),
      ),
    );
    final auth = AuthService(
      api: buildApi(MemoryTokenStore()),
      backgroundSync: controller,
    );

    expect(await auth.login('a@example.com', 'rahasia'), isTrue);
    expect(platform.token, 'token-abc');
    expect(platform.serviceRunning, isTrue);
    expect(platform.seenIds, isEmpty);
  });

  test('token kosong tidak memicu bridge native sama sekali', () async {
    final platform = MemoryBackgroundSyncPlatform();
    final controller = BackgroundSyncController(platform: platform);
    final auth = AuthService(
      api: ApiClient(
        baseUrl: baseUrl,
        tokenStore: MemoryTokenStore(),
        client: MockClient((_) async => http.Response('{}', 500)),
      ),
      backgroundSync: controller,
    );

    await controller.start(auth.api);
    expect(platform.startCount, 0);
    expect(platform.token, isNull);
    expect(controller.isRunning, isFalse);
  });

  test('bridge native memakai method channel yang sama dengan Kotlin', () async {
    final calls = <MethodCall>[];
    const channel = MethodChannel(MethodChannelBackgroundSyncPlatform.channelName);
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, (call) async {
          calls.add(call);
          return switch (call.method) {
            'readSeenIds' => <String>['notif-1'],
            'startService' => true,
            'isBatteryOptimizationIgnored' => true,
            'requestBatteryExemption' => false,
            _ => null,
          };
        });
    addTearDown(() {
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, null);
    });

    final platform = MethodChannelBackgroundSyncPlatform();
    await platform.syncCredentials(token: 'token-abc', baseUrl: baseUrl);
    await platform.startService();
    expect(await platform.readSeenIds(), ['notif-1']);
    await platform.writeSeenIds(['notif-1', 'notif-2']);
    await platform.stopService();
    await platform.clearCredentials();
    expect(await platform.isBatteryOptimizationIgnored(), isTrue);
    expect(await platform.requestBatteryExemption(), isFalse);

    expect(calls.map((call) => call.method), [
      'syncCredentials',
      'startService',
      'readSeenIds',
      'writeSeenIds',
      'stopService',
      'clearCredentials',
      'isBatteryOptimizationIgnored',
      'requestBatteryExemption',
    ]);
    expect(calls.first.arguments, {'token': 'token-abc', 'baseUrl': baseUrl});
    expect(calls[3].arguments, {
      'ids': ['notif-1', 'notif-2'],
    });
  });

  test('setelah login pengecualian baterai diminta otomatis sekali bila '
      'belum diizinkan', () async {
    final platform = MemoryBackgroundSyncPlatform()..batteryIgnored = false;
    final notifications = FakeNotificationPermission();
    final readiness = BackgroundReadinessController(
      platform: platform,
      notifications: notifications,
    );

    await readiness.ensureReady();

    expect(platform.batteryExemptionRequests, 1);
    expect(notifications.requests, 1);
    expect(readiness.isChecked, isTrue);
    expect(readiness.batteryOptimizationIgnored, isFalse);
    expect(readiness.needsManualEnable, isTrue);

    // Sesi yang sama tidak memunculkan dialog sistem berulang kali.
    await readiness.ensureReady();
    expect(platform.batteryExemptionRequests, 1);
  });

  test('pengecualian baterai dilewati bila pengguna sudah mengizinkannya',
      () async {
    final platform = MemoryBackgroundSyncPlatform()..batteryIgnored = true;
    final notifications = FakeNotificationPermission(granted: true);
    final readiness = BackgroundReadinessController(
      platform: platform,
      notifications: notifications,
    );

    await readiness.ensureReady();

    expect(platform.batteryExemptionRequests, 0);
    expect(notifications.requests, 0);
    expect(readiness.batteryOptimizationIgnored, isTrue);
    expect(readiness.needsManualEnable, isFalse);
  });

  test('status baterai dibaca ulang saat aplikasi kembali aktif', () async {
    final platform = MemoryBackgroundSyncPlatform()..batteryIgnored = false;
    final readiness = BackgroundReadinessController(
      platform: platform,
      notifications: FakeNotificationPermission(),
    );

    await readiness.ensureReady();
    expect(readiness.batteryOptimizationIgnored, isFalse);

    // Pengguna mengetuk "Izinkan" pada dialog sistem yang tadi tampil.
    platform.batteryIgnored = true;
    await readiness.refresh();

    expect(readiness.batteryOptimizationIgnored, isTrue);
    expect(readiness.needsManualEnable, isFalse);
  });

  test('platform tanpa pengaturan baterai tidak menampilkan tombol manual',
      () async {
    final platform = MemoryBackgroundSyncPlatform()..batteryIgnored = null;
    final readiness = BackgroundReadinessController(
      platform: platform,
      notifications: FakeNotificationPermission(granted: true),
    );

    await readiness.ensureReady();

    expect(readiness.isSupported, isFalse);
    expect(readiness.needsManualEnable, isFalse);
    expect(platform.batteryExemptionRequests, 0);
  });

  testWidgets('strip pesan menampilkan tombol Aktifkan Sekarang hanya setelah '
      'pengguna menolak', (tester) async {
    final platform = MemoryBackgroundSyncPlatform()..batteryIgnored = false;
    final readiness = BackgroundReadinessController(
      platform: platform,
      notifications: FakeNotificationPermission(),
    );
    await readiness.ensureReady();
    final auth = AuthService(api: buildApi(MemoryTokenStore()));

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: MessagesTab(auth: auth, readiness: readiness),
        ),
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 200));

    expect(find.byKey(const Key('messages-background-status')), findsOneWidget);
    expect(find.text('Notifikasi Latar Belakang: Nonaktif'), findsOneWidget);
    expect(
      find.byKey(const Key('messages-background-enable')),
      findsOneWidget,
    );

    platform.batteryIgnored = true;
    await readiness.refresh();
    await tester.pump();

    expect(find.text('Notifikasi Latar Belakang: Aktif'), findsOneWidget);
    expect(
      find.byKey(const Key('messages-background-enable')),
      findsNothing,
    );
  });

  testWidgets('login dari layar masuk menyalakan service dan menyimpan '
      'kredensial latar', (tester) async {
    final store = MemoryTokenStore();
    final platform = MemoryBackgroundSyncPlatform();
    final controller = BackgroundSyncController(
      platform: platform,
      clientFactory: () => MockClient(
        (_) async => http.Response(inboxBody(const []), 200),
      ),
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
