import 'package:material_ui/material_ui.dart';

import '../api/api_client.dart';
import '../models/attendance_log.dart';
import '../services/auth_service.dart';

class HistoryScreen extends StatefulWidget {
  const HistoryScreen({super.key, required this.auth});

  final AuthService auth;

  @override
  State<HistoryScreen> createState() => _HistoryScreenState();
}

class _HistoryScreenState extends State<HistoryScreen> {
  List<AttendanceLog> _rows = const [];
  DateTimeRange? _range;
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
      final rows = await widget.auth.api.attendanceHistory(
        from: _range?.start,
        to: _range?.end,
      );
      if (!mounted) return;
      setState(() {
        _rows = rows;
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

  Future<void> _pickRange() async {
    final now = DateTime.now();
    final picked = await showDateRangePicker(
      context: context,
      firstDate: DateTime(now.year - 2),
      lastDate: now,
      initialDateRange: _range,
    );
    if (picked == null) return;
    setState(() => _range = picked);
    await _load();
  }

  String _date(DateTime value) {
    final local = value.toLocal();
    final day = local.day.toString().padLeft(2, '0');
    final month = local.month.toString().padLeft(2, '0');
    final hour = local.hour.toString().padLeft(2, '0');
    final minute = local.minute.toString().padLeft(2, '0');
    return '$day/$month/${local.year} $hour:$minute';
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Riwayat Absensi'),
        actions: [
          IconButton(
            key: const Key('history-filter'),
            tooltip: 'Filter tanggal',
            onPressed: _pickRange,
            icon: const Icon(Icons.date_range),
          ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
          ? Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    _error!,
                    key: const Key('history-error'),
                    textAlign: TextAlign.center,
                  ),
                  const SizedBox(height: 12),
                  OutlinedButton(onPressed: _load, child: const Text('Coba lagi')),
                ],
              ),
            )
          : _rows.isEmpty
          ? const Center(
              child: Text(
                'Belum ada riwayat absensi.',
                key: Key('history-empty'),
              ),
            )
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView.builder(
                key: const Key('history-list'),
                padding: const EdgeInsets.all(12),
                itemCount: _rows.length,
                itemBuilder: (context, index) {
                  final row = _rows[index];
                  return Card(
                    child: ListTile(
                      leading: _thumbnail(row),
                      title: Text('${row.label} • ${_date(row.timestampServer)}'),
                      subtitle: Text(
                        'Jarak ${row.distanceMeters.toStringAsFixed(0)} m • '
                        'akurasi ${row.accuracyMeters.toStringAsFixed(0)} m',
                      ),
                      trailing: row.isSuspicious
                          ? const Chip(
                              avatar: Icon(Icons.warning_amber, size: 16),
                              label: Text('Suspicious'),
                            )
                          : const Chip(label: Text('Dalam radius')),
                    ),
                  );
                },
              ),
            ),
    );
  }

  Widget _thumbnail(AttendanceLog row) {
    final url = widget.auth.api.photoUrl(row.photoUrl);
    if (row.photoUrl.isEmpty) {
      return const CircleAvatar(child: Icon(Icons.image_not_supported));
    }
    return ClipRRect(
      borderRadius: BorderRadius.circular(8),
      child: Image.network(
        url,
        width: 52,
        height: 52,
        fit: BoxFit.cover,
        errorBuilder: (_, _, _) =>
            const CircleAvatar(child: Icon(Icons.broken_image)),
      ),
    );
  }
}
