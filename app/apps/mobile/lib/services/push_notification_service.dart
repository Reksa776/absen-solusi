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
  final StreamController<String> _registrations =
      StreamController<String>.broadcast();
  StreamSubscription<String>? _registrationSubscription;
  Completer<String>? _pendingRegistration;
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
    _registrationSubscription ??= _messaging.onRegistered.listen((token) {
      _token = token;
      _registrations.add(token);
      final pending = _pendingRegistration;
      if (pending != null && !pending.isCompleted) pending.complete(token);
    });
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

  /// firebase_messaging 17 memakai `register()` + `onRegistered`; token
  /// terakhir di-cache agar pemanggilan berulang tidak menunggu stream.
  @override
  Future<String?> getToken() async {
    final cached = _token;
    if (cached != null && cached.isNotEmpty) return cached;
    final pending = _pendingRegistration ??= Completer<String>();
    await _messaging.register();
    try {
      return await pending.future.timeout(const Duration(seconds: 8));
    } on TimeoutException {
      return _token;
    }
  }

  @override
  Stream<String> get onTokenRefresh => _registrations.stream;

  @override
  Stream<PushMessagePayload> get onMessage =>
      FirebaseMessaging.onMessage.map(_payload);

  @override
  Stream<PushMessagePayload> get onMessageOpenedApp =>
      FirebaseMessaging.onMessageOpenedApp.map(_payload);

  Future<void> dispose() async {
    await _registrationSubscription?.cancel();
    _registrationSubscription = null;
    await _registrations.close();
  }
}

/// Notifikasi lokal heads-up saat pesan tiba di foreground (FCM tidak
/// menampilkannya otomatis pada kondisi itu).
abstract class ApprovalNotificationPresenter {
  Future<void> initialize();
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
  Future<void> register(ApiClient api);
  Future<void> unregister(ApiClient api);
}

class NoopPushSessionSync implements PushSessionSync {
  const NoopPushSessionSync();

  @override
  Future<void> register(ApiClient api) async {}

  @override
  Future<void> unregister(ApiClient api) async {}
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
      await gateway.requestPermission();
      _messageSubscription ??= gateway.onMessage.listen(
        handleForegroundMessage,
      );
      _tokenSubscription ??= gateway.onTokenRefresh.listen(
        (token) => unawaited(_sendToken(token)),
      );
      final token = await gateway.getToken();
      if (token == null || token.isEmpty) return;
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
      await api.registerPushToken(token: token, platform: currentPushPlatform);
      _token = token;
      _registeredToken = token;
    } catch (_) {
      // Push opsional; login dan absensi tetap berjalan.
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
  @override
  Future<void> unregister(ApiClient api) async {
    final token = _token;
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
      await api.deletePushToken(token: token);
    } catch (_) {
      // Token lokal sudah dilepas; sisa token akan dibersihkan server saat
      // FCM melaporkan registration-token-not-registered.
    }
  }
}
