import 'package:material_ui/material_ui.dart';

/// Navigator akar aplikasi. Logout memakainya untuk membuang seluruh rute
/// bertumpuk (mis. layar Profil yang dibuka dari Beranda) sehingga layar Login
/// tampil di rute akar dan tombol Back keluar dari aplikasi.
final GlobalKey<NavigatorState> rootNavigatorKey = GlobalKey<NavigatorState>();

/// Kembali ke rute akar. `AbsensiApp` merender LoginScreen saat sesi kosong,
/// jadi rute akar langsung menampilkan Login tanpa jeda jaringan.
void resetRootNavigator() {
  NavigatorState? navigator;
  try {
    navigator = rootNavigatorKey.currentState;
  } catch (_) {
    // Unit test murni tanpa WidgetsBinding: tidak ada navigasi untuk direset.
    return;
  }
  if (navigator == null) return;
  navigator.popUntil((route) => route.isFirst);
}
