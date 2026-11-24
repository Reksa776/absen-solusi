import 'dart:convert';
import 'dart:typed_data';

import 'package:absensi_mobile/api/api_client.dart';
import 'package:absensi_mobile/screens/home_screen.dart';
import 'package:absensi_mobile/services/auth_service.dart';
import 'package:absensi_mobile/services/location_service.dart';
import 'package:absensi_mobile/services/token_store.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:material_ui/material_ui.dart';

const officeJson = {
  'id': 'o1',
  'name': 'HQ',
  'latitude': -6.2,
  'longitude': 106.8,
  'radiusMeters': 100,
  'timezone': 'Asia/Jakarta',
  'workStart': '09:00',
  'workEnd': '17:00',
  'isActive': true,
};

Map<String, dynamic> sessionJson() => {
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

class FakeLocation extends LocationService {
  FakeLocation(this.callback);

  final Future<GpsReading> Function() callback;
  int calls = 0;

  @override
  Future<GpsReading> current() {
    calls++;
    return callback();
  }
}

class AttendanceMock {
  AttendanceMock({this.checkInStatus = 201, this.checkInCode = ''});

  final int checkInStatus;
  final String checkInCode;
  final List<http.Request> requests = [];

  late ApiClient client;
  late AuthService auth;

  Future<void> init() async {
    client = ApiClient(
      baseUrl: 'https://absensi.test',
      tokenStore: MemoryTokenStore(),
      client: MockClient((request) async {
        requests.add(request);
        final path = request.url.path;
        if (path == '/api/auth/login') {
          return http.Response(jsonEncode(sessionJson()), 200);
        }
        if (path == '/api/attendance/office') {
          return http.Response(jsonEncode({'office': officeJson}), 200);
        }
        if (path == '/api/attendance/me') {
          return http.Response(jsonEncode({'attendance': []}), 200);
        }
        if (path == '/api/attendance/check-in') {
          if (checkInStatus != 201) {
            return http.Response(
              jsonEncode({
                'error': {'code': checkInCode, 'message': 'Absensi ditolak.'},
              }),
              checkInStatus,
            );
          }
          return http.Response(
            jsonEncode({
              'id': 'a1',
              'type': 'CHECK_IN',
              'timestampServer': '2026-11-19T03:00:00.000Z',
              'distanceMeters': 3,
              'accuracyMeters': 5,
              'isSuspicious': false,
              'photoUrl': '/uploads/attendance/a.jpg',
            }),
            201,
          );
        }
        if (path == '/api/mobile/schedule') {
          return http.Response(
            jsonEncode({
              'office': {
                'id': 'o1',
                'name': 'HQ',
                'timezone': 'Asia/Jakarta',
                'radiusMeters': 100,
                'workStart': '09:00',
                'workEnd': '17:00',
              },
              'workPattern': {
                'id': 'p1',
                'name': 'Pola kantor',
                'timezone': 'Asia/Jakarta',
              },
              'weekly': [],
              'holidays': [],
            }),
            200,
          );
        }
        return http.Response(jsonEncode({'ok': true}), 200);
      }),
    );
    auth = AuthService(api: client);
    await auth.login('a@example.com', 'benar');
  }
}

Widget shell(Widget child) => MaterialApp(home: child);

void main() {
  testWidgets('home fokus pada jam, tombol absen, dan status hari ini', (
    tester,
  ) async {
    final mock = AttendanceMock();
    await mock.init();
    final location = FakeLocation(
      () async => const GpsReading(
        latitude: -6.2,
        longitude: 106.8,
        accuracyMeters: 5,
        isMocked: false,
      ),
    );
    await tester.pumpWidget(
      shell(HomeScreen(auth: mock.auth, locationService: location)),
    );
    await tester.pumpAndSettle();

    expect(find.text('Status hari ini'), findsOneWidget);
    expect(find.text('Presensi Masuk'), findsOneWidget);
    expect(find.byKey(const Key('home-office')), findsNothing);
    // GPS tidak diminta sebelum tombol absen ditekan.
    expect(location.calls, 0);
  });

  testWidgets('GPS akurasi buruk memblokir pengiriman dan kamera', (
    tester,
  ) async {
    final mock = AttendanceMock();
    await mock.init();
    final location = FakeLocation(
      () async => const GpsReading(
        latitude: -6.2,
        longitude: 106.8,
        accuracyMeters: 150,
        isMocked: false,
      ),
    );
    await tester.pumpWidget(
      shell(
        HomeScreen(
          auth: mock.auth,
          locationService: location,
          photoTaker: (_) async => Uint8List.fromList([1]),
        ),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('attendance-submit')));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('accuracy-warning')), findsOneWidget);
    expect(
      mock.requests.any(
        (request) => request.url.path == '/api/attendance/check-in',
      ),
      isFalse,
    );
  });

  testWidgets('GPS permission ditolak menampilkan pesan', (tester) async {
    final mock = AttendanceMock();
    await mock.init();
    final location = FakeLocation(
      () async =>
          throw const LocationUnavailableException('Izin lokasi ditolak.'),
    );
    await tester.pumpWidget(
      shell(HomeScreen(auth: mock.auth, locationService: location)),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('attendance-submit')));
    await tester.pumpAndSettle();
    expect(find.text('Izin lokasi ditolak.'), findsOneWidget);
    expect(
      mock.requests.any(
        (request) => request.url.path == '/api/attendance/check-in',
      ),
      isFalse,
    );
  });

  testWidgets('mock location memblokir absensi', (tester) async {
    final mock = AttendanceMock();
    await mock.init();
    final location = FakeLocation(
      () async => const GpsReading(
        latitude: -6.2,
        longitude: 106.8,
        accuracyMeters: 5,
        isMocked: true,
      ),
    );
    await tester.pumpWidget(
      shell(
        HomeScreen(
          auth: mock.auth,
          locationService: location,
          photoTaker: (_) async => Uint8List.fromList([1]),
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('attendance-submit')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('mock-warning')), findsOneWidget);
    expect(
      mock.requests.any(
        (request) => request.url.path == '/api/attendance/check-in',
      ),
      isFalse,
    );
  });

  testWidgets('check-in mengambil lokasi lalu mengirim foto', (tester) async {
    final mock = AttendanceMock();
    await mock.init();
    final location = FakeLocation(
      () async => const GpsReading(
        latitude: -6.2,
        longitude: 106.8,
        accuracyMeters: 5,
        isMocked: false,
      ),
    );
    await tester.pumpWidget(
      shell(
        HomeScreen(
          auth: mock.auth,
          locationService: location,
          photoTaker: (_) async => Uint8List.fromList([1, 2, 3]),
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('attendance-submit')));
    await tester.pumpAndSettle();

    expect(location.calls, 1);
    expect(
      mock.requests.any(
        (request) => request.url.path == '/api/attendance/check-in',
      ),
      isTrue,
    );
    expect(find.text('Check-in berhasil dicatat.'), findsOneWidget);
  });

  testWidgets('menolak kirim saat foto dibatalkan', (tester) async {
    final mock = AttendanceMock();
    await mock.init();
    final location = FakeLocation(
      () async => const GpsReading(
        latitude: -6.2,
        longitude: 106.8,
        accuracyMeters: 5,
        isMocked: false,
      ),
    );
    await tester.pumpWidget(
      shell(
        HomeScreen(
          auth: mock.auth,
          locationService: location,
          photoTaker: (_) async => null,
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('attendance-submit')));
    await tester.pumpAndSettle();
    expect(
      mock.requests.any(
        (request) => request.url.path == '/api/attendance/check-in',
      ),
      isFalse,
    );
  });

  testWidgets('error GEOFENCE dari server ditampilkan jelas', (tester) async {
    final mock = AttendanceMock(
      checkInStatus: 403,
      checkInCode: 'GEOFENCE_VIOLATION',
    );
    await mock.init();
    final location = FakeLocation(
      () async => const GpsReading(
        latitude: -6.2,
        longitude: 106.8,
        accuracyMeters: 5,
        isMocked: false,
      ),
    );
    await tester.pumpWidget(
      shell(
        HomeScreen(
          auth: mock.auth,
          locationService: location,
          photoTaker: (_) async => Uint8List.fromList([1]),
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('attendance-submit')));
    await tester.pumpAndSettle();
    expect(find.text('Anda berada di luar radius kantor.'), findsWidgets);
  });
}
