import 'package:material_ui/material_ui.dart';

import '../api/api_client.dart';
import '../models/leave.dart';
import '../models/schedule.dart';
import '../services/auth_service.dart';
import '../theme/app_theme.dart';

class LeaveFormScreen extends StatefulWidget {
  const LeaveFormScreen({
    super.key,
    required this.auth,
    this.now,
    this.initialStart,
    this.initialEnd,
  });

  final AuthService auth;
  final DateTime Function()? now;

  /// Rentang awal opsional (misalnya dari tautan langsung atau widget test).
  final DateTime? initialStart;
  final DateTime? initialEnd;

  @override
  State<LeaveFormScreen> createState() => _LeaveFormScreenState();
}

class _LeaveFormScreenState extends State<LeaveFormScreen> {
  static const _types = [
    ('CUTI_TAHUNAN', 'Cuti tahunan'),
    ('CUTI_MELAHIRKAN', 'Cuti melahirkan'),
    ('CUTI_KHUSUS', 'Cuti khusus'),
    ('LAINNYA', 'Lainnya'),
  ];

  final _reason = TextEditingController();
  String _type = 'CUTI_TAHUNAN';
  late DateTime _start;
  late DateTime _end;
  LeaveBalance? _balance;
  WorkSchedule? _schedule;
  bool _busy = false;
  String? _error;

  DateTime get _today {
    final value = widget.now?.call() ?? DateTime.now();
    return DateUtils.dateOnly(value);
  }

  @override
  void initState() {
    super.initState();
    _start = DateUtils.dateOnly(widget.initialStart ?? _today);
    _end = DateUtils.dateOnly(widget.initialEnd ?? _start);
    if (_end.isBefore(_start)) _end = _start;
    _loadBalance();
    _loadSchedule();
  }

  @override
  void dispose() {
    _reason.dispose();
    super.dispose();
  }

  Future<void> _loadBalance() async {
    try {
      final balance = await widget.auth.api.myLeaveBalance();
      if (mounted) setState(() => _balance = balance);
    } catch (_) {
      // Saldo bersifat informatif; server tetap memvalidasi kuota.
    }
  }

  /// Hari libur dan pola kerja dipakai agar jumlah hari sama dengan server.
  /// Tanpa jadwal (misalnya offline) fallback Senin-Jumat tetap dipakai.
  Future<void> _loadSchedule() async {
    try {
      final schedule = await widget.auth.api.workSchedule();
      if (mounted) setState(() => _schedule = schedule);
    } catch (_) {
      // Opsional: perhitungan lokal memakai fallback tanpa hari libur.
    }
  }

  int get _requestedDays {
    final schedule = _schedule;
    var count = 0;
    final last = DateUtils.dateOnly(_end);
    for (
      var cursor = DateUtils.dateOnly(_start);
      !cursor.isAfter(last);
      cursor = DateUtils.dateOnly(cursor.add(const Duration(days: 1)))
    ) {
      final workday = schedule == null
          ? cursor.weekday <= DateTime.friday
          : schedule.dayFor(cursor)?.isWorkday ?? false;
      if (!workday) continue;
      if (schedule?.holidayOn(cursor) != null) continue;
      count += 1;
    }
    return count;
  }

  bool get _isAnnual => _type == 'CUTI_TAHUNAN';

  int get _remainingDays => _balance?.remainingDays ?? 0;

  int get _daysAfterSubmission {
    final left = _remainingDays - _requestedDays;
    return left < 0 ? 0 : left;
  }

  /// Alasan pengajuan diblokir, atau null bila tombol kirim boleh aktif.
  String? get _blockReason {
    final days = _requestedDays;
    if (days <= 0) {
      return 'Rentang tanggal yang dipilih tidak mencakup hari kerja (0 hari).';
    }
    final balance = _balance;
    if (_isAnnual && balance != null && days > balance.remainingDays) {
      return 'Jumlah hari cuti ($days hari) melebihi sisa kuota cuti Anda '
          '(${balance.remainingDays} hari).';
    }
    return null;
  }

  bool get _canSubmit => !_busy && _blockReason == null;

  Future<void> _pickDate({required bool start}) async {
    final picked = await showDatePicker(
      context: context,
      firstDate: _today,
      lastDate: _today.add(const Duration(days: 365)),
      initialDate: start ? _start : _end,
      helpText: start ? 'Tanggal mulai cuti' : 'Tanggal selesai cuti',
    );
    if (picked == null) return;
    setState(() {
      if (start) {
        _start = DateUtils.dateOnly(picked);
        if (_end.isBefore(_start)) _end = _start;
      } else {
        _end = DateUtils.dateOnly(picked);
        if (_end.isBefore(_start)) _start = _end;
      }
    });
  }

  Future<void> _submit() async {
    final blocked = _blockReason;
    if (blocked != null) {
      setState(() => _error = blocked);
      return;
    }
    final reason = _reason.text.trim();
    if (reason.length < 10) {
      setState(() => _error = 'Alasan cuti minimal 10 karakter.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.auth.api.submitLeave(
        leaveType: _type,
        startDate: _start,
        endDate: _end,
        reason: reason,
      );
      if (!mounted) return;
      Navigator.of(context).pop(true);
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() => _error = messageForApiError(error));
    } catch (_) {
      if (!mounted) return;
      setState(() => _error = 'Pengajuan cuti gagal dikirim.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  String _date(DateTime value) {
    final day = value.day.toString().padLeft(2, '0');
    final month = value.month.toString().padLeft(2, '0');
    return '$day/$month/${value.year}';
  }

  @override
  Widget build(BuildContext context) {
    final balance = _balance;
    return Scaffold(
      appBar: AppBar(title: const Text('Ajukan cuti')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          if (balance != null)
            Container(
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: AppColors.greenSoft,
                borderRadius: BorderRadius.circular(14),
                border: Border.all(color: AppColors.greenLine),
              ),
              child: Row(
                children: [
                  const Icon(
                    Icons.beach_access_outlined,
                    size: 19,
                    color: AppColors.greenDark,
                  ),
                  const SizedBox(width: 9),
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
                    key: const Key('leave-balance'),
                    style: const TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.w800,
                      color: AppColors.greenDark,
                      fontFeatures: tabularFigures,
                    ),
                  ),
                ],
              ),
            ),
          if (balance != null) const SizedBox(height: 12),
          Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: AppColors.surface,
              borderRadius: BorderRadius.circular(14),
              border: Border.all(color: AppColors.line),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'Detail cuti',
                  style: TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w800,
                    color: AppColors.ink,
                  ),
                ),
                const SizedBox(height: 3),
                const Text(
                  'Jumlah hari kerja dihitung otomatis tanpa Sabtu, Minggu, dan hari libur.',
                  style: TextStyle(
                    fontSize: 11.5,
                    height: 1.4,
                    color: AppColors.muted,
                  ),
                ),
                const SizedBox(height: 14),
                DropdownButtonFormField<String>(
                  key: const Key('leave-type'),
                  initialValue: _type,
                  decoration: const InputDecoration(labelText: 'Jenis cuti'),
                  items: [
                    for (final (value, label) in _types)
                      DropdownMenuItem(value: value, child: Text(label)),
                  ],
                  onChanged: _busy
                      ? null
                      : (value) {
                          if (value != null) setState(() => _type = value);
                        },
                ),
                const SizedBox(height: 8),
                Material(
                  type: MaterialType.transparency,
                  child: ListTile(
                    key: const Key('leave-start-date'),
                    contentPadding: EdgeInsets.zero,
                    leading: const Icon(Icons.event_outlined),
                    title: const Text('Tanggal mulai'),
                    subtitle: Text(
                      _date(_start),
                      style: const TextStyle(
                        fontFeatures: tabularFigures,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    trailing: const Icon(Icons.edit_calendar, size: 18),
                    onTap: _busy ? null : () => _pickDate(start: true),
                  ),
                ),
                Material(
                  type: MaterialType.transparency,
                  child: ListTile(
                    key: const Key('leave-end-date'),
                    contentPadding: EdgeInsets.zero,
                    leading: const Icon(Icons.event_available_outlined),
                    title: const Text('Tanggal selesai'),
                    subtitle: Text(
                      _date(_end),
                      style: const TextStyle(
                        fontFeatures: tabularFigures,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    trailing: const Icon(Icons.edit_calendar, size: 18),
                    onTap: _busy ? null : () => _pickDate(start: false),
                  ),
                ),
                const SizedBox(height: 6),
                _quotaSummary(),
                const SizedBox(height: 14),
                TextField(
                  key: const Key('leave-reason'),
                  controller: _reason,
                  enabled: !_busy,
                  minLines: 3,
                  maxLines: 5,
                  maxLength: 1000,
                  decoration: const InputDecoration(
                    labelText: 'Alasan cuti',
                    hintText: 'Jelaskan rencana cuti minimal 10 karakter.',
                  ),
                ),
              ],
            ),
          ),
          if (_error != null) ...[
            const SizedBox(height: 10),
            Text(
              _error!,
              key: const Key('leave-error'),
              style: const TextStyle(
                fontSize: 12,
                color: AppColors.danger,
                fontWeight: FontWeight.w600,
              ),
            ),
          ],
          const SizedBox(height: 14),
          SizedBox(
            height: 50,
            child: FilledButton.icon(
              key: const Key('leave-submit'),
              onPressed: _canSubmit ? _submit : null,
              icon: _busy
                  ? const SizedBox.square(
                      dimension: 16,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: Colors.white,
                      ),
                    )
                  : const Icon(Icons.send, size: 18),
              label: Text(_busy ? 'Mengirim…' : 'Kirim pengajuan cuti'),
            ),
          ),
        ],
      ),
    );
  }

  Widget _quotaSummary() {
    final days = _requestedDays;
    final warning = _blockReason;
    final balance = _balance;
    final foreground = warning == null ? AppColors.ink : AppColors.danger;
    return Container(
      key: const Key('leave-summary'),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: warning == null ? AppColors.tableHead : AppColors.dangerSoft,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
          color: warning == null
              ? AppColors.line
              : AppColors.danger.withValues(alpha: 0.25),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(
                warning == null
                    ? Icons.event_note_outlined
                    : Icons.error_outline,
                size: 15,
                color: foreground,
              ),
              const SizedBox(width: 6),
              Expanded(
                child: Text(
                  'Diajukan: $days hari kerja',
                  key: const Key('leave-duration'),
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                    color: foreground,
                    fontFeatures: tabularFigures,
                  ),
                ),
              ),
            ],
          ),
          if (_isAnnual && balance != null) ...[
            const SizedBox(height: 5),
            Text(
              'Sisa cuti setelah pengajuan: $_daysAfterSubmission / '
              '${balance.entitledDays} hari',
              key: const Key('leave-remaining'),
              style: const TextStyle(
                fontSize: 11.5,
                fontWeight: FontWeight.w600,
                color: AppColors.muted,
                fontFeatures: tabularFigures,
              ),
            ),
          ] else if (!_isAnnual) ...[
            const SizedBox(height: 5),
            const Text(
              'Jenis cuti ini tidak memotong kuota cuti tahunan.',
              key: Key('leave-remaining-note'),
              style: TextStyle(fontSize: 11.5, color: AppColors.muted),
            ),
          ],
          if (warning != null) ...[
            const SizedBox(height: 8),
            Text(
              warning,
              key: const Key('leave-warning'),
              style: const TextStyle(
                fontSize: 11.5,
                height: 1.35,
                fontWeight: FontWeight.w600,
                color: AppColors.danger,
              ),
            ),
          ],
        ],
      ),
    );
  }
}
