class ClientVisitLog {
  const ClientVisitLog({
    required this.id,
    required this.scheduleId,
    required this.clientName,
    required this.memberName,
    required this.type,
    required this.timestampServer,
    required this.latitude,
    required this.longitude,
    required this.accuracyMeters,
    required this.distanceMeters,
    required this.isInsideRadius,
    required this.validationStatus,
    this.photoUrl,
    this.notes,
    this.durationMinutes,
  });

  factory ClientVisitLog.fromJson(Map<String, dynamic> json) {
    return ClientVisitLog(
      id: json['id'] as String? ?? '',
      scheduleId: json['scheduleId'] as String? ?? '',
      clientName: json['clientName'] as String? ?? '',
      memberName: json['memberName'] as String? ?? '',
      type: json['type'] as String? ?? 'CHECK_IN',
      timestampServer:
          DateTime.tryParse(json['timestampServer'] as String? ?? '') ??
          DateTime.fromMillisecondsSinceEpoch(0, isUtc: true),
      latitude: (json['latitude'] as num?)?.toDouble() ?? 0,
      longitude: (json['longitude'] as num?)?.toDouble() ?? 0,
      accuracyMeters: (json['accuracyMeters'] as num?)?.toDouble() ?? 0,
      distanceMeters: (json['distanceMeters'] as num?)?.toDouble() ?? 0,
      isInsideRadius: json['isInsideRadius'] as bool? ?? false,
      validationStatus: json['validationStatus'] as String? ?? 'VALID',
      photoUrl: json['photoUrl'] as String?,
      notes: json['notes'] as String?,
      durationMinutes: json['durationMinutes'] as int?,
    );
  }

  final String id;
  final String scheduleId;
  final String clientName;
  final String memberName;
  final String type;
  final DateTime timestampServer;
  final double latitude;
  final double longitude;
  final double accuracyMeters;
  final double distanceMeters;
  final bool isInsideRadius;
  final String validationStatus;
  final String? photoUrl;
  final String? notes;
  final int? durationMinutes;

  bool get isCheckIn => type == 'CHECK_IN';
  bool get hasPhoto => photoUrl != null;
}

class ClientVisitSchedule {
  const ClientVisitSchedule({
    required this.id,
    required this.clientId,
    required this.clientName,
    required this.clientLatitude,
    required this.clientLongitude,
    required this.clientRadiusMeters,
    required this.scheduledDate,
    required this.plannedStartTime,
    required this.plannedEndTime,
    required this.purpose,
    required this.visitStatus,
    required this.logs,
    this.clientAddress,
    this.checkIn,
    this.checkOut,
  });

  factory ClientVisitSchedule.fromJson(Map<String, dynamic> json) {
    final logs = (json['logs'] as List<dynamic>? ?? const [])
        .whereType<Map<String, dynamic>>()
        .map(ClientVisitLog.fromJson)
        .toList(growable: false);
    ClientVisitLog? find(String type) {
      for (final log in logs) {
        if (log.type == type) return log;
      }
      return null;
    }

    return ClientVisitSchedule(
      id: json['id'] as String? ?? '',
      clientId: json['clientId'] as String? ?? '',
      clientName: json['clientName'] as String? ?? '',
      clientAddress: json['clientAddress'] as String?,
      clientLatitude: (json['clientLatitude'] as num?)?.toDouble() ?? 0,
      clientLongitude: (json['clientLongitude'] as num?)?.toDouble() ?? 0,
      clientRadiusMeters: (json['clientRadiusMeters'] as num?)?.toDouble() ?? 0,
      scheduledDate:
          DateTime.tryParse(json['scheduledDate'] as String? ?? '') ??
          DateTime.fromMillisecondsSinceEpoch(0, isUtc: true),
      plannedStartTime: json['plannedStartTime'] as String? ?? '',
      plannedEndTime: json['plannedEndTime'] as String? ?? '',
      purpose: json['purpose'] as String? ?? '',
      visitStatus: json['visitStatus'] as String? ?? 'SCHEDULED',
      checkIn: json['checkIn'] is Map<String, dynamic>
          ? ClientVisitLog.fromJson(json['checkIn'] as Map<String, dynamic>)
          : find('CHECK_IN'),
      checkOut: json['checkOut'] is Map<String, dynamic>
          ? ClientVisitLog.fromJson(json['checkOut'] as Map<String, dynamic>)
          : find('CHECK_OUT'),
      logs: logs,
    );
  }

  final String id;
  final String clientId;
  final String clientName;
  final String? clientAddress;
  final double clientLatitude;
  final double clientLongitude;
  final double clientRadiusMeters;
  final DateTime scheduledDate;
  final String plannedStartTime;
  final String plannedEndTime;
  final String purpose;
  final String visitStatus;
  final ClientVisitLog? checkIn;
  final ClientVisitLog? checkOut;
  final List<ClientVisitLog> logs;

  bool get canCheckIn => checkIn == null && visitStatus != 'CANCELLED';
  bool get canCheckOut => checkIn != null && checkOut == null;

  String get statusLabel => switch (visitStatus) {
    'COMPLETED' => 'Selesai',
    'IN_PROGRESS' => 'Berlangsung',
    'MISSED' => 'Terlewat',
    'CANCELLED' => 'Dibatalkan',
    _ => 'Terjadwal',
  };
}

class ClientVisitDay {
  const ClientVisitDay({
    required this.date,
    required this.schedules,
    required this.history,
  });

  factory ClientVisitDay.fromJson(Map<String, dynamic> json) {
    return ClientVisitDay(
      date: json['date'] as String? ?? '',
      schedules: (json['schedules'] as List<dynamic>? ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(ClientVisitSchedule.fromJson)
          .toList(growable: false),
      history: (json['history'] as List<dynamic>? ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(ClientVisitSchedule.fromJson)
          .toList(growable: false),
    );
  }

  final String date;
  final List<ClientVisitSchedule> schedules;
  final List<ClientVisitSchedule> history;
}

class WorkProjection {
  const WorkProjection({
    required this.id,
    required this.title,
    required this.periodType,
    required this.startDate,
    required this.endDate,
    required this.progress,
    required this.status,
    this.description,
    this.blockerNote,
    this.reviewNote,
  });

  factory WorkProjection.fromJson(Map<String, dynamic> json) {
    return WorkProjection(
      id: json['id'] as String? ?? '',
      title: json['title'] as String? ?? '',
      description: json['description'] as String?,
      periodType: json['periodType'] as String? ?? 'DAILY',
      startDate:
          DateTime.tryParse(json['startDate'] as String? ?? '') ??
          DateTime.fromMillisecondsSinceEpoch(0, isUtc: true),
      endDate:
          DateTime.tryParse(json['endDate'] as String? ?? '') ??
          DateTime.fromMillisecondsSinceEpoch(0, isUtc: true),
      progress: json['progress'] as int? ?? 0,
      status: json['status'] as String? ?? 'PLANNED',
      blockerNote: json['blockerNote'] as String?,
      reviewNote: json['reviewNote'] as String?,
    );
  }

  final String id;
  final String title;
  final String? description;
  final String periodType;
  final DateTime startDate;
  final DateTime endDate;
  final int progress;
  final String status;
  final String? blockerNote;
  final String? reviewNote;

  String get statusLabel => switch (status) {
    'COMPLETED' => 'Selesai',
    'BLOCKED' => 'Kendala',
    'IN_PROGRESS' => 'Berjalan',
    _ => 'Direncanakan',
  };

  String get periodLabel => periodType == 'WEEKLY' ? 'Mingguan' : 'Harian';
}

class PayslipItem {
  const PayslipItem({
    required this.baseSalary,
    required this.attendanceAllowance,
    required this.transportAllowance,
    required this.mealAllowance,
    required this.overtimeMinutes,
    required this.overtimePay,
    required this.lateMinutes,
    required this.lateIncidents,
    required this.lateDeduction,
    required this.spDeduction,
    required this.leaveDays,
    required this.permitDays,
    required this.grossPay,
    required this.totalDeductions,
    required this.netPay,
    this.spLevel,
  });

  factory PayslipItem.fromJson(Map<String, dynamic> json) {
    return PayslipItem(
      baseSalary: json['baseSalary'] as int? ?? 0,
      attendanceAllowance: json['attendanceAllowance'] as int? ?? 0,
      transportAllowance: json['transportAllowance'] as int? ?? 0,
      mealAllowance: json['mealAllowance'] as int? ?? 0,
      overtimeMinutes: json['overtimeMinutes'] as int? ?? 0,
      overtimePay: json['overtimePay'] as int? ?? 0,
      lateMinutes: json['lateMinutes'] as int? ?? 0,
      lateIncidents: json['lateIncidents'] as int? ?? 0,
      lateDeduction: json['lateDeduction'] as int? ?? 0,
      spLevel: json['spLevel'] as String?,
      spDeduction: json['spDeduction'] as int? ?? 0,
      leaveDays: json['leaveDays'] as int? ?? 0,
      permitDays: json['permitDays'] as int? ?? 0,
      grossPay: json['grossPay'] as int? ?? 0,
      totalDeductions: json['totalDeductions'] as int? ?? 0,
      netPay: json['netPay'] as int? ?? 0,
    );
  }

  final int baseSalary;
  final int attendanceAllowance;
  final int transportAllowance;
  final int mealAllowance;
  final int overtimeMinutes;
  final int overtimePay;
  final int lateMinutes;
  final int lateIncidents;
  final int lateDeduction;
  final String? spLevel;
  final int spDeduction;
  final int leaveDays;
  final int permitDays;
  final int grossPay;
  final int totalDeductions;
  final int netPay;
}

class Payslip {
  const Payslip({
    required this.runId,
    required this.periodYear,
    required this.periodMonth,
    required this.status,
    required this.currency,
    required this.item,
    this.paidAt,
  });

  factory Payslip.fromJson(Map<String, dynamic> json) {
    return Payslip(
      runId: json['runId'] as String? ?? '',
      periodYear: json['periodYear'] as int? ?? 0,
      periodMonth: json['periodMonth'] as int? ?? 1,
      status: json['status'] as String? ?? 'FINALIZED',
      currency: json['currency'] as String? ?? 'IDR',
      paidAt: DateTime.tryParse(json['paidAt'] as String? ?? ''),
      item: PayslipItem.fromJson(
        (json['item'] as Map<String, dynamic>?) ?? const {},
      ),
    );
  }

  final String runId;
  final int periodYear;
  final int periodMonth;
  final String status;
  final String currency;
  final DateTime? paidAt;
  final PayslipItem item;

  bool get isPaid => status == 'PAID';
  String get periodLabel => '$periodMonth/$periodYear';
}
