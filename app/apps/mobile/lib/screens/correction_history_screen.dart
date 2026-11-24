import 'package:material_ui/material_ui.dart';

import '../api/api_client.dart';
import '../models/correction.dart';
import '../services/auth_service.dart';

class CorrectionHistoryScreen extends StatefulWidget {
  const CorrectionHistoryScreen({super.key, required this.auth});

  final AuthService auth;

  @override
  State<CorrectionHistoryScreen> createState() =>
      _CorrectionHistoryScreenState();
}

class _CorrectionHistoryScreenState extends State<CorrectionHistoryScreen> {
  static const List<(String?, String)> _filters = [
    (null, 'Semua'),
    ('PENDING', 'Menunggu'),
    ('APPROVED', 'Disetujui'),
    ('REJECTED', 'Ditolak'),
  ];

  List<CorrectionRequest> _rows = const [];
  String? _status;
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
      final rows = await widget.auth.api.myCorrections(status: _status);
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
        _error = 'Riwayat revisi tidak dapat dimuat.';
        _loading = false;
      });
    }
  }

  Future<void> _select(String? status) async {
    if (_status == status) return;
    setState(() => _status = status);
    await _load();
  }

  String _date(DateTime value) {
    final local = value.toLocal();
    final day = local.day.toString().padLeft(2, '0');
    final month = local.month.toString().padLeft(2, '0');
    return '$day/$month/${local.year}';
  }

  String _dateTime(DateTime value) {
    final local = value.toLocal();
    final hour = local.hour.toString().padLeft(2, '0');
    final minute = local.minute.toString().padLeft(2, '0');
    return '${_date(local)} $hour:$minute';
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Riwayat Revisi')),
      body: Column(
        children: [
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            child: Row(
              children: [
                for (final (status, label) in _filters) ...[
                  ChoiceChip(
                    key: Key('correction-filter-${status ?? 'ALL'}'),
                    label: Text(label),
                    selected: _status == status,
                    onSelected: (_) => _select(status),
                  ),
                  const SizedBox(width: 8),
                ],
              ],
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
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              _error!,
              key: const Key('correction-error'),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 12),
            OutlinedButton(onPressed: _load, child: const Text('Coba lagi')),
          ],
        ),
      );
    }
    if (_rows.isEmpty) {
      return const Center(
        child: Text('Belum ada revisi.', key: Key('correction-empty')),
      );
    }
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView.builder(
        key: const Key('correction-list'),
        padding: const EdgeInsets.all(12),
        itemCount: _rows.length,
        itemBuilder: (context, index) {
          final row = _rows[index];
          return Card(
            child: ListTile(
              leading: Icon(
                row.requestType == 'CHECK_IN' ? Icons.login : Icons.logout,
              ),
              title: Text(
                '${row.typeLabel} • ${_date(row.requestedTimestamp)}',
              ),
              subtitle: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    row.reason,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                  const SizedBox(height: 4),
                  Text('Diajukan ${_dateTime(row.createdAt)}'),
                  if (row.isRejected && (row.rejectionReason ?? '').isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.only(top: 4),
                      child: Text(
                        'Alasan penolakan: ${row.rejectionReason}',
                        key: Key('correction-rejection-${row.id}'),
                        style: TextStyle(
                          color: Theme.of(context).colorScheme.error,
                        ),
                      ),
                    ),
                ],
              ),
              isThreeLine: true,
              trailing: Chip(label: Text(row.statusLabel)),
            ),
          );
        },
      ),
    );
  }
}
