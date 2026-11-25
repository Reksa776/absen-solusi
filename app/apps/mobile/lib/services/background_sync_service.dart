import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

import '../api/api_client.dart';
import '../models/in_app_notification.dart';
import 'background_sync_platform.dart';

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

/// Menyiapkan sesi latar: menyalin kredensial ke SharedPreferences polos,
/// menandai notifikasi lama sebagai sudah dilihat, lalu menyalakan foreground
/// service native.
///
/// Seluruh loop `GET /api/notifications/me` setiap 10 detik berjalan di Kotlin
/// (`BackgroundSyncService.kt`), jadi tetap hidup walau Activity Flutter sudah
/// dihancurkan. Dart sengaja tidak memakai `Timer.periodic` agar tidak ada dua
/// poller yang balapan dan menampilkan notifikasi ganda.
class BackgroundSyncController implements BackgroundSessionSync {
  BackgroundSyncController({
    BackgroundSyncPlatform? platform,
    http.Client Function()? clientFactory,
    this.seedLimit = 20,
    this.maxSeenIds = 200,
  }) : _platform = platform ?? MethodChannelBackgroundSyncPlatform(),
       _clientFactory = clientFactory ?? http.Client.new;

  final BackgroundSyncPlatform _platform;
  final http.Client Function() _clientFactory;
  final int seedLimit;
  final int maxSeenIds;

  bool _running = false;

  /// True setelah bridge native dipanggil untuk menyalakan service.
  bool get isRunning => _running;

  @override
  Future<void> start(ApiClient api) async {
    final token = await api.readToken();
    if (token == null || token.isEmpty) {
      debugPrint('Sinkronisasi latar tidak dimulai: token kosong.');
      return;
    }
    await _platform.syncCredentials(token: token, baseUrl: api.baseUrl);
    await _seedExistingNotifications(api: api, token: token);
    await _platform.startService();
    _running = true;
  }

  /// Notifikasi yang sudah ada sebelum login tidak boleh berbunyi sebagai
  /// heads-up. Halaman pertama ditandai sudah dilihat lebih dulu supaya hanya
  /// notifikasi baru setelah login yang memicu alert.
  Future<void> _seedExistingNotifications({
    required ApiClient api,
    required String token,
  }) async {
    try {
      if ((await _platform.readSeenIds()).isNotEmpty) return;
      final client = _clientFactory();
      try {
        final uri = Uri.parse(
          '${api.baseUrl}/api/notifications/me',
        ).replace(queryParameters: {'limit': '$seedLimit'});
        final response = await client
            .get(uri, headers: {
              'authorization': 'Bearer $token',
              'accept': 'application/json',
            })
            .timeout(const Duration(seconds: 10));
        if (response.statusCode < 200 || response.statusCode >= 300) {
          debugPrint(
            'Penandaan notifikasi lama dilewati: HTTP ${response.statusCode}.',
          );
          return;
        }
        final decoded = jsonDecode(response.body);
        if (decoded is! Map<String, dynamic>) return;
        final ids = InboxPage.fromJson(decoded)
            .notifications
            .map((item) => item.id)
            .where((id) => id.isNotEmpty)
            .toList(growable: false);
        if (ids.isEmpty) return;
        await _platform.writeSeenIds(_trim(ids));
      } finally {
        client.close();
      }
    } catch (error) {
      debugPrint('Penandaan notifikasi lama gagal: $error');
    }
  }

  /// ID terbaru berada di depan agar pemotongan 200 ID sama dengan Kotlin.
  List<String> _trim(List<String> ids) =>
      ids.length > maxSeenIds ? ids.sublist(0, maxSeenIds) : ids;

  @override
  Future<void> stop() async {
    _running = false;
    await _platform.stopService();
    await _platform.writeSeenIds(const <String>[]);
    await _platform.clearCredentials();
  }
}
