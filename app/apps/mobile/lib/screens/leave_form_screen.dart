import 'package:material_ui/material_ui.dart';

import '../api/api_client.dart';
import '../models/leave.dart';
import '../services/auth_service.dart';
import '../theme/app_theme.dart';

class LeaveFormScreen extends StatefulWidget {
  const LeaveFormScreen({super.key, required this.auth, this.now});

  final AuthService auth;
  final DateTime Function()? now;

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
  bool _busy = false;
  String? _error;

  DateTime get _today {
    final value = widget.now?.call() ?? DateTime.now();
    return DateUtils.dateOnly(value);
  }

  @override
  void initState() {
    super.initState();
    _start = _today;
    _end = _today;
    _loadBalance();
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
                ListTile(
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
                ListTile(
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
                const SizedBox(height: 6),
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
              onPressed: _busy ? null : _submit,
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
}
