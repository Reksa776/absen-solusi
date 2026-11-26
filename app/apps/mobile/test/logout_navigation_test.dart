import 'dart:async';
import 'dart:convert';

import 'package:absensi_mobile/api/api_client.dart';
import 'package:absensi_mobile/app.dart';
import 'package:absensi_mobile/core/root_navigator.dart';
import 'package:absensi_mobile/services/auth_service.dart';
import 'package:absensi_mobile/services/token_store.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:material_ui/material_ui.dart';

Map<String, dynamic> twoWorkspaceProfile() => {
  'user': {
    'id': 'u1',
    'email': 'a@example.com',
    'name': 'Ayu',
    'status': 'ACTIVE',
  },
  'activeTenantId': 't1',
  'workspaces': [
    {'id': 't1', 'name': 'Tenant A', 'slug': 'tenant-a'},
    {'id': 't2', 'name': 'Tenant B', 'slug': 'tenant-b'},
  ],
};

void main() {
  testWidgets(
    'logout membersihkan sesi lokal dan mereset tumpukan rute ke Login',
    (tester) async {
      final store = MemoryTokenStore();
      await store.write('token-abc');
      final logoutRequests = <http.Request>[];
      final api = ApiClient(
        baseUrl: 'https://absensi.test',
        tokenStore: store,
        client: MockClient((request) async {
          if (request.url.path == '/api/auth/me') {
            return http.Response(jsonEncode(twoWorkspaceProfile()), 200);
          }
          if (request.url.path == '/api/auth/logout') {
            logoutRequests.add(request);
            return http.Response(jsonEncode({'ok': true}), 200);
          }
          return http.Response(jsonEncode({'ok': true}), 200);
        }),
      );
      final auth = AuthService(api: api);

      await tester.pumpWidget(AbsensiApp(auth: auth, checkForUpdates: false));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 400));
      expect(auth.isAuthenticated, isTrue);
      expect(find.byKey(const Key('workspace-t1')), findsOneWidget);

      // Simulasikan layar yang dibuka dari shell (mis. Profil) di atas rute
      // akar: setelah logout, rute ini harus ikut dibuang.
      final navigator = rootNavigatorKey.currentState!;
      unawaited(
        navigator.push(
          MaterialPageRoute<void>(
            builder: (_) =>
                const Scaffold(body: Center(child: Text('Layar bertumpuk'))),
          ),
        ),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 400));
      expect(find.text('Layar bertumpuk'), findsOneWidget);
      expect(navigator.canPop(), isTrue);

      await auth.logout();
      await tester.pumpAndSettle();

      expect(auth.isAuthenticated, isFalse);
      expect(await store.read(), isNull);
      expect(find.byKey(const Key('login-email')), findsOneWidget);
      expect(find.text('Layar bertumpuk'), findsNothing);
      // Rute akar adalah Login: tombol Back keluar dari aplikasi.
      expect(navigator.canPop(), isFalse);

      // Pembersihan server berjalan di latar tanpa menahan UI.
      await tester.pump();
      expect(
        logoutRequests.single.headers['authorization'],
        'Bearer token-abc',
      );
    },
  );
}
