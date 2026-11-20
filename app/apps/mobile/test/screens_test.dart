import 'dart:convert';

import 'package:absensi_mobile/api/api_client.dart';
import 'package:absensi_mobile/screens/home_screen.dart';
import 'package:absensi_mobile/screens/login_screen.dart';
import 'package:absensi_mobile/screens/workspace_picker_screen.dart';
import 'package:absensi_mobile/services/auth_service.dart';
import 'package:absensi_mobile/services/token_store.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:material_ui/material_ui.dart';

Map<String, dynamic> profile({int workspaces = 2}) => {
  'user': {
    'id': 'u1',
    'email': 'a@example.com',
    'name': 'Ayu',
    'status': 'ACTIVE',
  },
  'activeTenantId': 't1',
  'workspaces': [
    {'id': 't1', 'name': 'Tenant A', 'slug': 'tenant-a'},
    if (workspaces > 1) {'id': 't2', 'name': 'Tenant B', 'slug': 'tenant-b'},
  ],
};

ApiClient mockApi({bool loginFails = false, int workspaces = 2}) {
  final store = MemoryTokenStore();
  return ApiClient(
    baseUrl: 'https://absensi.test',
    tokenStore: store,
    client: MockClient((request) async {
      if (request.url.path == '/api/auth/login') {
        if (loginFails) {
          return http.Response(
            jsonEncode({
              'error': {'code': 'INVALID_CREDENTIALS', 'message': 'salah'},
            }),
            401,
          );
        }
        return http.Response(
          jsonEncode({...profile(workspaces: workspaces), 'token': 'token-abc'}),
          200,
        );
      }
      if (request.url.path == '/api/auth/active-workspace') {
        return http.Response(
          jsonEncode({
            'activeTenantId': 't2',
            'workspace': {'id': 't2', 'name': 'Tenant B', 'slug': 'tenant-b'},
            'roleKeys': ['VIEWER'],
          }),
          200,
        );
      }
      if (request.url.path == '/api/auth/me') {
        return http.Response(
          jsonEncode({
            ...profile(workspaces: workspaces),
            'activeTenantId': request.headers['authorization'] == null ? 't1' : 't2',
          }),
          200,
        );
      }
      if (request.url.path == '/api/auth/logout') {
        return http.Response(jsonEncode({'ok': true}), 200);
      }
      if (request.url.path == '/api/attendance/office') {
        return http.Response(
          jsonEncode({
            'office': {
              'id': 'o1',
              'name': 'HQ',
              'latitude': -6.2,
              'longitude': 106.8,
              'radiusMeters': 100,
              'timezone': 'Asia/Jakarta',
              'workStart': '09:00',
              'workEnd': '17:00',
              'isActive': true,
            },
          }),
          200,
        );
      }
      if (request.url.path == '/api/attendance/me') {
        return http.Response(jsonEncode({'attendance': []}), 200);
      }
      return http.Response('{}', 404);
    }),
  );
}

Widget wrap(Widget child) => MaterialApp(home: child);

void main() {
  testWidgets('login merender field dan menampilkan error', (tester) async {
    final auth = AuthService(api: mockApi(loginFails: true));
    await tester.pumpWidget(
      wrap(LoginScreen(auth: auth, onLoggedIn: () {})),
    );
    expect(find.text('Masuk'), findsOneWidget);
    expect(find.byKey(const Key('login-email')), findsOneWidget);
    expect(find.byKey(const Key('login-password')), findsOneWidget);

    await tester.enterText(find.byKey(const Key('login-email')), 'a@example.com');
    await tester.enterText(find.byKey(const Key('login-password')), 'salah');
    await tester.tap(find.byKey(const Key('login-submit')));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('login-error')), findsOneWidget);
    expect(find.text('Email atau password salah.'), findsOneWidget);
  });

  testWidgets('login sukses memanggil callback', (tester) async {
    var loggedIn = false;
    final auth = AuthService(api: mockApi());
    await tester.pumpWidget(
      wrap(LoginScreen(auth: auth, onLoggedIn: () => loggedIn = true)),
    );

    await tester.enterText(find.byKey(const Key('login-email')), 'a@example.com');
    await tester.enterText(find.byKey(const Key('login-password')), 'benar');
    await tester.tap(find.byKey(const Key('login-submit')));
    await tester.pumpAndSettle();

    expect(loggedIn, isTrue);
    expect(auth.isAuthenticated, isTrue);
  });

  testWidgets('workspace picker memilih workspace dan logout', (tester) async {
    final auth = AuthService(api: mockApi());
    await auth.login('a@example.com', 'benar');
    var selected = false;

    await tester.pumpWidget(
      wrap(
        WorkspacePickerScreen(
          auth: auth,
          onSelected: () => selected = true,
        ),
      ),
    );
    expect(find.text('Tenant A'), findsOneWidget);
    expect(find.text('Tenant B'), findsOneWidget);

    await tester.tap(find.byKey(const Key('workspace-t2')));
    await tester.pumpAndSettle();
    expect(selected, isTrue);
    expect(auth.activeWorkspace?.name, 'Tenant B');

    await tester.tap(find.byKey(const Key('workspace-logout')));
    await tester.pumpAndSettle();
    expect(auth.isAuthenticated, isFalse);
  });

  testWidgets('home menampilkan workspace aktif dan logout', (tester) async {
    final auth = AuthService(api: mockApi(workspaces: 1));
    await auth.login('a@example.com', 'benar');
    await tester.pumpWidget(wrap(HomeScreen(auth: auth)));
    await tester.pumpAndSettle();

    expect(find.textContaining('Ayu'), findsOneWidget);
    expect(find.textContaining('Tenant A'), findsOneWidget);

    await tester.tap(find.byKey(const Key('home-logout')));
    await tester.pumpAndSettle();
    expect(auth.isAuthenticated, isFalse);
  });
}
