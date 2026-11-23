import 'package:material_ui/material_ui.dart';

import '../api/api_client.dart';
import '../models/warning_letter.dart';
import '../services/auth_service.dart';
import '../theme/app_theme.dart';

class WarningLettersScreen extends StatefulWidget {
  const WarningLettersScreen({super.key, required this.auth});

  final AuthService auth;

  @override
  State<WarningLettersScreen> createState() => _WarningLettersScreenState();
}

class _WarningLettersScreenState extends State<WarningLettersScreen> {
  List<WarningLetter> _items = const [];
  bool _loading = true;
  String? _busyId;
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
      final items = await widget.auth.api.myWarningLetters();
      if (!mounted) return;
      setState(() {
        _items = items;
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
        _error = 'Surat peringatan tidak dapat dimuat.';
        _loading = false;
      });
    }
  }

  Future<void> _acknowledge(WarningLetter item) async {
    setState(() {
      _busyId = item.id;
      _error = null;
    });
    try {
      final updated = await widget.auth.api.acknowledgeWarningLetter(item.id);
      if (!mounted) return;
      setState(() {
        _items = [
          for (final row in _items)
            if (row.id == updated.id) updated else row,
        ];
      });
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Konfirmasi baca tersimpan.')),
      );
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() => _error = messageForApiError(error));
    } catch (_) {
      if (!mounted) return;
      setState(() => _error = 'Konfirmasi gagal disimpan.');
    } finally {
      if (mounted) setState(() => _busyId = null);
    }
  }

  String _date(DateTime value) {
    final day = value.day.toString().padLeft(2, '0');
    final month = value.month.toString().padLeft(2, '0');
    return '$day/$month/${value.year}';
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Surat peringatan')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              color: AppColors.green,
              onRefresh: _load,
              child: ListView(
                padding: const EdgeInsets.fromLTRB(16, 16, 16, 28),
                children: [
                  if (_error != null) ...[
                    Text(
                      _error!,
                      style: const TextStyle(
                        fontSize: 12,
                        color: AppColors.danger,
                      ),
                    ),
                    const SizedBox(height: 10),
                  ],
                  if (_items.isEmpty)
                    const Padding(
                      padding: EdgeInsets.only(top: 80),
                      child: Column(
                        children: [
                          Icon(
                            Icons.verified_user_outlined,
                            size: 34,
                            color: AppColors.muted,
                          ),
                          SizedBox(height: 10),
                          Text(
                            'Tidak ada surat peringatan.',
                            style: TextStyle(
                              fontSize: 12.5,
                              color: AppColors.muted,
                            ),
                          ),
                        ],
                      ),
                    ),
                  for (final item in _items) ...[
                    Container(
                      key: Key('warning-${item.id}'),
                      padding: const EdgeInsets.all(14),
                      decoration: BoxDecoration(
                        color: item.isActive
                            ? AppColors.yellowSoft
                            : AppColors.surface,
                        borderRadius: BorderRadius.circular(14),
                        border: Border.all(
                          color: item.isActive
                              ? AppColors.yellowLine
                              : AppColors.line,
                        ),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Container(
                                padding: const EdgeInsets.symmetric(
                                  horizontal: 9,
                                  vertical: 4,
                                ),
                                decoration: BoxDecoration(
                                  color: AppColors.surface,
                                  borderRadius: BorderRadius.circular(999),
                                  border: Border.all(
                                    color: item.isActive
                                        ? AppColors.yellowLine
                                        : AppColors.line,
                                  ),
                                ),
                                child: Text(
                                  item.level,
                                  style: const TextStyle(
                                    fontSize: 11,
                                    fontWeight: FontWeight.w800,
                                    color: AppColors.ink,
                                  ),
                                ),
                              ),
                              const SizedBox(width: 8),
                              Expanded(
                                child: Text(
                                  item.letterNumber,
                                  style: const TextStyle(
                                    fontSize: 12,
                                    fontWeight: FontWeight.w700,
                                    color: AppColors.ink,
                                    fontFeatures: tabularFigures,
                                  ),
                                ),
                              ),
                              Text(
                                item.isActive ? 'Aktif' : 'Berakhir',
                                style: TextStyle(
                                  fontSize: 10.5,
                                  fontWeight: FontWeight.w700,
                                  color: item.isActive
                                      ? AppColors.yellowInk
                                      : AppColors.muted,
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 9),
                          Text(
                            item.violationReason,
                            style: const TextStyle(
                              fontSize: 12,
                              height: 1.45,
                              color: AppColors.ink,
                            ),
                          ),
                          const SizedBox(height: 8),
                          Text(
                            'Terbit ${_date(item.issuedAt)} · berlaku sampai '
                            '${_date(item.validUntil)} · oleh ${item.issuedByName}',
                            style: const TextStyle(
                              fontSize: 10.5,
                              height: 1.4,
                              color: AppColors.muted,
                            ),
                          ),
                          const SizedBox(height: 10),
                          if (item.isAcknowledged)
                            Row(
                              children: [
                                const Icon(
                                  Icons.check_circle,
                                  size: 15,
                                  color: AppColors.greenDark,
                                ),
                                const SizedBox(width: 6),
                                Text(
                                  'Dikonfirmasi ${_date(item.acknowledgedAt!)}',
                                  style: const TextStyle(
                                    fontSize: 11,
                                    fontWeight: FontWeight.w700,
                                    color: AppColors.greenDark,
                                    fontFeatures: tabularFigures,
                                  ),
                                ),
                              ],
                            )
                          else
                            SizedBox(
                              height: 42,
                              child: FilledButton.icon(
                                key: Key('warning-ack-${item.id}'),
                                onPressed: _busyId == item.id
                                    ? null
                                    : () => _acknowledge(item),
                                icon: _busyId == item.id
                                    ? const SizedBox.square(
                                        dimension: 14,
                                        child: CircularProgressIndicator(
                                          strokeWidth: 2,
                                          color: Colors.white,
                                        ),
                                      )
                                    : const Icon(Icons.done_all, size: 16),
                                label: const Text('Konfirmasi Sudah Dibaca'),
                              ),
                            ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 10),
                  ],
                ],
              ),
            ),
    );
  }
}
