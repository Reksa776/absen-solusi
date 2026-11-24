import 'package:absensi_mobile/api/api_client.dart';
import 'package:absensi_mobile/app.dart';
import 'package:absensi_mobile/services/auth_service.dart';
import 'package:absensi_mobile/services/token_store.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('tanpa token aplikasi menampilkan login', (tester) async {
    final auth = AuthService(
      api: ApiClient(
        baseUrl: 'https://absensi.test',
        tokenStore: MemoryTokenStore(),
      ),
    );
    await tester.pumpWidget(
      AbsensiApp(auth: auth, checkPermissions: false, checkForUpdates: false),
    );
    await tester.pumpAndSettle();
    expect(find.text('Masuk'), findsOneWidget);
  });
}
