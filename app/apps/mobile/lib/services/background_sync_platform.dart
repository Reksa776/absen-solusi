import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

/// Kunci key-value polos yang dibagi bersama Dart dan Android
/// SharedPreferences. Token sengaja dicerminkan keluar dari secure storage
/// karena Android Keystore sering menolak akses saat aplikasi di latar
/// belakang atau layar terkunci.
class BackgroundSyncKeys {
  const BackgroundSyncKeys._();

  static const String accessToken = 'bg_access_token';
  static const String apiBaseUrl = 'bg_api_base_url';
  static const String seenNotificationIds = 'seen_notification_ids';
}

/// Jembatan ke Android SharedPreferences dan foreground service native.
abstract class BackgroundSyncPlatform {
  Future<void> syncCredentials({required String token, required String baseUrl});

  Future<void> clearCredentials();

  Future<void> startService();

  Future<void> stopService();

  Future<List<String>> readSeenIds();

  Future<void> writeSeenIds(List<String> ids);

  /// True bila aplikasi sudah dikecualikan dari optimasi baterai. Null berarti
  /// platform ini tidak memiliki pengaturan tersebut (iOS / widget test).
  Future<bool?> isBatteryOptimizationIgnored();

  /// Menampilkan dialog sistem "Izinkan / Tolak" pengecualian baterai.
  /// Mengembalikan status terkini; false berarti dialog baru saja diminta.
  Future<bool?> requestBatteryExemption();
}

/// Implementasi produksi lewat MethodChannel yang ditangani MainActivity.
class MethodChannelBackgroundSyncPlatform implements BackgroundSyncPlatform {
  MethodChannelBackgroundSyncPlatform({MethodChannel? channel})
    : _channel = channel ?? const MethodChannel(channelName);

  static const String channelName = 'absensi/background_sync';

  final MethodChannel _channel;

  Future<T?> _invoke<T>(String method, [Object? arguments]) async {
    try {
      return await _channel.invokeMethod<T>(method, arguments);
    } on MissingPluginException {
      debugPrint('Foreground service latar tidak tersedia di platform ini.');
      return null;
    } on PlatformException catch (error) {
      debugPrint('Foreground service latar gagal ($method): ${error.message}');
      return null;
    }
  }

  @override
  Future<void> syncCredentials({
    required String token,
    required String baseUrl,
  }) async {
    await _invoke<void>('syncCredentials', {
      'token': token,
      'baseUrl': baseUrl,
    });
  }

  @override
  Future<void> clearCredentials() async {
    await _invoke<void>('clearCredentials');
  }

  @override
  Future<void> startService() async {
    await _invoke<void>('startService');
  }

  @override
  Future<void> stopService() async {
    await _invoke<void>('stopService');
  }

  @override
  Future<List<String>> readSeenIds() async {
    final ids = await _invoke<List<Object?>>('readSeenIds');
    return ids?.whereType<String>().toList(growable: false) ?? const [];
  }

  @override
  Future<void> writeSeenIds(List<String> ids) async {
    await _invoke<void>('writeSeenIds', {'ids': ids});
  }

  @override
  Future<bool?> isBatteryOptimizationIgnored() =>
      _invoke<bool>('isBatteryOptimizationIgnored');

  @override
  Future<bool?> requestBatteryExemption() =>
      _invoke<bool>('requestBatteryExemption');
}

/// Penyimpanan in-memory untuk unit test tanpa platform channel.
class MemoryBackgroundSyncPlatform implements BackgroundSyncPlatform {
  String? token;
  String? baseUrl;
  bool serviceRunning = false;
  List<String> seenIds = <String>[];
  int startCount = 0;
  int stopCount = 0;

  @override
  Future<void> syncCredentials({
    required String token,
    required String baseUrl,
  }) async {
    this.token = token;
    this.baseUrl = baseUrl;
  }

  @override
  Future<void> clearCredentials() async {
    token = null;
    baseUrl = null;
  }

  @override
  Future<void> startService() async {
    serviceRunning = true;
    startCount++;
  }

  @override
  Future<void> stopService() async {
    serviceRunning = false;
    stopCount++;
  }

  @override
  Future<List<String>> readSeenIds() async => List<String>.of(seenIds);

  @override
  Future<void> writeSeenIds(List<String> ids) async {
    seenIds = List<String>.of(ids);
  }

  /// Null mensimulasikan platform tanpa pengaturan optimasi baterai.
  bool? batteryIgnored = false;
  int batteryExemptionRequests = 0;

  @override
  Future<bool?> isBatteryOptimizationIgnored() async => batteryIgnored;

  @override
  Future<bool?> requestBatteryExemption() async {
    batteryExemptionRequests++;
    return batteryIgnored;
  }
}
