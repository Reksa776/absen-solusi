import 'package:material_ui/material_ui.dart';

import '../api/api_client.dart';
import '../models/attendance_log.dart';
import '../models/correction.dart';
import '../services/auth_service.dart';
import '../theme/app_theme.dart';
import 'correction_form_screen.dart';

class HistoryScreen extends StatefulWidget {
  const HistoryScreen({super.key, required this.auth, this.embedded = false});

  final AuthService auth;
  final bool embedded;

  @override
  State<HistoryScreen> createState() => _HistoryScreenState();
}

class _HistoryScreenState extends State<HistoryScreen> {
  static const _monthNames = [
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

  List<AttendanceLog> _rows = const [];
  List<CorrectionRequest> _corrections = const [];
  String _month = 'ALL';
  String _status = 'ALL';
  bool _loading = true;
  String? _error;

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
      final (from, to) = _monthRange(_month);
      final rows = await widget.auth.api.attendanceHistory(from: from, to: to);
      var corrections = const <CorrectionRequest>[];
      try {
        corrections = await widget.auth.api.myCorrections();
      } catch (_) {
        // Status revisi bersifat pelengkap; riwayat tetap tampil tanpa itu.
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
        _error = 'Riwayat absensi tidak dapat dimuat.';
        _loading = false;
      });
    }
  }

  (DateTime?, DateTime?) _monthRange(String key) {
    final now = DateTime.now();
    if (key == 'CURRENT') {
      return (
        DateTime(now.year, now.month, 1),
        DateTime(now.year, now.month + 1, 0, 23, 59, 59),
      );
    }
    if (key == 'PREVIOUS') {
      final previous = DateTime(now.year, now.month - 1, 1);
      return (
        previous,
        DateTime(previous.year, previous.month + 1, 0, 23, 59, 59),
      );
    }
    return (null, null);
  }

  Future<void> _selectMonth(String key) async {
    if (_month == key) return;
    setState(() => _month = key);
    await _load();
  }

  List<AttendanceLog> get _visible {
    if (_status == 'SUSPICIOUS') {
      return _rows.where((row) => row.isSuspicious).toList(growable: false);
    }
    if (_status == 'OK') {
      return _rows.where((row) => !row.isSuspicious).toList(growable: false);
    }
    return _rows;
  }

  int get _presentDays => _rows
      .where((row) => row.isCheckIn)
      .map((row) => _dayKey(row.timestampServer))
      .toSet()
      .length;

  int get _completeDays {
    final checkIns = <String>{};
    final checkOuts = <String>{};
    for (final row in _rows) {
      (row.isCheckIn ? checkIns : checkOuts).add(_dayKey(row.timestampServer));
    }
    return checkIns.intersection(checkOuts).length;
  }

  int get _suspiciousCount => _rows.where((row) => row.isSuspicious).length;

  String _dayKey(DateTime value) {
    final local = value.toLocal();
    return '${local.year}-${local.month}-${local.day}';
  }

  String _time(DateTime value) {
    final local = value.toLocal();
    final hour = local.hour.toString().padLeft(2, '0');
    final minute = local.minute.toString().padLeft(2, '0');
    return '$hour:$minute';
  }

  String _longDate(DateTime value) {
    final local = value.toLocal();
    return '${local.day.toString().padLeft(2, '0')} '
        '${_monthNames[local.month - 1]} ${local.year}';
  }

  AttendanceLog? _siblingOf(AttendanceLog row, bool checkIn) {
    final key = _dayKey(row.timestampServer);
    for (final candidate in _rows) {
      if (candidate.isCheckIn == checkIn &&
          _dayKey(candidate.timestampServer) == key) {
        return candidate;
      }
    }
    return null;
  }

  CorrectionRequest? _correctionFor(AttendanceLog row) {
    CorrectionRequest? latest;
    for (final correction in _corrections) {
      if (correction.requestType != row.type) continue;
      final sameLog = correction.attendanceLogId == row.id;
      final sameDay =
          _dayKey(correction.requestedTimestamp) == _dayKey(row.timestampServer);
      if (!sameLog && !sameDay) continue;
      if (latest == null || correction.createdAt.isAfter(latest.createdAt)) {
        latest = correction;
      }
    }
    return latest;
  }

  Future<void> _openRevision(AttendanceLog row) async {
    final checkIn = row.isCheckIn ? row : _siblingOf(row, true);
    final checkOut = row.isCheckOut ? row : _siblingOf(row, false);
    final saved = await Navigator.of(context).push<bool>(
      MaterialPageRoute<bool>(
        builder: (_) => CorrectionFormScreen(
          auth: widget.auth,
          initialDate: row.timestampServer.toLocal(),
          initialCheckInTime: checkIn?.timestampServer.toLocal(),
          initialCheckOutTime: checkOut?.timestampServer.toLocal(),
          initialKind: 'ADJUST',
          logType: row.type,
          attendanceLogId: row.id,
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
        _filters(),
        Expanded(child: _body()),
      ],
    );
    if (widget.embedded) {
      return SafeArea(bottom: false, child: content);
    }
    return Scaffold(
      backgroundColor: AppColors.canvas,
      appBar: AppBar(title: const Text('Riwayat Absensi')),
      body: content,
    );
  }

  Widget _header() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Expanded(
                child: Text(
                  'Riwayat',
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
                icon: const Icon(Icons.assignment_late_outlined, size: 16),
                label: const Text('Revisi'),
              ),
            ],
          ),
          const Text(
            'Rekap kehadiran dan log harian Anda.',
            style: TextStyle(fontSize: 12, color: AppColors.muted),
          ),
          const SizedBox(height: 12),
          Container(
            padding: const EdgeInsets.symmetric(vertical: 12),
            decoration: BoxDecoration(
              color: AppColors.surface,
              borderRadius: BorderRadius.circular(14),
              border: Border.all(color: AppColors.line),
            ),
            child: Row(
              children: [
                _stat('Hadir', '$_presentDays', 'hari'),
                _statDivider(),
                _stat('Lengkap', '$_completeDays', 'hari'),
                _statDivider(),
                _stat('Perlu tinjau', '$_suspiciousCount', 'log', warn: true),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _stat(String label, String value, String unit, {bool warn = false}) {
    return Expanded(
      child: Column(
        children: [
          Text(
            label,
            style: const TextStyle(
              fontSize: 10,
              fontWeight: FontWeight.w600,
              letterSpacing: 0.2,
              color: AppColors.muted,
            ),
          ),
          const SizedBox(height: 3),
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            crossAxisAlignment: CrossAxisAlignment.baseline,
            textBaseline: TextBaseline.alphabetic,
            children: [
              Text(
                value,
                style: TextStyle(
                  fontSize: 18,
                  fontWeight: FontWeight.w800,
                  color: warn ? AppColors.amber : AppColors.ink,
                  fontFeatures: tabularFigures,
                ),
              ),
              const SizedBox(width: 3),
              Text(
                unit,
                style: const TextStyle(
                  fontSize: 10,
                  fontWeight: FontWeight.w600,
                  color: AppColors.muted,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _statDivider() =>
      Container(width: 1, height: 30, color: AppColors.line);

  Widget _filters() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
          child: Row(
            children: [
              _chip(
                key: 'history-month-ALL',
                label: 'Semua bulan',
                selected: _month == 'ALL',
                onTap: () => _selectMonth('ALL'),
              ),
              _chip(
                key: 'history-month-CURRENT',
                label: 'Bulan ini',
                selected: _month == 'CURRENT',
                onTap: () => _selectMonth('CURRENT'),
              ),
              _chip(
                key: 'history-month-PREVIOUS',
                label: 'Bulan lalu',
                selected: _month == 'PREVIOUS',
                onTap: () => _selectMonth('PREVIOUS'),
              ),
            ],
          ),
        ),
        SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
          child: Row(
            children: [
              _chip(
                key: 'history-status-ALL',
                label: 'Semua status',
                selected: _status == 'ALL',
                onTap: () => setState(() => _status = 'ALL'),
              ),
              _chip(
                key: 'history-status-OK',
                label: 'Normal',
                selected: _status == 'OK',
                onTap: () => setState(() => _status = 'OK'),
              ),
              _chip(
                key: 'history-status-SUSPICIOUS',
                label: 'Perlu tinjau',
                selected: _status == 'SUSPICIOUS',
                onTap: () => setState(() => _status = 'SUSPICIOUS'),
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _chip({
    required String key,
    required String label,
    required bool selected,
    required VoidCallback onTap,
  }) {
    return Padding(
      padding: const EdgeInsets.only(right: 8),
      child: Material(
        color: selected ? AppColors.greenSoft : AppColors.surface,
        borderRadius: BorderRadius.circular(999),
        child: InkWell(
          key: Key(key),
          borderRadius: BorderRadius.circular(999),
          onTap: onTap,
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(999),
              border: Border.all(
                color: selected ? AppColors.greenLine : AppColors.line,
              ),
            ),
            child: Text(
              label,
              style: TextStyle(
                fontSize: 11.5,
                fontWeight: FontWeight.w700,
                color: selected ? AppColors.greenDark : AppColors.muted,
              ),
            ),
          ),
        ),
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
    final rows = _visible;
    if (rows.isEmpty) {
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
              'Belum ada riwayat absensi.',
              key: Key('history-empty'),
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
        padding: const EdgeInsets.fromLTRB(16, 4, 16, 24),
        itemCount: rows.length,
        separatorBuilder: (_, _) => const SizedBox(height: 10),
        itemBuilder: (context, index) => _logCard(rows[index]),
      ),
    );
  }

  Widget _logCard(AttendanceLog row) {
    final correction = _correctionFor(row);
    return Container(
      key: Key('history-card-${row.id}'),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.line),
      ),
      child: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 12, 12, 10),
            child: Row(
              children: [
                _dateBlock(row.timestampServer),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        '${row.label} • ${_time(row.timestampServer)}',
                        style: const TextStyle(
                          fontSize: 13.5,
                          fontWeight: FontWeight.w700,
                          color: AppColors.ink,
                          fontFeatures: tabularFigures,
                        ),
                      ),
                      const SizedBox(height: 3),
                      Text(
                        '${_longDate(row.timestampServer)} • '
                        'jarak ${row.distanceMeters.toStringAsFixed(0)} m • '
                        'akurasi ${row.accuracyMeters.toStringAsFixed(0)} m',
                        style: const TextStyle(
                          fontSize: 11,
                          height: 1.35,
                          color: AppColors.muted,
                          fontFeatures: tabularFigures,
                        ),
                      ),
                      if (row.isOutOfTown) ...[
                        const SizedBox(height: 4),
                        Text(
                          'Dinas luar kota'
                          '${row.outOfTownReason == null ? '' : ' • ${row.outOfTownReason}'}',
                          key: Key('history-out-of-town-${row.id}'),
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            fontSize: 10.5,
                            height: 1.35,
                            color: AppColors.yellowInk,
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
                const SizedBox(width: 8),
                _attendancePill(row),
              ],
            ),
          ),
          const Divider(height: 1),
          Padding(
            padding: const EdgeInsets.fromLTRB(6, 2, 10, 2),
            child: Row(
              children: [
                TextButton.icon(
                  key: Key('history-revise-${row.id}'),
                  onPressed: () => _openRevision(row),
                  icon: const Icon(Icons.edit_calendar_outlined, size: 15),
                  label: const Text('Ajukan Revisi'),
                  style: TextButton.styleFrom(
                    padding: const EdgeInsets.symmetric(horizontal: 8),
                    minimumSize: const Size(0, 36),
                    tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                    textStyle: const TextStyle(
                      fontSize: 11.5,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
                const Spacer(),
                if (correction != null)
                  _correctionPill(correction)
                else
                  const Text(
                    'Belum direvisi',
                    style: TextStyle(fontSize: 10.5, color: AppColors.muted),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _attendancePill(AttendanceLog row) {
    if (row.isOutOfTown) {
      if (row.isApprovalRejected) {
        return _pill(
          'Ditolak',
          AppColors.dangerSoft,
          AppColors.danger.withValues(alpha: 0.25),
          AppColors.danger,
        );
      }
      if (row.isApprovalPending) {
        return _pill(
          'Menunggu approval',
          AppColors.yellowSoft,
          AppColors.yellowLine,
          AppColors.yellowInk,
        );
      }
      return _pill(
        'Luar kota disetujui',
        AppColors.greenSoft,
        AppColors.greenLine,
        AppColors.greenDark,
      );
    }
    return row.isSuspicious
        ? _pill(
            'Suspicious',
            AppColors.dangerSoft,
            AppColors.danger.withValues(alpha: 0.25),
            AppColors.danger,
          )
        : _pill(
            'Dalam radius',
            AppColors.greenSoft,
            AppColors.greenLine,
            AppColors.greenDark,
          );
  }

  Widget _correctionPill(CorrectionRequest correction) {
    final (background, border, foreground) = switch (correction.status) {
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
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: border),
      ),
      child: Text(
        'Revisi: ${correction.statusLabel}',
        style: TextStyle(
          fontSize: 10,
          fontWeight: FontWeight.w700,
          color: foreground,
        ),
      ),
    );
  }

  Widget _dateBlock(DateTime value) {
    final local = value.toLocal();
    return Container(
      width: 44,
      height: 46,
      decoration: BoxDecoration(
        color: AppColors.greenSoft,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppColors.greenLine),
      ),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Text(
            local.day.toString().padLeft(2, '0'),
            style: const TextStyle(
              fontSize: 16,
              fontWeight: FontWeight.w800,
              height: 1,
              color: AppColors.greenDark,
              fontFeatures: tabularFigures,
            ),
          ),
          const SizedBox(height: 3),
          Text(
            _monthNames[local.month - 1].toUpperCase(),
            style: const TextStyle(
              fontSize: 8.5,
              fontWeight: FontWeight.w700,
              letterSpacing: 0.5,
              color: AppColors.greenDark,
            ),
          ),
        ],
      ),
    );
  }

  Widget _pill(String text, Color background, Color border, Color foreground) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: border),
      ),
      child: Text(
        text,
        style: TextStyle(
          fontSize: 10,
          fontWeight: FontWeight.w700,
          color: foreground,
        ),
      ),
    );
  }
}
