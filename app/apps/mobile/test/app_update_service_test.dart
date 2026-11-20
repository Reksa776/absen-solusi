import 'dart:convert';
import 'dart:io';

import 'package:absensi_mobile/services/app_update_service.dart';
import 'package:absensi_mobile/widgets/update_dialog.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:material_ui/material_ui.dart';

AppUpdateService buildService(MockClient client, Directory directory) {
  return AppUpdateService(
    baseUrl: 'https://absensi.test',
    client: client,
    cacheDirectory: () async => directory,
  );
}

const release = AppVersionInfo(
  latestVersion: '1.2.0',
  buildNumber: 5,
  forceUpdate: false,
  changelog: 'Perbaikan kamera selfie depan.',
  downloadUrl: '',
);

void main() {
  late Directory directory;

  setUp(() async {
    directory = await Directory.systemTemp.createTemp('absensi-update-test');
  });

  tearDown(() async {
    if (await directory.exists()) await directory.delete(recursive: true);
  });

  test('membaca metadata rilis dan memakai endpoint APK default', () async {
    final client = MockClient((request) async {
      expect(request.url.path, '/api/mobile/version');
      return http.Response(
        jsonEncode({
          'latestVersion': '1.2.0',
          'buildNumber': 5,
          'forceUpdate': true,
          'changelog': 'Perbaikan kamera',
          'downloadUrl': '',
        }),
        200,
      );
    });

    final latest = await buildService(client, directory).latest();
    expect(latest.latestVersion, '1.2.0');
    expect(latest.buildNumber, 5);
    expect(latest.forceUpdate, isTrue);
    expect(
      buildService(client, directory).downloadUri(latest).toString(),
      'https://absensi.test/api/mobile/apk/latest',
    );
  });

  test('downloadUrl relatif diselesaikan terhadap base URL', () {
    final uri = buildService(
      MockClient((_) async => http.Response('{}', 200)),
      directory,
    ).downloadUri(
      const AppVersionInfo(
        latestVersion: '1.2.0',
        buildNumber: 5,
        forceUpdate: false,
        changelog: '',
        downloadUrl: '/api/mobile/apk/latest',
      ),
    );
    expect(uri.toString(), 'https://absensi.test/api/mobile/apk/latest');
  });

  test('mengunduh APK ke cache dan melaporkan progres penuh', () async {
    final payload = List<int>.generate(64 * 1024, (index) => index % 251);
    final client = MockClient((request) async {
      expect(request.url.path, '/api/mobile/apk/latest');
      return http.Response.bytes(
        payload,
        200,
        headers: {'content-type': 'application/vnd.android.package-archive'},
      );
    });

    final progress = <double>[];
    final file = await buildService(client, directory).download(
      release,
      onProgress: progress.add,
    );

    expect(await file.readAsBytes(), payload);
    expect(file.path, contains('absensi-mobile-1.2.0.apk'));
    expect(progress, isNotEmpty);
    expect(progress.last, 1.0);
  });

  test('status gagal menghasilkan AppUpdateException', () async {
    final client = MockClient((_) async => http.Response('{}', 404));
    expect(
      () => buildService(client, directory).download(release),
      throwsA(isA<AppUpdateException>()),
    );
  });

  test('metadata dengan build lebih lama tidak dianggap pembaruan', () async {
    final client = MockClient(
      (_) async => http.Response(
        jsonEncode({
          'latestVersion': '1.0.0',
          'buildNumber': 1,
          'forceUpdate': false,
          'changelog': '',
          'downloadUrl': '',
        }),
        200,
      ),
    );
    final result = await buildService(client, directory).checkForUpdate();
    expect(result, isNull);
  });

  testWidgets('dialog menampilkan versi, changelog, dan tombol nanti', (
    tester,
  ) async {
    final service = buildService(
      MockClient((_) async => http.Response('{}', 200)),
      directory,
    );
    const result = AppUpdateResult(
      info: release,
      installed: InstalledAppInfo(version: '1.0.0', buildNumber: 1),
    );

    await tester.pumpWidget(
      MaterialApp(
        home: Builder(
          builder: (context) => TextButton(
            onPressed: () => UpdateAvailableDialog.show(
              context,
              service: service,
              result: result,
            ),
            child: const Text('buka'),
          ),
        ),
      ),
    );
    await tester.tap(find.text('buka'));
    await tester.pumpAndSettle();

    expect(find.text('Pembaruan tersedia'), findsOneWidget);
    expect(find.textContaining('1.2.0'), findsWidgets);
    expect(find.text('Perbaikan kamera selfie depan.'), findsOneWidget);
    expect(find.byKey(const Key('update-later')), findsOneWidget);
    expect(find.byKey(const Key('update-now')), findsOneWidget);
  });

  testWidgets('pembaruan wajib menyembunyikan tombol nanti', (tester) async {
    final service = buildService(
      MockClient((_) async => http.Response('{}', 200)),
      directory,
    );
    const result = AppUpdateResult(
      info: AppVersionInfo(
        latestVersion: '1.2.0',
        buildNumber: 5,
        forceUpdate: true,
        changelog: '',
        downloadUrl: '',
      ),
      installed: InstalledAppInfo(version: '1.0.0', buildNumber: 1),
    );

    await tester.pumpWidget(
      MaterialApp(
        home: Builder(
          builder: (context) => TextButton(
            onPressed: () => UpdateAvailableDialog.show(
              context,
              service: service,
              result: result,
            ),
            child: const Text('buka'),
          ),
        ),
      ),
    );
    await tester.tap(find.text('buka'));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('update-later')), findsNothing);
    expect(find.textContaining('wajib'), findsWidgets);
  });
}
