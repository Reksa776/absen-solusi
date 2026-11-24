import 'package:absensi_mobile/services/permission_onboarding_service.dart';
import 'package:absensi_mobile/widgets/permission_gate.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';

class FakeOnboardingService implements PermissionOnboardingService {
  FakeOnboardingService({required this.initial, required this.afterRequest});

  final PermissionSnapshot initial;
  final PermissionSnapshot afterRequest;
  bool requested = false;

  @override
  Future<PermissionSnapshot> status() async => initial;

  @override
  Future<PermissionSnapshot> requestAll() async {
    requested = true;
    return afterRequest;
  }
}

const granted = PermissionSnapshot(
  location: true,
  camera: true,
  notifications: true,
  exactAlarm: true,
);
const missing = PermissionSnapshot(
  location: false,
  camera: true,
  notifications: false,
  exactAlarm: false,
);

void main() {
  testWidgets('gerbang izin muncul saat izin wajib belum diberikan', (
    tester,
  ) async {
    final service = FakeOnboardingService(
      initial: missing,
      afterRequest: granted,
    );
    await tester.pumpWidget(
      MaterialApp(
        home: PermissionGate(
          service: service,
          enabled: true,
          child: const Text('Masuk'),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('permission-onboarding')), findsOneWidget);
    expect(find.text('Lokasi GPS'), findsOneWidget);
    expect(find.text('Kamera'), findsOneWidget);
    expect(find.text('Notifikasi & alarm'), findsOneWidget);
    expect(find.textContaining('Belum diberikan'), findsOneWidget);
    expect(find.text('Masuk'), findsNothing);

    await tester.tap(find.byKey(const Key('permission-allow-all')));
    await tester.pumpAndSettle();

    expect(service.requested, isTrue);
    expect(find.byKey(const Key('permission-onboarding')), findsNothing);
    expect(find.text('Masuk'), findsOneWidget);
  });

  testWidgets('gerbang izin melewati layar bila izin sudah lengkap', (
    tester,
  ) async {
    final service = FakeOnboardingService(
      initial: granted,
      afterRequest: granted,
    );
    await tester.pumpWidget(
      MaterialApp(
        home: PermissionGate(
          service: service,
          enabled: true,
          child: const Text('Login'),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('permission-onboarding')), findsNothing);
    expect(find.text('Login'), findsOneWidget);
  });
}
