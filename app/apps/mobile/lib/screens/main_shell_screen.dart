import 'dart:async';

import 'package:material_ui/material_ui.dart';

import '../services/app_update_service.dart';
import '../services/auth_service.dart';
import '../services/location_service.dart';
import '../services/submission_notification_service.dart';
import '../theme/app_theme.dart';
import 'history_screen.dart';
import 'home_screen.dart';
import 'messages_tab.dart';
import 'schedule_tab.dart';

/// Shell utama aplikasi: Beranda, Jadwal, Aktivitas, dan Pesan.
/// IndexedStack menjaga state kamera, GPS, dan posisi gulir tiap tab.
class MainShellScreen extends StatefulWidget {
  const MainShellScreen({
    super.key,
    required this.auth,
    this.updateService,
    this.locationService,
    this.photoTaker,
    this.notificationService,
  });

  final AuthService auth;
  final AppUpdateService? updateService;
  final LocationService? locationService;
  final PhotoTaker? photoTaker;
  final SubmissionNotificationService? notificationService;

  @override
  State<MainShellScreen> createState() => _MainShellScreenState();
}

class _MainShellScreenState extends State<MainShellScreen>
    with WidgetsBindingObserver {
  final List<Widget?> _tabs = List<Widget?>.filled(4, null);
  late final SubmissionNotificationService _submissionNotifications =
      widget.notificationService ?? SubmissionNotificationService();
  int _index = 0;
  int _unread = 0;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _tabs[0] = _buildTab(0);
    _loadUnread();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) unawaited(_loadUnread());
  }

  Future<void> _loadUnread() async {
    try {
      final page =
          await _submissionNotifications.sync(widget.auth.api) ??
          await widget.auth.api.myNotifications(limit: 1);
      if (!mounted) return;
      setState(() => _unread = page.unreadCount);
    } catch (_) {
      // Badge unread bersifat informatif; kegagalan jaringan diabaikan.
    }
  }

  Widget _buildTab(int index) {
    switch (index) {
      case 1:
        return ScheduleTab(auth: widget.auth);
      case 2:
        return HistoryScreen(auth: widget.auth, embedded: true);
      case 3:
        return MessagesTab(
          auth: widget.auth,
          onUnreadChanged: (count) {
            if (mounted && count != _unread) setState(() => _unread = count);
          },
        );
      default:
        return HomeScreen(
          auth: widget.auth,
          embedded: true,
          updateService: widget.updateService,
          locationService: widget.locationService,
          photoTaker: widget.photoTaker,
          onOpenActivity: () => _select(2),
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
            destinations: [
              const NavigationDestination(
                key: Key('nav-beranda'),
                icon: Icon(Icons.home_outlined),
                selectedIcon: Icon(Icons.home_rounded),
                label: 'Beranda',
              ),
              const NavigationDestination(
                key: Key('nav-jadwal'),
                icon: Icon(Icons.calendar_month_outlined),
                selectedIcon: Icon(Icons.calendar_month_rounded),
                label: 'Jadwal',
              ),
              const NavigationDestination(
                key: Key('nav-aktivitas'),
                icon: Icon(Icons.fact_check_outlined),
                selectedIcon: Icon(Icons.fact_check_rounded),
                label: 'Aktivitas',
              ),
              NavigationDestination(
                key: const Key('nav-pesan'),
                icon: _unread > 0
                    ? _PesanBadge(
                        count: _unread,
                        child: const Icon(Icons.chat_bubble_outline_rounded),
                      )
                    : const Icon(Icons.chat_bubble_outline_rounded),
                selectedIcon: _unread > 0
                    ? _PesanBadge(
                        count: _unread,
                        child: const Icon(Icons.chat_bubble_rounded),
                      )
                    : const Icon(Icons.chat_bubble_rounded),
                label: 'Pesan',
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _PesanBadge extends StatelessWidget {
  const _PesanBadge({required this.count, required this.child});

  final int count;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Badge(
      backgroundColor: AppColors.amber,
      textColor: AppColors.yellowInk,
      label: Text(
        count > 99 ? '99+' : '$count',
        style: const TextStyle(
          fontSize: 9,
          fontWeight: FontWeight.w800,
          fontFeatures: tabularFigures,
        ),
      ),
      child: child,
    );
  }
}
