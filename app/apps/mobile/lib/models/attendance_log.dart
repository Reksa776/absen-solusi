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
    this.isMockLocation = false,
    this.deviceInfo,
    this.workMode = 'OFFICE',
    this.outOfRadius = false,
    this.outOfTownReason,
    this.approvalStatus = 'APPROVED',
    this.currentApprovalLevel = 0,
    this.rejectionReason,
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
      isMockLocation: json['isMockLocation'] as bool? ?? false,
      deviceInfo: json['deviceInfo'] as String?,
      workMode: json['workMode'] as String? ?? 'OFFICE',
      outOfRadius: json['outOfRadius'] as bool? ?? false,
      outOfTownReason: json['outOfTownReason'] as String?,
      approvalStatus: json['approvalStatus'] as String? ?? 'APPROVED',
      currentApprovalLevel:
          (json['currentApprovalLevel'] as num?)?.toInt() ?? 0,
      rejectionReason: json['rejectionReason'] as String?,
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
  final bool isMockLocation;
  final String? deviceInfo;
  final String workMode;
  final bool outOfRadius;
  final String? outOfTownReason;
  final String approvalStatus;
  final int currentApprovalLevel;
  final String? rejectionReason;

  bool get isCheckIn => type == 'CHECK_IN';
  bool get isCheckOut => type == 'CHECK_OUT';
  bool get isOutOfTown => workMode == 'OUT_OF_TOWN';
  bool get isApprovalPending => approvalStatus == 'PENDING';
  bool get isApprovalRejected => approvalStatus == 'REJECTED';
  String get label => isCheckIn ? 'Check-in' : 'Check-out';
}
