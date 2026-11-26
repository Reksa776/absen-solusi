import 'dart:async';

import 'package:flutter/foundation.dart';

import '../api/api_client.dart';
import '../core/root_navigator.dart';
import '../models/session.dart';
import '../models/user.dart';
import '../models/workspace.dart';
import 'background_sync_service.dart';
import 'push_notification_service.dart';

class AuthService extends ChangeNotifier {
  AuthService({
    required this.api,
    BackgroundSessionSync? backgroundSync,
    PushSessionSync? pushSync,
    VoidCallback? onSessionCleared,
  }) : backgroundSync = backgroundSync ?? const NoopBackgroundSessionSync(),
       pushNotifications = pushSync ?? const NoopPushSessionSync(),
       _onSessionCleared = onSessionCleared ?? resetRootNavigator;

  final ApiClient api;

  /// Menyalin kredensial ke SharedPreferences polos dan menyalakan
  /// foreground service sinkronisasi selama sesi aktif.
  final BackgroundSessionSync backgroundSync;

  /// Registrasi token FCM saat login/sesi dipulihkan dan penghapusannya saat
  /// logout. Implementasi nyata ada di [PushNotificationService].
  final PushSessionSync pushNotifications;

  /// Dipanggil setelah sesi lokal dihapus agar seluruh rute bertumpuk dibuang
  /// dan layar Login tampil di rute akar.
  final VoidCallback _onSessionCleared;
  SessionProfile? _profile;
  bool _loading = false;
  bool _busy = false;
  String? _error;

  SessionProfile? get profile => _profile;
  User? get user => _profile?.user;
  bool get isLoading => _loading;
  bool get isBusy => _busy;
  String? get error => _error;
  bool get isAuthenticated => _profile != null;

  Workspace? get activeWorkspace {
    final current = _profile;
    if (current == null || current.activeTenantId == null) return null;
    for (final workspace in current.workspaces) {
      if (workspace.id == current.activeTenantId) return workspace;
    }
    return null;
  }

  Future<bool> restore() async {
    _loading = true;
    _error = null;
    notifyListeners();
    try {
      final token = await api.readToken();
      if (token == null || token.isEmpty) {
        _profile = null;
        return false;
      }
      _profile = await api.me();
      await _startPushSync();
      await _startBackgroundSync();
      return true;
    } on ApiException catch (error) {
      if (error.statusCode == 401 || error.statusCode == 403) {
        await api.clearToken();
      }
      _error = messageForApiError(error);
      _profile = null;
      return false;
    } catch (_) {
      _error = 'Tidak dapat memulihkan sesi. Periksa koneksi Anda.';
      _profile = null;
      return false;
    } finally {
      _loading = false;
      notifyListeners();
    }
  }

  Future<bool> login(String email, String password) async {
    _busy = true;
    _error = null;
    notifyListeners();
    try {
      final result = await api.login(email.trim(), password);
      _profile = result;
      await _startPushSync();
      await _startBackgroundSync();
      return true;
    } on ApiException catch (error) {
      _error = messageForApiError(error);
      return false;
    } catch (_) {
      _error = 'Tidak dapat terhubung ke server. Periksa koneksi Anda.';
      return false;
    } finally {
      _busy = false;
      notifyListeners();
    }
  }

  Future<bool> switchWorkspace(String workspaceId) async {
    _busy = true;
    _error = null;
    notifyListeners();
    try {
      await api.switchWorkspace(workspaceId);
      _profile = await api.me();
      return true;
    } on ApiException catch (error) {
      _error = messageForApiError(error);
      return false;
    } catch (_) {
      _error = 'Gagal berpindah workspace.';
      return false;
    } finally {
      _busy = false;
      notifyListeners();
    }
  }

  /// Batas waktu pembersihan server saat logout. UI tidak pernah menunggu
  /// jaringan lebih lama dari ini.
  static const Duration remoteLogoutTimeout = Duration(seconds: 3);

  /// Logout dua fase: sesi lokal diputus seketika (tanpa menunggu jaringan),
  /// lalu token push & sesi server dibersihkan di latar belakang.
  Future<void> logout() async {
    if (_busy) return;
    _busy = true;
    notifyListeners();

    // Kredensial disalin lebih dulu karena penyimpanan lokal langsung dihapus;
    // pembersihan server memakai nilai ini, bukan membaca storage lagi.
    String? accessToken;
    try {
      accessToken = await api.readToken();
    } catch (error) {
      debugPrint('Token sesi tidak terbaca saat logout: $error');
    }
    final pushToken = pushNotifications.token;

    // 1) Putus sesi lokal secara atomik: state memori, storage, dan sinkron
    //    latar. Semua langkah ini lokal sehingga tidak menunggu jaringan.
    _profile = null;
    _error = null;
    _busy = false;
    try {
      await api.clearToken();
    } catch (error) {
      debugPrint('Penyimpanan token tidak dapat dibersihkan: $error');
    }
    try {
      await backgroundSync.stop();
    } catch (error) {
      debugPrint('Sinkronisasi latar tidak dapat dihentikan: $error');
    }
    notifyListeners();

    // 2) Reset tumpukan rute: layar Login tampil tanpa jeda dan tombol Back
    //    keluar dari aplikasi, bukan kembali ke Beranda/Profil.
    _onSessionCleared();

    // 3) Hapus token FCM & sesi server di latar belakang dengan batas waktu.
    if (accessToken == null || accessToken.isEmpty) return;
    unawaited(
      _purgeRemoteSession(accessToken: accessToken, pushToken: pushToken),
    );
  }

  Future<void> _purgeRemoteSession({
    required String accessToken,
    required String? pushToken,
  }) async {
    debugPrint(
      'Logout: pembersihan server dimulai '
      '(token push: ${pushToken == null ? 'tidak ada' : 'ada'}).',
    );
    try {
      await pushNotifications
          .unregister(api, accessToken: accessToken, pushToken: pushToken)
          .timeout(remoteLogoutTimeout);
    } catch (error) {
      debugPrint('Penghapusan token push saat logout gagal: $error');
    }
    try {
      await api.logout(accessToken: accessToken).timeout(remoteLogoutTimeout);
    } catch (error) {
      debugPrint('Sesi server tidak dapat diakhiri: $error');
    }
  }

  void clearError() {
    _error = null;
    notifyListeners();
  }

  Future<void> _startPushSync() async {
    try {
      await pushNotifications.register(api);
    } catch (error) {
      debugPrint('Registrasi push notification gagal: $error');
    }
  }

  Future<void> _startBackgroundSync() async {
    try {
      await backgroundSync.start(api);
    } catch (error) {
      debugPrint('Sinkronisasi latar gagal dimulai: $error');
    }
  }
}

String messageForApiError(ApiException error) {
  switch (error.code) {
    case 'INVALID_CREDENTIALS':
      return 'Email atau password salah.';
    case 'RATE_LIMITED':
      return 'Terlalu banyak percobaan. Coba lagi nanti.';
    case 'UNAUTHENTICATED':
      return 'Sesi berakhir. Silakan login kembali.';
    case 'WORKSPACE_FORBIDDEN':
      return 'Workspace tidak tersedia untuk akun ini.';
    case 'GEOFENCE_VIOLATION':
      return 'Anda berada di luar radius kantor.';
    case 'ACCURACY_TOO_LOW':
      return 'Akurasi GPS belum cukup. Tunggu GPS lebih baik.';
    case 'MOCK_LOCATION_DETECTED':
      return 'Mock location terdeteksi. Matikan aplikasi lokasi palsu.';
    case 'ALREADY_CHECKED_IN':
      return 'Anda sudah check-in hari ini.';
    case 'ALREADY_CHECKED_OUT':
      return 'Anda sudah check-out hari ini.';
    case 'NOT_CHECKED_IN':
      return 'Anda belum check-in hari ini.';
    case 'OFFICE_NOT_CONFIGURED':
      return 'Lokasi kantor belum dikonfigurasi admin.';
    case 'WINDOW_EXCEEDED':
      return 'Revisi hanya bisa diajukan maksimal 7 hari ke belakang.';
    case 'FUTURE_TIMESTAMP':
      return 'Tanggal revisi tidak boleh di masa depan.';
    case 'REVISION_LIMIT_EXCEEDED':
      return 'Batas pengajuan revisi bulan ini sudah tercapai.';
    case 'ALASAN_TOO_SHORT':
      return 'Alasan revisi minimal 10 karakter.';
    case 'ALASAN_TOO_LONG':
      return 'Alasan revisi terlalu panjang.';
    case 'ATTENDANCE_LOG_FORBIDDEN':
      return 'Absensi yang dipilih tidak dapat direvisi.';
    case 'REQUEST_TYPE_MISMATCH':
      return 'Tipe revisi tidak sesuai dengan absensi yang dipilih.';
    case 'INVALID_PROOF':
      return 'Bukti harus berupa JPEG, PNG, WebP, atau PDF maksimal 5 MB.';
    default:
      return error.message;
  }
}
