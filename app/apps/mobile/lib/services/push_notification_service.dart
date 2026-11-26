import 'dart:async';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';

import '../api/api_client.dart';
import 'live_sync.dart';

/// Channel Android high-priority untuk notifikasi hasil approve/reject.
const String approvalNotificationChannelId = 'approval_alerts_high';
const String approvalNotificationChannelName = 'Persetujuan pengajuan';
const String approvalNotificationChannelDescription =
    'Hasil approve/reject pengajuan, izin, cuti, lembur, revisi, dan perangkat.';

/// Android 13+ memakai izin POST_NOTIFICATIONS; iOS memakai izin sistem.
/// Token tidak pernah dicetak ke log.
String get currentPushPlatform => switch (defaultTargetPlatform) {
  TargetPlatform.iOS => 'ios',
  _ => 'android',
};

/// Handler top-level wajib agar pesan tetap diterima saat aplikasi di
/// background atau di-close (terminated).
@pragma('vm:entry-point')
Future<void> firebaseMessagingBackgroundHandler(RemoteMessage message) async {
  try {
    if (Firebase.apps.isEmpty) {
      await Firebase.initializeApp();
    }
  } catch (error) {
    debugPrint('Inisialisasi Firebase di background gagal: $error');
  }
  // Tidak ada kerja UI di isolate ini; FCM sudah menampilkan notifikasi.
}

class PushMessagePayload {
  const PushMessagePayload({
    required this.title,
    required this.body,
    this.data = const {},
  });

  final String title;
  final String body;
  final Map<String, dynamic> data;
}

/// Abstraksi Firebase Messaging agar test tidak membutuhkan Firebase nyata.
abstract class PushMessagingGateway {
  Future<void> initialize();
  Future<bool> requestPermission();
  Future<String?> getToken();
  Stream<String> get onTokenRefresh;
  Stream<PushMessagePayload> get onMessage;
  Stream<PushMessagePayload> get onMessageOpenedApp;
}

class FirebasePushMessagingGateway implements PushMessagingGateway {
  FirebasePushMessagingGateway(this._messaging);

  final FirebaseMessaging _messaging;
  String? _token;

  /// Null bila Firebase belum dikonfigurasi (mis. tanpa google-services.json).
  static Future<FirebasePushMessagingGateway?> create() async {
    try {
      if (Firebase.apps.isEmpty) {
        await Firebase.initializeApp();
      }
      FirebaseMessaging.onBackgroundMessage(firebaseMessagingBackgroundHandler);
      return FirebasePushMessagingGateway(FirebaseMessaging.instance);
    } catch (error) {
      debugPrint('Firebase Messaging tidak tersedia: $error');
      return null;
    }
  }

  static PushMessagePayload _payload(RemoteMessage message) {
    final data = Map<String, dynamic>.from(message.data);
    final title =
        message.notification?.title ?? data['title'] as String? ?? '';
    final body = message.notification?.body ?? data['body'] as String? ?? '';
    return PushMessagePayload(title: title, body: body, data: data);
  }

  @override
  Future<void> initialize() async {
    // Opsi presentasi foreground diatur langsung; tidak bergantung pada
    // `onRegistered` agar tetap berjalan di Android 10+.
    await _messaging.setForegroundNotificationPresentationOptions(
      alert: true,
      badge: true,
      sound: true,
    );
  }

  @override
  Future<bool> requestPermission() async {
    final settings = await _messaging.requestPermission(
      alert: true,
      badge: true,
      sound: true,
    );
    return settings.authorizationStatus == AuthorizationStatus.authorized ||
        settings.authorizationStatus == AuthorizationStatus.provisional;
  }

  /// `getToken()` dipanggil langsung: `register()` + `onRegistered` tidak
  /// pernah menyelesaikan future di Android sehingga selalu timeout.
  /// Token terakhir di-cache agar pemanggilan berulang tidak menunggu.
  @override
  Future<String?> getToken() async {
    final cached = _token;
    if (cached != null && cached.isNotEmpty) return cached;
    // ignore: deprecated_member_use
    final token = await _messaging.getToken();
    if (token != null && token.isNotEmpty) _token = token;
    return token;
  }

  @override
  Stream<String> get onTokenRefresh {
    // ignore: deprecated_member_use
    return _messaging.onTokenRefresh.map((token) {
      if (token.isNotEmpty) _token = token;
      return token;
    });
  }

  @override
  Stream<PushMessagePayload> get onMessage =>
      FirebaseMessaging.onMessage.map(_payload);

  @override
  Stream<PushMessagePayload> get onMessageOpenedApp =>
      FirebaseMessaging.onMessageOpenedApp.map(_payload);

}

/// Notifikasi lokal heads-up saat pesan tiba di foreground (FCM tidak
/// menampilkannya otomatis pada kondisi itu).
abstract class ApprovalNotificationPresenter {
  Future<void> initialize();

  /// Meminta izin notifikasi OS secara eksplisit (Android 13+
  /// `POST_NOTIFICATIONS` / iOS alert, badge, sound).
  Future<bool> requestPermission();

  Future<void> show({
    required String title,
    required String body,
    Map<String, dynamic> data = const {},
  });
}

class LocalApprovalNotificationPresenter
    implements ApprovalNotificationPresenter {
  LocalApprovalNotificationPresenter({FlutterLocalNotificationsPlugin? plugin})
    : _plugin = plugin ?? FlutterLocalNotificationsPlugin();

  final FlutterLocalNotificationsPlugin _plugin;
  bool _ready = false;
  int _nextId = 2600;

  @override
  Future<void> initialize() async {
    if (_ready) return;
    try {
      const settings = InitializationSettings(
        android: AndroidInitializationSettings('@mipmap/ic_launcher'),
        iOS: DarwinInitializationSettings(
          requestAlertPermission: false,
          requestBadgePermission: false,
          requestSoundPermission: false,
        ),
      );
      await _plugin.initialize(settings: settings);
      final android = _plugin
          .resolvePlatformSpecificImplementation<
            AndroidFlutterLocalNotificationsPlugin
          >();
      await android?.createNotificationChannel(
        const AndroidNotificationChannel(
          approvalNotificationChannelId,
          approvalNotificationChannelName,
          description: approvalNotificationChannelDescription,
          importance: Importance.max,
          playSound: true,
          enableVibration: true,
        ),
      );
      _ready = true;
    } catch (error) {
      debugPrint('Notifikasi lokal approval tidak aktif: $error');
    }
  }

  @override
  Future<bool> requestPermission() async {
    await initialize();
    try {
      // Android 13+: dialog sistem POST_NOTIFICATIONS. Dipanggil eksplisit
      // lewat flutter_local_notifications, bukan hanya lewat FCM, agar
      // pop-up tetap muncul pada perangkat yang Firebase-nya belum siap.
      final android = _plugin
          .resolvePlatformSpecificImplementation<
            AndroidFlutterLocalNotificationsPlugin
          >();
      if (android != null) {
        return isAndroidPermissionGranted(
          await android.requestNotificationsPermission(),
        );
      }
      final ios = _plugin
          .resolvePlatformSpecificImplementation<
            IOSFlutterLocalNotificationsPlugin
          >();
      if (ios != null) {
        return await ios.requestPermissions(
              alert: true,
              badge: true,
              sound: true,
            ) ??
            false;
      }
    } catch (error) {
      debugPrint('Permintaan izin notifikasi lokal gagal: $error');
    }
    return false;
  }

  /// Android 10–12 (API 29–32) tidak punya dialog runtime
  /// `POST_NOTIFICATIONS`; plugin mengembalikan `null` bila kanal platform
  /// belum siap. Nilai `null` diperlakukan sebagai diizinkan agar token FCM
  /// tetap bisa diminta.
  @visibleForTesting
  static bool isAndroidPermissionGranted(bool? result) => result ?? true;

  @override
  Future<void> show({
    required String title,
    required String body,
    Map<String, dynamic> data = const {},
  }) async {
    await initialize();
    if (!_ready) return;
    try {
      await _plugin.show(
        id: _nextId++,
        title: title,
        body: body,
        notificationDetails: const NotificationDetails(
          android: AndroidNotificationDetails(
            approvalNotificationChannelId,
            approvalNotificationChannelName,
            channelDescription: approvalNotificationChannelDescription,
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
        ),
        payload: data['type'] as String?,
      );
    } catch (error) {
      debugPrint('Gagal menampilkan notifikasi approval: $error');
    }
  }
}

/// Kontrak yang dipakai [AuthService] agar alur login/logout tidak bergantung
/// pada Firebase.
abstract class PushSessionSync {
  /// Token FCM yang sedang terpasang pada perangkat, bila ada.
  String? get token;

  Future<void> register(ApiClient api);

  /// [accessToken] dan [pushToken] disalin sebelum penyimpanan lokal dihapus,
  /// sehingga pembersihan server tetap bisa berjalan di latar belakang.
  Future<void> unregister(
    ApiClient api, {
    String? accessToken,
    String? pushToken,
  });
}

class NoopPushSessionSync implements PushSessionSync {
  const NoopPushSessionSync();

  @override
  String? get token => null;

  @override
  Future<void> register(ApiClient api) async {}

  @override
  Future<void> unregister(
    ApiClient api, {
    String? accessToken,
    String? pushToken,
  }) async {}
}

/// Siklus hidup FCM: inisialisasi, izin, token (login/refresh), pesan
/// foreground (notifikasi lokal + detak LiveSync), dan hapus token saat logout.
class PushNotificationService implements PushSessionSync {
  PushNotificationService({
    PushMessagingGateway? gateway,
    ApprovalNotificationPresenter? presenter,
    LiveSync? liveSync,
  }) : _gatewayOverride = gateway,
       _presenter = presenter ?? LocalApprovalNotificationPresenter(),
       _liveSync = liveSync ?? LiveSync.instance;

  final PushMessagingGateway? _gatewayOverride;
  final ApprovalNotificationPresenter _presenter;
  final LiveSync _liveSync;

  PushMessagingGateway? _gateway;
  bool _initializing = false;
  bool _initialized = false;
  String? _token;
  String? _registeredToken;
  ApiClient? _api;
  StreamSubscription<PushMessagePayload>? _messageSubscription;
  StreamSubscription<String>? _tokenSubscription;
  StreamSubscription<PushMessagePayload>? _openedSubscription;

  @override
  String? get token => _token;

  /// Idempoten: aman dipanggil dari main() dan lagi saat login.
  Future<void> initialize() async {
    if (_initialized || _initializing) return;
    _initializing = true;
    try {
      final gateway =
          _gatewayOverride ?? await FirebasePushMessagingGateway.create();
      if (gateway == null) return;
      _gateway = gateway;
      await gateway.initialize();
      _openedSubscription = gateway.onMessageOpenedApp.listen(
        (_) => _liveSync.pulse(),
      );
      _initialized = true;
    } catch (error) {
      debugPrint('Inisialisasi push notification gagal: $error');
    } finally {
      _initializing = false;
    }
  }

  /// Dipanggil setiap sesi berhasil dipulihkan atau user login. Kegagalan
  /// push tidak boleh menggagalkan login.
  @override
  Future<void> register(ApiClient api) async {
    await initialize();
    final gateway = _gateway;
    if (gateway == null) return;
    _api = api;
    try {
      // Dua permintaan izin dipanggil eksplisit agar pop-up sistem Android
      // 13+ maupun iOS selalu muncul bila belum diizinkan.
      try {
        await gateway.requestPermission();
      } catch (error) {
        debugPrint('Permintaan izin notifikasi FCM gagal: $error');
      }
      try {
        await _presenter.requestPermission();
      } catch (error) {
        debugPrint('Permintaan izin notifikasi lokal gagal: $error');
      }
      _messageSubscription ??= gateway.onMessage.listen(
        handleForegroundMessage,
      );
      _tokenSubscription ??= gateway.onTokenRefresh.listen(
        (token) => unawaited(_sendToken(token)),
      );
      final token = await gateway.getToken();
      if (token == null || token.isEmpty) {
        debugPrint('FCM getToken() mengembalikan kosong.');
        return;
      }
      _token = token;
      await _sendToken(token);
    } catch (error) {
      debugPrint('Registrasi push token gagal: $error');
    }
  }

  Future<void> _sendToken(String token) async {
    final api = _api;
    if (api == null || token.isEmpty || token == _registeredToken) return;
    try {
      await api
          .registerPushToken(token: token, platform: currentPushPlatform)
          .timeout(const Duration(seconds: 5));
      _token = token;
      _registeredToken = token;
    } on TimeoutException {
      debugPrint('POST /api/mobile/push-token melewati batas waktu jaringan.');
    } catch (error) {
      // Push opsional; login dan absensi tetap berjalan.
      debugPrint('POST /api/mobile/push-token gagal: $error');
    }
  }

  /// Pesan foreground: tampilkan heads-up dan picu LiveSync supaya daftar
  /// pengajuan serta badge unread langsung diperbarui.
  @visibleForTesting
  Future<void> handleForegroundMessage(PushMessagePayload message) async {
    final title = message.title.trim();
    final body = message.body.trim();
    if (title.isEmpty && body.isEmpty) return;
    _liveSync.pulse();
    await _presenter.show(
      title: title.isEmpty ? 'Pengajuan diperbarui' : title,
      body: body,
      data: message.data,
    );
  }

  /// Logout: hapus token di server agar perangkat lama berhenti menerima
  /// notifikasi akun yang sudah keluar, lalu lepaskan semua listener.
  /// [pushToken] dikirim eksplisit karena penyimpanan lokal sudah dibersihkan.
  @override
  Future<void> unregister(
    ApiClient api, {
    String? accessToken,
    String? pushToken,
  }) async {
    final token = pushToken ?? _token;
    await _messageSubscription?.cancel();
    _messageSubscription = null;
    await _tokenSubscription?.cancel();
    _tokenSubscription = null;
    await _openedSubscription?.cancel();
    _openedSubscription = null;
    _api = null;
    _registeredToken = null;
    _token = null;
    if (token == null || token.isEmpty) return;
    try {
      await api.deletePushToken(token: token, accessToken: accessToken);
    } catch (error) {
      // Token lokal sudah dilepas; sisa token akan dibersihkan server saat
      // FCM melaporkan registration-token-not-registered.
      debugPrint('DELETE /api/mobile/push-token gagal: $error');
    }
  }
}
