import 'package:material_ui/material_ui.dart';

import '../services/app_update_service.dart';
import '../services/auth_service.dart';
import '../services/location_service.dart';
import '../theme/app_theme.dart';
import 'history_screen.dart';
import 'home_screen.dart';
import 'profile_screen.dart';
import 'requests_tab.dart';

/// Shell utama aplikasi: empat tab dengan IndexedStack agar state kamera,
/// GPS, dan posisi gulir tiap tab tetap hidup saat berpindah tab.
class MainShellScreen extends StatefulWidget {
  const MainShellScreen({
    super.key,
    required this.auth,
    this.updateService,
    this.locationService,
    this.photoTaker,
  });

  final AuthService auth;
  final AppUpdateService? updateService;
  final LocationService? locationService;
  final PhotoTaker? photoTaker;

  @override
  State<MainShellScreen> createState() => _MainShellScreenState();
}

class _MainShellScreenState extends State<MainShellScreen> {
  final List<Widget?> _tabs = List<Widget?>.filled(4, null);
  int _index = 0;

  @override
  void initState() {
    super.initState();
    _tabs[0] = _buildTab(0);
  }

  Widget _buildTab(int index) {
    switch (index) {
      case 1:
        return HistoryScreen(auth: widget.auth, embedded: true);
      case 2:
        return RequestsTab(auth: widget.auth);
      case 3:
        return ProfileScreen(
          auth: widget.auth,
          updateService: widget.updateService,
        );
      default:
        return HomeScreen(
          auth: widget.auth,
          embedded: true,
          locationService: widget.locationService,
          photoTaker: widget.photoTaker,
        );
    }
  }

  void _select(int index) {
    if (index == _index) return;
    setState(() {
      _tabs[index] ??= _buildTab(index);
      _index = index;
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.canvas,
      body: IndexedStack(
        index: _index,
        children: [
          for (var i = 0; i < _tabs.length; i++)
            _tabs[i] ?? const SizedBox.shrink(),
        ],
      ),
      bottomNavigationBar: DecoratedBox(
        decoration: const BoxDecoration(
          color: AppColors.surface,
          border: Border(top: BorderSide(color: AppColors.line)),
        ),
        child: SafeArea(
          top: false,
          child: NavigationBar(
            key: const Key('main-nav'),
            selectedIndex: _index,
            onDestinationSelected: _select,
            destinations: const [
              NavigationDestination(
                key: Key('nav-absen'),
                icon: Icon(Icons.fingerprint_outlined),
                selectedIcon: Icon(Icons.fingerprint),
                label: 'Absen',
              ),
              NavigationDestination(
                key: Key('nav-riwayat'),
                icon: Icon(Icons.history_rounded),
                selectedIcon: Icon(Icons.history_rounded),
                label: 'Riwayat',
              ),
              NavigationDestination(
                key: Key('nav-pengajuan'),
                icon: Icon(Icons.assignment_outlined),
                selectedIcon: Icon(Icons.assignment),
                label: 'Pengajuan',
              ),
              NavigationDestination(
                key: Key('nav-profil'),
                icon: Icon(Icons.person_outline_rounded),
                selectedIcon: Icon(Icons.person_rounded),
                label: 'Profil',
              ),
            ],
          ),
        ),
      ),
    );
  }
}
