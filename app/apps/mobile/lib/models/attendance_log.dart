class AttendanceLog {
  const AttendanceLog({
    required this.id,
    required this.type,
    required this.timestampServer,
    required this.distanceMeters,
    required this.accuracyMeters,
    required this.isSuspicious,
    required this.photoUrl,
    this.workDate,
    this.latitude,
    this.longitude,
    this.isMockLocation = false,
    this.deviceInfo,
    this.deviceName,
    this.deviceId,
    this.deviceModel,
    this.deviceManufacturer,
    this.workMode = 'OFFICE',
    this.outOfRadius = false,
    this.outOfTownReason,
    this.approvalStatus = 'APPROVED',
    this.currentApprovalLevel = 0,
    this.rejectionReason,
    this.attendanceStatus,
    this.lateMinutes = 0,
    this.earlyLeaveMinutes = 0,
    this.workPatternId,
  });

  factory AttendanceLog.fromJson(Map<String, dynamic> json) {
    return AttendanceLog(
      id: json['id'] as String? ?? '',
      type: json['type'] as String? ?? 'CHECK_IN',
      timestampServer:
          DateTime.tryParse(json['timestampServer'] as String? ?? '') ??
          DateTime.fromMillisecondsSinceEpoch(0, isUtc: true),
      workDate: DateTime.tryParse(json['workDate'] as String? ?? ''),
      distanceMeters: (json['distanceMeters'] as num?)?.toDouble() ?? 0,
      accuracyMeters: (json['accuracyMeters'] as num?)?.toDouble() ?? 0,
      isSuspicious: json['isSuspicious'] as bool? ?? false,
      photoUrl: json['photoUrl'] as String? ?? '',
      latitude: (json['latitude'] as num?)?.toDouble(),
      longitude: (json['longitude'] as num?)?.toDouble(),
      isMockLocation: json['isMockLocation'] as bool? ?? false,
      deviceInfo: json['deviceInfo'] as String?,
      deviceName: json['deviceName'] as String?,
      deviceId: json['deviceId'] as String?,
      deviceModel: json['deviceModel'] as String?,
      deviceManufacturer: json['deviceManufacturer'] as String?,
      workMode: json['workMode'] as String? ?? 'OFFICE',
      outOfRadius: json['outOfRadius'] as bool? ?? false,
      outOfTownReason: json['outOfTownReason'] as String?,
      approvalStatus: json['approvalStatus'] as String? ?? 'APPROVED',
      currentApprovalLevel:
          (json['currentApprovalLevel'] as num?)?.toInt() ?? 0,
      rejectionReason: json['rejectionReason'] as String?,
      attendanceStatus: json['attendanceStatus'] as String?,
      lateMinutes: (json['lateMinutes'] as num?)?.toInt() ?? 0,
      earlyLeaveMinutes: (json['earlyLeaveMinutes'] as num?)?.toInt() ?? 0,
      workPatternId: json['workPatternId'] as String?,
    );
  }

  final String id;
  final String type;
  final DateTime timestampServer;
  final DateTime? workDate;
  final double distanceMeters;
  final double accuracyMeters;
  final bool isSuspicious;
  final String photoUrl;
  final double? latitude;
  final double? longitude;
  final bool isMockLocation;
  final String? deviceInfo;
  final String? deviceName;
  final String? deviceId;
  final String? deviceModel;
  final String? deviceManufacturer;
  final String workMode;
  final bool outOfRadius;
  final String? outOfTownReason;
  final String approvalStatus;
  final int currentApprovalLevel;
  final String? rejectionReason;
  final String? attendanceStatus;
  final int lateMinutes;
  final int earlyLeaveMinutes;
  final String? workPatternId;

  bool get isLate => attendanceStatus == 'LATE' || lateMinutes > 0;
  bool get isEarlyLeave =>
      attendanceStatus == 'EARLY_LEAVE' || earlyLeaveMinutes > 0;
  bool get isCheckIn => type == 'CHECK_IN';
  bool get isCheckOut => type == 'CHECK_OUT';
  bool get isOutOfTown => workMode == 'OUT_OF_TOWN';
  bool get isApprovalPending => approvalStatus == 'PENDING';
  bool get isApprovalRejected => approvalStatus == 'REJECTED';
  String get label => isCheckIn ? 'Check-in' : 'Check-out';
}
