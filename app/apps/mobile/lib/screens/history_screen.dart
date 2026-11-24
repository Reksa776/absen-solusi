import 'dart:typed_data';

import 'package:material_ui/material_ui.dart';

import '../api/api_client.dart';
import '../models/attendance_log.dart';
import '../models/correction.dart';
import '../services/auth_service.dart';
import '../theme/app_theme.dart';
import 'correction_form_screen.dart';

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

/// Tab Aktivitas: rekap dan log kehadiran harian.
class HistoryScreen extends StatefulWidget {
  const HistoryScreen({super.key, required this.auth, this.embedded = false});

  final AuthService auth;
  final bool embedded;

  @override
  State<HistoryScreen> createState() => _HistoryScreenState();
}

class _HistoryScreenState extends State<HistoryScreen> {
  List<AttendanceLog> _rows = const [];
  List<CorrectionRequest> _corrections = const [];
  String _period = 'WEEK';
  DateTime _anchor = DateUtils.dateOnly(DateTime.now());
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  (DateTime, DateTime) _range() {
    if (_period == 'DAY') return (_anchor, _anchor);
    if (_period == 'MONTH') {
      return (
        DateTime(_anchor.year, _anchor.month, 1),
        DateTime(_anchor.year, _anchor.month + 1, 0),
      );
    }
    final start = _anchor.subtract(Duration(days: _anchor.weekday - 1));
    return (start, start.add(const Duration(days: 6)));
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final (from, to) = _range();
      final rows = await widget.auth.api.attendanceHistory(
        from: from,
        to: DateTime(to.year, to.month, to.day, 23, 59, 59),
      );
      var corrections = const <CorrectionRequest>[];
      try {
        corrections = await widget.auth.api.myCorrections();
      } catch (_) {
        // Status revisi bersifat pelengkap.
      }
      if (!mounted) return;
      setState(() {
        _rows = rows;
        _corrections = corrections;
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
        _error = 'Aktivitas tidak dapat dimuat.';
        _loading = false;
      });
    }
  }

  Future<void> _selectPeriod(String value) async {
    if (value == 'DAY') {
      final picked = await showDatePicker(
        context: context,
        initialDate: _anchor,
        firstDate: DateTime.now().subtract(const Duration(days: 730)),
        lastDate: DateTime.now(),
      );
      if (picked == null || !mounted) return;
      setState(() {
        _period = 'DAY';
        _anchor = DateUtils.dateOnly(picked);
      });
    } else {
      setState(() {
        _period = value;
        _anchor = DateUtils.dateOnly(DateTime.now());
      });
    }
    await _load();
  }

  Future<void> _shiftRange(int direction) async {
    setState(() {
      if (_period == 'MONTH') {
        _anchor = DateTime(_anchor.year, _anchor.month + direction, 1);
      } else if (_period == 'WEEK') {
        _anchor = _anchor.add(Duration(days: 7 * direction));
      } else {
        _anchor = _anchor.add(Duration(days: direction));
      }
    });
    await _load();
  }

  List<_DayLog> get _days {
    final grouped = <String, _DayLog>{};
    for (final row in _rows) {
      final date = row.workDate ?? row.timestampServer;
      final key = _dayKey(date);
      final current = grouped.putIfAbsent(key, () => _DayLog(date));
      if (row.isCheckIn) {
        if (current.checkIn == null ||
            row.timestampServer.isAfter(current.checkIn!.timestampServer)) {
          current.checkIn = row;
        }
      } else {
        if (current.checkOut == null ||
            row.timestampServer.isAfter(current.checkOut!.timestampServer)) {
          current.checkOut = row;
        }
      }
    }
    final result = grouped.values.toList(growable: false)
      ..sort((a, b) => b.date.compareTo(a.date));
    return result;
  }

  List<_ActivityEvent> get _events {
    final grouped = <String, List<AttendanceLog>>{};
    for (final row in _rows) {
      final date = row.workDate ?? row.timestampServer;
      grouped.putIfAbsent(_dayKey(date), () => <AttendanceLog>[]).add(row);
    }
    final events = <_ActivityEvent>[];
    for (final rows in grouped.values) {
      rows.sort((a, b) => a.timestampServer.compareTo(b.timestampServer));
      for (final row in rows) {
        events.add(
          _ActivityEvent(
            date: row.workDate ?? row.timestampServer,
            type: row.type,
            log: row,
          ),
        );
      }
      final last = rows.last;
      if (last.isCheckIn) {
        events.add(
          _ActivityEvent(
            date: last.workDate ?? last.timestampServer,
            type: 'CHECK_OUT',
            log: null,
            sortAt: last.timestampServer.add(const Duration(milliseconds: 1)),
          ),
        );
      }
    }
    events.sort((a, b) => b.sortAt.compareTo(a.sortAt));
    return events;
  }

  int get _presentDays => _days.where((day) => day.checkIn != null).length;

  int get _lateDays =>
      _days.where((day) => day.checkIn?.isLate ?? false).length;

  int get _lateMinutes =>
      _days.fold(0, (total, day) => total + (day.checkIn?.lateMinutes ?? 0));

  int get _completeDays =>
      _days.where((day) => day.checkIn != null && day.checkOut != null).length;

  int get _suspiciousCount => _rows.where((row) => row.isSuspicious).length;

  String _dayKey(DateTime value) {
    final local = value.toLocal();
    return '${local.year}-${_two(local.month)}-${_two(local.day)}';
  }

  String _time(DateTime value) {
    final local = value.toLocal();
    return '${_two(local.hour)}:${_two(local.minute)}';
  }

  String _rangeLabel() {
    final (from, to) = _range();
    if (_period == 'DAY') {
      return '${from.day} ${_monthShort[from.month - 1]} ${from.year}';
    }
    if (_period == 'MONTH') {
      return '${from.day} ${_monthShort[from.month - 1]} – '
          '${to.day} ${_monthShort[to.month - 1]} ${to.year}';
    }
    return '${from.day} ${_monthShort[from.month - 1]} – '
        '${to.day} ${_monthShort[to.month - 1]} ${to.year}';
  }

  AttendanceLog? _leadLog(_DayLog day) => day.checkIn ?? day.checkOut;

  CorrectionRequest? _correctionForEvent(_ActivityEvent event) {
    CorrectionRequest? latest;
    for (final correction in _corrections) {
      if (correction.requestType != event.type) continue;
      final sameLog =
          event.log != null && correction.attendanceLogId == event.log!.id;
      final sameDay =
          _dayKey(correction.requestedTimestamp) == _dayKey(event.date);
      if (!sameLog && !sameDay) continue;
      if (latest == null || correction.createdAt.isAfter(latest.createdAt)) {
        latest = correction;
      }
    }
    return latest;
  }

  _DayLog _dayFor(_ActivityEvent event) {
    for (final day in _days) {
      if (_dayKey(day.date) == _dayKey(event.date)) return day;
    }
    return _DayLog(event.date);
  }

  Future<void> _openRevision(_ActivityEvent event) async {
    final day = _dayFor(event);
    final saved = await Navigator.of(context).push<bool>(
      MaterialPageRoute<bool>(
        fullscreenDialog: true,
        builder: (_) => CorrectionFormScreen(
          auth: widget.auth,
          initialDate: day.date.toLocal(),
          initialCheckInTime: day.checkIn?.timestampServer.toLocal(),
          initialCheckOutTime: day.checkOut?.timestampServer.toLocal(),
          initialKind: 'ADJUST',
          logType: event.type,
          attendanceLogId: event.log?.id,
        ),
      ),
    );
    if (saved == true && mounted) await _load();
  }

  Future<void> _openMissedRevision() async {
    final saved = await Navigator.of(context).push<bool>(
      MaterialPageRoute<bool>(
        builder: (_) => CorrectionFormScreen(
          auth: widget.auth,
          initialKind: 'LUPA_FULL',
          initialDate: DateTime.now().subtract(const Duration(days: 1)),
        ),
      ),
    );
    if (saved == true && mounted) await _load();
  }

  @override
  Widget build(BuildContext context) {
    final content = Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _header(),
        _periodChips(),
        _rangeBar(),
        const SizedBox(height: 4),
        Expanded(child: _body()),
      ],
    );
    if (widget.embedded) return SafeArea(bottom: false, child: content);
    return Scaffold(
      backgroundColor: AppColors.canvas,
      appBar: AppBar(title: const Text('Aktivitas')),
      body: content,
    );
  }

  Widget _header() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Expanded(
                child: Text(
                  'Aktivitas',
                  style: TextStyle(
                    fontSize: 23,
                    fontWeight: FontWeight.w800,
                    letterSpacing: -0.5,
                    color: AppColors.ink,
                  ),
                ),
              ),
              TextButton.icon(
                key: const Key('history-revise-missed'),
                onPressed: _openMissedRevision,
                icon: const Icon(Icons.edit_calendar_outlined, size: 16),
                label: const Text('Revisi'),
              ),
            ],
          ),
          const Text(
            'Riwayat dan rekap kehadiran Anda.',
            style: TextStyle(fontSize: 12, color: AppColors.muted),
          ),
          const SizedBox(height: 10),
          _stats(),
        ],
      ),
    );
  }

  Widget _periodChips() {
    const values = [
      ('WEEK', 'Mingguan'),
      ('MONTH', 'Bulanan'),
      ('DAY', 'Pilih Tanggal'),
    ];
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 6),
      child: Row(
        children: [
          for (final (value, label) in values)
            Padding(
              padding: const EdgeInsets.only(right: 8),
              child: Material(
                color: _period == value
                    ? AppColors.greenSoft
                    : AppColors.surface,
                borderRadius: BorderRadius.circular(999),
                child: InkWell(
                  key: Key('activity-period-$value'),
                  borderRadius: BorderRadius.circular(999),
                  onTap: () => _selectPeriod(value),
                  child: Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 11,
                      vertical: 6,
                    ),
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(999),
                      border: Border.all(
                        color: _period == value
                            ? AppColors.greenLine
                            : AppColors.line,
                      ),
                    ),
                    child: Text(
                      label,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        fontSize: 11,
                        fontWeight: FontWeight.w700,
                        color: _period == value
                            ? AppColors.greenDark
                            : AppColors.muted,
                      ),
                    ),
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }

  Widget _rangeBar() {
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 16),
      padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 2),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppColors.line),
      ),
      child: Row(
        children: [
          IconButton(
            key: const Key('activity-range-prev'),
            tooltip: 'Periode sebelumnya',
            visualDensity: VisualDensity.compact,
            onPressed: () => _shiftRange(-1),
            icon: const Icon(Icons.chevron_left, size: 20),
          ),
          Expanded(
            child: Text(
              _rangeLabel(),
              textAlign: TextAlign.center,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                fontSize: 11.5,
                fontWeight: FontWeight.w700,
                color: AppColors.ink,
                fontFeatures: tabularFigures,
              ),
            ),
          ),
          IconButton(
            key: const Key('activity-range-next'),
            tooltip: 'Periode berikutnya',
            visualDensity: VisualDensity.compact,
            onPressed: () => _shiftRange(1),
            icon: const Icon(Icons.chevron_right, size: 20),
          ),
        ],
      ),
    );
  }

  Widget _stats() {
    return SizedBox(
      height: 104,
      child: ListView(
        scrollDirection: Axis.horizontal,
        children: [
          _summaryStat(),
          const SizedBox(width: 8),
          _numberStat(
            key: const Key('activity-stat-present'),
            label: 'Total Kehadiran',
            value: '$_presentDays',
            note: '$_completeDays hari lengkap',
            icon: Icons.fact_check_outlined,
          ),
          const SizedBox(width: 8),
          _numberStat(
            key: const Key('activity-stat-late'),
            label: 'Total Terlambat',
            value: '$_lateDays',
            note: '$_lateMinutes menit',
            icon: Icons.timer_outlined,
            warning: true,
          ),
        ],
      ),
    );
  }

  Widget _summaryStat() {
    return Material(
      key: const Key('activity-summary-card'),
      color: AppColors.greenSoft,
      borderRadius: BorderRadius.circular(13),
      child: InkWell(
        borderRadius: BorderRadius.circular(13),
        onTap: _showSummary,
        child: Container(
          width: 172,
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(13),
            border: Border.all(color: AppColors.greenLine),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  const Expanded(
                    child: Text(
                      'Detail Ringkasan',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        fontSize: 10.5,
                        fontWeight: FontWeight.w700,
                        color: AppColors.greenDark,
                      ),
                    ),
                  ),
                  Container(
                    width: 24,
                    height: 24,
                    decoration: const BoxDecoration(
                      color: AppColors.green,
                      shape: BoxShape.circle,
                    ),
                    child: const Icon(
                      Icons.arrow_outward,
                      size: 14,
                      color: Colors.white,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 6),
              Text(
                '$_presentDays hadir · $_lateDays telat',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  fontSize: 14,
                  height: 1.2,
                  fontWeight: FontWeight.w800,
                  color: AppColors.greenDark,
                  fontFeatures: tabularFigures,
                ),
              ),
              const SizedBox(height: 2),
              const Text(
                'Lihat rekap periode',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontSize: 9.5,
                  height: 1.3,
                  color: AppColors.greenDark,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _numberStat({
    required Key key,
    required String label,
    required String value,
    required String note,
    required IconData icon,
    bool warning = false,
  }) {
    return Container(
      key: key,
      width: 142,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(13),
        border: Border.all(color: AppColors.line),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(
                icon,
                size: 15,
                color: warning ? AppColors.amber : AppColors.green,
              ),
              const SizedBox(width: 6),
              Expanded(
                child: Text(
                  label,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 10,
                    height: 1.2,
                    fontWeight: FontWeight.w600,
                    color: AppColors.muted,
                  ),
                ),
              ),
            ],
          ),
          const Spacer(),
          Text(
            value,
            style: TextStyle(
              fontSize: 27,
              height: 1,
              fontWeight: FontWeight.w800,
              color: warning ? AppColors.amber : AppColors.ink,
              fontFeatures: tabularFigures,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            note,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              fontSize: 9.5,
              color: AppColors.muted,
              fontFeatures: tabularFigures,
            ),
          ),
        ],
      ),
    );
  }

  Widget _body() {
    if (_loading) return const Center(child: CircularProgressIndicator());
    if (_error != null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                _error!,
                key: const Key('history-error'),
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
    final events = _events;
    if (events.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 52,
              height: 52,
              decoration: BoxDecoration(
                color: AppColors.surface,
                borderRadius: BorderRadius.circular(14),
                border: Border.all(color: AppColors.line),
              ),
              child: const Icon(
                Icons.history_rounded,
                size: 24,
                color: AppColors.muted,
              ),
            ),
            const SizedBox(height: 10),
            const Text(
              'Belum ada aktivitas pada periode ini.',
              key: Key('history-empty'),
              textAlign: TextAlign.center,
              style: TextStyle(
                fontSize: 12.5,
                fontWeight: FontWeight.w600,
                color: AppColors.muted,
              ),
            ),
          ],
        ),
      );
    }
    return RefreshIndicator(
      color: AppColors.green,
      onRefresh: _load,
      child: ListView.separated(
        key: const Key('history-list'),
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(16, 6, 16, 24),
        itemCount: events.length,
        separatorBuilder: (_, _) => const SizedBox(height: 9),
        itemBuilder: (context, index) => _activityCard(events[index]),
      ),
    );
  }

  Widget _activityCard(_ActivityEvent event) {
    final row = event.log;
    final correction = _correctionForEvent(event);
    final local = event.date.toLocal();
    final isCheckIn = event.type == 'CHECK_IN';
    final time = row == null ? '—' : _time(row.timestampServer);
    final eventKey = row?.id ?? '${_dayKey(event.date)}-check-out';
    return Row(
      key: Key('history-card-${event.type}-$eventKey'),
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _dateBadge(local),
        const SizedBox(width: 9),
        Expanded(
          child: Material(
            color: AppColors.surface,
            borderRadius: BorderRadius.circular(13),
            child: InkWell(
              key: Key('history-detail-${event.type}-$eventKey'),
              borderRadius: BorderRadius.circular(13),
              onTap: () => _showDetail(_dayFor(event)),
              child: Container(
                padding: const EdgeInsets.fromLTRB(12, 10, 10, 7),
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(13),
                  border: Border.all(color: AppColors.line),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Row(
                      children: [
                        Icon(
                          isCheckIn ? Icons.login : Icons.logout,
                          size: 15,
                          color: isCheckIn
                              ? AppColors.greenDark
                              : AppColors.muted,
                        ),
                        const SizedBox(width: 6),
                        Expanded(
                          child: Text(
                            isCheckIn ? 'Masuk' : 'Keluar',
                            style: const TextStyle(
                              fontSize: 12.5,
                              fontWeight: FontWeight.w800,
                              color: AppColors.ink,
                            ),
                          ),
                        ),
                        _eventStatusPill(event),
                      ],
                    ),
                    const SizedBox(height: 6),
                    Text(
                      time,
                      key: Key('history-time-${event.type}-$eventKey'),
                      style: const TextStyle(
                        fontSize: 26,
                        height: 1,
                        fontWeight: FontWeight.w800,
                        letterSpacing: -0.5,
                        color: AppColors.ink,
                        fontFeatures: tabularFigures,
                      ),
                    ),
                    const SizedBox(height: 7),
                    Row(
                      children: [
                        _indicator(
                          Icons.my_location,
                          'GPS terverifikasi',
                          row != null && !row.isSuspicious && !row.outOfRadius,
                        ),
                        const SizedBox(width: 6),
                        _indicator(
                          Icons.schedule,
                          'Sesuai Pola Kerja',
                          row?.attendanceStatus != null,
                        ),
                        const SizedBox(width: 6),
                        _indicator(
                          Icons.fingerprint,
                          row == null ? 'Belum tercatat' : 'Waktu tercatat',
                          row != null,
                        ),
                        const Spacer(),
                        TextButton.icon(
                          key: Key('history-revise-$eventKey'),
                          onPressed: () => _openRevision(event),
                          icon: const Icon(
                            Icons.edit_calendar_outlined,
                            size: 14,
                          ),
                          label: const Text('Revisi'),
                          style: TextButton.styleFrom(
                            padding: const EdgeInsets.symmetric(horizontal: 4),
                            minimumSize: const Size(0, 30),
                            tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                            textStyle: const TextStyle(
                              fontSize: 10.5,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ),
                      ],
                    ),
                    if (correction != null)
                      Align(
                        alignment: Alignment.centerRight,
                        child: _correctionPill(correction),
                      ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ],
    );
  }

  Widget _eventStatusPill(_ActivityEvent event) {
    final row = event.log;
    final String label;
    final (Color bg, Color border, Color fg) colors;
    if (row == null) {
      label = 'Belum tercatat';
      colors = (
        AppColors.yellowSoft,
        AppColors.yellowLine,
        AppColors.yellowInk,
      );
    } else if (row.isApprovalPending) {
      label = 'Menunggu';
      colors = (
        AppColors.yellowSoft,
        AppColors.yellowLine,
        AppColors.yellowInk,
      );
    } else if (row.isApprovalRejected) {
      label = 'Ditolak';
      colors = (
        AppColors.dangerSoft,
        AppColors.danger.withValues(alpha: 0.25),
        AppColors.danger,
      );
    } else if (row.isOutOfTown) {
      label = 'Luar Kota';
      colors = (AppColors.greenSoft, AppColors.greenLine, AppColors.greenDark);
    } else if (row.isSuspicious) {
      label = 'Perlu Tinjau';
      colors = (
        AppColors.dangerSoft,
        AppColors.danger.withValues(alpha: 0.25),
        AppColors.danger,
      );
    } else if (event.type == 'CHECK_IN' && row.isLate) {
      label = 'Terlambat';
      colors = (
        AppColors.yellowSoft,
        AppColors.yellowLine,
        AppColors.yellowInk,
      );
    } else if (event.type == 'CHECK_OUT' && row.isEarlyLeave) {
      label = 'Pulang Awal';
      colors = (
        AppColors.yellowSoft,
        AppColors.yellowLine,
        AppColors.yellowInk,
      );
    } else {
      label = 'Tepat Waktu';
      colors = (AppColors.greenSoft, AppColors.greenLine, AppColors.greenDark);
    }
    return Container(
      constraints: const BoxConstraints(maxWidth: 96),
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 4),
      decoration: BoxDecoration(
        color: colors.$1,
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: colors.$2),
      ),
      child: Text(
        label,
        textAlign: TextAlign.center,
        maxLines: 2,
        overflow: TextOverflow.ellipsis,
        style: TextStyle(
          fontSize: 8.5,
          height: 1.15,
          fontWeight: FontWeight.w700,
          color: colors.$3,
        ),
      ),
    );
  }

  Widget _dateBadge(DateTime date) {
    return Container(
      width: 48,
      padding: const EdgeInsets.symmetric(vertical: 8),
      decoration: BoxDecoration(
        color: AppColors.greenSoft,
        borderRadius: BorderRadius.circular(11),
        border: Border.all(color: AppColors.greenLine),
      ),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Text(
            _two(date.day),
            style: const TextStyle(
              fontSize: 18,
              height: 1,
              fontWeight: FontWeight.w800,
              color: AppColors.greenDark,
              fontFeatures: tabularFigures,
            ),
          ),
          const SizedBox(height: 3),
          Text(
            _dayShort[date.weekday - 1],
            style: const TextStyle(
              fontSize: 9,
              fontWeight: FontWeight.w600,
              color: AppColors.greenDark,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            '${_monthShort[date.month - 1]} ${date.year}',
            textAlign: TextAlign.center,
            style: const TextStyle(
              fontSize: 7.5,
              color: AppColors.greenDark,
              fontFeatures: tabularFigures,
            ),
          ),
        ],
      ),
    );
  }

  Widget _statusPill(_DayLog day) {
    final outOfTown =
        day.checkIn?.isOutOfTown == true || day.checkOut?.isOutOfTown == true;
    final pending =
        (day.checkIn?.isApprovalPending ?? false) ||
        (day.checkOut?.isApprovalPending ?? false);
    final rejected =
        (day.checkIn?.isApprovalRejected ?? false) ||
        (day.checkOut?.isApprovalRejected ?? false);
    final suspicious =
        (day.checkIn?.isSuspicious ?? false) ||
        (day.checkOut?.isSuspicious ?? false);
    final late = day.checkIn?.isLate ?? false;
    final String label;
    final (Color bg, Color border, Color fg) colors;
    if (outOfTown) {
      label = pending
          ? 'Luar Kota - Pending'
          : rejected
          ? 'Luar Kota - Ditolak'
          : 'Luar Kota - Disetujui';
      colors = pending
          ? (AppColors.yellowSoft, AppColors.yellowLine, AppColors.yellowInk)
          : rejected
          ? (
              AppColors.dangerSoft,
              AppColors.danger.withValues(alpha: 0.25),
              AppColors.danger,
            )
          : (AppColors.greenSoft, AppColors.greenLine, AppColors.greenDark);
    } else if (suspicious) {
      label = 'Perlu Tinjau';
      colors = (
        AppColors.dangerSoft,
        AppColors.danger.withValues(alpha: 0.25),
        AppColors.danger,
      );
    } else if (late) {
      label = 'Terlambat';
      colors = (
        AppColors.yellowSoft,
        AppColors.yellowLine,
        AppColors.yellowInk,
      );
    } else {
      label = 'Tepat Waktu';
      colors = (AppColors.greenSoft, AppColors.greenLine, AppColors.greenDark);
    }
    return Container(
      constraints: const BoxConstraints(maxWidth: 96),
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 4),
      decoration: BoxDecoration(
        color: colors.$1,
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: colors.$2),
      ),
      child: Text(
        label,
        textAlign: TextAlign.center,
        maxLines: 2,
        overflow: TextOverflow.ellipsis,
        style: TextStyle(
          fontSize: 8.5,
          height: 1.15,
          fontWeight: FontWeight.w700,
          color: colors.$3,
        ),
      ),
    );
  }

  Widget _indicator(IconData icon, String tooltip, bool active) {
    return Tooltip(
      message: tooltip,
      child: Icon(
        icon,
        size: 13,
        color: active ? AppColors.green : AppColors.muted,
      ),
    );
  }

  Widget _correctionPill(CorrectionRequest correction) {
    final (
      Color background,
      Color border,
      Color foreground,
    ) = switch (correction.status) {
      'APPROVED' => (
        AppColors.greenSoft,
        AppColors.greenLine,
        AppColors.greenDark,
      ),
      'REJECTED' => (
        AppColors.dangerSoft,
        AppColors.danger.withValues(alpha: 0.25),
        AppColors.danger,
      ),
      _ => (AppColors.yellowSoft, AppColors.yellowLine, AppColors.yellowInk),
    };
    return Container(
      key: Key('history-correction-${correction.id}'),
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: border),
      ),
      child: Text(
        'Revisi: ${correction.statusLabel}',
        style: TextStyle(
          fontSize: 8.5,
          fontWeight: FontWeight.w700,
          color: foreground,
        ),
      ),
    );
  }

  Future<void> _showSummary() async {
    await showModalBottomSheet<void>(
      context: context,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(18)),
      ),
      builder: (sheetContext) => SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(18, 10, 18, 18),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              _sheetHandle(),
              const Text(
                'Detail Ringkasan Kehadiran',
                style: TextStyle(
                  fontSize: 15,
                  fontWeight: FontWeight.w800,
                  color: AppColors.ink,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                _rangeLabel(),
                style: const TextStyle(
                  fontSize: 11,
                  color: AppColors.muted,
                  fontFeatures: tabularFigures,
                ),
              ),
              const SizedBox(height: 14),
              Row(
                children: [
                  _sheetMetric('Hadir', '$_presentDays', 'hari'),
                  _sheetMetric('Lengkap', '$_completeDays', 'hari'),
                  _sheetMetric('Telat', '$_lateDays', 'hari'),
                  _sheetMetric('Menit telat', '$_lateMinutes', 'mnt'),
                ],
              ),
              const SizedBox(height: 12),
              if (_suspiciousCount > 0)
                Container(
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: AppColors.yellowSoft,
                    borderRadius: BorderRadius.circular(10),
                    border: Border.all(color: AppColors.yellowLine),
                  ),
                  child: Text(
                    '$_suspiciousCount log perlu ditinjau.',
                    style: const TextStyle(
                      fontSize: 11,
                      color: AppColors.yellowInk,
                      fontFeatures: tabularFigures,
                    ),
                  ),
                )
              else
                const Text(
                  'Semua log pada periode ini tercatat normal.',
                  style: TextStyle(fontSize: 11, color: AppColors.muted),
                ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _sheetMetric(String label, String value, String unit) {
    return Expanded(
      child: Column(
        children: [
          Text(
            value,
            style: const TextStyle(
              fontSize: 20,
              fontWeight: FontWeight.w800,
              color: AppColors.ink,
              fontFeatures: tabularFigures,
            ),
          ),
          Text(
            unit,
            style: const TextStyle(fontSize: 8.5, color: AppColors.muted),
          ),
          const SizedBox(height: 3),
          Text(
            label,
            textAlign: TextAlign.center,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              fontSize: 8.5,
              height: 1.15,
              color: AppColors.muted,
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _showDetail(_DayLog day) async {
    final lead = _leadLog(day);
    if (lead == null) return;
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(18)),
      ),
      builder: (sheetContext) => SafeArea(
        top: false,
        child: ConstrainedBox(
          constraints: BoxConstraints(
            maxHeight: MediaQuery.sizeOf(sheetContext).height * 0.88,
          ),
          child: SingleChildScrollView(
            padding: const EdgeInsets.fromLTRB(18, 10, 18, 18),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                _sheetHandle(),
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        '${_dayShort[day.date.weekday - 1]}, '
                        '${day.date.day} ${_monthShort[day.date.month - 1]} '
                        '${day.date.year}',
                        style: const TextStyle(
                          fontSize: 15,
                          fontWeight: FontWeight.w800,
                          color: AppColors.ink,
                          fontFeatures: tabularFigures,
                        ),
                      ),
                    ),
                    _statusPill(day),
                  ],
                ),
                const SizedBox(height: 12),
                _photo(lead),
                const SizedBox(height: 12),
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: AppColors.canvas,
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: AppColors.line),
                  ),
                  child: Column(
                    children: [
                      _detailRow(
                        'Masuk',
                        day.checkIn == null
                            ? '—'
                            : _time(day.checkIn!.timestampServer),
                      ),
                      _detailRow(
                        'Keluar',
                        day.checkOut == null
                            ? '—'
                            : _time(day.checkOut!.timestampServer),
                      ),
                      _detailRow(
                        'Jarak radius',
                        '${lead.distanceMeters.toStringAsFixed(0)} m',
                      ),
                      _detailRow(
                        'Akurasi GPS',
                        '${lead.accuracyMeters.toStringAsFixed(0)} m',
                      ),
                      _detailRow(
                        'Mode',
                        lead.isOutOfTown ? 'Dinas luar kota' : 'Kantor',
                      ),
                      if (lead.isLate)
                        _detailRow(
                          'Keterlambatan',
                          '${lead.lateMinutes} menit',
                        ),
                      if (lead.isEarlyLeave)
                        _detailRow(
                          'Pulang awal',
                          '${lead.earlyLeaveMinutes} menit',
                        ),
                    ],
                  ),
                ),
                if (lead.outOfTownReason != null &&
                    lead.outOfTownReason!.isNotEmpty) ...[
                  const SizedBox(height: 10),
                  Text(
                    lead.outOfTownReason!,
                    maxLines: 3,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      fontSize: 11,
                      height: 1.4,
                      color: AppColors.muted,
                    ),
                  ),
                ],
                const SizedBox(height: 12),
                SizedBox(
                  height: 44,
                  child: OutlinedButton.icon(
                    key: const Key('history-detail-revise'),
                    onPressed: () {
                      Navigator.of(sheetContext).pop();
                      final lead = _leadLog(day);
                      if (lead != null) {
                        _openRevision(
                          _ActivityEvent(
                            date: day.date,
                            type: lead.type,
                            log: lead,
                          ),
                        );
                      }
                    },
                    icon: const Icon(Icons.edit_calendar_outlined, size: 16),
                    label: const Text('Ajukan Revisi Kehadiran'),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _photo(AttendanceLog log) {
    if (log.photoUrl.isEmpty) return _photoPlaceholder();
    return ClipRRect(
      borderRadius: BorderRadius.circular(12),
      child: FutureBuilder<Uint8List?>(
        future: widget.auth.api.attendancePhotoBytes(log.photoUrl),
        builder: (context, snapshot) {
          if (snapshot.connectionState != ConnectionState.done) {
            return Container(
              height: 170,
              color: AppColors.tableHead,
              child: const Center(
                child: SizedBox.square(
                  dimension: 18,
                  child: CircularProgressIndicator(strokeWidth: 2),
                ),
              ),
            );
          }
          final bytes = snapshot.data;
          if (bytes == null || bytes.isEmpty) return _photoPlaceholder();
          return Image.memory(
            bytes,
            height: 170,
            width: double.infinity,
            fit: BoxFit.cover,
            errorBuilder: (_, _, _) => _photoPlaceholder(),
          );
        },
      ),
    );
  }

  Widget _photoPlaceholder() {
    return Container(
      height: 110,
      decoration: BoxDecoration(
        color: AppColors.tableHead,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.line),
      ),
      child: const Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(Icons.no_photography_outlined, size: 24, color: AppColors.muted),
          SizedBox(height: 5),
          Text(
            'Foto selfie tidak tersedia',
            style: TextStyle(fontSize: 10.5, color: AppColors.muted),
          ),
        ],
      ),
    );
  }

  Widget _detailRow(String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        children: [
          Expanded(
            child: Text(
              label,
              style: const TextStyle(fontSize: 11, color: AppColors.muted),
            ),
          ),
          Text(
            value,
            style: const TextStyle(
              fontSize: 11.5,
              fontWeight: FontWeight.w700,
              color: AppColors.ink,
              fontFeatures: tabularFigures,
            ),
          ),
        ],
      ),
    );
  }

  Widget _sheetHandle() {
    return Center(
      child: Container(
        width: 36,
        height: 4,
        margin: const EdgeInsets.only(bottom: 12),
        decoration: BoxDecoration(
          color: AppColors.line,
          borderRadius: BorderRadius.circular(999),
        ),
      ),
    );
  }
}

class _DayLog {
  _DayLog(this.date);

  final DateTime date;
  AttendanceLog? checkIn;
  AttendanceLog? checkOut;
}

class _ActivityEvent {
  _ActivityEvent({
    required this.date,
    required this.type,
    required this.log,
    DateTime? sortAt,
  }) : sortAt = sortAt ?? log?.timestampServer ?? date;

  final DateTime date;
  final String type;
  final AttendanceLog? log;
  final DateTime sortAt;
}
