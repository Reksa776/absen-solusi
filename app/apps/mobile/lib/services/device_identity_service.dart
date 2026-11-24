import 'dart:io';
import 'dart:math';

import 'package:device_info_plus/device_info_plus.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class DeviceIdentity {
  const DeviceIdentity({
    required this.deviceId,
    required this.deviceName,
    required this.platform,
    this.deviceModel,
    this.deviceManufacturer,
  });

  final String deviceId;
  final String deviceName;
  final String platform;
  final String? deviceModel;
  final String? deviceManufacturer;

  Map<String, String> get headers => {
    'x-device-id': deviceId,
    'x-device-name': deviceName,
    'x-device-platform': platform,
    if (deviceModel != null && deviceModel!.isNotEmpty)
      'x-device-model': deviceModel!,
    if (deviceManufacturer != null && deviceManufacturer!.isNotEmpty)
      'x-device-manufacturer': deviceManufacturer!,
  };
}

/// Identitas perangkat persisten lintas Android dan iOS. ID disimpan di
/// keychain/keystore; nama model diambil dari device_info_plus. Bila plugin
/// atau storage tidak tersedia (mis. test), ID sementara yang stabil per
/// proses tetap dikirim agar server dapat menolak perangkat yang belum
/// disetujui.
class DeviceIdentityService {
  DeviceIdentityService({
    FlutterSecureStorage? storage,
    DeviceInfoPlugin? deviceInfo,
  }) : _storage = storage ?? const FlutterSecureStorage(),
       _deviceInfo = deviceInfo ?? DeviceInfoPlugin();

  static const _key = 'absensi.device.id';
  static const _timeout = Duration(seconds: 2);
  static final String _fallbackId =
      'device-${DateTime.now().microsecondsSinceEpoch.toRadixString(36)}'
      '-${Random.secure().nextInt(1 << 32).toRadixString(36)}';

  final FlutterSecureStorage _storage;
  final DeviceInfoPlugin _deviceInfo;
  Future<DeviceIdentity>? _cached;

  Future<DeviceIdentity> resolve() => _cached ??= _load();

  Future<DeviceIdentity> _load() async {
    final platform = Platform.isAndroid
        ? 'ANDROID'
        : Platform.isIOS
        ? 'IOS'
        : 'UNKNOWN';
    // Widget/unit test tidak memiliki plugin secure storage atau device info.
    // Jangan menunggu platform channel yang tidak pernah menjawab.
    final isTest =
        const bool.fromEnvironment('FLUTTER_TEST') ||
        Platform.environment.containsKey('FLUTTER_TEST');
    final deviceId = await _persistentId(isTest);
    final (deviceName, deviceModel, deviceManufacturer) = await _deviceInfoFor(
      platform,
      isTest,
    );
    return DeviceIdentity(
      deviceId: deviceId,
      deviceName: deviceName.length > 120
          ? deviceName.substring(0, 120)
          : deviceName,
      platform: platform,
      deviceModel: deviceModel,
      deviceManufacturer: deviceManufacturer,
    );
  }

  Future<String> _persistentId(bool isTest) async {
    if (isTest) return _fallbackId;
    try {
      final existing = await _storage.read(key: _key).timeout(_timeout);
      if (existing != null && existing.length >= 8) return existing;
      await _storage.write(key: _key, value: _fallbackId).timeout(_timeout);
    } catch (_) {
      // Keystore/keychain tidak tersedia: tetap kirim ID proses ini.
    }
    return _fallbackId;
  }

  Future<(String, String?, String?)> _deviceInfoFor(
    String platform,
    bool isTest,
  ) async {
    if (isTest) {
      return (platform == 'UNKNOWN' ? 'Perangkat' : platform, null, null);
    }
    try {
      if (Platform.isAndroid) {
        final info = await _deviceInfo.androidInfo.timeout(_timeout);
        final model = info.model.trim();
        final manufacturer = info.manufacturer.trim();
        final name = '$manufacturer $model'.trim();
        if (name.isNotEmpty) {
          return (
            name,
            model.isEmpty ? null : model,
            manufacturer.isEmpty ? null : manufacturer,
          );
        }
      } else if (Platform.isIOS) {
        final info = await _deviceInfo.iosInfo.timeout(_timeout);
        final model = info.model.trim().isNotEmpty
            ? info.model.trim()
            : info.utsname.machine.trim();
        if (model.isNotEmpty) return (model, model, 'Apple');
      }
    } catch (_) {
      // Fallback ke label platform bila plugin gagal.
    }
    return (platform == 'UNKNOWN' ? 'Perangkat' : platform, null, null);
  }
}
