import 'dart:async';
import 'dart:typed_data';

import 'package:flutter_map/flutter_map.dart';
import 'package:image_picker/image_picker.dart';
import 'package:latlong2/latlong.dart';
import 'package:material_ui/material_ui.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api/api_client.dart';
import '../models/client_visit.dart';
import '../services/auth_service.dart';
import '../services/location_service.dart';
import '../theme/app_theme.dart';
import 'proof_camera_screen.dart';

class ClientVisitsScreen extends StatefulWidget {
  const ClientVisitsScreen({
    super.key,
    required this.auth,
    this.locationService,
    this.tileProvider,
  });

  final AuthService auth;
  final LocationService? locationService;
  final TileProvider? tileProvider;

  @override
  State<ClientVisitsScreen> createState() => _ClientVisitsScreenState();
}

class _ClientVisitsScreenState extends State<ClientVisitsScreen> {
  late final LocationService _location;
  final MapController _mapController = MapController();
  bool _mapReady = false;
  final ImagePicker _picker = ImagePicker();
  final TextEditingController _clientNameController = TextEditingController();
  final TextEditingController _notesController = TextEditingController();
  ClientVisitDay? _day;
  bool _loading = true;
  String? _error;
  String? _busyScheduleId;
  GpsReading? _adhocLocation;
  String? _adhocLocationError;
  bool _locating = false;
  bool _savingAdhoc = false;
  Uint8List? _adhocPhoto;
  String _adhocPhotoName = 'kunjungan.jpg';

  @override
  void initState() {
    super.initState();
    _location = widget.locationService ?? LocationService();
    _load();
    _refreshAdhocLocation();
  }

  @override
  void dispose() {
    _clientNameController.dispose();
    _notesController.dispose();
    super.dispose();
  }

  Future<void> _refreshAdhocLocation() async {
    setState(() {
      _locating = true;
      _adhocLocationError = null;
    });
    try {
      final reading = await _location.current();
      if (!mounted) return;
      setState(() => _adhocLocation = reading);
      WidgetsBinding.instance.addPostFrameCallback((_) {
        _moveMapTo(reading);
      });
    } on LocationUnavailableException catch (error) {
      if (!mounted) return;
      setState(() => _adhocLocationError = error.message);
    } catch (_) {
      if (!mounted) return;
      setState(() => _adhocLocationError = 'Lokasi GPS belum dapat dibaca.');
    } finally {
      if (mounted) setState(() => _locating = false);
    }
  }

  void _moveMapTo(GpsReading reading) {
    if (!mounted || !_mapReady) return;
    _mapController.move(LatLng(reading.latitude, reading.longitude), 17);
  }

  Future<void> _openMaps(GpsReading reading) async {
    final uri = Uri.https('www.google.com', '/maps/search/', {
      'api': '1',
      'query': '${reading.latitude},${reading.longitude}',
    });
    final opened = await launchUrl(uri, mode: LaunchMode.externalApplication);
    if (!opened && mounted) {
      _showMessage('Google Maps tidak dapat dibuka di perangkat ini.');
    }
  }

  Future<void> _captureAdhocPhoto() async {
    final photo = await Navigator.of(context).push<Uint8List>(
      MaterialPageRoute<Uint8List>(builder: (_) => const ProofCameraScreen()),
    );
    if (photo == null || !mounted) return;
    setState(() {
      _adhocPhoto = photo;
      _adhocPhotoName = 'kunjungan.jpg';
    });
  }

  Future<void> _pickAdhocPhoto() async {
    try {
      final picked = await _picker.pickImage(
        source: ImageSource.gallery,
        imageQuality: 85,
        maxWidth: 1600,
      );
      if (picked == null || !mounted) return;
      final bytes = await picked.readAsBytes();
      if (!mounted) return;
      setState(() {
        _adhocPhoto = bytes;
        _adhocPhotoName = picked.name;
      });
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Gambar tidak dapat dipilih.')),
      );
    }
  }

  Future<void> _saveAdhoc() async {
    final location = _adhocLocation;
    if (_clientNameController.text.trim().length < 2) {
      _showMessage('Nama client minimal 2 karakter.');
      return;
    }
    if (_notesController.text.trim().length < 3) {
      _showMessage('Keterangan kunjungan wajib diisi.');
      return;
    }
    if (location == null) {
      _showMessage('Tunggu lokasi GPS atau tekan refresh terlebih dahulu.');
      return;
    }
    if (location.isMocked) {
      _showMessage('Lokasi palsu terdeteksi. Nonaktifkan aplikasi mock GPS.');
      return;
    }
    if (_adhocPhoto == null) {
      _showMessage('Ambil foto atau pilih gambar bukti kunjungan.');
      return;
    }
    setState(() => _savingAdhoc = true);
    try {
      await widget.auth.api.recordAdHocClientVisit(
        clientName: _clientNameController.text,
        notes: _notesController.text,
        latitude: location.latitude,
        longitude: location.longitude,
        accuracyMeters: location.accuracyMeters,
        photoBytes: _adhocPhoto!,
        photoName: _adhocPhotoName,
      );
      if (!mounted) return;
      _clientNameController.clear();
      _notesController.clear();
      setState(() {
        _adhocPhoto = null;
        _adhocPhotoName = 'kunjungan.jpg';
      });
      _showMessage('Kunjungan client berhasil disimpan.');
      await _refreshAdhocLocation();
    } on ApiException catch (error) {
      if (!mounted) return;
      _showMessage(messageForApiError(error));
    } catch (_) {
      if (!mounted) return;
      _showMessage('Kunjungan gagal disimpan. Coba lagi.');
    } finally {
      if (mounted) setState(() => _savingAdhoc = false);
    }
  }

  void _showMessage(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context)
        .showSnackBar(SnackBar(content: Text(message)));
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
        MaterialPageRoute<Uint8List>(builder: (_) => const ProofCameraScreen()),
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
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(messageForApiError(error))));
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
        title: Text(
          type == 'CHECK_IN' ? 'Catatan check-in' : 'Catatan check-out',
        ),
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
        _adhocForm(),
        const SizedBox(height: 18),
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

  Widget _adhocForm() {
    final location = _adhocLocation;
    final accurate = (location?.accuracyMeters ?? 999) <= 50;
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.line),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Catat Kunjungan Client',
            style: TextStyle(
              fontSize: 16,
              fontWeight: FontWeight.w800,
              letterSpacing: -0.3,
              color: AppColors.ink,
            ),
          ),
          const SizedBox(height: 2),
          const Text(
            'Kunjungan langsung tanpa jadwal. Lokasi GPS, nama client, catatan, dan foto wajib diisi.',
            style: TextStyle(fontSize: 11, height: 1.4, color: AppColors.muted),
          ),
          const SizedBox(height: 12),
          TextField(
            key: const Key('adhoc-client-name'),
            controller: _clientNameController,
            textInputAction: TextInputAction.next,
            maxLength: 160,
            decoration: const InputDecoration(
              labelText: 'Nama client / instansi',
              hintText: 'Contoh: PT Nusantara Jaya',
              counterText: '',
            ),
          ),
          const SizedBox(height: 8),
          TextField(
            key: const Key('adhoc-notes'),
            controller: _notesController,
            minLines: 2,
            maxLines: 4,
            maxLength: 1000,
            decoration: const InputDecoration(
              labelText: 'Keterangan kunjungan',
              hintText: 'Tujuan, hasil, PIC yang ditemui, atau kendala.',
            ),
          ),
          const SizedBox(height: 8),
          Container(
            key: const Key('adhoc-gps-card'),
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: location == null
                  ? AppColors.yellowSoft
                  : AppColors.greenSoft,
              borderRadius: BorderRadius.circular(10),
              border: Border.all(
                color: location == null
                    ? AppColors.yellowLine
                    : AppColors.greenLine,
              ),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Icon(
                      Icons.my_location,
                      size: 15,
                      color: accurate
                          ? AppColors.greenDark
                          : AppColors.yellowInk,
                    ),
                    const SizedBox(width: 6),
                    const Expanded(
                      child: Text(
                        'Lokasi GPS otomatis',
                        style: TextStyle(
                          fontSize: 11.5,
                          fontWeight: FontWeight.w700,
                          color: AppColors.ink,
                        ),
                      ),
                    ),
                    TextButton.icon(
                      key: const Key('adhoc-refresh-location'),
                      onPressed: _locating ? null : _refreshAdhocLocation,
                      icon: _locating
                          ? const SizedBox.square(
                              dimension: 12,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Icon(Icons.refresh, size: 15),
                      label: const Text('Refresh'),
                    ),
                  ],
                ),
                Text(
                  location == null
                      ? (_adhocLocationError ?? 'Mengunci titik GPS perangkat…')
                      : '${location.latitude.toStringAsFixed(6)}, '
                            '${location.longitude.toStringAsFixed(6)}',
                  key: const Key('adhoc-coordinates'),
                  style: const TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                    color: AppColors.ink,
                    fontFeatures: tabularFigures,
                  ),
                ),
                if (location != null) ...[
                  const SizedBox(height: 3),
                  Text(
                    'Akurasi ±${location.accuracyMeters.toStringAsFixed(0)} m · '
                    '${accurate ? 'siap disimpan' : 'cari area lebih terbuka'}',
                    style: TextStyle(
                      fontSize: 10.5,
                      color: accurate
                          ? AppColors.greenDark
                          : AppColors.yellowInk,
                      fontFeatures: tabularFigures,
                    ),
                  ),
                  const SizedBox(height: 10),
                  ClipRRect(
                    key: const Key('adhoc-map'),
                    borderRadius: BorderRadius.circular(10),
                    child: SizedBox(
                      height: 170,
                      child: FlutterMap(
                        mapController: _mapController,
                        options: MapOptions(
                          initialCenter: LatLng(
                            location.latitude,
                            location.longitude,
                          ),
                          initialZoom: 17,
                          minZoom: 3,
                          maxZoom: 19,
                          interactionOptions: const InteractionOptions(
                            flags:
                                InteractiveFlag.drag |
                                InteractiveFlag.pinchZoom |
                                InteractiveFlag.doubleTapZoom,
                          ),
                          onMapReady: () {
                            _mapReady = true;
                            _moveMapTo(location);
                          },
                        ),
                        children: [
                          TileLayer(
                            urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                            userAgentPackageName: 'com.absensi.absensi_mobile',
                            tileProvider: widget.tileProvider,
                          ),
                          MarkerLayer(
                            markers: [
                              Marker(
                                width: 44,
                                height: 44,
                                alignment: Alignment.topCenter,
                                point: LatLng(
                                  location.latitude,
                                  location.longitude,
                                ),
                                child: const Icon(
                                  Icons.location_on,
                                  key: Key('adhoc-map-pin'),
                                  size: 40,
                                  color: AppColors.green,
                                ),
                              ),
                            ],
                          ),
                          RichAttributionWidget(
                            attributions: [
                              TextSourceAttribution(
                                'OpenStreetMap contributors',
                                onTap: () => unawaited(
                                  launchUrl(
                                    Uri.parse(
                                      'https://www.openstreetmap.org/copyright',
                                    ),
                                    mode: LaunchMode.externalApplication,
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(height: 8),
                  Align(
                    alignment: Alignment.centerRight,
                    child: OutlinedButton.icon(
                      key: const Key('adhoc-open-maps'),
                      onPressed: () => _openMaps(location),
                      icon: const Icon(Icons.map_outlined, size: 16),
                      label: const Text('Buka Maps'),
                    ),
                  ),
                ],
              ],
            ),
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(
                child: OutlinedButton.icon(
                  key: const Key('adhoc-camera'),
                  onPressed: _savingAdhoc ? null : _captureAdhocPhoto,
                  icon: const Icon(Icons.photo_camera_outlined, size: 17),
                  label: const Text('Kamera'),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: OutlinedButton.icon(
                  key: const Key('adhoc-gallery'),
                  onPressed: _savingAdhoc ? null : _pickAdhocPhoto,
                  icon: const Icon(Icons.photo_library_outlined, size: 17),
                  label: const Text('Galeri'),
                ),
              ),
            ],
          ),
          if (_adhocPhoto != null) ...[
            const SizedBox(height: 8),
            ClipRRect(
              borderRadius: BorderRadius.circular(9),
              child: Image.memory(
                _adhocPhoto!,
                key: const Key('adhoc-photo-preview'),
                width: double.infinity,
                height: 120,
                fit: BoxFit.cover,
              ),
            ),
          ],
          const SizedBox(height: 10),
          SizedBox(
            width: double.infinity,
            height: 44,
            child: FilledButton.icon(
              key: const Key('adhoc-save'),
              onPressed: _savingAdhoc ? null : _saveAdhoc,
              icon: _savingAdhoc
                  ? const SizedBox.square(
                      dimension: 14,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: Colors.white,
                      ),
                    )
                  : const Icon(Icons.save_outlined, size: 17),
              label: Text(_savingAdhoc ? 'Menyimpan…' : 'Simpan Kunjungan'),
            ),
          ),
        ],
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
              const Icon(Icons.schedule, size: 14, color: AppColors.muted),
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
                        schedule.canCheckIn ? Icons.login : Icons.logout,
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
      'CANCELLED' ||
      'MISSED' => (AppColors.dangerSoft, AppColors.danger, AppColors.danger),
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
