import 'package:material_ui/material_ui.dart';

import '../screens/permission_onboarding_screen.dart';
import '../services/permission_onboarding_service.dart';
import '../theme/app_theme.dart';

class PermissionGate extends StatefulWidget {
  const PermissionGate({
    super.key,
    required this.service,
    required this.enabled,
    required this.child,
  });

  final PermissionOnboardingService service;
  final bool enabled;
  final Widget child;

  @override
  State<PermissionGate> createState() => _PermissionGateState();
}

class _PermissionGateState extends State<PermissionGate> {
  bool _checking = true;
  bool _needsOnboarding = false;
  PermissionSnapshot? _initialStatus;

  @override
  void initState() {
    super.initState();
    _check();
  }

  Future<void> _check() async {
    if (!widget.enabled) {
      if (mounted) {
        setState(() {
          _checking = false;
          _needsOnboarding = false;
        });
      }
      return;
    }
    final status = await widget.service.status();
    if (!mounted) return;
    setState(() {
      _initialStatus = status;
      _needsOnboarding = !status.allGranted;
      _checking = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    if (_checking) {
      return const Scaffold(
        backgroundColor: AppColors.canvas,
        body: Center(child: CircularProgressIndicator()),
      );
    }
    if (_needsOnboarding) {
      return PermissionOnboardingScreen(
        service: widget.service,
        initialStatus: _initialStatus,
        onFinished: () {
          if (mounted) setState(() => _needsOnboarding = false);
        },
      );
    }
    return widget.child;
  }
}
