import 'package:material_ui/material_ui.dart';

import '../api/api_client.dart';
import '../models/client_visit.dart';
import '../services/auth_service.dart';
import '../theme/app_theme.dart';

class WorkProjectionsScreen extends StatefulWidget {
  const WorkProjectionsScreen({super.key, required this.auth});

  final AuthService auth;

  @override
  State<WorkProjectionsScreen> createState() => _WorkProjectionsScreenState();
}

class _WorkProjectionsScreenState extends State<WorkProjectionsScreen> {
  List<WorkProjection> _rows = const [];
  bool _loading = true;
  bool _busy = false;
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
      final rows = await widget.auth.api.myWorkProjections();
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
        _error = 'Proyeksi pekerjaan tidak dapat dimuat.';
        _loading = false;
      });
    }
  }

  Future<void> _create() async {
    final title = TextEditingController();
    final description = TextEditingController();
    final today = DateTime.now();
    var periodType = 'DAILY';
    var startDate = DateTime(today.year, today.month, today.day);
    var endDate = startDate;
    final result = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          title: const Text('Target kerja baru'),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextField(
                  controller: title,
                  maxLength: 160,
                  decoration: const InputDecoration(labelText: 'Judul target'),
                ),
                TextField(
                  controller: description,
                  minLines: 2,
                  maxLines: 4,
                  maxLength: 1000,
                  decoration: const InputDecoration(
                    labelText: 'Deskripsi (opsional)',
                  ),
                ),
                DropdownButtonFormField<String>(
                  initialValue: periodType,
                  decoration: const InputDecoration(labelText: 'Periode'),
                  items: const [
                    DropdownMenuItem(value: 'DAILY', child: Text('Harian')),
                    DropdownMenuItem(value: 'WEEKLY', child: Text('Mingguan')),
                  ],
                  onChanged: (value) {
                    if (value != null) setDialogState(() => periodType = value);
                  },
                ),
                const SizedBox(height: 10),
                Row(
                  children: [
                    Expanded(
                      child: OutlinedButton(
                        onPressed: () async {
                          final picked = await showDatePicker(
                            context: context,
                            initialDate: startDate,
                            firstDate: DateTime(today.year - 1),
                            lastDate: DateTime(today.year + 2),
                          );
                          if (picked != null) {
                            setDialogState(() {
                              startDate = picked;
                              if (endDate.isBefore(startDate)) {
                                endDate = startDate;
                              }
                            });
                          }
                        },
                        child: Text('Mulai ${_shortDate(startDate)}'),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: OutlinedButton(
                        onPressed: () async {
                          final picked = await showDatePicker(
                            context: context,
                            initialDate: endDate.isBefore(startDate)
                                ? startDate
                                : endDate,
                            firstDate: startDate,
                            lastDate: DateTime(today.year + 2),
                          );
                          if (picked != null) {
                            setDialogState(() => endDate = picked);
                          }
                        },
                        child: Text('Selesai ${_shortDate(endDate)}'),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(dialogContext).pop(false),
              child: const Text('Batal'),
            ),
            FilledButton(
              onPressed: () {
                if (title.text.trim().length < 3) return;
                Navigator.of(dialogContext).pop(true);
              },
              child: const Text('Simpan target'),
            ),
          ],
        ),
      ),
    );
    if (result == true && mounted) {
      setState(() => _busy = true);
      try {
        await widget.auth.api.createWorkProjection(
          title: title.text.trim(),
          description: description.text.trim(),
          periodType: periodType,
          startDate: startDate,
          endDate: endDate,
        );
        await _load();
      } on ApiException catch (error) {
        if (mounted) {
          ScaffoldMessenger.of(context)
              .showSnackBar(SnackBar(content: Text(messageForApiError(error))));
        }
      } catch (_) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Target kerja gagal disimpan.')),
          );
        }
      } finally {
        if (mounted) setState(() => _busy = false);
      }
    }
    title.dispose();
    description.dispose();
  }

  Future<void> _update(WorkProjection row) async {
    var progress = row.progress.toDouble();
    var status = row.status;
    final blocker = TextEditingController(text: row.blockerNote ?? '');
    final result = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(18)),
      ),
      builder: (sheetContext) => Padding(
        padding: EdgeInsets.fromLTRB(
          18,
          16,
          18,
          MediaQuery.viewInsetsOf(sheetContext).bottom + 18,
        ),
        child: StatefulBuilder(
          builder: (context, setSheetState) => Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                row.title,
                style: const TextStyle(
                  fontSize: 15,
                  fontWeight: FontWeight.w800,
                  color: AppColors.ink,
                ),
              ),
              const SizedBox(height: 4),
              Text(
                '${row.periodLabel} • ${_shortDate(row.startDate)}–${_shortDate(row.endDate)}',
                style: const TextStyle(fontSize: 11, color: AppColors.muted),
              ),
              const SizedBox(height: 14),
              Row(
                children: [
                  const Text(
                    'Progres',
                    style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w700,
                      color: AppColors.ink,
                    ),
                  ),
                  const Spacer(),
                  Text(
                    '${progress.round()}%',
                    style: const TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w800,
                      color: AppColors.greenDark,
                      fontFeatures: tabularFigures,
                    ),
                  ),
                ],
              ),
              Slider(
                value: progress,
                max: 100,
                divisions: 20,
                label: '${progress.round()}%',
                onChanged: (value) {
                  setSheetState(() {
                    progress = value;
                    if (value >= 100) {
                      status = 'COMPLETED';
                    } else if (status == 'COMPLETED') {
                      status = 'IN_PROGRESS';
                    } else if (value > 0 && status == 'PLANNED') {
                      status = 'IN_PROGRESS';
                    }
                  });
                },
              ),
              DropdownButtonFormField<String>(
                initialValue: status,
                decoration: const InputDecoration(labelText: 'Status'),
                items: const [
                  DropdownMenuItem(
                    value: 'PLANNED',
                    child: Text('Direncanakan'),
                  ),
                  DropdownMenuItem(
                    value: 'IN_PROGRESS',
                    child: Text('Berjalan'),
                  ),
                  DropdownMenuItem(value: 'BLOCKED', child: Text('Kendala')),
                  DropdownMenuItem(value: 'COMPLETED', child: Text('Selesai')),
                ],
                onChanged: progress >= 100
                    ? null
                    : (value) {
                        if (value != null) setSheetState(() => status = value);
                      },
              ),
              const SizedBox(height: 10),
              TextField(
                controller: blocker,
                minLines: 2,
                maxLines: 3,
                maxLength: 1000,
                decoration: const InputDecoration(
                  labelText: 'Catatan kendala (wajib bila BLOCKED)',
                ),
              ),
              const SizedBox(height: 8),
              SizedBox(
                width: double.infinity,
                height: 46,
                child: FilledButton(
                  onPressed: () {
                    if (status == 'BLOCKED' && blocker.text.trim().isEmpty) {
                      return;
                    }
                    Navigator.of(sheetContext).pop(true);
                  },
                  child: const Text('Perbarui progres'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
    if (result == true && mounted) {
      setState(() => _busy = true);
      try {
        await widget.auth.api.updateWorkProjection(
          projectionId: row.id,
          progress: progress.round(),
          status: status,
          blockerNote: blocker.text.trim(),
        );
        await _load();
      } on ApiException catch (error) {
        if (mounted) {
          ScaffoldMessenger.of(context)
              .showSnackBar(SnackBar(content: Text(messageForApiError(error))));
        }
      } catch (_) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Progres gagal diperbarui.')),
          );
        }
      } finally {
        if (mounted) setState(() => _busy = false);
      }
    }
    blocker.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.canvas,
      appBar: AppBar(
        title: const Text('Proyeksi Pekerjaan'),
        backgroundColor: AppColors.surface,
        surfaceTintColor: Colors.transparent,
      ),
      floatingActionButton: FloatingActionButton.extended(
        key: const Key('projection-create'),
        onPressed: _busy ? null : _create,
        backgroundColor: AppColors.green,
        foregroundColor: Colors.white,
        icon: const Icon(Icons.add_task, size: 18),
        label: const Text('Target baru'),
      ),
      body: RefreshIndicator(
        color: AppColors.green,
        onRefresh: _load,
        child: _body(),
      ),
    );
  }

  Widget _body() {
    if (_loading) return const Center(child: CircularProgressIndicator());
    if (_error != null) {
      return ListView(
        padding: const EdgeInsets.all(24),
        children: [
          Text(
            _error!,
            key: const Key('projection-error'),
            textAlign: TextAlign.center,
            style: const TextStyle(fontSize: 12.5, color: AppColors.muted),
          ),
          const SizedBox(height: 12),
          OutlinedButton(onPressed: _load, child: const Text('Coba lagi')),
        ],
      );
    }
    if (_rows.isEmpty) {
      return ListView(
        padding: const EdgeInsets.all(24),
        children: const [
          SizedBox(height: 50),
          Icon(Icons.track_changes, size: 38, color: AppColors.muted),
          SizedBox(height: 10),
          Text(
            'Belum ada target kerja.\nTekan “Target baru” untuk mulai.',
            textAlign: TextAlign.center,
            style: TextStyle(
              fontSize: 12.5,
              height: 1.5,
              color: AppColors.muted,
            ),
          ),
        ],
      );
    }
    return ListView.separated(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 90),
      itemCount: _rows.length,
      separatorBuilder: (_, _) => const SizedBox(height: 10),
      itemBuilder: (context, index) {
        final row = _rows[index];
        return Container(
          key: Key('projection-${row.id}'),
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: AppColors.surface,
            borderRadius: BorderRadius.circular(14),
            border: Border.all(
              color: row.status == 'BLOCKED'
                  ? AppColors.danger.withValues(alpha: 0.28)
                  : AppColors.line,
            ),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          row.title,
                          style: const TextStyle(
                            fontSize: 13.5,
                            fontWeight: FontWeight.w800,
                            color: AppColors.ink,
                          ),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          '${row.periodLabel} • ${_shortDate(row.startDate)}–${_shortDate(row.endDate)}',
                          style: const TextStyle(
                            fontSize: 10.5,
                            color: AppColors.muted,
                            fontFeatures: tabularFigures,
                          ),
                        ),
                      ],
                    ),
                  ),
                  _statusPill(row.status, row.statusLabel),
                ],
              ),
              if (row.description != null) ...[
                const SizedBox(height: 7),
                Text(
                  row.description!,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 11,
                    height: 1.4,
                    color: AppColors.muted,
                  ),
                ),
              ],
              const SizedBox(height: 11),
              Row(
                children: [
                  Expanded(
                    child: ClipRRect(
                      borderRadius: BorderRadius.circular(999),
                      child: LinearProgressIndicator(
                        value: row.progress / 100,
                        minHeight: 7,
                        backgroundColor: AppColors.tableHead,
                        valueColor: AlwaysStoppedAnimation<Color>(
                          row.status == 'BLOCKED'
                              ? AppColors.danger
                              : AppColors.green,
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Text(
                    '${row.progress}%',
                    style: const TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w800,
                      color: AppColors.ink,
                      fontFeatures: tabularFigures,
                    ),
                  ),
                ],
              ),
              if (row.blockerNote != null) ...[
                const SizedBox(height: 8),
                Text(
                  'Kendala: ${row.blockerNote}',
                  style: const TextStyle(
                    fontSize: 10.8,
                    height: 1.4,
                    color: AppColors.danger,
                  ),
                ),
              ],
              if (row.reviewNote != null) ...[
                const SizedBox(height: 6),
                Text(
                  'Review atasan: ${row.reviewNote}',
                  style: const TextStyle(
                    fontSize: 10.8,
                    height: 1.4,
                    color: AppColors.greenDark,
                  ),
                ),
              ],
              const SizedBox(height: 9),
              SizedBox(
                width: double.infinity,
                child: OutlinedButton.icon(
                  key: Key('projection-update-${row.id}'),
                  onPressed: _busy ? null : () => _update(row),
                  icon: const Icon(Icons.tune, size: 16),
                  label: const Text('Perbarui progres'),
                ),
              ),
            ],
          ),
        );
      },
    );
  }

  Widget _statusPill(String status, String label) {
    final (background, border, foreground) = switch (status) {
      'COMPLETED' => (
        AppColors.greenSoft,
        AppColors.greenLine,
        AppColors.greenDark,
      ),
      'BLOCKED' => (AppColors.dangerSoft, AppColors.danger, AppColors.danger),
      'IN_PROGRESS' => (
        AppColors.yellowSoft,
        AppColors.yellowLine,
        AppColors.yellowInk,
      ),
      _ => (AppColors.tableHead, AppColors.line, AppColors.muted),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: border),
      ),
      child: Text(
        label,
        style: TextStyle(
          fontSize: 9.5,
          fontWeight: FontWeight.w700,
          color: foreground,
        ),
      ),
    );
  }

  String _shortDate(DateTime value) {
    final local = value.toLocal();
    return '${local.day.toString().padLeft(2, '0')}/'
        '${local.month.toString().padLeft(2, '0')}';
  }
}
