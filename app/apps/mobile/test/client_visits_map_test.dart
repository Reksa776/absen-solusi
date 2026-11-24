import 'dart:convert';

import 'package:absensi_mobile/api/api_client.dart';
import 'package:absensi_mobile/screens/client_visits_screen.dart';
import 'package:absensi_mobile/services/auth_service.dart';
import 'package:absensi_mobile/services/location_service.dart';
import 'package:absensi_mobile/services/token_store.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:material_ui/material_ui.dart';

const officeSession = {
  'token': 'token-abc',
  'user': {
    'id': 'u1',
    'email': 'a@example.com',
    'name': 'Ayu',
    'status': 'ACTIVE',
  },
  'activeTenantId': 't1',
  'workspaces': [
    {'id': 't1', 'name': 'Tenant A', 'slug': 'tenant-a'},
  ],
};

final transparentPng = base64Decode(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
);

class FakeMapTileProvider extends TileProvider {
  @override
  ImageProvider getImage(TileCoordinates coordinates, TileLayer options) {
    return MemoryImage(transparentPng);
  }
}

class FakeLocation extends LocationService {
  @override
  Future<GpsReading> current() async => const GpsReading(
    latitude: -6.74381,
    longitude: 108.551559,
    accuracyMeters: 6,
    isMocked: false,
  );
}

Future<AuthService> buildAuth() async {
  final auth = AuthService(
    api: ApiClient(
      baseUrl: 'https://absensi.test',
      tokenStore: MemoryTokenStore(),
      client: MockClient((request) async {
        if (request.url.path == '/api/auth/login') {
          return http.Response(jsonEncode(officeSession), 200);
        }
        if (request.url.path == '/api/mobile/client-visits') {
          return http.Response(
            jsonEncode({
              'date': DateTime.now().toIso8601String().substring(0, 10),
              'schedules': [],
              'history': [],
            }),
            200,
          );
        }
        return http.Response(jsonEncode({'ok': true}), 200);
      }),
    ),
  );
  await auth.login('a@example.com', 'benar');
  return auth;
}

void main() {
  testWidgets('kunjungan client merender peta dan pin GPS aktif', (
    tester,
  ) async {
    final auth = await buildAuth();
    await tester.pumpWidget(
      MaterialApp(
        home: ClientVisitsScreen(
          auth: auth,
          locationService: FakeLocation(),
          tileProvider: FakeMapTileProvider(),
        ),
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 500));

    expect(find.byKey(const Key('adhoc-map')), findsOneWidget);
    expect(find.byType(FlutterMap), findsOneWidget);
    expect(find.byKey(const Key('adhoc-map-pin')), findsOneWidget);
    expect(find.byKey(const Key('adhoc-open-maps')), findsOneWidget);
    expect(find.textContaining('-6.743810'), findsOneWidget);
  });
}
