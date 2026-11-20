class WeeklyScheduleDay {
  const WeeklyScheduleDay({
    required this.dayOfWeek,
    required this.label,
    required this.isWorkday,
    required this.startTime,
    required this.endTime,
    required this.lateToleranceMinutes,
  });

  factory WeeklyScheduleDay.fromJson(Map<String, dynamic> json) {
    return WeeklyScheduleDay(
      dayOfWeek: (json['dayOfWeek'] as num?)?.toInt() ?? 0,
      label: json['label'] as String? ?? '',
      isWorkday: json['isWorkday'] as bool? ?? false,
      startTime: json['startTime'] as String? ?? '',
      endTime: json['endTime'] as String? ?? '',
      lateToleranceMinutes:
          (json['lateToleranceMinutes'] as num?)?.toInt() ?? 0,
    );
  }

  final int dayOfWeek;
  final String label;
  final bool isWorkday;
  final String startTime;
  final String endTime;
  final int lateToleranceMinutes;

  String get hours => '$startTime–$endTime';
}

class WorkHoliday {
  const WorkHoliday({
    required this.id,
    required this.date,
    required this.name,
    required this.type,
  });

  factory WorkHoliday.fromJson(Map<String, dynamic> json) {
    return WorkHoliday(
      id: json['id'] as String? ?? '',
      date:
          DateTime.tryParse(json['date'] as String? ?? '') ??
          DateTime.fromMillisecondsSinceEpoch(0),
      name: json['name'] as String? ?? '',
      type: json['type'] as String? ?? 'COMPANY',
    );
  }

  final String id;
  final DateTime date;
  final String name;
  final String type;

  bool get isNational => type == 'NATIONAL';
  String get typeLabel => isNational ? 'Libur nasional' : 'Libur perusahaan';

  String get dateKey =>
      '${date.year}-${date.month.toString().padLeft(2, '0')}-'
      '${date.day.toString().padLeft(2, '0')}';
}

class WorkSchedule {
  const WorkSchedule({
    required this.officeName,
    required this.timezone,
    required this.shiftName,
    required this.workStart,
    required this.workEnd,
    required this.lateToleranceMinutes,
    required this.weekly,
    required this.holidays,
  });

  factory WorkSchedule.fromJson(Map<String, dynamic> json) {
    final office = json['office'] as Map<String, dynamic>?;
    final shift = json['shift'] as Map<String, dynamic>?;
    final weekly = (json['weekly'] as List<dynamic>? ?? const [])
        .whereType<Map<String, dynamic>>()
        .map(WeeklyScheduleDay.fromJson)
        .toList(growable: false);
    final firstWorkday = weekly.where((day) => day.isWorkday).firstOrNull;
    return WorkSchedule(
      officeName: office?['name'] as String? ?? '',
      timezone: office?['timezone'] as String? ?? 'Asia/Jakarta',
      shiftName: shift?['name'] as String? ?? 'Shift kantor',
      workStart:
          shift?['startTime'] as String? ??
          firstWorkday?.startTime ??
          office?['workStart'] as String? ??
          '09:00',
      workEnd:
          shift?['endTime'] as String? ??
          firstWorkday?.endTime ??
          office?['workEnd'] as String? ??
          '17:00',
      lateToleranceMinutes:
          (shift?['lateToleranceMinutes'] as num?)?.toInt() ??
          firstWorkday?.lateToleranceMinutes ??
          0,
      weekly: weekly,
      holidays: (json['holidays'] as List<dynamic>? ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(WorkHoliday.fromJson)
          .toList(growable: false),
    );
  }

  final String officeName;
  final String timezone;
  final String shiftName;
  final String workStart;
  final String workEnd;
  final int lateToleranceMinutes;
  final List<WeeklyScheduleDay> weekly;
  final List<WorkHoliday> holidays;

  String get hours => '$workStart–$workEnd';

  bool isHoliday(DateTime day) {
    final key =
        '${day.year}-${day.month.toString().padLeft(2, '0')}-'
        '${day.day.toString().padLeft(2, '0')}';
    return holidays.any((holiday) => holiday.dateKey == key);
  }

  WeeklyScheduleDay? dayFor(DateTime day) {
    for (final entry in weekly) {
      if (entry.dayOfWeek == day.weekday) return entry;
    }
    return null;
  }

  List<WorkHoliday> holidaysThisYear([DateTime? now]) {
    final year = (now ?? DateTime.now()).year;
    return holidays.where((holiday) => holiday.date.year == year).toList();
  }
}
