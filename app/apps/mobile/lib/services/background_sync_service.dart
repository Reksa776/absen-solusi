import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:http/http.dart' as http;

import '../api/api_client.dart';
import '../models/in_app_notification.dart';
import 'background_sync_platform.dart';

/// Penampil notifikasi alert. Dipisah dari poller agar mudah diuji.
abstract class AlertNotifier {
  Future<void> show(InAppNotification item);
}

/// Notifikasi Android prioritas maksimum agar muncul sebagai heads-up banner
/// walau aplikasi lain sedang dibuka.
class LocalAlertNotifier implements AlertNotifier {
  LocalAlertNotifier({FlutterLocalNotificationsPlugin? plugin})
    : _plugin = plugin ?? FlutterLocalNotificationsPlugin();

  static const String channelId = 'approval_alerts_high';
  static const String channelName = 'Persetujuan & pengumuman';
  static const String channelDescription =
      'Hasil persetujuan dan pengumuman baru yang masuk.';

  static const NotificationDetails details = NotificationDetails(
    android: AndroidNotificationDetails(
      channelId,
      channelName,
      channelDescription: channelDescription,
      importance: Importance.max,
      priority: Priority.high,
      category: AndroidNotificationCategory.message,
      playSound: true,
      enableVibration: true,
    ),
    iOS: DarwinNotificationDetails(
      presentAlert: true,
      presentBadge: true,
      presentSound: true,
      interruptionLevel: InterruptionLevel.timeSensitive,
    ),
  );

  final FlutterLocalNotificationsPlugin _plugin;
  bool _ready = false;

  Future<void> _ensureReady() async {
    if (_ready) return;
    const settings = InitializationSettings(
      android: AndroidInitializationSettings('@mipmap/ic_launcher'),
      iOS: DarwinInitializationSettings(
        requestAlertPermission: true,
        requestBadgePermission: true,
        requestSoundPermission: true,
      ),
    );
    await _plugin.initialize(settings: settings);
    _ready = true;
  }

  @override
  Future<void> show(InAppNotification item) async {
    try {
      await _ensureReady();
      await _plugin.show(
        id: item.id.hashCode & 0x7fffffff,
        title: item.title,
        body: item.body,
        notificationDetails: details,
        payload: item.linkUrl,
      );
    } catch (error) {
      debugPrint('Notifikasi alert gagal ditampilkan: $error');
    }
  }
}

/// Polling ringan `GET /api/notifications/me` yang dijaga foreground service
/// Android sehingga tetap berjalan saat aplikasi lain dibuka.
///
/// Notifikasi hanya ditampilkan sekali per ID; ID yang sudah tampil disimpan
/// pada SharedPreferences polos agar tidak muncul ganda setelah proses hidup
/// kembali.
class BackgroundAlertPoller {
  BackgroundAlertPoller({
    required this.client,
    required this.platform,
    required this.notifier,
    required this.baseUrl,
    required this.token,
    this.interval = const Duration(seconds: 10),
    this.limit = 20,
    this.maxSeenIds = 200,
    this.maxAlertsPerTick = 3,
  });

  final http.Client client;
  final BackgroundSyncPlatform platform;
  final AlertNotifier notifier;
  final String baseUrl;
  final String token;
  final Duration interval;
  final int limit;
  final int maxSeenIds;
  final int maxAlertsPerTick;

  Timer? _timer;
  bool _busy = false;
  int _pollCount = 0;
  int _alertCount = 0;

  bool get isRunning => _timer != null;
  int get pollCount => _pollCount;
  int get alertCount => _alertCount;

  /// Memulai detak pertama segera, lalu mengulang setiap [interval].
  /// Detak tidak ditunggu agar login tidak bergantung pada jaringan.
  Future<void> start() async {
    _timer?.cancel();
    _timer = Timer.periodic(interval, (_) => unawaited(tick()));
    unawaited(tick());
  }

  void stop() {
    _timer?.cancel();
    _timer = null;
  }

  /// Satu putaran polling. Mengembalikan daftar notifikasi baru yang tampil.
  Future<List<InAppNotification>> tick() async {
    if (_busy) return const [];
    if (token.isEmpty) {
      debugPrint('Polling notifikasi latar dilewati: token kosong.');
      return const [];
    }
    _busy = true;
    try {
      final uri = Uri.parse(
        '$baseUrl/api/notifications/me',
      ).replace(queryParameters: {'limit': '$limit'});
      final response = await client
          .get(uri, headers: {
            'authorization': 'Bearer $token',
            'accept': 'application/json',
          })
          .timeout(const Duration(seconds: 10));
      if (response.statusCode < 200 || response.statusCode >= 300) {
        debugPrint(
          'Polling notifikasi latar gagal: HTTP ${response.statusCode} '
          '(${response.body.length} byte).',
        );
        return const [];
      }
      final decoded = jsonDecode(response.body);
      if (decoded is! Map<String, dynamic>) {
        debugPrint('Polling notifikasi latar: respons bukan objek JSON.');
        return const [];
      }
      _pollCount++;
      final page = InboxPage.fromJson(decoded);
      final seen = (await platform.readSeenIds()).toSet();
      final fresh = page.notifications
          .where((item) => item.id.isNotEmpty && !seen.contains(item.id))
          .toList(growable: false);
      if (fresh.isEmpty) return const [];

      for (final item in fresh.take(maxAlertsPerTick)) {
        await notifier.show(item);
        _alertCount++;
      }

      final merged = <String>[
        ...seen,
        ...page.notifications.map((item) => item.id).where((id) => id.isNotEmpty),
      ];
      final trimmed = merged.length > maxSeenIds
          ? merged.sublist(merged.length - maxSeenIds)
          : merged;
      await platform.writeSeenIds(trimmed);
      return fresh;
    } catch (error) {
      debugPrint('Polling notifikasi latar gagal: $error');
      return const [];
    } finally {
      _busy = false;
    }
  }
}

/// Kontrak yang dipakai [AuthService] agar alur login/logout tidak bergantung
/// pada implementasi background yang sebenarnya.
abstract class BackgroundSessionSync {
  Future<void> start(ApiClient api);

  Future<void> stop();
}

class NoopBackgroundSessionSync implements BackgroundSessionSync {
  const NoopBackgroundSessionSync();

  @override
  Future<void> start(ApiClient api) async {}

  @override
  Future<void> stop() async {}
}

/// Menyalin kredensial ke SharedPreferences polos, menyalakan foreground
/// service native, dan menjalankan poller 10 detik selama sesi aktif.
class BackgroundSyncController implements BackgroundSessionSync {
  BackgroundSyncController({
    BackgroundSyncPlatform? platform,
    AlertNotifier? notifier,
    http.Client Function()? clientFactory,
    this.interval = const Duration(seconds: 10),
  }) : _platform = platform ?? MethodChannelBackgroundSyncPlatform(),
       _notifier = notifier ?? LocalAlertNotifier(),
       _clientFactory = clientFactory ?? http.Client.new;

  final BackgroundSyncPlatform _platform;
  final AlertNotifier _notifier;
  final http.Client Function() _clientFactory;
  final Duration interval;

  BackgroundAlertPoller? _poller;
  http.Client? _client;

  bool get isPolling => _poller?.isRunning ?? false;

  @override
  Future<void> start(ApiClient api) async {
    final token = await api.readToken();
    if (token == null || token.isEmpty) {
      debugPrint('Sinkronisasi latar tidak dimulai: token kosong.');
      return;
    }
    await _platform.syncCredentials(token: token, baseUrl: api.baseUrl);
    await _platform.startService();
    _poller?.stop();
    _client?.close();
    final client = _clientFactory();
    _client = client;
    _poller = BackgroundAlertPoller(
      client: client,
      platform: _platform,
      notifier: _notifier,
      baseUrl: api.baseUrl,
      token: token,
      interval: interval,
    );
    await _poller!.start();
  }

  @override
  Future<void> stop() async {
    _poller?.stop();
    _poller = null;
    _client?.close();
    _client = null;
    await _platform.stopService();
    await _platform.clearCredentials();
  }
}
