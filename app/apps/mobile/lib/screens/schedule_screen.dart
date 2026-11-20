import 'package:material_ui/material_ui.dart';

import '../api/api_client.dart';
import '../models/schedule.dart';
import '../services/auth_service.dart';
import '../theme/app_theme.dart';

/// Halaman jadwal kerja mingguan dan daftar hari libur tahun berjalan.
class ScheduleScreen extends StatefulWidget {
  const ScheduleScreen({super.key, required this.auth, this.initialSchedule});

  final AuthService auth;
  final WorkSchedule? initialSchedule;

  @override
  State<ScheduleScreen> createState() => _ScheduleScreenState();
}

class _ScheduleScreenState extends State<ScheduleScreen> {
  static const _months = [
    'Januari',
    'Februari',
    'Maret',
    'April',
    'Mei',
    'Juni',
    'Juli',
    'Agustus',
    'September',
    'Oktober',
    'November',
    'Desember',
  ];

  WorkSchedule? _schedule;
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _schedule = widget.initialSchedule;
    _loading = _schedule == null;
    _load();
  }

  Future<void> _load() async {
    try {
      final schedule = await widget.auth.api.workSchedule();
      if (!mounted) return;
      setState(() {
        _schedule = schedule;
        _loading = false;
        _error = null;
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
        _error = 'Jadwal kerja tidak dapat dimuat.';
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.canvas,
      appBar: AppBar(title: const Text('Jadwal Kerja & Hari Libur')),
      body: _body(),
    );
  }

  Widget _body() {
    if (_loading) return const Center(child: CircularProgressIndicator());
    final schedule = _schedule;
    if (schedule == null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                _error ?? 'Jadwal kerja belum tersedia.',
                key: const Key('schedule-error'),
                textAlign: TextAlign.center,
                style: const TextStyle(fontSize: 12.5, color: AppColors.muted),
              ),
              const SizedBox(height: 12),
              OutlinedButton(onPressed: _load, child: const Text('Coba lagi')),
            ],
          ),
        ),
      );
    }

    final holidays = schedule.holidaysThisYear();
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 28),
      children: [
        _summaryCard(schedule),
        const SizedBox(height: 16),
        _sectionTitle('Jam Kerja / Shift', Icons.schedule_outlined),
        const SizedBox(height: 8),
        Container(
          decoration: BoxDecoration(
            color: AppColors.surface,
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: AppColors.line),
          ),
          child: Column(
            children: [
              for (var index = 0; index < schedule.weekly.length; index++) ...[
                _dayRow(schedule.weekly[index]),
                if (index < schedule.weekly.length - 1)
                  const Divider(height: 1, indent: 14, endIndent: 14),
              ],
            ],
          ),
        ),
        const SizedBox(height: 18),
        _sectionTitle(
          'Hari Libur ${holidays.isEmpty ? '' : holidays.first.date.year}',
          Icons.event_busy_outlined,
        ),
        const SizedBox(height: 8),
        if (holidays.isEmpty)
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: AppColors.surface,
              borderRadius: BorderRadius.circular(14),
              border: Border.all(color: AppColors.line),
            ),
            child: const Text(
              'Belum ada hari libur yang dicatat untuk tahun ini.',
              key: Key('schedule-holidays-empty'),
              style: TextStyle(fontSize: 12.5, color: AppColors.muted),
            ),
          )
        else
          Container(
            key: const Key('schedule-holidays'),
            decoration: BoxDecoration(
              color: AppColors.surface,
              borderRadius: BorderRadius.circular(14),
              border: Border.all(color: AppColors.line),
            ),
            child: Column(
              children: [
                for (var index = 0; index < holidays.length; index++) ...[
                  _holidayRow(holidays[index]),
                  if (index < holidays.length - 1)
                    const Divider(height: 1, indent: 14, endIndent: 14),
                ],
              ],
            ),
          ),
      ],
    );
  }

  Widget _summaryCard(WorkSchedule schedule) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.line),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 38,
                height: 38,
                decoration: BoxDecoration(
                  color: AppColors.yellowSoft,
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(color: AppColors.yellowLine),
                ),
                child: const Icon(
                  Icons.work_outline,
                  size: 19,
                  color: AppColors.yellowInk,
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      schedule.shiftName,
                      style: const TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w800,
                        color: AppColors.ink,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      [
                        schedule.officeName.isEmpty
                            ? 'Kantor belum disetel'
                            : schedule.officeName,
                        schedule.timezone,
                      ].join(' · '),
                      style: const TextStyle(
                        fontSize: 11,
                        color: AppColors.muted,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: _metric(
                  'Jam masuk',
                  schedule.workStart,
                ),
              ),
              Container(width: 1, height: 32, color: AppColors.line),
              Expanded(child: _metric('Jam pulang', schedule.workEnd)),
              Container(width: 1, height: 32, color: AppColors.line),
              Expanded(
                child: _metric(
                  'Toleransi',
                  '${schedule.lateToleranceMinutes} mnt',
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _metric(String label, String value) {
    return Column(
      children: [
        Text(
          label,
          style: const TextStyle(
            fontSize: 10,
            fontWeight: FontWeight.w600,
            color: AppColors.muted,
          ),
        ),
        const SizedBox(height: 3),
        Text(
          value,
          style: const TextStyle(
            fontSize: 15,
            fontWeight: FontWeight.w700,
            color: AppColors.ink,
            fontFeatures: tabularFigures,
          ),
        ),
      ],
    );
  }

  Widget _sectionTitle(String text, IconData icon) {
    return Row(
      children: [
        Icon(icon, size: 15, color: AppColors.muted),
        const SizedBox(width: 6),
        Text(
          text,
          style: const TextStyle(
            fontSize: 13,
            fontWeight: FontWeight.w700,
            color: AppColors.ink,
          ),
        ),
      ],
    );
  }

  Widget _dayRow(WeeklyScheduleDay day) {
    return Padding(
      key: Key('schedule-day-${day.dayOfWeek}'),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 11),
      child: Row(
        children: [
          SizedBox(
            width: 74,
            child: Text(
              day.label,
              style: TextStyle(
                fontSize: 12.5,
                fontWeight: FontWeight.w700,
                color: day.isWorkday ? AppColors.ink : AppColors.muted,
              ),
            ),
          ),
          Expanded(
            child: Text(
              day.isWorkday ? day.hours : '—',
              style: const TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w600,
                color: AppColors.ink,
                fontFeatures: tabularFigures,
              ),
            ),
          ),
          _badge(
            day.isWorkday ? 'Hari kerja' : 'Libur rutin',
            day.isWorkday
                ? (AppColors.yellowSoft, AppColors.yellowLine, AppColors.yellowInk)
                : (AppColors.tableHead, AppColors.line, AppColors.muted),
          ),
        ],
      ),
    );
  }

  Widget _holidayRow(WorkHoliday holiday) {
    return Padding(
      key: Key('schedule-holiday-${holiday.id}'),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 11),
      child: Row(
        children: [
          Container(
            width: 44,
            padding: const EdgeInsets.symmetric(vertical: 6),
            decoration: BoxDecoration(
              color: AppColors.greenSoft,
              borderRadius: BorderRadius.circular(10),
              border: Border.all(color: AppColors.greenLine),
            ),
            child: Column(
              children: [
                Text(
                  holiday.date.day.toString().padLeft(2, '0'),
                  style: const TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w800,
                    height: 1,
                    color: AppColors.greenDark,
                    fontFeatures: tabularFigures,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  _months[holiday.date.month - 1].substring(0, 3).toUpperCase(),
                  style: const TextStyle(
                    fontSize: 8.5,
                    fontWeight: FontWeight.w700,
                    letterSpacing: 0.4,
                    color: AppColors.greenDark,
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
                  holiday.name,
                  style: const TextStyle(
                    fontSize: 12.5,
                    fontWeight: FontWeight.w700,
                    color: AppColors.ink,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  '${holiday.date.day} ${_months[holiday.date.month - 1]} '
                  '${holiday.date.year}',
                  style: const TextStyle(
                    fontSize: 11,
                    color: AppColors.muted,
                    fontFeatures: tabularFigures,
                  ),
                ),
              ],
            ),
          ),
          _badge(
            holiday.typeLabel,
            holiday.isNational
                ? (AppColors.greenSoft, AppColors.greenLine, AppColors.greenDark)
                : (AppColors.tableHead, AppColors.line, AppColors.muted),
          ),
        ],
      ),
    );
  }

  Widget _badge(String text, (Color, Color, Color) colors) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: colors.$1,
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: colors.$2),
      ),
      child: Text(
        text,
        style: TextStyle(
          fontSize: 10,
          fontWeight: FontWeight.w700,
          color: colors.$3,
        ),
      ),
    );
  }
}
