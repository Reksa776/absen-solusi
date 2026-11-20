import 'package:material_ui/material_ui.dart';

import 'screens/home_screen.dart';
import 'screens/login_screen.dart';
import 'screens/workspace_picker_screen.dart';
import 'services/auth_service.dart';

class AbsensiApp extends StatefulWidget {
  const AbsensiApp({super.key, required this.auth});

  final AuthService auth;

  @override
  State<AbsensiApp> createState() => _AbsensiAppState();
}

class _AbsensiAppState extends State<AbsensiApp> {
  bool _picked = false;

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
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF00695C)),
        useMaterial3: true,
      ),
      home: AnimatedBuilder(
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
          return HomeScreen(auth: auth);
        },
      ),
    );
  }
}
