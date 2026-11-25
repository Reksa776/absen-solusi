import 'package:absensi_mobile/api/api_client.dart';
import 'package:absensi_mobile/screens/login_screen.dart';
import 'package:absensi_mobile/services/auth_service.dart';
import 'package:absensi_mobile/services/permission_onboarding_service.dart';
import 'package:absensi_mobile/services/token_store.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';

class FakeOnboardingService implements PermissionOnboardingService {
  bool requested = false;

  @override
  Future<bool> isNotificationGranted() async => true;

  @override
  Future<bool> requestNotification() async => true;

  @override
  Future<PermissionSnapshot> status() async => const PermissionSnapshot(
    location: true,
    camera: true,
    notifications: true,
    exactAlarm: true,
  );

  @override
  Future<PermissionSnapshot> requestAll() async {
    requested = true;
    return status();
  }
}

void main() {
  testWidgets('startup langsung menampilkan login tanpa layar izin kustom', (
    tester,
  ) async {
    final service = FakeOnboardingService();
    final auth = AuthService(
      api: ApiClient(
        baseUrl: 'https://absensi.test',
        tokenStore: MemoryTokenStore(),
      ),
    );

    await tester.pumpWidget(
      MaterialApp(
        home: LoginScreen(
          auth: auth,
          onLoggedIn: () {},
          permissionService: service,
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('login-email')), findsOneWidget);
    expect(find.text('Izin akses aplikasi'), findsNothing);
    expect(find.text('Lanjutkan tanpa izin'), findsNothing);
    expect(service.requested, isTrue);
  });
}
