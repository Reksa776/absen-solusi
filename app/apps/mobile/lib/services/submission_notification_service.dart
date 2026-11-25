import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../api/api_client.dart';
import '../models/in_app_notification.dart';

/// Menampilkan hasil revisi yang baru muncul saat aplikasi sinkronisasi.
/// Notifikasi in-app tetap sumber kebenaran; local notification hanya pengingat.
class SubmissionNotificationService {
  SubmissionNotificationService({
    FlutterLocalNotificationsPlugin? plugin,
    FlutterSecureStorage? storage,
  }) : _plugin = plugin ?? FlutterLocalNotificationsPlugin(),
       _storage = storage ?? const FlutterSecureStorage();

  static const _lastSeenKey = 'submission_notification_last_at';
  static const _channelId = 'submission_status';

  final FlutterLocalNotificationsPlugin _plugin;
  final FlutterSecureStorage _storage;
  bool _ready = false;

  Future<void> _init() async {
    if (_ready) return;
    try {
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
    } catch (error) {
      debugPrint('Notifikasi submisi tidak aktif: $error');
    }
  }

  Future<InboxPage?> sync(ApiClient api) async {
    try {
      final page = await api.myNotifications(limit: 20);
      if (page.notifications.isEmpty) return page;
      final revisions = page.notifications
          .where((item) => !item.isRead && _isApprovalResult(item.type))
          .toList(growable: false);
      final newest = page.notifications.first.createdAt;
      final lastSeenRaw = await _storage.read(key: _lastSeenKey);
      final lastSeen = DateTime.tryParse(lastSeenRaw ?? '');
      if (lastSeen == null) {
        await _storage.write(
          key: _lastSeenKey,
          value: newest.toUtc().toIso8601String(),
        );
        return page;
      }
      final fresh = revisions
          .where((item) => item.createdAt.isAfter(lastSeen))
          .toList(growable: false);
      if (fresh.isNotEmpty) {
        await _init();
        if (_ready) {
          for (final item in fresh.take(3)) {
            await _show(item);
          }
        }
      }
      await _storage.write(
        key: _lastSeenKey,
        value: newest.toUtc().toIso8601String(),
      );
      return page;
    } catch (error) {
      debugPrint('Sinkronisasi notifikasi submisi gagal: $error');
      return null;
    }
  }

  /// Hasil persetujuan dari seluruh fitur pengajuan, bukan hanya revisi.
  bool _isApprovalResult(String type) {
    final value = type.toUpperCase();
    if (!value.endsWith('APPROVED') && !value.endsWith('REJECTED')) {
      return false;
    }
    return value.contains('CORRECTION') ||
        value.contains('WFH') ||
        value.contains('OVERTIME') ||
        value.contains('LEAVE') ||
        value.contains('PERMIT') ||
        value.contains('DEVICE') ||
        value.contains('ATTENDANCE');
  }

  Future<void> _show(InAppNotification item) async {
    const details = NotificationDetails(
      android: AndroidNotificationDetails(
        _channelId,
        'Status pengajuan',
        channelDescription: 'Hasil persetujuan revisi dan presensi.',
        importance: Importance.high,
        priority: Priority.high,
        category: AndroidNotificationCategory.status,
      ),
      iOS: DarwinNotificationDetails(
        presentAlert: true,
        presentBadge: true,
        presentSound: true,
      ),
    );
    try {
      await _plugin.show(
        id: item.createdAt.millisecondsSinceEpoch ~/ 1000 % 2147483647,
        title: item.title,
        body: item.body,
        notificationDetails: details,
        payload: item.linkUrl,
      );
    } catch (error) {
      debugPrint('Notifikasi lokal submisi gagal: $error');
    }
  }
}
