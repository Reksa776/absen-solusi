import 'dart:typed_data';

import 'package:material_ui/material_ui.dart';

import '../api/api_client.dart';
import '../services/auth_service.dart';
import 'camera_screen.dart';
import 'correction_history_screen.dart';

typedef CorrectionPhotoTaker = Future<Uint8List?> Function(BuildContext context);

class CorrectionFormScreen extends StatefulWidget {
  const CorrectionFormScreen({
    super.key,
    required this.auth,
    this.photoTaker,
    this.initialDate,
    this.now,
  });

  final AuthService auth;
  final CorrectionPhotoTaker? photoTaker;
  final DateTime? initialDate;
  final DateTime Function()? now;

  @override
  State<CorrectionFormScreen> createState() => _CorrectionFormScreenState();
}

class _CorrectionFormScreenState extends State<CorrectionFormScreen> {
  static const int _minReasonLength = 10;

  final TextEditingController _reason = TextEditingController();
  late DateTime _date;
  String _type = 'CHECK_IN';
  Uint8List? _proof;
  bool _submitting = false;
  String? _validationError;
  String? _error;

  DateTime get _now => widget.now?.call() ?? DateTime.now();

  @override
  void initState() {
    super.initState();
    final now = _now;
    _date = DateUtils.dateOnly(
      widget.initialDate ?? now.subtract(const Duration(days: 1)),
    );
  }

  @override
  void dispose() {
    _reason.dispose();
    super.dispose();
  }

  DateTime get _requestedTimestamp {
    final hour = _type == 'CHECK_IN' ? 9 : 17;
    final candidate = DateTime(_date.year, _date.month, _date.day, hour);
    final now = _now;
    return candidate.isAfter(now)
        ? now.subtract(const Duration(minutes: 1))
        : candidate;
  }

  String _formatDate(DateTime value) {
    final day = value.day.toString().padLeft(2, '0');
    final month = value.month.toString().padLeft(2, '0');
    return '$day/$month/${value.year}';
  }

  Future<void> _pickDate() async {
    if (_submitting) return;
    final now = _now;
    final picked = await showDatePicker(
      context: context,
      firstDate: DateUtils.dateOnly(now.subtract(const Duration(days: 30))),
      lastDate: DateUtils.dateOnly(now),
      initialDate: _date,
      helpText: 'Pilih tanggal revisi',
    );
    if (picked == null) return;
    setState(() => _date = DateUtils.dateOnly(picked));
  }

  Future<void> _attachProof() async {
    if (_submitting) return;
    final custom = widget.photoTaker;
    final photo = custom != null
        ? await custom(context)
        : await Navigator.of(context).push<Uint8List>(
            MaterialPageRoute<Uint8List>(builder: (_) => const CameraScreen()),
          );
    if (photo == null || !mounted) return;
    setState(() {
      _proof = photo;
      _error = null;
    });
  }

  Future<void> _submit() async {
    final reason = _reason.text.trim();
    if (reason.length < _minReasonLength) {
      setState(() {
        _validationError = 'Alasan revisi minimal $_minReasonLength karakter.';
        _error = null;
      });
      return;
    }
    setState(() {
      _submitting = true;
      _validationError = null;
      _error = null;
    });
    try {
      await widget.auth.api.submitCorrection(
        requestType: _type,
        requestedTimestamp: _requestedTimestamp,
        reason: reason,
        proofBytes: _proof,
      );
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Pengajuan revisi terkirim.')),
      );
      Navigator.of(context).pop(true);
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() => _error = messageForApiError(error));
    } catch (_) {
      if (!mounted) return;
      setState(() => _error = 'Pengajuan revisi gagal dikirim. Periksa koneksi Anda.');
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(
        title: const Text('Ajukan Revisi'),
        actions: [
          IconButton(
            key: const Key('correction-history'),
            tooltip: 'Riwayat revisi',
            onPressed: () => Navigator.of(context).push(
              MaterialPageRoute<void>(
                builder: (_) => CorrectionHistoryScreen(auth: widget.auth),
              ),
            ),
            icon: const Icon(Icons.fact_check_outlined),
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text(
            'Ajukan koreksi absensi yang terlewat atau salah waktu.',
            style: theme.textTheme.bodyMedium,
          ),
          const SizedBox(height: 16),
          Card(
            child: ListTile(
              key: const Key('correction-date'),
              leading: const Icon(Icons.event),
              title: const Text('Tanggal revisi'),
              subtitle: Text(_formatDate(_date)),
              trailing: const Icon(Icons.edit_calendar),
              onTap: _pickDate,
            ),
          ),
          const SizedBox(height: 16),
          Text('Tipe revisi', style: theme.textTheme.titleSmall),
          const SizedBox(height: 8),
          SegmentedButton<String>(
            key: const Key('correction-type'),
            segments: const [
              ButtonSegment(
                value: 'CHECK_IN',
                label: Text('Check-in'),
                icon: Icon(Icons.login),
              ),
              ButtonSegment(
                value: 'CHECK_OUT',
                label: Text('Check-out'),
                icon: Icon(Icons.logout),
              ),
            ],
            selected: {_type},
            onSelectionChanged: (values) {
              if (_submitting) return;
              setState(() => _type = values.first);
            },
          ),
          const SizedBox(height: 16),
          TextField(
            key: const Key('correction-reason'),
            controller: _reason,
            enabled: !_submitting,
            maxLines: 4,
            maxLength: 1000,
            decoration: const InputDecoration(
              labelText: 'Alasan revisi',
              hintText: 'Contoh: lupa check-in karena jaringan kantor terputus',
              border: OutlineInputBorder(),
              alignLabelWithHint: true,
            ),
            onChanged: (_) {
              if (_validationError != null) {
                setState(() => _validationError = null);
              }
            },
          ),
          if (_validationError != null)
            Text(
              _validationError!,
              key: const Key('correction-validation'),
              style: TextStyle(color: theme.colorScheme.error),
            ),
          const SizedBox(height: 8),
          Row(
            children: [
              OutlinedButton.icon(
                key: const Key('correction-proof'),
                onPressed: _submitting ? null : _attachProof,
                icon: const Icon(Icons.attach_file),
                label: Text(_proof == null ? 'Lampirkan bukti' : 'Ganti bukti'),
              ),
              const SizedBox(width: 8),
              if (_proof != null) ...[
                Expanded(
                  child: Text(
                    'Bukti terpasang (${_proof!.length} byte)',
                    key: const Key('correction-proof-attached'),
                    style: theme.textTheme.bodySmall,
                  ),
                ),
                IconButton(
                  key: const Key('correction-proof-remove'),
                  tooltip: 'Hapus bukti',
                  onPressed: _submitting
                      ? null
                      : () => setState(() => _proof = null),
                  icon: const Icon(Icons.close),
                ),
              ] else
                const Expanded(
                  child: Text(
                    'Opsional, maksimal 5 MB.',
                    style: TextStyle(fontSize: 12),
                  ),
                ),
            ],
          ),
          if (_error != null) ...[
            const SizedBox(height: 8),
            Text(
              _error!,
              key: const Key('correction-error'),
              style: TextStyle(color: theme.colorScheme.error),
            ),
          ],
          const SizedBox(height: 20),
          SizedBox(
            height: 52,
            child: FilledButton.icon(
              key: const Key('correction-submit'),
              onPressed: _submitting ? null : _submit,
              icon: _submitting
                  ? const SizedBox.square(
                      dimension: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.send),
              label: const Text('Kirim pengajuan'),
            ),
          ),
        ],
      ),
    );
  }
}
