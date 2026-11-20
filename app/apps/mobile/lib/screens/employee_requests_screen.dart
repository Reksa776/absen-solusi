import 'package:material_ui/material_ui.dart';

import '../api/api_client.dart';
import '../models/employee_request.dart';
import '../services/auth_service.dart';

/// Form dan riwayat lembur/WFH untuk karyawan. Kedua pengajuan memakai
/// approval Admin/HR; WFH yang disetujui akan melewati geofence saat check-in.
class EmployeeRequestsScreen extends StatefulWidget {
  const EmployeeRequestsScreen({super.key, required this.auth, this.now});

  final AuthService auth;
  final DateTime Function()? now;

  @override
  State<EmployeeRequestsScreen> createState() => _EmployeeRequestsScreenState();
}

class _EmployeeRequestsScreenState extends State<EmployeeRequestsScreen> {
  final _overtimeStart = TextEditingController(text: '18:00');
  final _overtimeEnd = TextEditingController(text: '20:00');
  final _overtimeReason = TextEditingController();
  final _wfhReason = TextEditingController();
  late DateTime _overtimeDate;
  late DateTime _wfhDate;
  List<OvertimeRequest> _overtime = const [];
  List<WfhRequest> _wfh = const [];
  bool _loading = true;
  bool _busy = false;
  String? _error;

  DateTime get _now => widget.now?.call() ?? DateTime.now();

  @override
  void initState() {
    super.initState();
    _overtimeDate = DateUtils.dateOnly(_now);
    _wfhDate = DateUtils.dateOnly(_now.add(const Duration(days: 1)));
    _load();
  }

  @override
  void dispose() {
    _overtimeStart.dispose();
    _overtimeEnd.dispose();
    _overtimeReason.dispose();
    _wfhReason.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
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
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.auth.api.submitOvertime(
        date: _overtimeDate,
        startTime: _overtimeStart.text.trim(),
        endTime: _overtimeEnd.text.trim(),
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
    if (_wfhReason.text.trim().length < 10) {
      setState(() => _error = 'Alasan WFH minimal 10 karakter.');
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
      );
      if (!mounted) return;
      _wfhReason.clear();
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Pengajuan WFH terkirim.')),
      );
      await _load();
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() => _error = messageForApiError(error));
    } catch (_) {
      if (!mounted) return;
      setState(() => _error = 'Pengajuan WFH gagal dikirim.');
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
      helpText: overtime ? 'Tanggal lembur' : 'Tanggal WFH',
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

  String _date(DateTime value) {
    final day = value.day.toString().padLeft(2, '0');
    final month = value.month.toString().padLeft(2, '0');
    return '$day/$month/${value.year}';
  }

  Widget _statusChip(String status) {
    final color = status == 'APPROVED'
        ? Colors.green
        : status == 'REJECTED'
        ? Colors.red
        : Colors.orange;
    return Chip(
      label: Text(statusLabel(status)),
      backgroundColor: color.withValues(alpha: 0.12),
    );
  }

  String statusLabel(String status) => switch (status) {
    'APPROVED' => 'Disetujui',
    'REJECTED' => 'Ditolak',
    _ => 'Menunggu',
  };

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Lembur & WFH')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  if (_error != null)
                    Text(
                      _error!,
                      key: const Key('request-error'),
                      style: TextStyle(color: Theme.of(context).colorScheme.error),
                    ),
                  Text('Pengajuan lembur', style: Theme.of(context).textTheme.titleMedium),
                  const SizedBox(height: 8),
                  ListTile(
                    key: const Key('overtime-date'),
                    leading: const Icon(Icons.event),
                    title: Text('Tanggal ${_date(_overtimeDate)}'),
                    trailing: const Icon(Icons.edit_calendar),
                    onTap: _busy ? null : () => _pickDate(overtime: true),
                  ),
                  Row(
                    children: [
                      Expanded(
                        child: TextField(
                          key: const Key('overtime-start'),
                          controller: _overtimeStart,
                          enabled: !_busy,
                          decoration: const InputDecoration(labelText: 'Mulai (HH:MM)'),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: TextField(
                          key: const Key('overtime-end'),
                          controller: _overtimeEnd,
                          enabled: !_busy,
                          decoration: const InputDecoration(labelText: 'Selesai (HH:MM)'),
                        ),
                      ),
                    ],
                  ),
                  TextField(
                    key: const Key('overtime-reason'),
                    controller: _overtimeReason,
                    enabled: !_busy,
                    maxLines: 3,
                    maxLength: 1000,
                    decoration: const InputDecoration(
                      labelText: 'Alasan lembur',
                      border: OutlineInputBorder(),
                    ),
                  ),
                  FilledButton.icon(
                    key: const Key('overtime-submit'),
                    onPressed: _busy ? null : _submitOvertime,
                    icon: const Icon(Icons.send),
                    label: const Text('Ajukan lembur'),
                  ),
                  const SizedBox(height: 8),
                  for (final row in _overtime)
                    Card(
                      child: ListTile(
                        title: Text('${_date(row.date)} • ${row.startTime}–${row.endTime}'),
                        subtitle: Text(row.reason, maxLines: 2),
                        trailing: _statusChip(row.status),
                      ),
                    ),
                  const Divider(height: 32),
                  Text('Pengajuan WFH', style: Theme.of(context).textTheme.titleMedium),
                  const SizedBox(height: 8),
                  ListTile(
                    key: const Key('wfh-date'),
                    leading: const Icon(Icons.home_work),
                    title: Text('Tanggal ${_date(_wfhDate)}'),
                    trailing: const Icon(Icons.edit_calendar),
                    onTap: _busy ? null : () => _pickDate(overtime: false),
                  ),
                  TextField(
                    key: const Key('wfh-reason'),
                    controller: _wfhReason,
                    enabled: !_busy,
                    maxLines: 3,
                    maxLength: 1000,
                    decoration: const InputDecoration(
                      labelText: 'Alasan WFH',
                      border: OutlineInputBorder(),
                    ),
                  ),
                  FilledButton.icon(
                    key: const Key('wfh-submit'),
                    onPressed: _busy ? null : _submitWfh,
                    icon: const Icon(Icons.send),
                    label: const Text('Ajukan WFH'),
                  ),
                  const SizedBox(height: 8),
                  for (final row in _wfh)
                    Card(
                      child: ListTile(
                        title: Text(_date(row.date)),
                        subtitle: Text(row.reason, maxLines: 2),
                        trailing: _statusChip(row.status),
                      ),
                    ),
                ],
              ),
            ),
    );
  }
}
