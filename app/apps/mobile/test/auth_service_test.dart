import 'dart:convert';

import 'package:absensi_mobile/api/api_client.dart';
import 'package:absensi_mobile/services/auth_service.dart';
import 'package:absensi_mobile/services/token_store.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

Map<String, dynamic> profileJson({List<Map<String, dynamic>>? workspaces}) {
  return {
    'user': {
      'id': 'u1',
      'email': 'a@example.com',
      'name': 'A',
      'status': 'ACTIVE',
    },
    'activeTenantId': 't1',
    'workspaces':
        workspaces ??
        [
          {'id': 't1', 'name': 'Tenant A', 'slug': 'tenant-a'},
        ],
  };
}

void main() {
  test('login menyimpan sesi dan logout menghapus token', () async {
    final store = MemoryTokenStore();
    final client = ApiClient(
      baseUrl: 'https://absensi.test',
      tokenStore: store,
      client: MockClient((request) async {
        if (request.url.path == '/api/auth/login') {
          return http.Response(
            jsonEncode({...profileJson(), 'token': 'token-abc'}),
            200,
          );
        }
        if (request.url.path == '/api/auth/logout') {
          return http.Response(jsonEncode({'ok': true}), 200);
        }
        return http.Response('{}', 404);
      }),
    );
    final auth = AuthService(api: client);

    expect(await auth.login('a@example.com', 'rahasia'), isTrue);
    expect(auth.isAuthenticated, isTrue);
    expect(auth.activeWorkspace?.name, 'Tenant A');
    expect(await store.read(), 'token-abc');

    await auth.logout();
    expect(auth.isAuthenticated, isFalse);
    expect(await store.read(), isNull);
  });

  test('login gagal menampilkan pesan yang dapat dibaca', () async {
    final auth = AuthService(
      api: ApiClient(
        baseUrl: 'https://absensi.test',
        tokenStore: MemoryTokenStore(),
        client: MockClient(
          (_) async => http.Response(
            jsonEncode({
              'error': {'code': 'INVALID_CREDENTIALS', 'message': 'salah'},
            }),
            401,
          ),
        ),
      ),
    );

    expect(await auth.login('a@example.com', 'salah'), isFalse);
    expect(auth.isAuthenticated, isFalse);
    expect(auth.error, 'Email atau password salah.');
  });
}
