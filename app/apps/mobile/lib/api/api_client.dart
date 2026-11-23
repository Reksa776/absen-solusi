import 'dart:convert';
import 'dart:typed_data';

import 'package:http/http.dart' as http;
import 'package:http_parser/http_parser.dart';

import '../core/app_config.dart';
import '../models/attendance_log.dart';
import '../models/broadcast.dart';
import '../models/client_visit.dart';
import '../models/correction.dart';
import '../models/leave.dart';
import '../models/employee_request.dart';
import '../models/in_app_notification.dart';
import '../models/member_device.dart';
import '../models/office_location.dart';
import '../models/offline_attendance.dart';
import '../models/overtime_schedule.dart';
import '../models/organization.dart';
import '../models/profile_photo.dart';
import '../models/schedule.dart';
import '../models/session.dart';
import '../models/warning_letter.dart';
import '../models/work_permit.dart';
import '../services/device_identity_service.dart';
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
    DeviceIdentityService? deviceIdentityService,
  }) : _client = client ?? http.Client(),
       _tokenStore = tokenStore ?? SecureTokenStore(),
       _deviceIdentityService =
           deviceIdentityService ?? DeviceIdentityService(),
       baseUrl = baseUrl ?? AppConfig.apiBaseUrl;

  final http.Client _client;
  final TokenStore _tokenStore;
  final DeviceIdentityService _deviceIdentityService;
  final String baseUrl;

  Future<String?> readToken() => _tokenStore.read();

  Future<void> clearToken() => _tokenStore.clear();

  Future<AuthResult> login(String email, String password) async {
    final identity = await _deviceIdentityService.resolve();
    final response = await _client.post(
      Uri.parse('$baseUrl/api/auth/login'),
      headers: {
        'content-type': 'application/json',
        'x-auth-mode': 'bearer',
        ...identity.headers,
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
    String workMode = 'OFFICE',
    String? outOfTownReason,
  }) {
    return _record(
      'check-in',
      latitude: latitude,
      longitude: longitude,
      accuracyMeters: accuracyMeters,
      isMockLocation: isMockLocation,
      photoBytes: photoBytes,
      deviceInfo: deviceInfo,
      workMode: workMode,
      outOfTownReason: outOfTownReason,
    );
  }

  Future<AttendanceLog> checkOut({
    required double latitude,
    required double longitude,
    required double accuracyMeters,
    required bool isMockLocation,
    required Uint8List photoBytes,
    required String deviceInfo,
    String workMode = 'OFFICE',
    String? outOfTownReason,
  }) {
    return _record(
      'check-out',
      latitude: latitude,
      longitude: longitude,
      accuracyMeters: accuracyMeters,
      isMockLocation: isMockLocation,
      photoBytes: photoBytes,
      deviceInfo: deviceInfo,
      workMode: workMode,
      outOfTownReason: outOfTownReason,
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
    String workMode = 'OFFICE',
    String? outOfTownReason,
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
      'work_mode': workMode,
      if (workMode == 'OUT_OF_TOWN' && outOfTownReason != null)
        'out_of_town_reason': outOfTownReason,
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
      'work_mode': entry.workMode,
      if (entry.workMode == 'OUT_OF_TOWN' && entry.outOfTownReason != null)
        'out_of_town_reason': entry.outOfTownReason!,
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

  Future<List<OvertimeSchedule>> myOvertimeSchedules() async {
    final response = await _client.get(
      Uri.parse('$baseUrl/api/mobile/overtime/schedules'),
      headers: await _authHeaders(),
    );
    final json = _decodeObject(response);
    return (json['schedules'] as List<dynamic>? ?? const [])
        .whereType<Map<String, dynamic>>()
        .map(OvertimeSchedule.fromJson)
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

  Future<WorkPermitRequest> submitWorkPermit({
    required String permitType,
    required DateTime startDate,
    required DateTime endDate,
    required String reason,
    Uint8List? proofBytes,
    String proofFilename = 'bukti-izin.jpg',
    String proofContentType = 'image/jpeg',
  }) async {
    final fields = <String, String>{
      'permitType': permitType,
      'startDate': _dateOnly(startDate),
      'endDate': _dateOnly(endDate),
      'reason': reason,
    };
    if (proofBytes == null) {
      final response = await _client.post(
        Uri.parse('$baseUrl/api/permits'),
        headers: await _authHeaders(json: true),
        body: jsonEncode(fields),
      );
      return WorkPermitRequest.fromJson(_decodeObject(response));
    }
    final request = http.MultipartRequest(
      'POST',
      Uri.parse('$baseUrl/api/permits'),
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
    return WorkPermitRequest.fromJson(_decodeObject(response));
  }

  Future<List<WorkPermitRequest>> myWorkPermits({String? status}) async {
    final uri = Uri.parse('$baseUrl/api/permits/me').replace(
      queryParameters: status == null ? null : {'status': status},
    );
    final response = await _client.get(uri, headers: await _authHeaders());
    final json = _decodeObject(response);
    return (json['permits'] as List<dynamic>? ?? const [])
        .whereType<Map<String, dynamic>>()
        .map(WorkPermitRequest.fromJson)
        .toList(growable: false);
  }

  Future<LeaveRequest> submitLeave({
    required String leaveType,
    required DateTime startDate,
    required DateTime endDate,
    required String reason,
  }) async {
    final response = await _client.post(
      Uri.parse('$baseUrl/api/leave'),
      headers: await _authHeaders(json: true),
      body: jsonEncode({
        'leaveType': leaveType,
        'startDate': _dateOnly(startDate),
        'endDate': _dateOnly(endDate),
        'reason': reason,
      }),
    );
    return LeaveRequest.fromJson(_decodeObject(response));
  }

  Future<List<LeaveRequest>> myLeave({String? status}) async {
    final uri = Uri.parse('$baseUrl/api/leave/me').replace(
      queryParameters: status == null ? null : {'status': status},
    );
    final response = await _client.get(uri, headers: await _authHeaders());
    final json = _decodeObject(response);
    return (json['leave'] as List<dynamic>? ?? const [])
        .whereType<Map<String, dynamic>>()
        .map(LeaveRequest.fromJson)
        .toList(growable: false);
  }

  Future<LeaveBalance> myLeaveBalance({int? year}) async {
    final uri = Uri.parse('$baseUrl/api/leave/balance').replace(
      queryParameters: year == null ? null : {'year': '$year'},
    );
    final response = await _client.get(uri, headers: await _authHeaders());
    return LeaveBalance.fromJson(_decodeObject(response));
  }

  Future<List<WarningLetter>> myWarningLetters() async {
    final response = await _client.get(
      Uri.parse('$baseUrl/api/warning-letters/me'),
      headers: await _authHeaders(),
    );
    final json = _decodeObject(response);
    return (json['letters'] as List<dynamic>? ?? const [])
        .whereType<Map<String, dynamic>>()
        .map(WarningLetter.fromJson)
        .toList(growable: false);
  }

  Future<WarningLetter> acknowledgeWarningLetter(String id) async {
    final response = await _client.patch(
      Uri.parse('$baseUrl/api/warning-letters/$id/acknowledge'),
      headers: await _authHeaders(json: true),
    );
    return WarningLetter.fromJson(_decodeObject(response));
  }

  Future<List<BroadcastMessage>> myBroadcasts() async {
    final response = await _client.get(
      Uri.parse('$baseUrl/api/broadcasts/me'),
      headers: await _authHeaders(),
    );
    final json = _decodeObject(response);
    return (json['broadcasts'] as List<dynamic>? ?? const [])
        .whereType<Map<String, dynamic>>()
        .map(BroadcastMessage.fromJson)
        .toList(growable: false);
  }

  Future<MemberDevice?> myDevice() async {
    final response = await _client.get(
      Uri.parse('$baseUrl/api/mobile/device'),
      headers: await _authHeaders(),
    );
    final device = _decodeObject(response)['device'];
    return device is Map<String, dynamic>
        ? MemberDevice.fromJson(device)
        : null;
  }

  Future<ProfilePhotoStatus> myProfilePhoto() async {
    final response = await _client.get(
      Uri.parse('$baseUrl/api/mobile/profile/photo'),
      headers: await _authHeaders(),
    );
    return ProfilePhotoStatus.fromJson(_decodeObject(response));
  }

  Future<Uint8List?> profilePhotoBytes(String path) async {
    final response = await _client.get(
      Uri.parse(photoUrl(path)),
      headers: await _authHeaders(),
    );
    if (response.statusCode == 404) return null;
    if (response.statusCode < 200 || response.statusCode >= 300) {
      _decodeObject(response);
    }
    return response.bodyBytes;
  }

  Future<ProfilePhotoStatus> uploadProfilePhoto(Uint8List bytes) async {
    final request = http.MultipartRequest(
      'POST',
      Uri.parse('$baseUrl/api/mobile/profile/photo'),
    );
    request.headers.addAll(await _authHeaders());
    request.files.add(
      http.MultipartFile.fromBytes(
        'photo',
        bytes,
        filename: 'profile.jpg',
        contentType: MediaType('image', 'jpeg'),
      ),
    );
    final streamed = await _client.send(request);
    final response = await http.Response.fromStream(streamed);
    return ProfilePhotoStatus.fromJson(_decodeObject(response));
  }

  Future<OrganizationProfile> organizationProfile() async {
    final response = await _client.get(
      Uri.parse('$baseUrl/api/mobile/profile'),
      headers: await _authHeaders(),
    );
    return OrganizationProfile.fromJson(_decodeObject(response));
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

  Future<ClientVisitDay> myClientVisits({DateTime? date}) async {
    final uri = Uri.parse('$baseUrl/api/mobile/client-visits').replace(
      queryParameters: date == null ? null : {'date': _dateOnly(date)},
    );
    final response = await _client.get(uri, headers: await _authHeaders());
    return ClientVisitDay.fromJson(_decodeObject(response));
  }

  Future<ClientVisitLog> recordClientVisit({
    required String scheduleId,
    required String type,
    required double latitude,
    required double longitude,
    required double accuracyMeters,
    required Uint8List photoBytes,
    String? notes,
  }) async {
    final request = http.MultipartRequest(
      'POST',
      Uri.parse('$baseUrl/api/mobile/client-visits/$scheduleId'),
    );
    request.headers.addAll(await _authHeaders());
    request.fields.addAll({
      'type': type,
      'latitude': '$latitude',
      'longitude': '$longitude',
      'accuracy_meters': '$accuracyMeters',
      if (notes != null && notes.trim().isNotEmpty) 'notes': notes.trim(),
    });
    request.files.add(
      http.MultipartFile.fromBytes(
        'photo',
        photoBytes,
        filename: 'kunjungan.jpg',
        contentType: MediaType('image', 'jpeg'),
      ),
    );
    final streamed = await _client.send(request);
    final response = await http.Response.fromStream(streamed);
    return ClientVisitLog.fromJson(_decodeObject(response));
  }

  Future<List<WorkProjection>> myWorkProjections() async {
    final response = await _client.get(
      Uri.parse('$baseUrl/api/mobile/work-projections'),
      headers: await _authHeaders(),
    );
    final json = _decodeObject(response);
    return (json['projections'] as List<dynamic>? ?? const [])
        .whereType<Map<String, dynamic>>()
        .map(WorkProjection.fromJson)
        .toList(growable: false);
  }

  Future<WorkProjection> createWorkProjection({
    required String title,
    required String periodType,
    required DateTime startDate,
    required DateTime endDate,
    String? description,
  }) async {
    final response = await _client.post(
      Uri.parse('$baseUrl/api/mobile/work-projections'),
      headers: await _authHeaders(json: true),
      body: jsonEncode({
        'title': title,
        'periodType': periodType,
        'startDate': _dateOnly(startDate),
        'endDate': _dateOnly(endDate),
        if (description != null && description.trim().isNotEmpty)
          'description': description.trim(),
      }),
    );
    return WorkProjection.fromJson(_decodeObject(response));
  }

  Future<WorkProjection> updateWorkProjection({
    required String projectionId,
    required int progress,
    String? status,
    String? blockerNote,
  }) async {
    final payload = <String, Object>{'progress': progress};
    if (status != null) payload['status'] = status;
    if (blockerNote != null) payload['blockerNote'] = blockerNote;
    final response = await _client.patch(
      Uri.parse('$baseUrl/api/mobile/work-projections/$projectionId'),
      headers: await _authHeaders(json: true),
      body: jsonEncode(payload),
    );
    return WorkProjection.fromJson(_decodeObject(response));
  }

  Future<List<Payslip>> myPayslips() async {
    final response = await _client.get(
      Uri.parse('$baseUrl/api/mobile/payslips'),
      headers: await _authHeaders(),
    );
    final json = _decodeObject(response);
    return (json['payslips'] as List<dynamic>? ?? const [])
        .whereType<Map<String, dynamic>>()
        .map(Payslip.fromJson)
        .toList(growable: false);
  }

  Future<Payslip> payslip(String runId) async {
    final response = await _client.get(
      Uri.parse('$baseUrl/api/mobile/payslips/$runId'),
      headers: await _authHeaders(),
    );
    return Payslip.fromJson(_decodeObject(response));
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
    final identity = await _deviceIdentityService.resolve();
    return {
      'authorization': 'Bearer $token',
      if (json) 'content-type': 'application/json',
      ...identity.headers,
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
