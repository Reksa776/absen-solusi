class OvertimeSchedule {
  const OvertimeSchedule({
    required this.id,
    required this.date,
    required this.startTime,
    required this.endTime,
    required this.durationMinutes,
    required this.status,
    this.notes,
  });

  factory OvertimeSchedule.fromJson(Map<String, dynamic> json) {
    return OvertimeSchedule(
      id: json['id'] as String? ?? '',
      date:
          DateTime.tryParse(json['date'] as String? ?? '') ??
          DateTime.fromMillisecondsSinceEpoch(0, isUtc: true),
      startTime: json['startTime'] as String? ?? '',
      endTime: json['endTime'] as String? ?? '',
      durationMinutes: json['durationMinutes'] as int? ?? 0,
      notes: json['notes'] as String?,
      status: json['status'] as String? ?? 'PLANNED',
    );
  }

  final String id;
  final DateTime date;
  final String startTime;
  final String endTime;
  final int durationMinutes;
  final String? notes;
  final String status;

  String get statusLabel => status == 'PLANNED' ? 'Dijadwalkan' : 'Dibatalkan';
}
