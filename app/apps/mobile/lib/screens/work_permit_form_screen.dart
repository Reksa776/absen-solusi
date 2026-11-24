import 'dart:typed_data';

import 'package:material_ui/material_ui.dart';

import '../api/api_client.dart';
import '../services/auth_service.dart';
import '../theme/app_theme.dart';
import 'proof_camera_screen.dart';

class WorkPermitFormScreen extends StatefulWidget {
  const WorkPermitFormScreen({super.key, required this.auth, this.now});

  final AuthService auth;
  final DateTime Function()? now;

  @override
  State<WorkPermitFormScreen> createState() => _WorkPermitFormScreenState();
}

class _WorkPermitFormScreenState extends State<WorkPermitFormScreen> {
  static const _types = [
    ('SAKIT', 'Sakit'),
    ('IZIN_PRIBADI', 'Izin pribadi'),
    ('PULANG_CEPAT', 'Pulang cepat'),
    ('DATANG_TERLAMBAT', 'Datang terlambat'),
    ('LAINNYA', 'Lainnya'),
  ];

  final _reason = TextEditingController();
  String _type = 'SAKIT';
  late DateTime _start;
  late DateTime _end;
  Uint8List? _proof;
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
  }

  @override
  void dispose() {
    _reason.dispose();
    super.dispose();
  }

  Future<void> _pickDate({required bool start}) async {
    final picked = await showDatePicker(
      context: context,
      firstDate: _today.subtract(const Duration(days: 30)),
      lastDate: _today.add(const Duration(days: 60)),
      initialDate: start ? _start : _end,
      helpText: start ? 'Tanggal mulai izin' : 'Tanggal selesai izin',
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

  Future<void> _captureProof() async {
    final bytes = await Navigator.of(context).push<Uint8List>(
      MaterialPageRoute<Uint8List>(builder: (_) => const ProofCameraScreen()),
    );
    if (bytes == null || !mounted) return;
    setState(() => _proof = bytes);
  }

  Future<void> _submit() async {
    final reason = _reason.text.trim();
    if (reason.length < 10) {
      setState(() => _error = 'Alasan izin minimal 10 karakter.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.auth.api.submitWorkPermit(
        permitType: _type,
        startDate: _start,
        endDate: _end,
        reason: reason,
        proofBytes: _proof,
      );
      if (!mounted) return;
      Navigator.of(context).pop(true);
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() => _error = messageForApiError(error));
    } catch (_) {
      if (!mounted) return;
      setState(() => _error = 'Pengajuan izin gagal dikirim.');
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
    return Scaffold(
      appBar: AppBar(title: const Text('Ajukan izin kerja')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
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
                  'Detail izin',
                  style: TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w800,
                    color: AppColors.ink,
                  ),
                ),
                const SizedBox(height: 3),
                const Text(
                  'Persetujuan mengikuti alur PERMIT. Lampiran bukti bersifat opsional.',
                  style: TextStyle(
                    fontSize: 11.5,
                    height: 1.4,
                    color: AppColors.muted,
                  ),
                ),
                const SizedBox(height: 14),
                DropdownButtonFormField<String>(
                  key: const Key('permit-type'),
                  initialValue: _type,
                  decoration: const InputDecoration(labelText: 'Jenis izin'),
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
                  key: const Key('permit-start-date'),
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
                  key: const Key('permit-end-date'),
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
                  key: const Key('permit-reason'),
                  controller: _reason,
                  enabled: !_busy,
                  minLines: 3,
                  maxLines: 5,
                  maxLength: 1000,
                  decoration: const InputDecoration(
                    labelText: 'Alasan izin',
                    hintText: 'Jelaskan alasan izin minimal 10 karakter.',
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 12),
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
                  'Bukti pendukung',
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w700,
                    color: AppColors.ink,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  _proof == null
                      ? 'Opsional. Ambil foto surat dokter atau dokumen pendukung.'
                      : 'Foto bukti siap dilampirkan.',
                  style: const TextStyle(
                    fontSize: 11,
                    height: 1.4,
                    color: AppColors.muted,
                  ),
                ),
                const SizedBox(height: 9),
                Row(
                  children: [
                    OutlinedButton.icon(
                      key: const Key('permit-proof'),
                      onPressed: _busy ? null : _captureProof,
                      icon: Icon(
                        _proof == null
                            ? Icons.add_a_photo_outlined
                            : Icons.check_circle_outline,
                        size: 16,
                      ),
                      label: Text(
                        _proof == null
                            ? 'Ambil foto bukti'
                            : 'Ganti foto bukti',
                      ),
                    ),
                    if (_proof != null) ...[
                      const SizedBox(width: 10),
                      TextButton(
                        onPressed: _busy
                            ? null
                            : () => setState(() => _proof = null),
                        child: const Text('Hapus'),
                      ),
                    ],
                  ],
                ),
              ],
            ),
          ),
          if (_error != null) ...[
            const SizedBox(height: 10),
            Text(
              _error!,
              key: const Key('permit-error'),
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
              key: const Key('permit-submit'),
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
              label: Text(_busy ? 'Mengirim…' : 'Kirim pengajuan izin'),
            ),
          ),
        ],
      ),
    );
  }
}
