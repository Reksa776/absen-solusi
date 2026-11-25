import 'package:flutter/foundation.dart';

/// Sinyal sinkronisasi ringan dari shell ke layar data yang sedang terbuka.
///
/// Shell memancarkan detak setiap 12 detik saat aplikasi di foreground,
/// saat pengguna berpindah tab, dan saat aplikasi kembali dari background.
/// Layar hanya memuat ulang datanya sendiri tanpa spinner layar penuh.
class LiveSync extends ChangeNotifier {
  LiveSync();

  /// Instance global agar layar yang dibuka lewat route push (misalnya
  /// Lembur & WFH) tetap menerima detak yang sama.
  static final LiveSync instance = LiveSync();

  int _tick = 0;
  DateTime? _lastTickAt;

  int get tick => _tick;

  DateTime? get lastTickAt => _lastTickAt;

  void pulse({DateTime? now}) {
    _tick += 1;
    _lastTickAt = now ?? DateTime.now();
    notifyListeners();
  }

  @visibleForTesting
  void reset() {
    _tick = 0;
    _lastTickAt = null;
  }
}
