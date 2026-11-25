import 'package:flutter/foundation.dart';
import 'package:permission_handler/permission_handler.dart';

class PermissionSnapshot {
  const PermissionSnapshot({
    required this.location,
    required this.camera,
    required this.notifications,
    required this.exactAlarm,
  });

  final bool location;
  final bool camera;
  final bool notifications;
  final bool exactAlarm;

  bool get allGranted => location && camera && notifications && exactAlarm;

  List<String> get missing => [
    if (!location) 'Lokasi GPS',
    if (!camera) 'Kamera',
    if (!notifications) 'Notifikasi',
    if (!exactAlarm) 'Alarm presensi',
  ];
}

/// Kontrak sempit izin notifikasi agar layar utama dapat meminta izin tanpa
/// bergantung pada plugin OS saat widget test.
abstract class NotificationPermissionGateway {
  Future<bool> isNotificationGranted();

  Future<bool> requestNotification();
}

/// Permission handler dipakai agar tombol onboarding meminta izin OS secara
/// berurutan, bukan memicu kamera/GPS diam-diam untuk memancing dialog.
class PermissionOnboardingService implements NotificationPermissionGateway {
  const PermissionOnboardingService();

  bool get _supported =>
      !kIsWeb &&
      (defaultTargetPlatform == TargetPlatform.android ||
          defaultTargetPlatform == TargetPlatform.iOS);

  @override
  Future<bool> isNotificationGranted() async {
    if (!_supported) return true;
    try {
      return (await Permission.notification.status).isGranted;
    } catch (error) {
      debugPrint('Status izin notifikasi tidak tersedia: $error');
      return true;
    }
  }

  @override
  Future<bool> requestNotification() async {
    if (!_supported) return true;
    try {
      return (await Permission.notification.request()).isGranted;
    } catch (error) {
      debugPrint('Permintaan izin notifikasi tidak tersedia: $error');
      return false;
    }
  }

  Future<PermissionSnapshot> status() async {
    if (kIsWeb ||
        (defaultTargetPlatform != TargetPlatform.android &&
            defaultTargetPlatform != TargetPlatform.iOS)) {
      // Widget test/desktop tidak memiliki izin OS mobile.
      return const PermissionSnapshot(
        location: true,
        camera: true,
        notifications: true,
        exactAlarm: true,
      );
    }
    try {
      return PermissionSnapshot(
        location: (await Permission.locationWhenInUse.status).isGranted,
        camera: (await Permission.camera.status).isGranted,
        notifications: (await Permission.notification.status).isGranted,
        exactAlarm: (await Permission.scheduleExactAlarm.status).isGranted,
      );
    } catch (error) {
      // Widget test/desktop tidak memiliki plugin permission.
      debugPrint('Status izin tidak tersedia: $error');
      return const PermissionSnapshot(
        location: true,
        camera: true,
        notifications: true,
        exactAlarm: true,
      );
    }
  }

  Future<PermissionSnapshot> requestAll() async {
    try {
      await Permission.locationWhenInUse.request();
      await Permission.camera.request();
      await Permission.notification.request();
      await Permission.scheduleExactAlarm.request();
    } catch (error) {
      debugPrint('Permintaan izin tidak tersedia: $error');
    }
    return status();
  }
}
