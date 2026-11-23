import 'dart:typed_data';

import 'package:material_ui/material_ui.dart';

import '../api/api_client.dart';
import '../models/client_visit.dart';
import '../services/auth_service.dart';
import '../services/location_service.dart';
import '../theme/app_theme.dart';
import 'proof_camera_screen.dart';

class ClientVisitsScreen extends StatefulWidget {
  const ClientVisitsScreen({super.key, required this.auth});

  final AuthService auth;

  @override
  State<ClientVisitsScreen> createState() => _ClientVisitsScreenState();
}

class _ClientVisitsScreenState extends State<ClientVisitsScreen> {
  final LocationService _location = LocationService();
  ClientVisitDay? _day;
  bool _loading = true;
  String? _error;
  String? _busyScheduleId;

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
      final day = await widget.auth.api.myClientVisits();
      if (!mounted) return;
      setState(() {
        _day = day;
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
        _error = 'Jadwal kunjungan tidak dapat dimuat.';
        _loading = false;
      });
    }
  }

  Future<void> _record(ClientVisitSchedule schedule, String type) async {
    setState(() => _busyScheduleId = schedule.id);
    try {
      final reading = await _location.current();
      if (!mounted) return;
      final photo = await Navigator.of(context).push<Uint8List>(
        MaterialPageRoute<Uint8List>(
          builder: (_) => const ProofCameraScreen(),
        ),
      );
      if (photo == null) return;
      final notes = await _askNotes(type);
      if (notes == null) return;
      await widget.auth.api.recordClientVisit(
        scheduleId: schedule.id,
        type: type,
        latitude: reading.latitude,
        longitude: reading.longitude,
        accuracyMeters: reading.accuracyMeters,
        photoBytes: photo,
        notes: notes,
      );
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            type == 'CHECK_IN'
                ? 'Check-in kunjungan tercatat.'
                : 'Check-out kunjungan tercatat.',
          ),
        ),
      );
      await _load();
    } on LocationUnavailableException catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(error.message),
          action: error.canOpenSettings
              ? SnackBarAction(
                  label: 'Pengaturan',
                  onPressed: () => _location.openSettings(error.problem),
                )
              : null,
        ),
      );
    } on ApiException catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(messageForApiError(error))),
      );
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Kunjungan gagal dicatat. Coba lagi.')),
      );
    } finally {
      if (mounted) setState(() => _busyScheduleId = null);
    }
  }

  Future<String?> _askNotes(String type) async {
    final controller = TextEditingController();
    final result = await showDialog<String>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(type == 'CHECK_IN' ? 'Catatan check-in' : 'Catatan check-out'),
        content: TextField(
          controller: controller,
          minLines: 2,
          maxLines: 4,
          maxLength: 1000,
          decoration: const InputDecoration(
            hintText: 'Hasil kunjungan, PIC yang ditemui, atau kendala.',
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(null),
            child: const Text('Batal'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(dialogContext).pop(controller.text),
            child: const Text('Simpan'),
          ),
        ],
      ),
    );
    controller.dispose();
    return result;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.canvas,
      appBar: AppBar(
        title: const Text('Kunjungan Client'),
        backgroundColor: AppColors.surface,
        surfaceTintColor: Colors.transparent,
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
            key: const Key('client-visits-error'),
            textAlign: TextAlign.center,
            style: const TextStyle(fontSize: 12.5, color: AppColors.muted),
          ),
          const SizedBox(height: 12),
          OutlinedButton(onPressed: _load, child: const Text('Coba lagi')),
        ],
      );
    }
    final day = _day;
    if (day == null) return const SizedBox.shrink();
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 28),
      children: [
        const Text(
          'Jadwal hari ini',
          style: TextStyle(
            fontSize: 20,
            fontWeight: FontWeight.w800,
            letterSpacing: -0.4,
            color: AppColors.ink,
          ),
        ),
        const SizedBox(height: 2),
        Text(
          '${day.date} • check-in dan check-out memakai GPS serta foto bukti.',
          style: const TextStyle(fontSize: 12, color: AppColors.muted),
        ),
        const SizedBox(height: 14),
        if (day.schedules.isEmpty)
          _empty('Tidak ada jadwal kunjungan hari ini.')
        else
          for (final schedule in day.schedules) ...[
            _scheduleCard(schedule),
            const SizedBox(height: 10),
          ],
        if (day.history.isNotEmpty) ...[
          const SizedBox(height: 12),
          const Text(
            'Riwayat kunjungan',
            style: TextStyle(
              fontSize: 15,
              fontWeight: FontWeight.w800,
              color: AppColors.ink,
            ),
          ),
          const SizedBox(height: 8),
          for (final schedule in day.history) ...[
            _historyCard(schedule),
            const SizedBox(height: 8),
          ],
        ],
      ],
    );
  }

  Widget _empty(String message) {
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.line),
      ),
      child: Text(
        message,
        textAlign: TextAlign.center,
        style: const TextStyle(fontSize: 12, color: AppColors.muted),
      ),
    );
  }

  Widget _scheduleCard(ClientVisitSchedule schedule) {
    final busy = _busyScheduleId == schedule.id;
    final inside = schedule.checkIn?.isInsideRadius ?? true;
    return Container(
      key: Key('client-visit-${schedule.id}'),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(
          color: inside ? AppColors.line : AppColors.yellowLine,
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
                      schedule.clientName,
                      style: const TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w800,
                        color: AppColors.ink,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      schedule.clientAddress ?? 'Alamat client belum diisi',
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: 11,
                        height: 1.4,
                        color: AppColors.muted,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              _badge(schedule.statusLabel, schedule.visitStatus),
            ],
          ),
          const SizedBox(height: 9),
          Row(
            children: [
              const Icon(
                Icons.schedule,
                size: 14,
                color: AppColors.muted,
              ),
              const SizedBox(width: 5),
              Text(
                '${schedule.plannedStartTime}–${schedule.plannedEndTime}',
                style: const TextStyle(
                  fontSize: 11.5,
                  fontWeight: FontWeight.w700,
                  color: AppColors.ink,
                  fontFeatures: tabularFigures,
                ),
              ),
              const Spacer(),
              Text(
                'Radius ${schedule.clientRadiusMeters.toStringAsFixed(0)} m',
                style: const TextStyle(
                  fontSize: 10.5,
                  color: AppColors.muted,
                  fontFeatures: tabularFigures,
                ),
              ),
            ],
          ),
          const SizedBox(height: 7),
          Text(
            schedule.purpose,
            style: const TextStyle(
              fontSize: 11.5,
              height: 1.4,
              color: AppColors.muted,
            ),
          ),
          if (schedule.checkIn != null) ...[
            const SizedBox(height: 8),
            Container(
              padding: const EdgeInsets.all(9),
              decoration: BoxDecoration(
                color: schedule.checkIn!.isInsideRadius
                    ? AppColors.greenSoft
                    : AppColors.yellowSoft,
                borderRadius: BorderRadius.circular(9),
                border: Border.all(
                  color: schedule.checkIn!.isInsideRadius
                      ? AppColors.greenLine
                      : AppColors.yellowLine,
                ),
              ),
              child: Text(
                schedule.checkIn!.isInsideRadius
                    ? 'Check-in ${_time(schedule.checkIn!.timestampServer)} • '
                          '${schedule.checkIn!.distanceMeters.toStringAsFixed(0)} m dari client'
                    : 'Check-in di luar radius (${schedule.checkIn!.distanceMeters.toStringAsFixed(0)} m). Admin akan memverifikasi.',
                style: const TextStyle(
                  fontSize: 10.8,
                  height: 1.4,
                  color: AppColors.ink,
                ),
              ),
            ),
          ],
          if (schedule.canCheckIn || schedule.canCheckOut) ...[
            const SizedBox(height: 10),
            SizedBox(
              width: double.infinity,
              height: 44,
              child: FilledButton.icon(
                key: Key(
                  'client-visit-${schedule.canCheckIn ? 'check-in' : 'check-out'}-${schedule.id}',
                ),
                onPressed: busy
                    ? null
                    : () => _record(
                        schedule,
                        schedule.canCheckIn ? 'CHECK_IN' : 'CHECK_OUT',
                      ),
                icon: busy
                    ? const SizedBox.square(
                        dimension: 14,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: Colors.white,
                        ),
                      )
                    : Icon(
                        schedule.canCheckIn
                            ? Icons.login
                            : Icons.logout,
                        size: 17,
                      ),
                label: Text(
                  busy
                      ? 'Memproses…'
                      : schedule.canCheckIn
                      ? 'Check-in Kunjungan'
                      : 'Check-out Kunjungan',
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _historyCard(ClientVisitSchedule schedule) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.line),
      ),
      child: Row(
        children: [
          const Icon(
            Icons.where_to_vote_outlined,
            size: 17,
            color: AppColors.muted,
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  schedule.clientName,
                  style: const TextStyle(
                    fontSize: 12.5,
                    fontWeight: FontWeight.w700,
                    color: AppColors.ink,
                  ),
                ),
                Text(
                  '${_date(schedule.scheduledDate)} • '
                  '${schedule.checkIn == null ? 'tidak check-in' : _time(schedule.checkIn!.timestampServer)}'
                  '${schedule.checkOut?.durationMinutes == null ? '' : ' • ${schedule.checkOut!.durationMinutes} menit'}',
                  style: const TextStyle(
                    fontSize: 10.5,
                    color: AppColors.muted,
                    fontFeatures: tabularFigures,
                  ),
                ),
              ],
            ),
          ),
          _badge(schedule.statusLabel, schedule.visitStatus),
        ],
      ),
    );
  }

  Widget _badge(String label, String status) {
    final (background, border, foreground) = switch (status) {
      'COMPLETED' => (
        AppColors.greenSoft,
        AppColors.greenLine,
        AppColors.greenDark,
      ),
      'IN_PROGRESS' => (
        AppColors.yellowSoft,
        AppColors.yellowLine,
        AppColors.yellowInk,
      ),
      'CANCELLED' || 'MISSED' => (
        AppColors.dangerSoft,
        AppColors.danger,
        AppColors.danger,
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

  String _time(DateTime value) {
    final local = value.toLocal();
    return '${local.hour.toString().padLeft(2, '0')}:'
        '${local.minute.toString().padLeft(2, '0')}';
  }

  String _date(DateTime value) {
    final local = value.toLocal();
    return '${local.day.toString().padLeft(2, '0')}/'
        '${local.month.toString().padLeft(2, '0')}/${local.year}';
  }
}
