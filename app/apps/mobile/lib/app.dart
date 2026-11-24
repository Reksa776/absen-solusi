import 'package:material_ui/material_ui.dart';

import 'screens/main_shell_screen.dart';
import 'screens/login_screen.dart';
import 'screens/workspace_picker_screen.dart';
import 'services/app_update_service.dart';
import 'services/auth_service.dart';
import 'theme/app_theme.dart';
import 'widgets/update_dialog.dart';

class AbsensiApp extends StatefulWidget {
  const AbsensiApp({
    super.key,
    required this.auth,
    this.updateService,
    this.checkForUpdates = true,
  });

  final AuthService auth;
  final AppUpdateService? updateService;
  final bool checkForUpdates;

  @override
  State<AbsensiApp> createState() => _AbsensiAppState();
}

class _AbsensiAppState extends State<AbsensiApp> {
  bool _picked = false;
  late final AppUpdateService _updates =
      widget.updateService ?? AppUpdateService();

  @override
  void initState() {
    super.initState();
    widget.auth.restore();
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Absensi',
      debugShowCheckedModeBanner: false,
      theme: buildAppTheme(),
      home: _AppUpdateGate(
        service: _updates,
        enabled: widget.checkForUpdates,
        child: AnimatedBuilder(
          animation: widget.auth,
          builder: (context, _) {
            final auth = widget.auth;
            if (auth.isLoading && !auth.isAuthenticated) {
              return const Scaffold(
                body: Center(child: CircularProgressIndicator()),
              );
            }
            if (!auth.isAuthenticated) {
              return LoginScreen(
                auth: auth,
                onLoggedIn: () => setState(() => _picked = false),
              );
            }
            final needsPicker =
                !_picked && (auth.profile?.workspaces.length ?? 0) > 1;
            if (needsPicker) {
              return WorkspacePickerScreen(
                auth: auth,
                onSelected: () => setState(() => _picked = true),
              );
            }
            return MainShellScreen(auth: auth, updateService: _updates);
          },
        ),
      ),
    );
  }
}

/// Cek pembaruan sekali setelah layar pertama tampil. Kegagalan jaringan
/// diabaikan agar login dan absensi tidak pernah terhalang.
class _AppUpdateGate extends StatefulWidget {
  const _AppUpdateGate({
    required this.service,
    required this.enabled,
    required this.child,
  });

  final AppUpdateService service;
  final bool enabled;
  final Widget child;

  @override
  State<_AppUpdateGate> createState() => _AppUpdateGateState();
}

class _AppUpdateGateState extends State<_AppUpdateGate> {
  bool _checked = false;

  @override
  void initState() {
    super.initState();
    if (!widget.enabled) return;
    WidgetsBinding.instance.addPostFrameCallback((_) => _check());
  }

  Future<void> _check() async {
    if (_checked || !mounted) return;
    _checked = true;
    try {
      final result = await widget.service.checkForUpdate();
      if (result == null || !mounted) return;
      await UpdateAvailableDialog.show(
        context,
        service: widget.service,
        result: result,
      );
    } catch (_) {
      // Pemeriksaan otomatis bersifat opsional.
    }
  }

  @override
  Widget build(BuildContext context) => widget.child;
}
