import 'package:material_ui/material_ui.dart';

import '../api/api_client.dart';
import '../models/correction.dart';
import '../models/employee_request.dart';
import '../services/auth_service.dart';
import '../theme/app_theme.dart';
import 'correction_form_screen.dart';
import 'employee_requests_screen.dart';

/// Tab Pengajuan: satu tempat untuk revisi absensi, lembur, dan WFH.
class RequestsTab extends StatefulWidget {
  const RequestsTab({super.key, required this.auth});

  final AuthService auth;

  @override
  State<RequestsTab> createState() => _RequestsTabState();
}

class _RequestsTabState extends State<RequestsTab> {
  static const _segments = [
    ('CORRECTION', 'Revisi Absen'),
    ('OVERTIME', 'Lembur'),
    ('WFH', 'WFH'),
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

  String _segment = 'CORRECTION';
  List<CorrectionRequest> _corrections = const [];
  List<OvertimeRequest> _overtime = const [];
  List<WfhRequest> _wfh = const [];
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
      final results = await Future.wait([
        widget.auth.api.myCorrections(),
        widget.auth.api.myOvertime(),
        widget.auth.api.myWfh(),
      ]);
      if (!mounted) return;
      setState(() {
        _corrections = results[0] as List<CorrectionRequest>;
        _overtime = results[1] as List<OvertimeRequest>;
        _wfh = results[2] as List<WfhRequest>;
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
              subtitle: 'Minta izin bekerja dari rumah untuk tanggal tertentu.',
              value: 'WFH',
            ),
            const SizedBox(height: 10),
          ],
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
      trailing: const Icon(Icons.chevron_right, size: 20, color: AppColors.muted),
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
                  'Revisi absensi, lembur, dan WFH dalam satu tempat.',
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
              ],
            ),
          ),
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

  String get _emptyText => switch (_segment) {
    'OVERTIME' => 'Belum ada pengajuan lembur.',
    'WFH' => 'Belum ada pengajuan WFH.',
    _ => 'Belum ada pengajuan revisi.',
  };

  List<Widget> _cards() {
    if (_segment == 'OVERTIME') {
      return [
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
            icon: Icons.home_work_outlined,
            title: 'WFH • ${_date(row.date)}',
            subtitle: row.reason,
            status: row.status,
            statusLabel: row.statusLabel,
          ),
      ];
    }
    return [
      for (final row in _corrections)
        _requestCard(
          icon: row.requestType == 'CHECK_OUT'
              ? Icons.logout
              : Icons.login,
          title: '${row.typeLabel} • ${_date(row.requestedTimestamp)}',
          subtitle: row.reason,
          status: row.status,
          statusLabel: row.statusLabel,
        ),
    ];
  }

  Widget _requestCard({
    required IconData icon,
    required String title,
    required String subtitle,
    required String status,
    required String statusLabel,
  }) {
    return Container(
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
