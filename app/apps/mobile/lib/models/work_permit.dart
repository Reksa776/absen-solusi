class WorkPermitRequest {
  const WorkPermitRequest({
    required this.id,
    required this.permitType,
    required this.startDate,
    required this.endDate,
    required this.reason,
    required this.status,
    required this.currentApprovalLevel,
    required this.createdAt,
    this.rejectionReason,
    this.proofUrl,
  });

  factory WorkPermitRequest.fromJson(Map<String, dynamic> json) {
    return WorkPermitRequest(
      id: json['id'] as String? ?? '',
      permitType: json['permitType'] as String? ?? 'LAINNYA',
      startDate:
          DateTime.tryParse(json['startDate'] as String? ?? '') ??
          DateTime.fromMillisecondsSinceEpoch(0, isUtc: true),
      endDate:
          DateTime.tryParse(json['endDate'] as String? ?? '') ??
          DateTime.fromMillisecondsSinceEpoch(0, isUtc: true),
      reason: json['reason'] as String? ?? '',
      status: json['status'] as String? ?? 'PENDING',
      currentApprovalLevel: json['currentApprovalLevel'] as int? ?? 0,
      rejectionReason: json['rejectionReason'] as String?,
      proofUrl: json['proofUrl'] as String?,
      createdAt:
          DateTime.tryParse(json['createdAt'] as String? ?? '') ??
          DateTime.fromMillisecondsSinceEpoch(0, isUtc: true),
    );
  }

  final String id;
  final String permitType;
  final DateTime startDate;
  final DateTime endDate;
  final String reason;
  final String status;
  final int currentApprovalLevel;
  final String? rejectionReason;
  final String? proofUrl;
  final DateTime createdAt;

  bool get isPending => status == 'PENDING';
  bool get hasProof => proofUrl != null && proofUrl!.isNotEmpty;

  String get typeLabel => switch (permitType) {
    'SAKIT' => 'Sakit',
    'IZIN_PRIBADI' => 'Izin pribadi',
    'PULANG_CEPAT' => 'Pulang cepat',
    'DATANG_TERLAMBAT' => 'Datang terlambat',
    _ => 'Izin lainnya',
  };

  String get statusLabel => switch (status) {
    'APPROVED' => 'Disetujui',
    'REJECTED' => 'Ditolak',
    _ => 'Menunggu',
  };
}
