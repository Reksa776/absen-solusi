import 'dart:typed_data';

import 'package:material_ui/material_ui.dart';

import '../api/api_client.dart';
import '../services/auth_service.dart';
import '../theme/app_theme.dart';
import 'camera_screen.dart';
import 'correction_history_screen.dart';

typedef CorrectionPhotoTaker = Future<Uint8List?> Function(
  BuildContext context,
);

const List<(String, String)> _correctionKinds = [
  ('LUPA_CHECK_IN', 'Lupa Check-in'),
  ('LUPA_CHECK_OUT', 'Lupa Check-out'),
  ('LUPA_FULL', 'Lupa Absen Penuh'),
  ('ADJUST', 'Penyesuaian Jam'),
];

class CorrectionFormScreen extends StatefulWidget {
  const CorrectionFormScreen({
    super.key,
    required this.auth,
    this.photoTaker,
    this.initialDate,
    this.initialCheckInTime,
    this.initialCheckOutTime,
    this.initialKind,
    this.attendanceLogId,
    this.logType,
    this.now,
  });

  final AuthService auth;
  final CorrectionPhotoTaker? photoTaker;
  final DateTime? initialDate;

  /// Jam yang tercatat sebelumnya; dipakai untuk pre-fill dari kartu riwayat.
  final DateTime? initialCheckInTime;
  final DateTime? initialCheckOutTime;
  final String? initialKind;
  final String? attendanceLogId;
  final String? logType;
  final DateTime Function()? now;

  @override
  State<CorrectionFormScreen> createState() => _CorrectionFormScreenState();
}

class _CorrectionFormScreenState extends State<CorrectionFormScreen> {
  static const int _minReasonLength = 10;

  final TextEditingController _reason = TextEditingController();
  late DateTime _date;
  late String _kind;
  late String _logType;
  late TimeOfDay _checkIn;
  late TimeOfDay _checkOut;
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
    _kind = widget.initialKind ?? 'LUPA_CHECK_IN';
    _logType =
        widget.logType ??
        (_kind == 'LUPA_CHECK_OUT' ? 'CHECK_OUT' : 'CHECK_IN');
    _checkIn = TimeOfDay.fromDateTime(
      widget.initialCheckInTime ?? DateTime(2000, 1, 1, 9),
    );
    _checkOut = TimeOfDay.fromDateTime(
      widget.initialCheckOutTime ?? DateTime(2000, 1, 1, 17),
    );
  }

  @override
  void dispose() {
    _reason.dispose();
    super.dispose();
  }

  String _timeLabel(TimeOfDay value) =>
      '${value.hour.toString().padLeft(2, '0')}:'
      '${value.minute.toString().padLeft(2, '0')}';

  DateTime _combine(DateTime day, TimeOfDay time) =>
      DateTime(day.year, day.month, day.day, time.hour, time.minute);

  String get _requestType {
    if (_kind == 'LUPA_CHECK_OUT') return 'CHECK_OUT';
    if (_kind == 'ADJUST') return _logType;
    return 'CHECK_IN';
  }

  DateTime get _requestedTimestamp {
    final candidate = _combine(
      _date,
      _requestType == 'CHECK_OUT' || _kind == 'LUPA_CHECK_OUT'
          ? _checkOut
          : _checkIn,
    );
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
      firstDate: DateTime(now.year - 5),
      lastDate: DateUtils.dateOnly(now),
      initialDate: _date,
      helpText: 'Pilih tanggal revisi',
    );
    if (picked == null) return;
    setState(() => _date = DateUtils.dateOnly(picked));
  }

  Future<void> _pickTime({required bool checkIn}) async {
    if (_submitting) return;
    final picked = await showTimePicker(
      context: context,
      initialTime: checkIn ? _checkIn : _checkOut,
      helpText: checkIn ? 'Jam check-in' : 'Jam check-out',
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(context).copyWith(alwaysUse24HourFormat: true),
        child: child!,
      ),
    );
    if (picked == null) return;
    setState(() {
      if (checkIn) {
        _checkIn = picked;
      } else {
        _checkOut = picked;
      }
    });
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
      // Lupa absen penuh hanya mengirim satu permintaan; jam pulang disertakan
      // agar admin dapat memproses keduanya. Revisi parsial hanya mengirim
      // satu tipe dan tidak menyentuh jam sisi lainnya.
      final payloadReason = _kind == 'LUPA_FULL'
          ? '$reason\nJam pulang yang diajukan: ${_timeLabel(_checkOut)}.'
          : reason;
      await widget.auth.api.submitCorrection(
        requestType: _requestType,
        requestedTimestamp: _requestedTimestamp,
        reason: payloadReason,
        attendanceLogId: widget.attendanceLogId,
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
      setState(
        () => _error = 'Pengajuan revisi gagal dikirim. Periksa koneksi Anda.',
      );
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final partial = widget.initialKind == 'ADJUST' && widget.logType != null;
    final targetLabel = _logType == 'CHECK_OUT' ? 'Keluar' : 'Masuk';
    final recorded =
        widget.initialCheckInTime != null || widget.initialCheckOutTime != null;
    return Scaffold(
      backgroundColor: AppColors.canvas,
      appBar: AppBar(
        title: Text(
          partial ? 'Revisi Presensi $targetLabel' : 'Ajukan Revisi',
          key: const Key('correction-title'),
        ),
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
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text(
              'Ajukan koreksi absensi yang terlewat atau salah waktu.',
              style: TextStyle(fontSize: 12.5, color: AppColors.muted),
            ),
            if (recorded) ...[
              const SizedBox(height: 10),
              Container(
                key: const Key('correction-recorded'),
                padding: const EdgeInsets.symmetric(
                  horizontal: 12,
                  vertical: 9,
                ),
                decoration: BoxDecoration(
                  color: AppColors.tableHead,
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(color: AppColors.line),
                ),
                child: Text(
                  partial
                      ? 'Revisi hanya mengubah jam ${targetLabel.toLowerCase()}. '
                            'Jam ${targetLabel == 'Masuk' ? 'keluar' : 'masuk'} '
                            'tetap '
                            '${targetLabel == 'Masuk' ? (widget.initialCheckOutTime == null ? '—' : _timeLabel(TimeOfDay.fromDateTime(widget.initialCheckOutTime!))) : (widget.initialCheckInTime == null ? '—' : _timeLabel(TimeOfDay.fromDateTime(widget.initialCheckInTime!)))}.'
                      : 'Tercatat: masuk '
                            '${widget.initialCheckInTime == null ? '—' : _timeLabel(TimeOfDay.fromDateTime(widget.initialCheckInTime!))}'
                            ' • pulang '
                            '${widget.initialCheckOutTime == null ? '—' : _timeLabel(TimeOfDay.fromDateTime(widget.initialCheckOutTime!))}',
                  style: const TextStyle(
                    fontSize: 11.5,
                    fontWeight: FontWeight.w600,
                    color: AppColors.muted,
                    fontFeatures: tabularFigures,
                  ),
                ),
              ),
            ],
            const SizedBox(height: 14),
            _card(
              child: Material(
                color: Colors.transparent,
                child: ListTile(
                  key: const Key('correction-date'),
                  contentPadding: EdgeInsets.zero,
                  leading: const Icon(Icons.event, size: 20),
                  title: const Text(
                    'Tanggal revisi',
                    style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700),
                  ),
                  subtitle: Text(
                    _formatDate(_date),
                    style: const TextStyle(
                      fontSize: 12,
                      color: AppColors.muted,
                      fontFeatures: tabularFigures,
                    ),
                  ),
                  trailing: const Icon(Icons.edit_calendar, size: 19),
                  onTap: _pickDate,
                ),
              ),
            ),
            const SizedBox(height: 12),
            if (partial)
              _timeTile(
                key: _logType == 'CHECK_OUT'
                    ? 'correction-check-out'
                    : 'correction-check-in',
                label: _logType == 'CHECK_OUT'
                    ? 'Jam Check-Out'
                    : 'Jam Check-In',
                value: _logType == 'CHECK_OUT'
                    ? _timeLabel(_checkOut)
                    : _timeLabel(_checkIn),
                onTap: () => _pickTime(checkIn: _logType != 'CHECK_OUT'),
              )
            else
              Row(
                children: [
                  Expanded(
                    child: _timeTile(
                      key: 'correction-check-in',
                      label: 'Jam Check-In',
                      value: _timeLabel(_checkIn),
                      onTap: () => _pickTime(checkIn: true),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: _timeTile(
                      key: 'correction-check-out',
                      label: 'Jam Check-Out',
                      value: _timeLabel(_checkOut),
                      onTap: () => _pickTime(checkIn: false),
                    ),
                  ),
                ],
              ),
            if (_kind == 'LUPA_FULL') ...[
              const SizedBox(height: 8),
              const Text(
                'Jam check-out ikut disertakan pada alasan pengajuan.',
                style: TextStyle(fontSize: 11, color: AppColors.muted),
              ),
            ],
            if (!partial) ...[
              const SizedBox(height: 16),
              const Text(
                'Jenis koreksi',
                style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700),
              ),
              const SizedBox(height: 8),
              Wrap(
                key: const Key('correction-type'),
                spacing: 8,
                runSpacing: 8,
                children: [
                  for (final (value, label) in _correctionKinds)
                    ChoiceChip(
                      key: Key('correction-kind-$value'),
                      label: Text(label),
                      selected: _kind == value,
                      onSelected: _submitting
                          ? null
                          : (selected) {
                              if (!selected) return;
                              setState(() => _kind = value);
                            },
                    ),
                ],
              ),
            ],
            const SizedBox(height: 16),
            TextField(
              key: const Key('correction-reason'),
              controller: _reason,
              enabled: !_submitting,
              maxLines: 4,
              maxLength: 1000,
              decoration: const InputDecoration(
                labelText: 'Alasan revisi',
                hintText:
                    'Contoh: lupa check-in karena jaringan kantor terputus',
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
                style: const TextStyle(color: AppColors.danger),
              ),
            const SizedBox(height: 8),
            Row(
              children: [
                OutlinedButton.icon(
                  key: const Key('correction-proof'),
                  onPressed: _submitting ? null : _attachProof,
                  icon: const Icon(Icons.attach_file, size: 17),
                  label: Text(
                    _proof == null ? 'Lampirkan bukti' : 'Ganti bukti',
                  ),
                ),
                const SizedBox(width: 8),
                if (_proof != null) ...[
                  Expanded(
                    child: Text(
                      'Bukti terpasang (${_proof!.length} byte)',
                      key: const Key('correction-proof-attached'),
                      style: const TextStyle(
                        fontSize: 11.5,
                        color: AppColors.muted,
                      ),
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
                      style: TextStyle(fontSize: 11.5, color: AppColors.muted),
                    ),
                  ),
              ],
            ),
            if (_error != null) ...[
              const SizedBox(height: 8),
              Text(
                _error!,
                key: const Key('correction-error'),
                style: const TextStyle(color: AppColors.danger, fontSize: 12.5),
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
      ),
    );
  }

  Widget _card({required Widget child}) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 4),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.line),
      ),
      child: child,
    );
  }

  Widget _timeTile({
    required String key,
    required String label,
    required String value,
    required VoidCallback onTap,
  }) {
    return Material(
      color: AppColors.surface,
      borderRadius: BorderRadius.circular(10),
      child: InkWell(
        key: Key(key),
        borderRadius: BorderRadius.circular(10),
        onTap: _submitting ? null : onTap,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 11),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(10),
            border: Border.all(color: AppColors.line),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                label,
                style: const TextStyle(
                  fontSize: 10.5,
                  fontWeight: FontWeight.w600,
                  color: AppColors.muted,
                ),
              ),
              const SizedBox(height: 4),
              Row(
                children: [
                  Expanded(
                    child: Text(
                      value,
                      style: const TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w700,
                        color: AppColors.ink,
                        fontFeatures: tabularFigures,
                      ),
                    ),
                  ),
                  const Icon(Icons.schedule, size: 16, color: AppColors.muted),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}
