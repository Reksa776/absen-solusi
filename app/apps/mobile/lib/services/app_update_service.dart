import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;
import 'package:package_info_plus/package_info_plus.dart';
import 'package:path_provider/path_provider.dart';

import '../core/app_config.dart';

/// Metadata rilis yang diterbitkan server (`GET /api/mobile/version`).
class AppVersionInfo {
  const AppVersionInfo({
    required this.latestVersion,
    required this.buildNumber,
    required this.forceUpdate,
    required this.changelog,
    required this.downloadUrl,
  });

  factory AppVersionInfo.fromJson(Map<String, dynamic> json) {
    final version = json['latestVersion'];
    final build = json['buildNumber'];
    return AppVersionInfo(
      latestVersion: version is String && version.trim().isNotEmpty
          ? version.trim()
          : '1.0.0',
      buildNumber: build is int
          ? build
          : int.tryParse('${build ?? ''}') ?? 0,
      forceUpdate: json['forceUpdate'] == true,
      changelog: json['changelog'] is String
          ? (json['changelog'] as String).trim()
          : '',
      downloadUrl: json['downloadUrl'] is String
          ? (json['downloadUrl'] as String).trim()
          : '',
    );
  }

  final String latestVersion;
  final int buildNumber;
  final bool forceUpdate;
  final String changelog;
  final String downloadUrl;

  bool isNewerThan(int installedBuildNumber) =>
      buildNumber > installedBuildNumber;
}

/// Versi yang benar-benar terpasang di perangkat.
class InstalledAppInfo {
  const InstalledAppInfo({required this.version, required this.buildNumber});

  final String version;
  final int buildNumber;

  static const InstalledAppInfo unknown = InstalledAppInfo(
    version: '1.0.0',
    buildNumber: 1,
  );
}

class AppUpdateResult {
  const AppUpdateResult({required this.info, required this.installed});

  final AppVersionInfo info;
  final InstalledAppInfo installed;
}

class AppUpdateException implements Exception {
  const AppUpdateException(this.message);

  final String message;

  @override
  String toString() => message;
}

class AppUpdateService {
  AppUpdateService({
    http.Client? client,
    String? baseUrl,
    Future<Directory> Function()? cacheDirectory,
  }) : _client = client ?? http.Client(),
       baseUrl = baseUrl ?? AppConfig.apiBaseUrl,
       _cacheDirectory = cacheDirectory ?? getTemporaryDirectory;

  final http.Client _client;
  final String baseUrl;
  final Future<Directory> Function() _cacheDirectory;

  Future<InstalledAppInfo> installed() async {
    try {
      final info = await PackageInfo.fromPlatform();
      return InstalledAppInfo(
        version: info.version.isEmpty ? '1.0.0' : info.version,
        buildNumber: int.tryParse(info.buildNumber) ?? 1,
      );
    } catch (_) {
      // Plugin tidak tersedia (mis. unit test): anggap build 1.
      return InstalledAppInfo.unknown;
    }
  }

  Future<AppVersionInfo> latest() async {
    final response = await _client.get(
      Uri.parse('$baseUrl/api/mobile/version'),
      headers: const {'accept': 'application/json'},
    );
    if (response.statusCode != 200) {
      throw AppUpdateException(
        'Server pembaruan tidak tersedia (${response.statusCode}).',
      );
    }
    final decoded = jsonDecode(response.body);
    if (decoded is! Map<String, dynamic>) {
      throw const AppUpdateException('Metadata pembaruan tidak valid.');
    }
    return AppVersionInfo.fromJson(decoded);
  }

  /// Null berarti aplikasi sudah memakai build terbaru.
  Future<AppUpdateResult?> checkForUpdate() async {
    final installedInfo = await installed();
    final latestInfo = await latest();
    if (!latestInfo.isNewerThan(installedInfo.buildNumber)) return null;
    return AppUpdateResult(info: latestInfo, installed: installedInfo);
  }

  Uri downloadUri(AppVersionInfo info) {
    if (info.downloadUrl.isEmpty) {
      return Uri.parse('$baseUrl/api/mobile/apk/latest');
    }
    final parsed = Uri.parse(info.downloadUrl);
    if (parsed.hasScheme) return parsed;
    return Uri.parse(baseUrl).resolveUri(parsed);
  }

  Future<File> download(
    AppVersionInfo info, {
    void Function(double progress)? onProgress,
  }) async {
    final response = await _client.send(http.Request('GET', downloadUri(info)));
    if (response.statusCode != 200) {
      throw AppUpdateException('Unduhan APK gagal (${response.statusCode}).');
    }
    final directory = Directory('${(await _cacheDirectory()).path}/apk_release');
    await directory.create(recursive: true);
    final file = File('${directory.path}/${_fileName(info)}');
    final sink = file.openWrite();
    final total = response.contentLength ?? 0;
    var received = 0;
    try {
      await for (final chunk in response.stream) {
        sink.add(chunk);
        received += chunk.length;
        if (total > 0) {
          onProgress?.call((received / total).clamp(0.0, 1.0));
        }
      }
      await sink.flush();
    } catch (_) {
      await sink.close();
      if (await file.exists()) await file.delete();
      throw const AppUpdateException('Unduhan terputus. Coba lagi.');
    }
    await sink.close();
    if (total > 0 && received != total) {
      if (await file.exists()) await file.delete();
      throw const AppUpdateException('Unduhan tidak lengkap. Coba lagi.');
    }
    onProgress?.call(1);
    return file;
  }

  String _fileName(AppVersionInfo info) {
    final safe = info.latestVersion.replaceAll(RegExp(r'[^0-9A-Za-z._-]'), '-');
    return 'absensi-mobile-$safe.apk';
  }
}
