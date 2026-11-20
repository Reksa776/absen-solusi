class CorrectionRequest {
  const CorrectionRequest({
    required this.id,
    required this.memberId,
    required this.requestType,
    required this.requestedTimestamp,
    required this.reason,
    required this.status,
    required this.createdAt,
    this.attendanceLogId,
    this.originalTimestamp,
    this.proofUrl,
    this.reviewedAt,
    this.rejectionReason,
  });

  factory CorrectionRequest.fromJson(Map<String, dynamic> json) {
    return CorrectionRequest(
      id: json['id'] as String? ?? '',
      memberId: json['memberId'] as String? ?? '',
      attendanceLogId: json['attendanceLogId'] as String?,
      requestType: json['requestType'] as String? ?? 'CHECK_IN',
      requestedTimestamp:
          DateTime.tryParse(json['requestedTimestamp'] as String? ?? '') ??
          DateTime.fromMillisecondsSinceEpoch(0, isUtc: true),
      originalTimestamp: DateTime.tryParse(
        json['originalTimestamp'] as String? ?? '',
      ),
      reason: json['reason'] as String? ?? '',
      proofUrl: json['proofUrl'] as String?,
      status: json['status'] as String? ?? 'PENDING',
      reviewedAt: DateTime.tryParse(json['reviewedAt'] as String? ?? ''),
      rejectionReason: json['rejectionReason'] as String?,
      createdAt:
          DateTime.tryParse(json['createdAt'] as String? ?? '') ??
          DateTime.fromMillisecondsSinceEpoch(0, isUtc: true),
    );
  }

  final String id;
  final String memberId;
  final String? attendanceLogId;
  final String requestType;
  final DateTime requestedTimestamp;
  final DateTime? originalTimestamp;
  final String reason;
  final String? proofUrl;
  final String status;
  final DateTime? reviewedAt;
  final String? rejectionReason;
  final DateTime createdAt;

  bool get isPending => status == 'PENDING';
  bool get isRejected => status == 'REJECTED';
  String get typeLabel => requestType == 'CHECK_OUT' ? 'Check-out' : 'Check-in';

  String get statusLabel {
    switch (status) {
      case 'APPROVED':
        return 'Disetujui';
      case 'REJECTED':
        return 'Ditolak';
      default:
        return 'Menunggu';
    }
  }
}
