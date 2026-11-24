import 'package:material_ui/material_ui.dart';

import '../api/api_client.dart';
import '../models/overtime_schedule.dart';
import '../models/schedule.dart';
import '../services/auth_service.dart';
import '../theme/app_theme.dart';

const _monthShort = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'Mei',
  'Jun',
  'Jul',
  'Agu',
  'Sep',
  'Okt',
  'Nov',
  'Des',
];

const _dayShort = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];

String _two(int value) => value.toString().padLeft(2, '0');

String _dateKey(DateTime value) =>
    '${value.year}-${_two(value.month)}-${_two(value.day)}';

String _zoneLabel(String timezone) {
  return switch (timezone) {
    'Asia/Jakarta' => 'WIB',
    'Asia/Makassar' => 'WITA',
    'Asia/Jayapura' => 'WIT',
    _ => timezone.isEmpty ? 'WIB' : timezone,
  };
}

/// Tab Jadwal: pola kerja mingguan dan jadwal lembur, tanpa open shift.
class ScheduleTab extends StatefulWidget {
  const ScheduleTab({super.key, required this.auth, this.now});

  final AuthService auth;
  final DateTime Function()? now;

  @override
  State<ScheduleTab> createState() => _ScheduleTabState();
}

class _ScheduleTabState extends State<ScheduleTab> {
  WorkSchedule? _schedule;
  List<OvertimeSchedule> _overtime = const [];
  int _segment = 0;
  int _weekOffset = 0;
  bool _loading = true;
  String? _error;

  DateTime get _now => widget.now?.call() ?? DateTime.now();

  DateTime get _today => DateUtils.dateOnly(_now);

  DateTime get _currentWeekStart {
    final today = _today;
    return today.subtract(Duration(days: today.weekday - 1));
  }

  DateTime get _weekStart =>
      _currentWeekStart.add(Duration(days: _weekOffset * 7));

  DateTime get _weekEnd => _weekStart.add(const Duration(days: 6));

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final results = await Future.wait([
        widget.auth.api.workSchedule(),
        widget.auth.api.myOvertimeSchedules(),
      ]);
      if (!mounted) return;
      setState(() {
        _schedule = results[0] as WorkSchedule;
        _overtime = results[1] as List<OvertimeSchedule>;
        _loading = false;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _error = messageForApiError(error);
        _loading = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _error = 'Jadwal tidak dapat dimuat.';
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      bottom: false,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Padding(
            padding: EdgeInsets.fromLTRB(16, 16, 16, 10),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Jadwal',
                  style: TextStyle(
                    fontSize: 23,
                    fontWeight: FontWeight.w800,
                    letterSpacing: -0.5,
                    color: AppColors.ink,
                  ),
                ),
                SizedBox(height: 2),
                Text(
                  'Pola kerja dan jadwal lembur Anda.',
                  style: TextStyle(fontSize: 12, color: AppColors.muted),
                ),
              ],
            ),
          ),
          _segmented(),
          Expanded(child: _body()),
        ],
      ),
    );
  }

  Widget _segmented() {
    return Container(
      margin: const EdgeInsets.fromLTRB(16, 0, 16, 12),
      decoration: const BoxDecoration(
        border: Border(bottom: BorderSide(color: AppColors.line)),
      ),
      child: Row(
        children: [
          _segmentButton(0, 'Jadwal Kerja'),
          _segmentButton(1, 'Jadwal Lembur'),
        ],
      ),
    );
  }

  Widget _segmentButton(int value, String label) {
    final active = _segment == value;
    return Expanded(
      child: InkWell(
        key: Key('schedule-segment-$value'),
        onTap: () => setState(() => _segment = value),
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 11),
          decoration: BoxDecoration(
            border: Border(
              bottom: BorderSide(
                color: active ? AppColors.green : Colors.transparent,
                width: 2,
              ),
            ),
          ),
          child: Text(
            label,
            textAlign: TextAlign.center,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              fontSize: 12.5,
              fontWeight: FontWeight.w700,
              color: active ? AppColors.greenDark : AppColors.muted,
            ),
          ),
        ),
      ),
    );
  }

  Widget _body() {
    if (_loading) return const Center(child: CircularProgressIndicator());
    final schedule = _schedule;
    if (schedule == null) {
      return _emptyState(
        key: const Key('schedule-error'),
        icon: Icons.event_busy_outlined,
        message: _error ?? 'Jadwal kerja belum tersedia.',
        retry: true,
      );
    }
    return RefreshIndicator(
      color: AppColors.green,
      onRefresh: _load,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 28),
        children: [
          _weekPicker(),
          const SizedBox(height: 12),
          if (_segment == 0)
            ..._workContent(schedule)
          else
            ..._overtimeContent(),
        ],
      ),
    );
  }

  Widget _weekPicker() {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 4),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.line),
      ),
      child: Row(
        children: [
          IconButton(
            key: const Key('schedule-week-prev'),
            tooltip: 'Minggu sebelumnya',
            visualDensity: VisualDensity.compact,
            onPressed: () => setState(() => _weekOffset--),
            icon: const Icon(Icons.chevron_left, size: 21),
          ),
          Expanded(
            child: Text(
              '${_weekStart.day} ${_monthShort[_weekStart.month - 1]} – '
              '${_weekEnd.day} ${_monthShort[_weekEnd.month - 1]} '
              '${_weekEnd.year}',
              textAlign: TextAlign.center,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                fontSize: 12.5,
                fontWeight: FontWeight.w700,
                color: AppColors.ink,
                fontFeatures: tabularFigures,
              ),
            ),
          ),
          IconButton(
            key: const Key('schedule-week-next'),
            tooltip: 'Minggu berikutnya',
            visualDensity: VisualDensity.compact,
            onPressed: () => setState(() => _weekOffset++),
            icon: const Icon(Icons.chevron_right, size: 21),
          ),
        ],
      ),
    );
  }

  List<Widget> _workContent(WorkSchedule schedule) {
    final today = _today;
    final todayDay = schedule.dayFor(today);
    final todayHoliday = schedule.isHoliday(today);
    final todayWorkday = !todayHoliday && (todayDay?.isWorkday ?? false);
    final upcoming = <Widget>[];
    for (var index = 0; index < 7; index++) {
      final date = _weekStart.add(Duration(days: index));
      if (date.isBefore(today)) continue;
      upcoming.add(_upcomingDay(schedule, date));
    }
    return [
      _todayCard(schedule, today, todayDay, todayHoliday, todayWorkday),
      const SizedBox(height: 12),
      _patternSummary(schedule),
      const SizedBox(height: 18),
      Row(
        children: [
          const Expanded(
            child: Text(
              'Jadwal Selanjutnya',
              style: TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w700,
                color: AppColors.ink,
              ),
            ),
          ),
          Text(
            _weekOffset == 0 ? 'Minggu ini' : 'Minggu dipilih',
            style: const TextStyle(fontSize: 10.5, color: AppColors.muted),
          ),
        ],
      ),
      const SizedBox(height: 8),
      if (upcoming.isEmpty)
        _emptyState(
          key: const Key('schedule-upcoming-empty'),
          icon: Icons.event_note_outlined,
          message: 'Tidak ada jadwal berikutnya pada minggu ini.',
        )
      else
        Container(
          key: const Key('schedule-upcoming'),
          decoration: BoxDecoration(
            color: AppColors.surface,
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: AppColors.line),
          ),
          child: Column(
            children: [
              for (var index = 0; index < upcoming.length; index++) ...[
                upcoming[index],
                if (index < upcoming.length - 1)
                  const Divider(height: 1, indent: 14, endIndent: 14),
              ],
            ],
          ),
        ),
    ];
  }

  Widget _todayCard(
    WorkSchedule schedule,
    DateTime date,
    WeeklyScheduleDay? day,
    bool holiday,
    bool workday,
  ) {
    final hours = workday && day != null ? day.hours : 'Hari Libur';
    return Container(
      key: const Key('schedule-today'),
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        color: AppColors.teal,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.teal),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(14, 14, 14, 16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'Jadwal Hari Ini',
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w700,
                    color: Colors.white,
                  ),
                ),
                const SizedBox(height: 12),
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Container(
                      width: 54,
                      padding: const EdgeInsets.symmetric(vertical: 8),
                      decoration: BoxDecoration(
                        color: AppColors.surface,
                        borderRadius: BorderRadius.circular(10),
                      ),
                      child: Column(
                        children: [
                          Text(
                            _dayShort[date.weekday - 1],
                            style: const TextStyle(
                              fontSize: 9.5,
                              fontWeight: FontWeight.w600,
                              color: AppColors.muted,
                            ),
                          ),
                          const SizedBox(height: 2),
                          Text(
                            _two(date.day),
                            style: const TextStyle(
                              fontSize: 20,
                              height: 1,
                              fontWeight: FontWeight.w800,
                              color: AppColors.teal,
                              fontFeatures: tabularFigures,
                            ),
                          ),
                          const SizedBox(height: 2),
                          Text(
                            _monthShort[date.month - 1].toUpperCase(),
                            style: const TextStyle(
                              fontSize: 8.5,
                              fontWeight: FontWeight.w700,
                              letterSpacing: 0.4,
                              color: AppColors.muted,
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            hours.replaceFirst('–', ' ··· '),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              fontSize: 23,
                              height: 1.1,
                              fontWeight: FontWeight.w800,
                              letterSpacing: -0.4,
                              color: Colors.white,
                              fontFeatures: tabularFigures,
                            ),
                          ),
                          const SizedBox(height: 7),
                          Wrap(
                            spacing: 6,
                            runSpacing: 6,
                            children: [
                              _pill(
                                workday
                                    ? '${day?.lateToleranceMinutes ?? schedule.lateToleranceMinutes} menit toleransi'
                                    : 'Hari Libur',
                                background: workday
                                    ? AppColors.yellow
                                    : AppColors.surface,
                                foreground: workday
                                    ? AppColors.yellowInk
                                    : AppColors.teal,
                              ),
                              _pill(
                                holiday
                                    ? 'Libur'
                                    : workday
                                    ? 'Hari Kerja'
                                    : 'Libur Rutin',
                                background: AppColors.surface,
                                foreground: AppColors.teal,
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                Row(
                  children: [
                    const Icon(
                      Icons.free_breakfast_outlined,
                      size: 15,
                      color: Colors.white,
                    ),
                    const SizedBox(width: 6),
                    Expanded(
                      child: Text(
                        'Istirahat mengikuti kebijakan kantor',
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          fontSize: 10.5,
                          height: 1.3,
                          color: Colors.white.withValues(alpha: 0.9),
                        ),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _pill(
    String text, {
    required Color background,
    required Color foreground,
  }) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        text,
        style: TextStyle(
          fontSize: 9.5,
          fontWeight: FontWeight.w700,
          color: foreground,
          fontFeatures: tabularFigures,
        ),
      ),
    );
  }

  Widget _patternSummary(WorkSchedule schedule) {
    final workdays = schedule.weekly.where((day) => day.isWorkday).length;
    return Container(
      key: const Key('schedule-pattern-summary'),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.line),
      ),
      child: Row(
        children: [
          Expanded(
            child: _summaryColumn(
              label: 'Pola Kerja',
              value: schedule.workPatternName,
              note: '$workdays hari kerja',
            ),
          ),
          Container(width: 1, height: 38, color: AppColors.line),
          Expanded(
            child: _summaryColumn(
              label: 'Zona Waktu',
              value: _zoneLabel(schedule.timezone),
              note: schedule.officeName.isEmpty
                  ? 'Kantor'
                  : schedule.officeName,
            ),
          ),
        ],
      ),
    );
  }

  Widget _summaryColumn({
    required String label,
    required String value,
    required String note,
  }) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label,
            style: const TextStyle(fontSize: 10, color: AppColors.muted),
          ),
          const SizedBox(height: 3),
          Text(
            value,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              fontSize: 12.5,
              height: 1.25,
              fontWeight: FontWeight.w700,
              color: AppColors.ink,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            note,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(fontSize: 10, color: AppColors.muted),
          ),
        ],
      ),
    );
  }

  Widget _upcomingDay(WorkSchedule schedule, DateTime date) {
    final day = schedule.dayFor(date);
    final holiday = schedule.holidayOn(date);
    final isWorkday = day?.isWorkday ?? false;
    final isToday = DateUtils.isSameDay(date, _today);
    final workday = isWorkday && holiday == null;
    return Padding(
      key: Key('schedule-upcoming-${_dateKey(date)}'),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 11),
      child: Row(
        children: [
          Container(
            width: 42,
            padding: const EdgeInsets.symmetric(vertical: 6),
            decoration: BoxDecoration(
              color: isToday ? AppColors.greenSoft : AppColors.tableHead,
              borderRadius: BorderRadius.circular(9),
              border: Border.all(
                color: isToday ? AppColors.greenLine : AppColors.line,
              ),
            ),
            child: Column(
              children: [
                Text(
                  _dayShort[date.weekday - 1],
                  style: TextStyle(
                    fontSize: 9,
                    fontWeight: FontWeight.w600,
                    color: isToday ? AppColors.greenDark : AppColors.muted,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  _two(date.day),
                  style: TextStyle(
                    fontSize: 15,
                    height: 1,
                    fontWeight: FontWeight.w800,
                    color: isToday ? AppColors.greenDark : AppColors.ink,
                    fontFeatures: tabularFigures,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 11),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  holiday?.name ?? day?.label ?? 'Hari',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 12.5,
                    fontWeight: FontWeight.w700,
                    color: AppColors.ink,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  holiday != null
                      ? holiday.typeLabel
                      : workday
                      ? '${day?.hours ?? '—'} · toleransi '
                            '${day?.lateToleranceMinutes ?? 0} mnt'
                      : 'Libur rutin',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 10.5,
                    color: AppColors.muted,
                    fontFeatures: tabularFigures,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 6),
          Text(
            holiday != null
                ? 'Libur'
                : workday
                ? 'Kerja'
                : 'Libur',
            style: TextStyle(
              fontSize: 10,
              fontWeight: FontWeight.w700,
              color: workday ? AppColors.greenDark : AppColors.muted,
            ),
          ),
        ],
      ),
    );
  }

  List<Widget> _overtimeContent() {
    final rows =
        _overtime
            .where(
              (row) =>
                  !row.date.isBefore(_weekStart) &&
                  row.date.isBefore(_weekEnd.add(const Duration(days: 1))),
            )
            .toList(growable: false)
          ..sort((a, b) => a.date.compareTo(b.date));
    return [
      if (rows.isEmpty)
        _emptyState(
          key: const Key('schedule-overtime-empty'),
          icon: Icons.more_time,
          message: 'Belum ada jadwal lembur pada minggu ini.',
        )
      else
        Container(
          key: const Key('schedule-overtime-list'),
          decoration: BoxDecoration(
            color: AppColors.surface,
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: AppColors.line),
          ),
          child: Column(
            children: [
              for (var index = 0; index < rows.length; index++) ...[
                _overtimeRow(rows[index]),
                if (index < rows.length - 1)
                  const Divider(height: 1, indent: 14, endIndent: 14),
              ],
            ],
          ),
        ),
      const SizedBox(height: 12),
      const Text(
        'Jadwal lembur ditetapkan admin. Ajukan lembur dari menu Lembur di Beranda.',
        style: TextStyle(fontSize: 10.5, height: 1.4, color: AppColors.muted),
      ),
    ];
  }

  Widget _overtimeRow(OvertimeSchedule row) {
    final local = row.date.toLocal();
    return Padding(
      key: Key('schedule-overtime-${row.id}'),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      child: Row(
        children: [
          Container(
            width: 42,
            padding: const EdgeInsets.symmetric(vertical: 6),
            decoration: BoxDecoration(
              color: AppColors.yellowSoft,
              borderRadius: BorderRadius.circular(9),
              border: Border.all(color: AppColors.yellowLine),
            ),
            child: Column(
              children: [
                Text(
                  _dayShort[local.weekday - 1],
                  style: const TextStyle(
                    fontSize: 9,
                    fontWeight: FontWeight.w600,
                    color: AppColors.yellowInk,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  _two(local.day),
                  style: const TextStyle(
                    fontSize: 15,
                    height: 1,
                    fontWeight: FontWeight.w800,
                    color: AppColors.yellowInk,
                    fontFeatures: tabularFigures,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 11),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '${row.startTime}–${row.endTime}',
                  style: const TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w700,
                    color: AppColors.ink,
                    fontFeatures: tabularFigures,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  '${row.durationMinutes} menit'
                  '${row.notes == null || row.notes!.isEmpty ? '' : ' · ${row.notes}'}',
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 10.5,
                    height: 1.3,
                    color: AppColors.muted,
                    fontFeatures: tabularFigures,
                  ),
                ),
              ],
            ),
          ),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
            decoration: BoxDecoration(
              color: row.status == 'PLANNED'
                  ? AppColors.greenSoft
                  : AppColors.tableHead,
              borderRadius: BorderRadius.circular(999),
              border: Border.all(
                color: row.status == 'PLANNED'
                    ? AppColors.greenLine
                    : AppColors.line,
              ),
            ),
            child: Text(
              row.statusLabel,
              style: TextStyle(
                fontSize: 9.5,
                fontWeight: FontWeight.w700,
                color: row.status == 'PLANNED'
                    ? AppColors.greenDark
                    : AppColors.muted,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _emptyState({
    required Key key,
    required IconData icon,
    required String message,
    bool retry = false,
  }) {
    return Container(
      key: key,
      padding: const EdgeInsets.symmetric(vertical: 34, horizontal: 20),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.line),
      ),
      child: Column(
        children: [
          Icon(icon, size: 26, color: AppColors.muted),
          const SizedBox(height: 8),
          Text(
            message,
            textAlign: TextAlign.center,
            style: const TextStyle(fontSize: 12, color: AppColors.muted),
          ),
          if (retry) ...[
            const SizedBox(height: 10),
            OutlinedButton(onPressed: _load, child: const Text('Coba lagi')),
          ],
        ],
      ),
    );
  }
}
