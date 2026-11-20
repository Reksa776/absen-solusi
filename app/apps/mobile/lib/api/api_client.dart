import 'dart:convert';
import 'dart:typed_data';

import 'package:http/http.dart' as http;
import 'package:http_parser/http_parser.dart';

import '../core/app_config.dart';
import '../models/attendance_log.dart';
import '../models/correction.dart';
import '../models/employee_request.dart';
import '../models/in_app_notification.dart';
import '../models/office_location.dart';
import '../models/offline_attendance.dart';
import '../models/schedule.dart';
import '../models/session.dart';
import '../services/token_store.dart';

class ApiException implements Exception {
  const ApiException(this.statusCode, this.code, this.message);

  final int statusCode;
  final String code;
  final String message;

  @override
  String toString() => '$code ($statusCode): $message';
}

class ApiClient {
  ApiClient({
    http.Client? client,
    TokenStore? tokenStore,
    String? baseUrl,
  }) : _client = client ?? http.Client(),
       _tokenStore = tokenStore ?? SecureTokenStore(),
       baseUrl = baseUrl ?? AppConfig.apiBaseUrl;

  final http.Client _client;
  final TokenStore _tokenStore;
  final String baseUrl;

  Future<String?> readToken() => _tokenStore.read();

  Future<void> clearToken() => _tokenStore.clear();

  Future<AuthResult> login(String email, String password) async {
    final response = await _client.post(
      Uri.parse('$baseUrl/api/auth/login'),
      headers: const {
        'content-type': 'application/json',
        'x-auth-mode': 'bearer',
      },
      body: jsonEncode({'email': email, 'password': password}),
    );
    final json = _decodeObject(response);
    final result = AuthResult.fromJson(json);
    if (result.token.isEmpty) {
      throw const ApiException(500, 'INVALID_RESPONSE', 'Token login tidak diterima');
    }
    await _tokenStore.write(result.token);
    return result;
  }

  Future<SessionProfile> me() async {
    final response = await _client.get(
      Uri.parse('$baseUrl/api/auth/me'),
      headers: await _authHeaders(),
    );
    return SessionProfile.fromJson(_decodeObject(response));
  }

  Future<SwitchWorkspaceResult> switchWorkspace(String workspaceId) async {
    final response = await _client.post(
      Uri.parse('$baseUrl/api/auth/active-workspace'),
      headers: await _authHeaders(json: true),
      body: jsonEncode({'workspaceId': workspaceId}),
    );
    return SwitchWorkspaceResult.fromJson(_decodeObject(response));
  }

  Future<void> logout() async {
    final response = await _client.post(
      Uri.parse('$baseUrl/api/auth/logout'),
      headers: await _authHeaders(),
    );
    if (response.statusCode >= 400) {
      _decodeObject(response);
    }
    await _tokenStore.clear();
  }

  Future<OfficeLocation?> activeOffice() async {
    final offices = await activeOffices();
    return offices.isEmpty ? null : offices.first;
  }

  Future<List<OfficeLocation>> activeOffices() async {
    final response = await _client.get(
      Uri.parse('$baseUrl/api/attendance/office'),
      headers: await _authHeaders(),
    );
    final json = _decodeObject(response);
    final offices = json['offices'];
    if (offices is List) {
      return offices
          .whereType<Map<String, dynamic>>()
          .map(OfficeLocation.fromJson)
          .toList(growable: false);
    }
    final office = json['office'];
    return office is Map<String, dynamic>
        ? [OfficeLocation.fromJson(office)]
        : const [];
  }

  Future<AttendanceLog> checkIn({
    required double latitude,
    required double longitude,
    required double accuracyMeters,
    required bool isMockLocation,
    required Uint8List photoBytes,
    required String deviceInfo,
  }) {
    return _record(
      'check-in',
      latitude: latitude,
      longitude: longitude,
      accuracyMeters: accuracyMeters,
      isMockLocation: isMockLocation,
      photoBytes: photoBytes,
      deviceInfo: deviceInfo,
    );
  }

  Future<AttendanceLog> checkOut({
    required double latitude,
    required double longitude,
    required double accuracyMeters,
    required bool isMockLocation,
    required Uint8List photoBytes,
    required String deviceInfo,
  }) {
    return _record(
      'check-out',
      latitude: latitude,
      longitude: longitude,
      accuracyMeters: accuracyMeters,
      isMockLocation: isMockLocation,
      photoBytes: photoBytes,
      deviceInfo: deviceInfo,
    );
  }

  Future<AttendanceLog> _record(
    String action, {
    required double latitude,
    required double longitude,
    required double accuracyMeters,
    required bool isMockLocation,
    required Uint8List photoBytes,
    required String deviceInfo,
  }) async {
    final request = http.MultipartRequest(
      'POST',
      Uri.parse('$baseUrl/api/attendance/$action'),
    );
    request.headers.addAll(await _authHeaders());
    request.fields.addAll({
      'latitude': '$latitude',
      'longitude': '$longitude',
      'accuracy_meters': '$accuracyMeters',
      'is_mock_location': '$isMockLocation',
      'device_info': deviceInfo,
    });
    request.files.add(
      http.MultipartFile.fromBytes(
        'photo',
        photoBytes,
        filename: 'attendance.jpg',
        contentType: MediaType('image', 'jpeg'),
      ),
    );
    final streamed = await _client.send(request);
    final response = await http.Response.fromStream(streamed);
    return AttendanceLog.fromJson(_decodeObject(response));
  }

  Future<AttendanceLog> syncOfflineAttendance(
    OfflineAttendanceEntry entry,
  ) async {
    final action = entry.type == 'CHECK_IN' ? 'check-in' : 'check-out';
    final request = http.MultipartRequest(
      'POST',
      Uri.parse('$baseUrl/api/attendance/$action'),
    );
    request.headers.addAll(await _authHeaders());
    request.headers['idempotency-key'] = entry.idempotencyKey;
    request.fields.addAll({
      'latitude': '${entry.latitude}',
      'longitude': '${entry.longitude}',
      'accuracy_meters': '${entry.accuracyMeters}',
      'is_mock_location': '${entry.isMockLocation}',
      'client_captured_at': entry.clientCapturedAt.toUtc().toIso8601String(),
      'device_info': 'offline-queue',
    });
    request.files.add(
      await http.MultipartFile.fromPath(
        'photo',
        entry.photoPath,
        filename: 'attendance.jpg',
        contentType: MediaType('image', 'jpeg'),
      ),
    );
    final streamed = await _client.send(request);
    final response = await http.Response.fromStream(streamed);
    return AttendanceLog.fromJson(_decodeObject(response));
  }

  Future<List<AttendanceLog>> attendanceHistory({
    DateTime? from,
    DateTime? to,
  }) async {
    final query = <String, String>{
      if (from != null) 'from': _dateOnly(from),
      if (to != null) 'to': _dateOnly(to),
    };
    final uri = Uri.parse(
      '$baseUrl/api/attendance/me',
    ).replace(queryParameters: query.isEmpty ? null : query);
    final response = await _client.get(uri, headers: await _authHeaders());
    final json = _decodeObject(response);
    return (json['attendance'] as List<dynamic>? ?? const [])
        .whereType<Map<String, dynamic>>()
        .map(AttendanceLog.fromJson)
        .toList(growable: false);
  }

  Future<CorrectionRequest> submitCorrection({
    required String requestType,
    required DateTime requestedTimestamp,
    required String reason,
    String? attendanceLogId,
    Uint8List? proofBytes,
    String proofFilename = 'bukti.jpg',
    String proofContentType = 'image/jpeg',
  }) async {
    final fields = <String, String>{
      'requestType': requestType,
      'requestedTimestamp': requestedTimestamp.toUtc().toIso8601String(),
      'reason': reason,
    };
    if (attendanceLogId != null) fields['attendanceLogId'] = attendanceLogId;
    if (proofBytes == null) {
      final response = await _client.post(
        Uri.parse('$baseUrl/api/corrections'),
        headers: await _authHeaders(json: true),
        body: jsonEncode(fields),
      );
      return CorrectionRequest.fromJson(_decodeObject(response));
    }
    final request = http.MultipartRequest(
      'POST',
      Uri.parse('$baseUrl/api/corrections'),
    );
    request.headers.addAll(await _authHeaders());
    request.fields.addAll(fields);
    request.files.add(
      http.MultipartFile.fromBytes(
        'proof',
        proofBytes,
        filename: proofFilename,
        contentType: MediaType.parse(proofContentType),
      ),
    );
    final streamed = await _client.send(request);
    final response = await http.Response.fromStream(streamed);
    return CorrectionRequest.fromJson(_decodeObject(response));
  }

  Future<List<CorrectionRequest>> myCorrections({String? status}) async {
    final uri = Uri.parse('$baseUrl/api/corrections/me').replace(
      queryParameters: status == null ? null : {'status': status},
    );
    final response = await _client.get(uri, headers: await _authHeaders());
    final json = _decodeObject(response);
    return (json['corrections'] as List<dynamic>? ?? const [])
        .whereType<Map<String, dynamic>>()
        .map(CorrectionRequest.fromJson)
        .toList(growable: false);
  }

  Future<void> registerDeviceToken({
    required String token,
    required String platform,
  }) async {
    final response = await _client.post(
      Uri.parse('$baseUrl/api/notifications/register-device'),
      headers: await _authHeaders(json: true),
      body: jsonEncode({'token': token, 'platform': platform}),
    );
    _decodeObject(response);
  }

  Future<OvertimeRequest> submitOvertime({
    required DateTime date,
    required String startTime,
    required String endTime,
    required String reason,
  }) async {
    final response = await _client.post(
      Uri.parse('$baseUrl/api/overtime'),
      headers: await _authHeaders(json: true),
      body: jsonEncode({
        'date': _dateOnly(date),
        'startTime': startTime,
        'endTime': endTime,
        'reason': reason,
      }),
    );
    return OvertimeRequest.fromJson(_decodeObject(response));
  }

  Future<List<OvertimeRequest>> myOvertime({String? status}) async {
    final uri = Uri.parse('$baseUrl/api/overtime/me').replace(
      queryParameters: status == null ? null : {'status': status},
    );
    final response = await _client.get(uri, headers: await _authHeaders());
    final json = _decodeObject(response);
    return (json['overtime'] as List<dynamic>? ?? const [])
        .whereType<Map<String, dynamic>>()
        .map(OvertimeRequest.fromJson)
        .toList(growable: false);
  }

  Future<WfhRequest> submitWfh({
    required DateTime date,
    required String reason,
  }) async {
    final response = await _client.post(
      Uri.parse('$baseUrl/api/wfh'),
      headers: await _authHeaders(json: true),
      body: jsonEncode({'date': _dateOnly(date), 'reason': reason}),
    );
    return WfhRequest.fromJson(_decodeObject(response));
  }

  Future<List<WfhRequest>> myWfh({String? status}) async {
    final uri = Uri.parse('$baseUrl/api/wfh/me').replace(
      queryParameters: status == null ? null : {'status': status},
    );
    final response = await _client.get(uri, headers: await _authHeaders());
    final json = _decodeObject(response);
    return (json['wfh'] as List<dynamic>? ?? const [])
        .whereType<Map<String, dynamic>>()
        .map(WfhRequest.fromJson)
        .toList(growable: false);
  }

  Future<WorkSchedule> workSchedule() async {
    final response = await _client.get(
      Uri.parse('$baseUrl/api/mobile/schedule'),
      headers: await _authHeaders(),
    );
    return WorkSchedule.fromJson(_decodeObject(response));
  }

  Future<InboxPage> myNotifications({
    int limit = 30,
    bool unreadOnly = false,
  }) async {
    final uri = Uri.parse('$baseUrl/api/notifications/me').replace(
      queryParameters: {
        'limit': '$limit',
        if (unreadOnly) 'unread': 'true',
      },
    );
    final response = await _client.get(uri, headers: await _authHeaders());
    return InboxPage.fromJson(_decodeObject(response));
  }

  Future<InAppNotification> markNotificationRead(String id) async {
    final response = await _client.patch(
      Uri.parse('$baseUrl/api/notifications/$id/read'),
      headers: await _authHeaders(json: true),
    );
    return InAppNotification.fromJson(_decodeObject(response));
  }

  Future<void> markAllNotificationsRead() async {
    final response = await _client.post(
      Uri.parse('$baseUrl/api/notifications/read-all'),
      headers: await _authHeaders(json: true),
    );
    _decodeObject(response);
  }

  String photoUrl(String path) {
    if (path.startsWith('http://') || path.startsWith('https://')) {
      return path;
    }
    return Uri.parse(baseUrl).resolve(path).toString();
  }

  Future<Map<String, String>> _authHeaders({bool json = false}) async {
    final token = await _tokenStore.read();
    if (token == null || token.isEmpty) {
      throw const ApiException(401, 'UNAUTHENTICATED', 'Sesi tidak tersedia');
    }
    return {
      'authorization': 'Bearer $token',
      if (json) 'content-type': 'application/json',
    };
  }

  Map<String, dynamic> _decodeObject(http.Response response) {
    Map<String, dynamic>? json;
    try {
      final decoded = jsonDecode(response.body);
      if (decoded is Map<String, dynamic>) json = decoded;
    } catch (_) {
      json = null;
    }
    if (response.statusCode >= 200 && response.statusCode < 300) {
      if (json == null) {
        throw const ApiException(500, 'INVALID_RESPONSE', 'Respons server tidak valid');
      }
      return json;
    }
    final error = json?['error'];
    final errorMap = error is Map<String, dynamic> ? error : const <String, dynamic>{};
    throw ApiException(
      response.statusCode,
      errorMap['code'] as String? ?? 'REQUEST_FAILED',
      errorMap['message'] as String? ?? 'Request gagal',
    );
  }

  static String _dateOnly(DateTime value) {
    final year = value.year.toString().padLeft(4, '0');
    final month = value.month.toString().padLeft(2, '0');
    final day = value.day.toString().padLeft(2, '0');
    return '$year-$month-$day';
  }
}
