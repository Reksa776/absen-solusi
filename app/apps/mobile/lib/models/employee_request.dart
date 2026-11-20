class OvertimeRequest {
  const OvertimeRequest({
    required this.id,
    required this.date,
    required this.startTime,
    required this.endTime,
    required this.durationMinutes,
    required this.reason,
    required this.status,
    this.rejectionReason,
  });

  final String id;
  final DateTime date;
  final String startTime;
  final String endTime;
  final int durationMinutes;
  final String reason;
  final String status;
  final String? rejectionReason;

  bool get isPending => status == 'PENDING';
  bool get isApproved => status == 'APPROVED';

  String get statusLabel => switch (status) {
    'APPROVED' => 'Disetujui',
    'REJECTED' => 'Ditolak',
    _ => 'Menunggu',
  };

  factory OvertimeRequest.fromJson(Map<String, dynamic> json) {
    return OvertimeRequest(
      id: json['id'] as String,
      date: DateTime.parse(json['date'] as String),
      startTime: json['startTime'] as String,
      endTime: json['endTime'] as String,
      durationMinutes: json['durationMinutes'] as int,
      reason: json['reason'] as String,
      status: json['status'] as String,
      rejectionReason: json['rejectionReason'] as String?,
    );
  }
}

class WfhRequest {
  const WfhRequest({
    required this.id,
    required this.date,
    required this.reason,
    required this.status,
    this.rejectionReason,
  });

  final String id;
  final DateTime date;
  final String reason;
  final String status;
  final String? rejectionReason;

  String get statusLabel => switch (status) {
    'APPROVED' => 'Disetujui',
    'REJECTED' => 'Ditolak',
    _ => 'Menunggu',
  };

  factory WfhRequest.fromJson(Map<String, dynamic> json) {
    return WfhRequest(
      id: json['id'] as String,
      date: DateTime.parse(json['date'] as String),
      reason: json['reason'] as String,
      status: json['status'] as String,
      rejectionReason: json['rejectionReason'] as String?,
    );
  }
}
