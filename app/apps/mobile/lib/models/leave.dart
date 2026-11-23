class LeaveRequest {
  const LeaveRequest({
    required this.id,
    required this.leaveType,
    required this.startDate,
    required this.endDate,
    required this.workingDays,
    required this.reason,
    required this.status,
    required this.currentApprovalLevel,
    required this.createdAt,
    this.rejectionReason,
  });

  factory LeaveRequest.fromJson(Map<String, dynamic> json) {
    return LeaveRequest(
      id: json['id'] as String? ?? '',
      leaveType: json['leaveType'] as String? ?? 'LAINNYA',
      startDate:
          DateTime.tryParse(json['startDate'] as String? ?? '') ??
          DateTime.fromMillisecondsSinceEpoch(0, isUtc: true),
      endDate:
          DateTime.tryParse(json['endDate'] as String? ?? '') ??
          DateTime.fromMillisecondsSinceEpoch(0, isUtc: true),
      workingDays: json['workingDays'] as int? ?? 0,
      reason: json['reason'] as String? ?? '',
      status: json['status'] as String? ?? 'PENDING',
      currentApprovalLevel: json['currentApprovalLevel'] as int? ?? 0,
      rejectionReason: json['rejectionReason'] as String?,
      createdAt:
          DateTime.tryParse(json['createdAt'] as String? ?? '') ??
          DateTime.fromMillisecondsSinceEpoch(0, isUtc: true),
    );
  }

  final String id;
  final String leaveType;
  final DateTime startDate;
  final DateTime endDate;
  final int workingDays;
  final String reason;
  final String status;
  final int currentApprovalLevel;
  final String? rejectionReason;
  final DateTime createdAt;

  bool get isPending => status == 'PENDING';

  String get typeLabel => switch (leaveType) {
    'CUTI_TAHUNAN' => 'Cuti tahunan',
    'CUTI_MELAHIRKAN' => 'Cuti melahirkan',
    'CUTI_KHUSUS' => 'Cuti khusus',
    _ => 'Cuti lainnya',
  };

  String get statusLabel => switch (status) {
    'APPROVED' => 'Disetujui',
    'REJECTED' => 'Ditolak',
    _ => 'Menunggu',
  };
}

class LeaveBalance {
  const LeaveBalance({
    required this.year,
    required this.entitledDays,
    required this.usedDays,
    required this.remainingDays,
  });

  factory LeaveBalance.fromJson(Map<String, dynamic> json) {
    return LeaveBalance(
      year: json['year'] as int? ?? DateTime.now().year,
      entitledDays: json['entitledDays'] as int? ?? 0,
      usedDays: json['usedDays'] as int? ?? 0,
      remainingDays: json['remainingDays'] as int? ?? 0,
    );
  }

  final int year;
  final int entitledDays;
  final int usedDays;
  final int remainingDays;
}
