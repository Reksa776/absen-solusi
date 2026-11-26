import 'dart:async';

import 'package:material_ui/material_ui.dart';

import '../api/api_client.dart';
import '../models/attendance_log.dart';
import '../models/correction.dart';
import '../models/employee_request.dart';
import '../models/leave.dart';
import '../models/overtime_schedule.dart';
import '../models/work_permit.dart';
import '../services/auth_service.dart';
import '../services/live_sync.dart';
import '../theme/app_theme.dart';
import 'client_visits_screen.dart';
import 'correction_form_screen.dart';
import 'employee_requests_screen.dart';
import 'leave_form_screen.dart';
import 'work_permit_form_screen.dart';
import 'work_projections_screen.dart';

/// Tab Pengajuan: satu tempat untuk revisi absensi, lembur, dan WFH.
class RequestsTab extends StatefulWidget {
  const RequestsTab({
    super.key,
    required this.auth,
    this.compact = false,
    this.initialSegment = 'CORRECTION',
    this.combined = false,
  });

  final AuthService auth;
  final bool compact;
  final String initialSegment;

  /// Menampilkan seluruh jenis pengajuan sekaligus untuk tab Pesan > Submisi.
  final bool combined;

  @override
  State<RequestsTab> createState() => _RequestsTabState();
}

class _RequestsTabState extends State<RequestsTab> {
  static const _segments = [
    ('CORRECTION', 'Revisi'),
    ('OVERTIME', 'Lembur'),
    ('WFH', 'WFH/WFC'),
    ('IZIN', 'Izin'),
    ('CUTI', 'Cuti'),
  ];
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

  late String _segment;
  List<CorrectionRequest> _corrections = const [];
  List<AttendanceLog> _outOfTown = const [];
  List<OvertimeRequest> _overtime = const [];
  List<OvertimeSchedule> _overtimeSchedules = const [];
  List<WfhRequest> _wfh = const [];
  List<WorkPermitRequest> _permits = const [];
  List<LeaveRequest> _leave = const [];
  LeaveBalance? _balance;
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _segment = widget.initialSegment;
    LiveSync.instance.addListener(_onLiveSync);
    _load();
  }

  @override
  void dispose() {
    LiveSync.instance.removeListener(_onLiveSync);
    super.dispose();
  }

  void _onLiveSync() {
    if (mounted) unawaited(_load(silent: true));
  }

  Future<void> _load({bool silent = false}) async {
    if (!silent) {
      setState(() {
        _loading = true;
        _error = null;
      });
    }
    try {
      final results = await Future.wait([
        widget.auth.api.myCorrections(),
        widget.auth.api.myOvertime(),
        widget.auth.api.myOvertimeSchedules(),
        widget.auth.api.myWfh(),
        widget.auth.api.myWorkPermits(),
        widget.auth.api.myLeave(),
        widget.auth.api.myLeaveBalance(),
      ]);
      if (!mounted) return;
      setState(() {
        _corrections = results[0] as List<CorrectionRequest>;
        _overtime = results[1] as List<OvertimeRequest>;
        _overtimeSchedules = results[2] as List<OvertimeSchedule>;
        _wfh = results[3] as List<WfhRequest>;
        _permits = results[4] as List<WorkPermitRequest>;
        _leave = results[5] as List<LeaveRequest>;
        _balance = results[6] as LeaveBalance;
        _loading = false;
      });
      // Presensi luar kota melengkapi tampilan gabungan; kegagalan endpoint
      // ini tidak boleh mengosongkan seluruh daftar submisi.
      try {
        final logs = await widget.auth.api.attendanceHistory();
        if (!mounted) return;
        setState(() {
          _outOfTown = logs
              .where((row) => row.isOutOfTown)
              .toList(growable: false);
        });
      } catch (_) {
        // Bagian luar kota dilewati bila riwayat presensi tidak tersedia.
      }
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _error = messageForApiError(error);
        _loading = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _error = 'Pengajuan tidak dapat dimuat.';
        _loading = false;
      });
    }
  }

  Future<void> _create() async {
    final choice = await showModalBottomSheet<String>(
      context: context,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(18)),
      ),
      builder: (sheetContext) => SafeArea(
        top: false,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const SizedBox(height: 10),
              Container(
                width: 38,
                height: 4,
                decoration: BoxDecoration(
                  color: AppColors.line,
                  borderRadius: BorderRadius.circular(999),
                ),
              ),
              const Padding(
                padding: EdgeInsets.fromLTRB(20, 14, 20, 6),
                child: Align(
                  alignment: Alignment.centerLeft,
                  child: Text(
                    'Buat pengajuan',
                    style: TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.w800,
                      color: AppColors.ink,
                    ),
                  ),
                ),
              ),
              _sheetOption(
                sheetContext,
                key: 'create-CORRECTION',
                icon: Icons.assignment_late_outlined,
                title: 'Revisi Absen',
                subtitle: 'Koreksi jam check-in atau check-out yang salah.',
                value: 'CORRECTION',
              ),
              _sheetOption(
                sheetContext,
                key: 'create-OVERTIME',
                icon: Icons.more_time,
                title: 'Lembur',
                subtitle: 'Ajukan jam kerja tambahan setelah shift.',
                value: 'OVERTIME',
              ),
              _sheetOption(
                sheetContext,
                key: 'create-WFH',
                icon: Icons.home_work_outlined,
                title: 'WFH',
                subtitle:
                    'Minta izin WFH (rumah) atau WFC (cafe/remote) lengkap dengan rencana kerja.',
                value: 'WFH',
              ),
              _sheetOption(
                sheetContext,
                key: 'create-IZIN',
                icon: Icons.badge_outlined,
                title: 'Izin Kerja',
                subtitle: 'Sakit, izin pribadi, pulang cepat, atau terlambat.',
                value: 'IZIN',
              ),
              _sheetOption(
                sheetContext,
                key: 'create-CUTI',
                icon: Icons.beach_access_outlined,
                title: 'Cuti',
                subtitle:
                    'Ajukan cuti tahunan atau cuti khusus beserta alasannya.',
                value: 'CUTI',
              ),
              const SizedBox(height: 10),
            ],
          ),
        ),
      ),
    );
    if (choice == null || !mounted) return;

    if (choice == 'CORRECTION') {
      await Navigator.of(context).push(
        MaterialPageRoute<void>(
          builder: (_) => CorrectionFormScreen(auth: widget.auth),
        ),
      );
    } else if (choice == 'IZIN') {
      await Navigator.of(context).push(
        MaterialPageRoute<void>(
          builder: (_) => WorkPermitFormScreen(auth: widget.auth),
        ),
      );
    } else if (choice == 'CUTI') {
      await Navigator.of(context).push(
        MaterialPageRoute<void>(
          builder: (_) => LeaveFormScreen(auth: widget.auth),
        ),
      );
    } else {
      await Navigator.of(context).push(
        MaterialPageRoute<void>(
          builder: (_) => EmployeeRequestsScreen(auth: widget.auth),
        ),
      );
    }
    if (!mounted) return;
    setState(() => _segment = choice);
    await _load();
  }

  Widget _sheetOption(
    BuildContext sheetContext, {
    required String key,
    required IconData icon,
    required String title,
    required String subtitle,
    required String value,
  }) {
    return ListTile(
      key: Key(key),
      leading: Container(
        width: 38,
        height: 38,
        decoration: BoxDecoration(
          color: AppColors.tableHead,
          borderRadius: BorderRadius.circular(10),
          border: Border.all(color: AppColors.line),
        ),
        child: Icon(icon, size: 19, color: AppColors.ink),
      ),
      title: Text(
        title,
        style: const TextStyle(
          fontSize: 13.5,
          fontWeight: FontWeight.w700,
          color: AppColors.ink,
        ),
      ),
      subtitle: Text(
        subtitle,
        style: const TextStyle(fontSize: 11.5, color: AppColors.muted),
      ),
      trailing: const Icon(
        Icons.chevron_right,
        size: 20,
        color: AppColors.muted,
      ),
      onTap: () => Navigator.of(sheetContext).pop(value),
    );
  }

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      bottom: false,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (!widget.compact)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 10),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'Pengajuan',
                    style: TextStyle(
                      fontSize: 23,
                      fontWeight: FontWeight.w800,
                      letterSpacing: -0.5,
                      color: AppColors.ink,
                    ),
                  ),
                  const SizedBox(height: 2),
                  const Text(
                    'Revisi absensi, lembur, WFH, izin kerja, dan cuti.',
                    style: TextStyle(fontSize: 12, color: AppColors.muted),
                  ),
                  const SizedBox(height: 12),
                  SizedBox(
                    height: 46,
                    child: FilledButton.icon(
                      key: const Key('requests-create'),
                      onPressed: _create,
                      icon: const Icon(Icons.add, size: 18),
                      label: const Text('Buat Pengajuan'),
                    ),
                  ),
                  const SizedBox(height: 8),
                  Row(
                    children: [
                      Expanded(
                        child: OutlinedButton.icon(
                          key: const Key('requests-client-visits'),
                          onPressed: () => Navigator.of(context).push(
                            MaterialPageRoute<void>(
                              builder: (_) =>
                                  ClientVisitsScreen(auth: widget.auth),
                            ),
                          ),
                          icon: const Icon(
                            Icons.location_on_outlined,
                            size: 16,
                          ),
                          label: const Text('Kunjungan Client'),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: OutlinedButton.icon(
                          key: const Key('requests-work-projections'),
                          onPressed: () => Navigator.of(context).push(
                            MaterialPageRoute<void>(
                              builder: (_) =>
                                  WorkProjectionsScreen(auth: widget.auth),
                            ),
                          ),
                          icon: const Icon(Icons.track_changes, size: 16),
                          label: const Text('Proyeksi Kerja'),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          if (!widget.combined)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 10),
              child: Container(
                padding: const EdgeInsets.all(4),
                decoration: BoxDecoration(
                  color: AppColors.tableHead,
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(color: AppColors.line),
                ),
                child: Row(
                  children: [
                    for (final (value, label) in _segments)
                      Expanded(
                        child: InkWell(
                          key: Key('requests-segment-$value'),
                          borderRadius: BorderRadius.circular(8),
                          onTap: () => setState(() => _segment = value),
                          child: AnimatedContainer(
                            duration: const Duration(milliseconds: 140),
                            padding: const EdgeInsets.symmetric(vertical: 8),
                            decoration: BoxDecoration(
                              color: _segment == value
                                  ? AppColors.surface
                                  : Colors.transparent,
                              borderRadius: BorderRadius.circular(8),
                              border: Border.all(
                                color: _segment == value
                                    ? AppColors.line
                                    : Colors.transparent,
                              ),
                            ),
                            child: Text(
                              label,
                              textAlign: TextAlign.center,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(
                                fontSize: 11.5,
                                fontWeight: FontWeight.w700,
                                color: _segment == value
                                    ? AppColors.greenDark
                                    : AppColors.muted,
                              ),
                            ),
                          ),
                        ),
                      ),
                  ],
                ),
              ),
            ),
          Expanded(child: _body()),
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
                key: const Key('requests-error'),
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
    final cards = _cards();
    if (cards.isEmpty) {
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
                Icons.assignment_outlined,
                size: 24,
                color: AppColors.muted,
              ),
            ),
            const SizedBox(height: 10),
            Text(
              _emptyText,
              key: const Key('requests-empty'),
              style: const TextStyle(
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
        key: const Key('requests-list'),
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(16, 4, 16, 24),
        itemCount: cards.length,
        separatorBuilder: (_, _) => const SizedBox(height: 10),
        itemBuilder: (context, index) => cards[index],
      ),
    );
  }

  String get _emptyText {
    if (widget.combined) return 'Belum ada pengajuan.';
    return switch (_segment) {
      'OVERTIME' => 'Belum ada pengajuan lembur.',
      'WFH' => 'Belum ada pengajuan WFH.',
      'IZIN' => 'Belum ada pengajuan izin kerja.',
      'CUTI' => 'Belum ada pengajuan cuti.',
      _ => 'Belum ada pengajuan revisi.',
    };
  }

  List<Widget> _cards() {
    if (widget.combined) return _combinedCards();
    if (_segment == 'OVERTIME') {
      return [
        for (final schedule in _overtimeSchedules)
          _requestCard(
            key: Key('overtime-schedule-${schedule.id}'),
            icon: Icons.event_available_outlined,
            title: 'Jadwal lembur • ${_date(schedule.date)}',
            subtitle:
                '${schedule.startTime}–${schedule.endTime} • '
                '${schedule.durationMinutes} menit',
            status: 'APPROVED',
            statusLabel: schedule.statusLabel,
          ),
        for (final row in _overtime)
          _requestCard(
            icon: Icons.more_time,
            title: 'Lembur • ${_date(row.date)}',
            subtitle:
                '${row.startTime}–${row.endTime} • '
                '${row.durationMinutes} menit\n${row.reason}',
            status: row.status,
            statusLabel: row.statusLabel,
          ),
      ];
    }
    if (_segment == 'WFH') {
      return [
        for (final row in _wfh)
          _requestCard(
            icon: row.workMode == 'WFC'
                ? Icons.local_cafe_outlined
                : Icons.home_work_outlined,
            title: '${row.modeLabel} • ${_date(row.date)}',
            subtitle:
                '${row.reason}'
                '${row.locationNote == null ? '' : '\\nLokasi: ${row.locationNote}'}',
            status: row.status,
            statusLabel: row.statusLabel,
          ),
      ];
    }
    if (_segment == 'IZIN') {
      return [
        for (final row in _permits)
          _requestCard(
            icon: row.permitType == 'SAKIT'
                ? Icons.medical_services_outlined
                : Icons.badge_outlined,
            title:
                '${row.typeLabel} • ${_date(row.startDate)}'
                '${row.endDate == row.startDate ? '' : ' – ${_date(row.endDate)}'}',
            subtitle:
                '${row.reason}'
                '${row.hasProof ? '\nBukti terlampir' : ''}'
                '${row.rejectionReason == null ? '' : '\nDitolak: ${row.rejectionReason}'}',
            status: row.status,
            statusLabel: row.statusLabel,
          ),
      ];
    }
    if (_segment == 'CUTI') {
      final balance = _balance;
      return [
        if (balance != null)
          Container(
            key: const Key('leave-balance-card'),
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: AppColors.greenSoft,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: AppColors.greenLine),
            ),
            child: Row(
              children: [
                const Icon(
                  Icons.beach_access_outlined,
                  size: 18,
                  color: AppColors.greenDark,
                ),
                const SizedBox(width: 8),
                const Expanded(
                  child: Text(
                    'Sisa cuti tahunan',
                    style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w700,
                      color: AppColors.greenDark,
                    ),
                  ),
                ),
                Text(
                  '${balance.remainingDays} / ${balance.entitledDays} hari',
                  style: const TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w800,
                    color: AppColors.greenDark,
                    fontFeatures: tabularFigures,
                  ),
                ),
              ],
            ),
          ),
        for (final row in _leave)
          _requestCard(
            icon: Icons.event_busy_outlined,
            title:
                '${row.typeLabel} • ${_date(row.startDate)}'
                '${row.endDate == row.startDate ? '' : ' – ${_date(row.endDate)}'}',
            subtitle:
                '${row.workingDays} hari kerja\n${row.reason}'
                '${row.rejectionReason == null ? '' : '\nDitolak: ${row.rejectionReason}'}',
            status: row.status,
            statusLabel: row.statusLabel,
          ),
      ];
    }
    return [
      for (final row in _corrections)
        _requestCard(
          icon: row.requestType == 'CHECK_OUT' ? Icons.logout : Icons.login,
          title: '${row.typeLabel} • ${_date(row.requestedTimestamp)}',
          subtitle: row.reason,
          status: row.status,
          statusLabel: row.statusLabel,
        ),
    ];
  }

  List<Widget> _combinedCards() {
    final cards = <Widget>[];
    void addSection(String title, List<Widget> rows) {
      if (rows.isEmpty) return;
      if (cards.isNotEmpty) cards.add(const SizedBox(height: 4));
      cards.add(_sectionLabel(title));
      cards.addAll(rows);
    }

    addSection('Revisi Kehadiran', [
      for (final row in _corrections)
        _requestCard(
          icon: row.requestType == 'CHECK_OUT' ? Icons.logout : Icons.login,
          title: '${row.typeLabel} • ${_date(row.requestedTimestamp)}',
          subtitle: row.reason,
          status: row.status,
          statusLabel: row.statusLabel,
        ),
    ]);
    addSection('Lembur', [
      for (final row in _overtime)
        _requestCard(
          icon: Icons.more_time,
          title: 'Lembur • ${_date(row.date)}',
          subtitle:
              '${row.startTime}–${row.endTime} • '
              '${row.durationMinutes} menit\n${row.reason}',
          status: row.status,
          statusLabel: row.statusLabel,
        ),
    ]);
    addSection('Izin Kerja', [
      for (final row in _permits)
        _requestCard(
          icon: row.permitType == 'SAKIT'
              ? Icons.medical_services_outlined
              : Icons.badge_outlined,
          title:
              '${row.typeLabel} • ${_date(row.startDate)}'
              '${row.endDate == row.startDate ? '' : ' – ${_date(row.endDate)}'}',
          subtitle: row.reason,
          status: row.status,
          statusLabel: row.statusLabel,
        ),
    ]);
    addSection('Cuti', [
      for (final row in _leave)
        _requestCard(
          icon: Icons.event_busy_outlined,
          title:
              '${row.typeLabel} • ${_date(row.startDate)}'
              '${row.endDate == row.startDate ? '' : ' – ${_date(row.endDate)}'}',
          subtitle: '${row.workingDays} hari kerja\n${row.reason}',
          status: row.status,
          statusLabel: row.statusLabel,
        ),
    ]);
    addSection('Presensi Luar Kota', [
      for (final row in _outOfTown)
        _requestCard(
          icon: Icons.flight_takeoff,
          title: 'Presensi Luar Kota • ${_date(row.timestampServer)}',
          subtitle:
              '${row.label} • '
              '${row.outOfTownReason ?? 'Tanpa catatan alasan'}',
          status: row.approvalStatus,
          statusLabel: switch (row.approvalStatus) {
            'APPROVED' => 'Disetujui',
            'REJECTED' => 'Ditolak',
            _ => 'Menunggu',
          },
        ),
    ]);
    addSection('WFH & WFC', [
      for (final row in _wfh)
        _requestCard(
          icon: row.workMode == 'WFC'
              ? Icons.local_cafe_outlined
              : Icons.home_work_outlined,
          title: '${row.modeLabel} • ${_date(row.date)}',
          subtitle:
              '${row.reason}'
              '${row.locationNote == null ? '' : '\\nLokasi: ${row.locationNote}'}',
          status: row.status,
          statusLabel: row.statusLabel,
        ),
    ]);
    return cards;
  }

  Widget _sectionLabel(String text) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 2),
      child: Text(
        text,
        style: const TextStyle(
          fontSize: 11,
          fontWeight: FontWeight.w700,
          letterSpacing: 0.2,
          color: AppColors.muted,
        ),
      ),
    );
  }

  Widget _requestCard({
    Key? key,
    required IconData icon,
    required String title,
    required String subtitle,
    required String status,
    required String statusLabel,
  }) {
    return Container(
      key: key,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.line),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 38,
            height: 38,
            decoration: BoxDecoration(
              color: AppColors.tableHead,
              borderRadius: BorderRadius.circular(10),
              border: Border.all(color: AppColors.line),
            ),
            child: Icon(icon, size: 18, color: AppColors.ink),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: const TextStyle(
                    fontSize: 12.5,
                    fontWeight: FontWeight.w700,
                    color: AppColors.ink,
                    fontFeatures: tabularFigures,
                  ),
                ),
                const SizedBox(height: 3),
                Text(
                  subtitle,
                  maxLines: 3,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 11,
                    height: 1.35,
                    color: AppColors.muted,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          _statusPill(status, statusLabel),
        ],
      ),
    );
  }

  Widget _statusPill(String status, String label) {
    return _pill(status, label);
  }

  Widget _pill(String status, String label) {
    final (background, border, foreground) = switch (status) {
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
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: border),
      ),
      child: Text(
        label,
        style: TextStyle(
          fontSize: 10,
          fontWeight: FontWeight.w700,
          color: foreground,
        ),
      ),
    );
  }

  String _date(DateTime value) {
    final local = value.toLocal();
    return '${local.day.toString().padLeft(2, '0')} '
        '${_monthNames[local.month - 1]} ${local.year}';
  }
}
