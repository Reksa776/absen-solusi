import 'package:flutter/foundation.dart';

import '../api/api_client.dart';
import '../models/session.dart';
import '../models/user.dart';
import '../models/workspace.dart';

class AuthService extends ChangeNotifier {
  AuthService({required this.api});

  final ApiClient api;
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

  Future<void> logout() async {
    _busy = true;
    notifyListeners();
    try {
      await api.logout();
    } catch (_) {
      // Token tetap dihapus lokal walau server tidak dapat dihubungi.
    } finally {
      await api.clearToken();
      _profile = null;
      _error = null;
      _busy = false;
      notifyListeners();
    }
  }

  void clearError() {
    _error = null;
    notifyListeners();
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
