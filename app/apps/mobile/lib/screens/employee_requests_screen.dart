import 'dart:async';

import 'package:material_ui/material_ui.dart';

import '../api/api_client.dart';
import '../models/employee_request.dart';
import '../services/auth_service.dart';
import '../services/live_sync.dart';
import '../theme/app_theme.dart';
import '../widgets/work_plan_editor.dart';

/// Form dan riwayat lembur/WFH/WFC untuk karyawan. Kedua pengajuan remote
/// memakai approval Admin/HR; WFH/WFC yang disetujui melewati geofence.
class EmployeeRequestsScreen extends StatefulWidget {
  const EmployeeRequestsScreen({super.key, required this.auth, this.now});

  final AuthService auth;
  final DateTime Function()? now;

  @override
  State<EmployeeRequestsScreen> createState() => _EmployeeRequestsScreenState();
}

class _EmployeeRequestsScreenState extends State<EmployeeRequestsScreen> {
  static const _modes = [
    ('OVERTIME', 'Pengajuan Lembur'),
    ('WFH', 'Pengajuan WFH'),
    ('WFC', 'Pengajuan WFC'),
  ];
  static const _dayNames = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];
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

  final _overtimeStart = TextEditingController(text: '18:00');
  final _overtimeEnd = TextEditingController(text: '20:00');
  final _overtimeReason = TextEditingController();
  final _wfhReason = TextEditingController();
  late final WorkPlanDraft _wfhPlan = WorkPlanDraft();
  late DateTime _overtimeDate;
  late DateTime _wfhDate;
  List<OvertimeRequest> _overtime = const [];
  List<WfhRequest> _wfh = const [];
  String _mode = 'OVERTIME';
  bool _loading = true;
  bool _busy = false;
  String? _error;

  DateTime get _now => widget.now?.call() ?? DateTime.now();

  @override
  void initState() {
    super.initState();
    _overtimeDate = DateUtils.dateOnly(_now);
    _wfhDate = DateUtils.dateOnly(_now.add(const Duration(days: 1)));
    _overtimeStart.addListener(_refreshDuration);
    _overtimeEnd.addListener(_refreshDuration);
    LiveSync.instance.addListener(_onLiveSync);
    _load();
  }

  @override
  void dispose() {
    LiveSync.instance.removeListener(_onLiveSync);
    _overtimeStart.removeListener(_refreshDuration);
    _overtimeEnd.removeListener(_refreshDuration);
    _overtimeStart.dispose();
    _overtimeEnd.dispose();
    _overtimeReason.dispose();
    _wfhReason.dispose();
    _wfhPlan.dispose();
    super.dispose();
  }

  void _refreshDuration() {
    if (mounted) setState(() {});
  }

  void _onLiveSync() {
    if (mounted && !_busy) unawaited(_load(silent: true));
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
        widget.auth.api.myOvertime(),
        widget.auth.api.myWfh(),
      ]);
      if (!mounted) return;
      setState(() {
        _overtime = results[0] as List<OvertimeRequest>;
        _wfh = results[1] as List<WfhRequest>;
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

  Future<void> _submitOvertime() async {
    if (_overtimeReason.text.trim().length < 10) {
      setState(() => _error = 'Alasan lembur minimal 10 karakter.');
      return;
    }
    final start = _parseTime(_overtimeStart.text);
    final end = _parseTime(_overtimeEnd.text);
    if (start == null || end == null) {
      setState(() => _error = 'Isi jam mulai dan selesai dengan format HH:MM.');
      return;
    }
    if (end <= start) {
      setState(() => _error = 'Jam selesai harus setelah jam mulai.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.auth.api.submitOvertime(
        date: _overtimeDate,
        startTime: _formatMinutes(start),
        endTime: _formatMinutes(end),
        reason: _overtimeReason.text.trim(),
      );
      if (!mounted) return;
      _overtimeReason.clear();
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Pengajuan lembur terkirim.')),
      );
      await _load();
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() => _error = messageForApiError(error));
    } catch (_) {
      if (!mounted) return;
      setState(() => _error = 'Pengajuan lembur gagal dikirim.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _submitWfh() async {
    final wfc = _mode == 'WFC';
    final modeLabel = wfc ? 'WFC' : 'WFH';
    final location = _wfhPlan.locationController.text.trim();
    if (wfc && location.length < 3) {
      setState(
        () => _error = 'Lokasi kerja WFC wajib diisi (min. 3 karakter).',
      );
      return;
    }
    if (_wfhPlan.titles.isEmpty) {
      setState(
        () => _error = 'Rencana kerja $modeLabel minimal 1 tugas.',
      );
      return;
    }
    if (_wfhReason.text.trim().length < 10) {
      setState(() => _error = 'Alasan $modeLabel minimal 10 karakter.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.auth.api.submitWfh(
        date: _wfhDate,
        reason: _wfhReason.text.trim(),
        workMode: _mode,
        locationNote: location.isEmpty ? null : location,
        workPlanItems: _wfhPlan.titles,
        planBytes: _wfhPlan.attachmentBytes,
        planFilename: _wfhPlan.attachmentName,
      );
      if (!mounted) return;
      _wfhReason.clear();
      _wfhPlan.locationController.clear();
      for (var index = _wfhPlan.itemControllers.length - 1; index > 0; index--) {
        _wfhPlan.itemControllers.removeAt(index).dispose();
      }
      _wfhPlan.itemControllers.first.clear();
      _wfhPlan.attachmentBytes = null;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Pengajuan $modeLabel terkirim.')),
      );
      await _load();
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() => _error = messageForApiError(error));
    } catch (_) {
      if (!mounted) return;
      setState(() => _error = 'Pengajuan $modeLabel gagal dikirim.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _pickDate({required bool overtime}) async {
    final initial = overtime ? _overtimeDate : _wfhDate;
    final picked = await showDatePicker(
      context: context,
      firstDate: DateUtils.dateOnly(_now),
      lastDate: DateUtils.dateOnly(_now.add(const Duration(days: 90))),
      initialDate: initial,
      helpText: overtime ? 'Tanggal lembur' : 'Tanggal ${_mode == 'WFC' ? 'WFC' : 'WFH'}',
    );
    if (picked == null) return;
    setState(() {
      if (overtime) {
        _overtimeDate = DateUtils.dateOnly(picked);
      } else {
        _wfhDate = DateUtils.dateOnly(picked);
      }
    });
  }

  Future<void> _pickTime(TextEditingController controller) async {
    final parsed = _parseTime(controller.text);
    final picked = await showTimePicker(
      context: context,
      initialTime: parsed == null
          ? const TimeOfDay(hour: 18, minute: 0)
          : TimeOfDay(hour: parsed ~/ 60, minute: parsed % 60),
      helpText: 'Pilih jam',
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(context).copyWith(alwaysUse24HourFormat: true),
        child: child!,
      ),
    );
    if (picked == null) return;
    controller.text = _formatMinutes(picked.hour * 60 + picked.minute);
  }

  /// Mengembalikan menit sejak 00:00 untuk input `HH:MM`, atau null bila
  /// formatnya tidak valid.
  int? _parseTime(String raw) {
    final match = RegExp(r'^(\d{1,2}):(\d{2})$').firstMatch(raw.trim());
    if (match == null) return null;
    final hour = int.parse(match.group(1)!);
    final minute = int.parse(match.group(2)!);
    if (hour > 23 || minute > 59) return null;
    return hour * 60 + minute;
  }

  String _formatMinutes(int minutes) {
    final hour = (minutes ~/ 60).toString().padLeft(2, '0');
    final minute = (minutes % 60).toString().padLeft(2, '0');
    return '$hour:$minute';
  }

  String _longDate(DateTime value) {
    final local = value.toLocal();
    return '${_dayNames[local.weekday - 1]}, '
        '${local.day.toString().padLeft(2, '0')} '
        '${_monthNames[local.month - 1]} ${local.year}';
  }

  String _durationText(int minutes) =>
      '${minutes ~/ 60} jam ${minutes % 60} menit';

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Lembur & WFH')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              color: AppColors.green,
              onRefresh: _load,
              child: ListView(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.fromLTRB(16, 14, 16, 28),
                children: [
                  _modeSwitcher(),
                  const SizedBox(height: 12),
                  _formCard(),
                  const SizedBox(height: 22),
                  _historySection(),
                ],
              ),
            ),
    );
  }

  Widget _modeSwitcher() {
    return Container(
      padding: const EdgeInsets.all(4),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.line),
      ),
      child: Row(
        children: [
          for (final (value, label) in _modes)
            Expanded(
              child: Semantics(
                button: true,
                selected: _mode == value,
                child: InkWell(
                  key: Key('mode-$value'),
                  borderRadius: BorderRadius.circular(9),
                  onTap: _busy
                      ? null
                      : () => setState(() {
                          _mode = value;
                          _error = null;
                        }),
                  child: AnimatedContainer(
                    duration: const Duration(milliseconds: 140),
                    padding: const EdgeInsets.symmetric(
                      horizontal: 6,
                      vertical: 10,
                    ),
                    decoration: BoxDecoration(
                      color: _mode == value
                          ? AppColors.green
                          : Colors.transparent,
                      borderRadius: BorderRadius.circular(9),
                    ),
                    child: Text(
                      label,
                      textAlign: TextAlign.center,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w700,
                        color: _mode == value ? Colors.white : AppColors.muted,
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

  Widget _formCard() {
    final overtime = _mode == 'OVERTIME';
    final wfc = _mode == 'WFC';
    final remoteModeLabel = wfc ? 'WFC' : 'WFH';
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.line),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            overtime ? 'Detail lembur' : 'Detail $remoteModeLabel',
            style: const TextStyle(
              fontSize: 14,
              fontWeight: FontWeight.w800,
              color: AppColors.ink,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            overtime
                ? 'Isi tanggal, jam, dan pekerjaan yang dikerjakan di luar shift.'
                : wfc
                ? 'Isi tanggal, lokasi cafe/coworking, rencana kerja, dan alasannya.'
                : 'Isi tanggal, rencana kerja hari ini, dan alasan bekerja dari rumah.',
            style: const TextStyle(
              fontSize: 11.5,
              height: 1.4,
              color: AppColors.muted,
            ),
          ),
          const SizedBox(height: 16),
          if (_error != null) ...[
            Container(
              key: const Key('request-error'),
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
              decoration: BoxDecoration(
                color: AppColors.dangerSoft,
                borderRadius: BorderRadius.circular(10),
                border: Border.all(
                  color: AppColors.danger.withValues(alpha: 0.25),
                ),
              ),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Icon(
                    Icons.error_outline,
                    size: 16,
                    color: AppColors.danger,
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      _error!,
                      style: const TextStyle(
                        fontSize: 11.5,
                        height: 1.35,
                        fontWeight: FontWeight.w600,
                        color: AppColors.danger,
                      ),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 14),
          ],
          _dateField(
            key: Key(overtime ? 'overtime-date' : 'wfh-date'),
            label: overtime ? 'Tanggal Lembur' : 'Tanggal $remoteModeLabel',
            date: overtime ? _overtimeDate : _wfhDate,
            onTap: _busy ? null : () => _pickDate(overtime: overtime),
          ),
          if (!overtime)
            WorkPlanEditor(
              draft: _wfhPlan,
              workMode: remoteModeLabel,
              enabled: !_busy,
              onChanged: () => setState(() {}),
            ),
          const SizedBox(height: 16),
          if (overtime) ...[
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: _timeField(
                    key: const Key('overtime-start'),
                    label: 'Jam Mulai',
                    controller: _overtimeStart,
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: _timeField(
                    key: const Key('overtime-end'),
                    label: 'Jam Selesai',
                    controller: _overtimeEnd,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 10),
            _durationBadge(),
            const SizedBox(height: 16),
          ],
          TextField(
            key: Key(overtime ? 'overtime-reason' : 'wfh-reason'),
            controller: overtime ? _overtimeReason : _wfhReason,
            enabled: !_busy,
            minLines: 3,
            maxLines: 4,
            maxLength: 1000,
            style: const TextStyle(
              fontSize: 13.5,
              height: 1.4,
              fontFeatures: tabularFigures,
            ),
            decoration: InputDecoration(
              hintText: overtime
                  ? 'Misalnya: menyelesaikan laporan bulanan yang tertunda.'
                  : wfc
                  ? 'Misalnya: meeting client di cafe dekat kantor.'
                  : 'Misalnya: pekerjaan hari ini dapat diselesaikan dari rumah.',
              alignLabelWithHint: true,
              counterStyle: const TextStyle(
                fontSize: 10.5,
                color: AppColors.muted,
                fontFeatures: tabularFigures,
              ),
            ),
          ),
          const SizedBox(height: 6),
          SizedBox(
            height: 48,
            child: FilledButton(
              key: Key(overtime ? 'overtime-submit' : 'wfh-submit'),
              onPressed: _busy
                  ? null
                  : (overtime ? _submitOvertime : _submitWfh),
              style: FilledButton.styleFrom(
                minimumSize: const Size.fromHeight(48),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(12),
                ),
              ),
              child: _busy
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: Colors.white,
                      ),
                    )
                  : Text(
                      overtime ? 'Ajukan Lembur' : 'Ajukan $remoteModeLabel',
                    ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _dateField({
    required Key key,
    required String label,
    required DateTime date,
    required VoidCallback? onTap,
  }) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _fieldLabel(label),
        const SizedBox(height: 6),
        InkWell(
          key: key,
          onTap: onTap,
          borderRadius: BorderRadius.circular(10),
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 13),
            decoration: BoxDecoration(
              color: AppColors.canvas,
              borderRadius: BorderRadius.circular(10),
              border: Border.all(color: AppColors.line),
            ),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    _longDate(date),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      fontSize: 13.5,
                      fontWeight: FontWeight.w700,
                      color: AppColors.ink,
                      fontFeatures: tabularFigures,
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                const Icon(
                  Icons.calendar_today_outlined,
                  size: 18,
                  color: AppColors.green,
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }

  Widget _timeField({
    required Key key,
    required String label,
    required TextEditingController controller,
  }) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _fieldLabel(label),
        const SizedBox(height: 6),
        TextField(
          key: key,
          controller: controller,
          enabled: !_busy,
          keyboardType: TextInputType.datetime,
          onTap: _busy ? null : () => _pickTime(controller),
          style: const TextStyle(
            fontSize: 14,
            fontWeight: FontWeight.w700,
            color: AppColors.ink,
            fontFeatures: tabularFigures,
          ),
          decoration: const InputDecoration(
            hintText: 'HH:MM',
            fillColor: AppColors.canvas,
            contentPadding: EdgeInsets.symmetric(horizontal: 12, vertical: 13),
            suffixIcon: Icon(Icons.schedule, size: 17, color: AppColors.green),
            suffixIconConstraints: BoxConstraints(minWidth: 34, minHeight: 34),
          ),
        ),
      ],
    );
  }

  Widget _fieldLabel(String text) {
    return Text(
      text,
      style: const TextStyle(
        fontSize: 11,
        fontWeight: FontWeight.w700,
        letterSpacing: 0.2,
        color: AppColors.muted,
      ),
    );
  }

  Widget _durationBadge() {
    final start = _parseTime(_overtimeStart.text);
    final end = _parseTime(_overtimeEnd.text);
    final invalidOrder = start != null && end != null && end <= start;
    final minutes = start != null && end != null && end > start
        ? end - start
        : null;
    final text = invalidOrder
        ? 'Jam selesai harus setelah jam mulai.'
        : minutes == null
        ? 'Estimasi durasi lembur: isi jam mulai dan selesai.'
        : 'Estimasi durasi lembur: ${_durationText(minutes)}';
    final background = invalidOrder
        ? AppColors.dangerSoft
        : minutes == null
        ? AppColors.tableHead
        : AppColors.greenSoft;
    final border = invalidOrder
        ? AppColors.danger.withValues(alpha: 0.25)
        : minutes == null
        ? AppColors.line
        : AppColors.greenLine;
    final foreground = invalidOrder
        ? AppColors.danger
        : minutes == null
        ? AppColors.muted
        : AppColors.greenDark;

    return Container(
      key: const Key('overtime-duration'),
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: border),
      ),
      child: Row(
        children: [
          Icon(
            invalidOrder ? Icons.error_outline : Icons.timelapse,
            size: 15,
            color: foreground,
          ),
          const SizedBox(width: 6),
          Expanded(
            child: Text(
              text,
              style: TextStyle(
                fontSize: 11.5,
                fontWeight: FontWeight.w700,
                color: foreground,
                fontFeatures: tabularFigures,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _historySection() {
    final items = <({DateTime date, Widget child})>[
      for (final row in _overtime)
        (
          date: row.date,
          child: _historyCard(
            key: Key('history-overtime-${row.id}'),
            type: 'Lembur',
            date: row.date,
            reason: row.reason,
            status: row.status,
            statusLabel: row.statusLabel,
            detail:
                '${row.startTime} - ${row.endTime} • '
                '${_durationText(row.durationMinutes)}',
          ),
        ),
      for (final row in _wfh)
        (
          date: row.date,
          child: _historyCard(
            key: Key('history-wfh-${row.id}'),
            type: row.modeLabel,
            date: row.date,
            reason: row.reason,
            status: row.status,
            statusLabel: row.statusLabel,
          ),
        ),
    ]..sort((a, b) => b.date.compareTo(a.date));

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const Text(
          'Riwayat Pengajuan Terbaru',
          style: TextStyle(
            fontSize: 14,
            fontWeight: FontWeight.w800,
            color: AppColors.ink,
          ),
        ),
        const SizedBox(height: 2),
        const Text(
          'Lembur, WFH, dan WFC yang sudah dikirim beserta status persetujuannya.',
          style: TextStyle(fontSize: 11.5, color: AppColors.muted),
        ),
        const SizedBox(height: 10),
        if (items.isEmpty)
          Container(
            key: const Key('request-history-empty'),
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 22),
            decoration: BoxDecoration(
              color: AppColors.surface,
              borderRadius: BorderRadius.circular(14),
              border: Border.all(color: AppColors.line),
            ),
            child: const Column(
              children: [
                Icon(
                  Icons.assignment_outlined,
                  size: 22,
                  color: AppColors.muted,
                ),
                SizedBox(height: 8),
                Text(
                  'Belum ada pengajuan lembur atau WFH.',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                    color: AppColors.muted,
                  ),
                ),
              ],
            ),
          )
        else
          for (var index = 0; index < items.length; index++) ...[
            if (index > 0) const SizedBox(height: 8),
            items[index].child,
          ],
      ],
    );
  }

  Widget _historyCard({
    required Key key,
    required String type,
    required DateTime date,
    required String reason,
    required String status,
    required String statusLabel,
    String? detail,
  }) {
    final overtime = type == 'Lembur';
    final wfc = type == 'WFC';
    return Container(
      key: key,
      padding: const EdgeInsets.all(14),
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
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(
                  color: overtime
                      ? AppColors.greenSoft
                      : wfc
                      ? AppColors.yellowSoft
                      : AppColors.tableHead,
                  borderRadius: BorderRadius.circular(999),
                  border: Border.all(
                    color: overtime
                        ? AppColors.greenLine
                        : wfc
                        ? AppColors.yellowLine
                        : AppColors.line,
                  ),
                ),
                child: Text(
                  type,
                  style: TextStyle(
                    fontSize: 10,
                    fontWeight: FontWeight.w700,
                    color: overtime
                        ? AppColors.greenDark
                        : wfc
                        ? AppColors.yellowInk
                        : AppColors.ink,
                  ),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  _longDate(date),
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
              const SizedBox(width: 6),
              _statusPill(status, statusLabel),
            ],
          ),
          if (detail != null) ...[
            const SizedBox(height: 8),
            Row(
              children: [
                const Icon(Icons.schedule, size: 14, color: AppColors.muted),
                const SizedBox(width: 5),
                Expanded(
                  child: Text(
                    detail,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      fontSize: 11.5,
                      fontWeight: FontWeight.w600,
                      color: AppColors.ink,
                      fontFeatures: tabularFigures,
                    ),
                  ),
                ),
              ],
            ),
          ],
          const SizedBox(height: 6),
          Text(
            '"$reason"',
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              fontSize: 11.5,
              height: 1.4,
              color: AppColors.muted,
            ),
          ),
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
}
