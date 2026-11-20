import 'dart:async';
import 'dart:io';
import 'dart:typed_data';

import 'package:material_ui/material_ui.dart';

import '../api/api_client.dart';
import '../core/app_config.dart';
import '../models/attendance_log.dart';
import '../models/employee_request.dart';
import '../models/office_location.dart';
import '../models/offline_attendance.dart';
import '../services/auth_service.dart';
import '../services/location_service.dart';
import '../services/offline_attendance_queue.dart';
import '../services/push_service.dart';
import '../widgets/geofence_map.dart';
import 'camera_screen.dart';
import 'correction_form_screen.dart';
import 'employee_requests_screen.dart';
import 'history_screen.dart';
import 'notifications_screen.dart';
import 'workspace_picker_screen.dart';

typedef PhotoTaker = Future<Uint8List?> Function(BuildContext context);

class HomeScreen extends StatefulWidget {
  const HomeScreen({
    super.key,
    required this.auth,
    this.locationService,
    this.photoTaker,
    this.pushService,
    this.offlineQueue,
  });

  final AuthService auth;
  final LocationService? locationService;
  final PhotoTaker? photoTaker;
  final PushService? pushService;
  final OfflineAttendanceQueue? offlineQueue;

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  late final LocationService _location;
  late final OfflineAttendanceQueue _offlineQueue;
  int _pendingOffline = 0;
  bool _syncingOffline = false;
  Timer? _offlineRetry;
  List<OfficeLocation> _offices = const [];
  List<AttendanceLog> _today = const [];
  bool _wfhToday = false;
  GpsReading? _gps;
  bool _loading = true;
  bool _locating = false;
  bool _submitting = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _location = widget.locationService ?? LocationService();
    _offlineQueue = widget.offlineQueue ?? OfflineAttendanceQueue();
    unawaited(_refreshOffline().then((_) => _syncOffline()));
    // Retry berkala: koneksi yang pulih akan menyinkronkan antrean tanpa aksi user.
    _offlineRetry = Timer.periodic(const Duration(seconds: 30), (_) {
      if (_pendingOffline > 0 && !_syncingOffline) unawaited(_syncOffline());
    });
    unawaited(
      PushRegistrar.register(
        widget.auth.api,
        widget.pushService ?? const NoopPushService(),
      ),
    );
    _load();
  }

  @override
  void dispose() {
    _offlineRetry?.cancel();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final results = await Future.wait([
        widget.auth.api.activeOffices(),
        widget.auth.api.attendanceHistory(),
        widget.auth.api.myWfh(),
      ]);
      if (!mounted) return;
      setState(() {
        _offices = results[0] as List<OfficeLocation>;
        _today = (results[1] as List<AttendanceLog>)
            .where(_isToday)
            .toList(growable: false);
        _wfhToday = (results[2] as List<WfhRequest>).any(
          (row) => row.status == 'APPROVED' && _isSameDay(row.date, DateTime.now()),
        );
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
        _error = 'Data absensi tidak dapat dimuat.';
        _loading = false;
      });
    }
  }

  bool _isSameDay(DateTime value, DateTime reference) {
    final local = value.toLocal();
    return local.year == reference.year &&
        local.month == reference.month &&
        local.day == reference.day;
  }

  OfficeLocation? get _office {
    if (_offices.isEmpty) return null;
    final gps = _gps;
    if (gps == null) return _offices.first;
    var best = _offices.first;
    var bestDistance = distanceMeters(
      gps.latitude,
      gps.longitude,
      best.latitude,
      best.longitude,
    );
    for (final candidate in _offices.skip(1)) {
      final distance = distanceMeters(
        gps.latitude,
        gps.longitude,
        candidate.latitude,
        candidate.longitude,
      );
      if (distance < bestDistance) {
        best = candidate;
        bestDistance = distance;
      }
    }
    return best;
  }

  bool _isToday(AttendanceLog log) {
    final date = log.workDate ?? log.timestampServer;
    final local = date.toLocal();
    final now = DateTime.now();
    return local.year == now.year &&
        local.month == now.month &&
        local.day == now.day;
  }

  String? get _nextAction {
    final hasCheckIn = _today.any((row) => row.isCheckIn);
    final hasCheckOut = _today.any((row) => row.isCheckOut);
    if (!hasCheckIn) return 'CHECK_IN';
    if (!hasCheckOut) return 'CHECK_OUT';
    return null;
  }

  double? get _distance {
    final office = _office;
    final gps = _gps;
    if (office == null || gps == null) return null;
    return distanceMeters(
      gps.latitude,
      gps.longitude,
      office.latitude,
      office.longitude,
    );
  }

  bool get _canSubmit {
    final office = _office;
    final gps = _gps;
    final distance = _distance;
    final withinOffice = office != null &&
        distance != null &&
        distance <= office.radiusMeters;
    return gps != null &&
        !gps.isMocked &&
        gps.accuracyMeters <= AppConfig.accuracyThresholdMeters &&
        (_wfhToday || withinOffice) &&
        _nextAction != null &&
        !_submitting;
  }

  Future<void> _readLocation() async {
    setState(() {
      _locating = true;
      _error = null;
    });
    try {
      final reading = await _location.current();
      if (!mounted) return;
      setState(() {
        _gps = reading;
        _locating = false;
      });
    } on LocationUnavailableException catch (error) {
      if (!mounted) return;
      setState(() {
        _error = error.message;
        _locating = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _error = 'Lokasi tidak dapat dibaca. Coba lagi.';
        _locating = false;
      });
    }
  }

  Future<Uint8List?> _takePhoto(BuildContext context) {
    final custom = widget.photoTaker;
    if (custom != null) return custom(context);
    return Navigator.of(context).push<Uint8List>(
      MaterialPageRoute<Uint8List>(builder: (_) => const CameraScreen()),
    );
  }

  Future<void> _submit() async {
    final action = _nextAction;
    final gps = _gps;
    if (action == null || gps == null) return;
    final photo = await _takePhoto(context);
    if (photo == null || !mounted) return;

    setState(() {
      _submitting = true;
      _error = null;
    });
    final deviceInfo = '${Theme.of(context).platform.name}-mobile';
    try {
      final api = widget.auth.api;
      final args = (
        latitude: gps.latitude,
        longitude: gps.longitude,
        accuracyMeters: gps.accuracyMeters,
        isMockLocation: gps.isMocked,
        photoBytes: photo,
        deviceInfo: deviceInfo,
      );
      if (action == 'CHECK_IN') {
        await api.checkIn(
          latitude: args.latitude,
          longitude: args.longitude,
          accuracyMeters: args.accuracyMeters,
          isMockLocation: args.isMockLocation,
          photoBytes: args.photoBytes,
          deviceInfo: args.deviceInfo,
        );
      } else {
        await api.checkOut(
          latitude: args.latitude,
          longitude: args.longitude,
          accuracyMeters: args.accuracyMeters,
          isMockLocation: args.isMockLocation,
          photoBytes: args.photoBytes,
          deviceInfo: args.deviceInfo,
        );
      }
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            action == 'CHECK_IN'
                ? 'Check-in berhasil dicatat.'
                : 'Check-out berhasil dicatat.',
          ),
        ),
      );
      await _load();
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() => _error = messageForApiError(error));
    } catch (_) {
      await _saveOffline(action, gps, photo, deviceInfo);
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  Future<void> _refreshOffline() async {
    final count = await _offlineQueue.count();
    if (!mounted) return;
    setState(() => _pendingOffline = count);
  }

  Future<void> _saveOffline(
    String action,
    GpsReading gps,
    Uint8List photo,
    String deviceInfo,
  ) async {
    try {
      final key = createIdempotencyKey();
      final directory = Directory(
        '${Directory.systemTemp.path}/absensi_offline',
      );
      await directory.create(recursive: true);
      final path = '${directory.path}/$key.jpg';
      await File(path).writeAsBytes(photo, flush: true);
      await _offlineQueue.add(
        OfflineAttendanceEntry(
          type: action,
          latitude: gps.latitude,
          longitude: gps.longitude,
          accuracyMeters: gps.accuracyMeters,
          isMockLocation: gps.isMocked,
          clientCapturedAt: DateTime.now().toUtc(),
          photoPath: path,
          idempotencyKey: key,
        ),
      );
      await _refreshOffline();
      if (!mounted) return;
      setState(() => _error = null);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Tidak ada koneksi. Absensi disimpan dan akan disinkronkan.'),
        ),
      );
    } catch (_) {
      if (!mounted) return;
      setState(() => _error = 'Absensi gagal dikirim dan tidak dapat disimpan offline.');
    }
  }

  Future<void> _syncOffline() async {
    if (_syncingOffline || _pendingOffline == 0) return;
    setState(() => _syncingOffline = true);
    try {
      final synced = await _offlineQueue.sync(
        (entry) => widget.auth.api.syncOfflineAttendance(entry),
      );
      await _refreshOffline();
      if (!mounted) return;
      if (synced > 0) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('$synced absensi offline berhasil disinkronkan.')),
        );
        await _load();
      } else {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Sinkronisasi gagal. Periksa koneksi Anda.')),
        );
      }
    } finally {
      if (mounted) setState(() => _syncingOffline = false);
    }
  }

  Future<void> _openWorkspacePicker() async {
    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => WorkspacePickerScreen(
          auth: widget.auth,
          allowLogout: false,
          onSelected: () => Navigator.of(context).pop(),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final workspace = widget.auth.activeWorkspace;
    return AnimatedBuilder(
      animation: widget.auth,
      builder: (context, _) {
        return Scaffold(
          appBar: AppBar(
            title: Text(workspace?.name ?? 'Absensi'),
            actions: [
              IconButton(
                key: const Key('home-notifications'),
                tooltip: 'Notifikasi',
                onPressed: () => Navigator.of(context).push(
                  MaterialPageRoute<void>(
                    builder: (_) => NotificationsScreen(auth: widget.auth),
                  ),
                ),
                icon: const Icon(Icons.notifications_outlined),
              ),
              IconButton(
                key: const Key('home-corrections'),
                tooltip: 'Ajukan revisi',
                onPressed: () => Navigator.of(context).push(
                  MaterialPageRoute<void>(
                    builder: (_) => CorrectionFormScreen(auth: widget.auth),
                  ),
                ),
                icon: const Icon(Icons.assignment_late_outlined),
              ),
              IconButton(
                key: const Key('home-requests'),
                tooltip: 'Lembur & WFH',
                onPressed: () => Navigator.of(context).push(
                  MaterialPageRoute<void>(
                    builder: (_) => EmployeeRequestsScreen(auth: widget.auth),
                  ),
                ),
                icon: const Icon(Icons.more_time),
              ),
              IconButton(
                key: const Key('home-history'),
                tooltip: 'Riwayat absensi',
                onPressed: () => Navigator.of(context).push(
                  MaterialPageRoute<void>(
                    builder: (_) => HistoryScreen(auth: widget.auth),
                  ),
                ),
                icon: const Icon(Icons.history),
              ),
              IconButton(
                key: const Key('home-switch-workspace'),
                tooltip: 'Ganti workspace',
                onPressed: _openWorkspacePicker,
                icon: const Icon(Icons.swap_horiz),
              ),
              IconButton(
                key: const Key('home-logout'),
                tooltip: 'Keluar',
                onPressed: widget.auth.logout,
                icon: const Icon(Icons.logout),
              ),
            ],
          ),
          body: _loading
              ? const Center(child: CircularProgressIndicator())
              : RefreshIndicator(
                  onRefresh: () async {
                    await _load();
                    await _syncOffline();
                  },
                  child: ListView(
                    padding: const EdgeInsets.all(16),
                    children: [
                      if (_pendingOffline > 0)
                        Card(
                          key: const Key('offline-queue-banner'),
                          color: Theme.of(context).colorScheme.tertiaryContainer,
                          child: ListTile(
                            leading: const Icon(Icons.cloud_off),
                            title: Text(
                              '$_pendingOffline absensi menunggu sinkronisasi',
                            ),
                            trailing: TextButton(
                              key: const Key('sync-offline-now'),
                              onPressed: _syncingOffline ? null : _syncOffline,
                              child: Text(
                                _syncingOffline ? 'Menyinkronkan…' : 'Sinkronkan Sekarang',
                              ),
                            ),
                          ),
                        ),
                      Text(
                        'Selamat datang, ${widget.auth.user?.name ?? 'Pengguna'}',
                        style: Theme.of(context).textTheme.titleMedium,
                      ),
                      const SizedBox(height: 12),
                      Card(
                        child: Padding(
                          padding: const EdgeInsets.all(16),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                'Status hari ini',
                                style: Theme.of(context).textTheme.titleMedium,
                              ),
                              const SizedBox(height: 8),
                              if (_today.isEmpty)
                                const Text('Belum ada absensi hari ini.')
                              else
                                for (final log in _today)
                                  Row(
                                    children: [
                                      Icon(
                                        log.isCheckIn
                                            ? Icons.login
                                            : Icons.logout,
                                        size: 18,
                                      ),
                                      const SizedBox(width: 8),
                                      Expanded(
                                        child: Text(
                                          '${log.label} • '
                                          '${log.distanceMeters.toStringAsFixed(0)} m',
                                        ),
                                      ),
                                      if (log.isSuspicious)
                                        const Icon(
                                          Icons.warning_amber,
                                          color: Colors.orange,
                                        ),
                                    ],
                                  ),
                            ],
                          ),
                        ),
                      ),
                      const SizedBox(height: 12),
                      if (_wfhToday)
                        Text(
                          'Mode WFH disetujui — geofence kantor dilewati.',
                          key: const Key('wfh-mode'),
                          style: Theme.of(context).textTheme.titleSmall,
                        )
                      else if (_office != null)
                        Text(
                          _office!.name,
                          style: Theme.of(context).textTheme.titleSmall,
                        ),
                      const SizedBox(height: 4),
                      GeofenceMap(office: _office, gps: _gps),
                      const SizedBox(height: 12),
                      Row(
                        children: [
                          Expanded(
                            child: Text(
                              _gps == null
                                  ? 'Lokasi belum diambil.'
                                  : 'Akurasi GPS: '
                                        '${_gps!.accuracyMeters.toStringAsFixed(0)} m'
                                        '${_distance == null ? '' : ' • jarak ${_distance!.toStringAsFixed(0)} m'}',
                            ),
                          ),
                          TextButton.icon(
                            key: const Key('refresh-location'),
                            onPressed: _locating ? null : _readLocation,
                            icon: _locating
                                ? const SizedBox.square(
                                    dimension: 16,
                                    child: CircularProgressIndicator(
                                      strokeWidth: 2,
                                    ),
                                  )
                                : const Icon(Icons.my_location),
                            label: const Text('Perbarui'),
                          ),
                        ],
                      ),
                      if (_gps != null &&
                          _gps!.accuracyMeters >
                              AppConfig.accuracyThresholdMeters)
                        Text(
                          'Akurasi GPS di atas '
                          '${AppConfig.accuracyThresholdMeters.toStringAsFixed(0)} m. '
                          'Tunggu GPS lebih baik.',
                          key: const Key('accuracy-warning'),
                          style: TextStyle(
                            color: Theme.of(context).colorScheme.error,
                          ),
                        ),
                      if (_gps?.isMocked == true)
                        Text(
                          'Mock location terdeteksi. Absensi diblokir.',
                          key: const Key('mock-warning'),
                          style: TextStyle(
                            color: Theme.of(context).colorScheme.error,
                          ),
                        ),
                      if (!_wfhToday &&
                          _distance != null &&
                          _office != null &&
                          _distance! > _office!.radiusMeters)
                        Text(
                          'Anda berada di luar radius kantor.',
                          key: const Key('geofence-warning'),
                          style: TextStyle(
                            color: Theme.of(context).colorScheme.error,
                          ),
                        ),
                      if (_error != null) ...[
                        const SizedBox(height: 8),
                        Text(
                          _error!,
                          key: const Key('attendance-error'),
                          style: TextStyle(
                            color: Theme.of(context).colorScheme.error,
                          ),
                        ),
                      ],
                      const SizedBox(height: 20),
                      SizedBox(
                        height: 56,
                        child: FilledButton.icon(
                          key: const Key('attendance-submit'),
                          onPressed: _canSubmit ? _submit : null,
                          icon: _submitting
                              ? const SizedBox.square(
                                  dimension: 18,
                                  child: CircularProgressIndicator(
                                    strokeWidth: 2,
                                  ),
                                )
                              : Icon(
                                  _nextAction == 'CHECK_IN'
                                      ? Icons.login
                                      : Icons.logout,
                                ),
                          label: Text(
                            _nextAction == null
                                ? 'Absensi hari ini selesai'
                                : _nextAction == 'CHECK_IN'
                                ? 'Check-in sekarang'
                                : 'Check-out sekarang',
                          ),
                        ),
                      ),
                      if (_nextAction != null && _gps == null)
                        const Padding(
                          padding: EdgeInsets.only(top: 8),
                          child: Text(
                            'Ambil lokasi terlebih dahulu untuk mengaktifkan tombol.',
                            textAlign: TextAlign.center,
                          ),
                        ),
                    ],
                  ),
                ),
        );
      },
    );
  }
}
