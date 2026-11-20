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
import '../theme/app_theme.dart';
import '../widgets/geofence_map.dart';
import '../widgets/selfie_frame.dart';
import 'camera_screen.dart';
import 'correction_form_screen.dart';
import 'employee_requests_screen.dart';
import 'history_screen.dart';
import 'notifications_screen.dart';
import 'workspace_picker_screen.dart';

typedef PhotoTaker = Future<Uint8List?> Function(BuildContext context);

const List<String> _weekdays = [
  'Senin',
  'Selasa',
  'Rabu',
  'Kamis',
  'Jumat',
  'Sabtu',
  'Minggu',
];

const List<String> _months = [
  'Januari',
  'Februari',
  'Maret',
  'April',
  'Mei',
  'Juni',
  'Juli',
  'Agustus',
  'September',
  'Oktober',
  'November',
  'Desember',
];

String _two(int value) => value.toString().padLeft(2, '0');

String _clockText(DateTime value) =>
    '${_two(value.hour)}:${_two(value.minute)}:${_two(value.second)}';

String _timeText(DateTime value) =>
    '${_two(value.hour)}:${_two(value.minute)}';

String _dateText(DateTime value) =>
    '${_weekdays[value.weekday - 1]}, ${value.day} '
    '${_months[value.month - 1]} ${value.year}';

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
  Timer? _clockTimer;
  DateTime _now = DateTime.now();
  int _pendingOffline = 0;
  bool _syncingOffline = false;
  Timer? _offlineRetry;
  List<OfficeLocation> _offices = const [];
  List<AttendanceLog> _today = const [];
  bool _wfhToday = false;
  GpsReading? _gps;
  Uint8List? _selfie;
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
    _clockTimer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (!mounted) return;
      setState(() => _now = DateTime.now());
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
    _clockTimer?.cancel();
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

  bool get _insideRadius {
    final office = _office;
    final distance = _distance;
    if (office == null || distance == null) return false;
    return distance <= office.radiusMeters;
  }

  bool get _canSubmit {
    final gps = _gps;
    final withinOffice = _insideRadius;
    return gps != null &&
        !gps.isMocked &&
        gps.accuracyMeters <= AppConfig.accuracyThresholdMeters &&
        (_wfhToday || withinOffice) &&
        _nextAction != null &&
        !_submitting;
  }

  String get _locationLabel {
    if (_wfhToday) return 'Di Luar Radius / WFH';
    if (_gps == null) return 'Lokasi belum diambil';
    return _insideRadius ? 'Dalam Radius Kantor' : 'Di Luar Radius / WFH';
  }

  bool get _locationPositive => _wfhToday || _insideRadius;

  String get _todayStatus {
    final hasCheckIn = _today.any((row) => row.isCheckIn);
    final hasCheckOut = _today.any((row) => row.isCheckOut);
    if (hasCheckIn && hasCheckOut) return 'Lengkap';
    if (hasCheckIn) return 'Belum check-out';
    return 'Belum absen';
  }

  AttendanceLog? _firstOf(bool Function(AttendanceLog) test) {
    for (final log in _today) {
      if (test(log)) return log;
    }
    return null;
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
      MaterialPageRoute<Uint8List>(
        builder: (_) => CameraScreen(
          insideGeofence: _insideRadius || _wfhToday,
        ),
      ),
    );
  }

  Future<void> _pickSelfie() async {
    final photo = await _takePhoto(context);
    if (photo == null || !mounted) return;
    setState(() => _selfie = photo);
  }

  Future<void> _submit() async {
    final action = _nextAction;
    final gps = _gps;
    if (action == null || gps == null) return;
    final photo = _selfie ?? await _takePhoto(context);
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
      setState(() => _selfie = null);
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
        final width = MediaQuery.sizeOf(context).width;
        final wide = width >= 680;
        final circleSize = (width * 0.62).clamp(220.0, 260.0);
        return Scaffold(
          backgroundColor: AppColors.canvas,
          appBar: AppBar(
            title: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(workspace?.name ?? 'Absensi'),
                const Text(
                  'Absensi harian',
                  style: TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w500,
                    color: AppColors.muted,
                  ),
                ),
              ],
            ),
            actions: [
              IconButton(
                key: const Key('home-notifications'),
                tooltip: 'Notifikasi',
                visualDensity: VisualDensity.compact,
                onPressed: () => Navigator.of(context).push(
                  MaterialPageRoute<void>(
                    builder: (_) => NotificationsScreen(auth: widget.auth),
                  ),
                ),
                icon: const Icon(Icons.notifications_outlined, size: 22),
              ),
              const SizedBox(width: 4),
            ],
          ),
          body: _loading
              ? const Center(child: CircularProgressIndicator())
              : RefreshIndicator(
                  color: AppColors.green,
                  onRefresh: () async {
                    await _load();
                    await _syncOffline();
                  },
                  child: SingleChildScrollView(
                    physics: const AlwaysScrollableScrollPhysics(),
                    padding: const EdgeInsets.fromLTRB(16, 16, 16, 28),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                      if (_pendingOffline > 0) ...[
                        Card(
                          key: const Key('offline-queue-banner'),
                          color: AppColors.yellowSoft,
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(12),
                            side: const BorderSide(color: AppColors.yellowLine),
                          ),
                          child: ListTile(
                            leading: const Icon(
                              Icons.cloud_off,
                              color: AppColors.yellowInk,
                            ),
                            title: Text(
                              '$_pendingOffline absensi menunggu sinkronisasi',
                              style: const TextStyle(
                                fontSize: 13,
                                fontWeight: FontWeight.w600,
                                color: AppColors.yellowInk,
                              ),
                            ),
                            trailing: TextButton(
                              key: const Key('sync-offline-now'),
                              onPressed: _syncingOffline ? null : _syncOffline,
                              child: Text(
                                _syncingOffline ? 'Menyinkronkan…' : 'Sinkronkan',
                              ),
                            ),
                          ),
                        ),
                        const SizedBox(height: 12),
                      ],
                      _buildGreeting(),
                      const SizedBox(height: 14),
                      if (wide) ...[
                        Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Expanded(child: _buildClockCard()),
                            const SizedBox(width: 14),
                            Expanded(
                              child: Column(
                                children: [
                                  _buildSelfieSection(circleSize),
                                  const SizedBox(height: 14),
                                  _buildSubmitButton(),
                                ],
                              ),
                            ),
                          ],
                        ),
                      ] else ...[
                        _buildClockCard(),
                        const SizedBox(height: 18),
                        _buildSelfieSection(circleSize),
                      ],
                      const SizedBox(height: 18),
                      ..._buildWarnings(),
                      if (!wide) _buildSubmitButton(),
                      if (_nextAction != null && _gps == null)
                        const Padding(
                          padding: EdgeInsets.only(top: 8),
                          child: Text(
                            'Ambil lokasi terlebih dahulu untuk mengaktifkan tombol.',
                            textAlign: TextAlign.center,
                            style: TextStyle(fontSize: 11, color: AppColors.muted),
                          ),
                        ),
                      const SizedBox(height: 20),
                      _buildTodayCard(),
                      const SizedBox(height: 14),
                      _buildOfficeCard(),
                      ],
                    ),
                  ),
                ),
        );
      },
    );
  }

  Widget _buildGreeting() {
    final name = widget.auth.user?.name ?? 'Pengguna';
    final office = _office;
    final shiftLabel = office == null
        ? 'Belum ada shift'
        : '${office.workStart}–${office.workEnd}';
    final shiftName = _wfhToday ? 'WFH' : 'Shift aktif';

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'Selamat datang',
                    style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w500,
                      color: AppColors.muted,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    name,
                    style: const TextStyle(
                      fontSize: 23,
                      fontWeight: FontWeight.w800,
                      letterSpacing: -0.5,
                      color: AppColors.ink,
                    ),
                  ),
                ],
              ),
            ),
            IconButton(
              key: const Key('home-switch-workspace'),
              tooltip: 'Ganti workspace',
              visualDensity: VisualDensity.compact,
              onPressed: _openWorkspacePicker,
              icon: const Icon(Icons.swap_horiz, size: 20),
            ),
            IconButton(
              key: const Key('home-logout'),
              tooltip: 'Keluar',
              visualDensity: VisualDensity.compact,
              onPressed: widget.auth.logout,
              icon: const Icon(Icons.logout, size: 20),
            ),
          ],
        ),
        const SizedBox(height: 10),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
          decoration: BoxDecoration(
            color: AppColors.yellowSoft,
            borderRadius: BorderRadius.circular(8),
            border: Border.all(color: AppColors.yellowLine),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.schedule, size: 14, color: AppColors.yellowInk),
              const SizedBox(width: 6),
              Text(
                shiftName,
                style: const TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w600,
                  color: AppColors.yellowInk,
                ),
              ),
              const SizedBox(width: 8),
              Text(
                shiftLabel,
                style: const TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w700,
                  color: AppColors.yellowInk,
                  fontFeatures: tabularFigures,
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 12),
        Wrap(
          spacing: 6,
          runSpacing: 6,
          children: [
            _quickAction(
              key: const Key('home-history'),
              icon: Icons.history,
              label: 'Riwayat',
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute<void>(
                  builder: (_) => HistoryScreen(auth: widget.auth),
                ),
              ),
            ),
            _quickAction(
              key: const Key('home-corrections'),
              icon: Icons.assignment_late_outlined,
              label: 'Revisi',
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute<void>(
                  builder: (_) => CorrectionFormScreen(auth: widget.auth),
                ),
              ),
            ),
            _quickAction(
              key: const Key('home-requests'),
              icon: Icons.more_time,
              label: 'Lembur & WFH',
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute<void>(
                  builder: (_) => EmployeeRequestsScreen(auth: widget.auth),
                ),
              ),
            ),
          ],
        ),
      ],
    );
  }

  Widget _quickAction({
    required Key key,
    required IconData icon,
    required String label,
    required VoidCallback onPressed,
  }) {
    return TextButton.icon(
      key: key,
      onPressed: onPressed,
      icon: Icon(icon, size: 15),
      label: Text(label),
      style: TextButton.styleFrom(
        foregroundColor: AppColors.ink,
        backgroundColor: AppColors.surface,
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
        minimumSize: Size.zero,
        tapTargetSize: MaterialTapTargetSize.shrinkWrap,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(8),
          side: const BorderSide(color: AppColors.line),
        ),
        textStyle: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600),
      ),
    );
  }

  Widget _buildSelfieSection(double circleSize) {
    return Column(
      children: [
        SelfieCircleFrame(
          size: circleSize,
          insideGeofence: _locationPositive,
          photo: _selfie,
          onTap: _submitting ? null : _pickSelfie,
        ),
        const SizedBox(height: 10),
        Text(
          _selfie == null
              ? 'Ketuk lingkaran untuk selfie kamera depan.'
              : 'Selfie siap — ketuk tombol untuk mengirim.',
          textAlign: TextAlign.center,
          style: const TextStyle(fontSize: 12, color: AppColors.muted),
        ),
      ],
    );
  }

  Widget _buildSubmitButton() {
    return SizedBox(
      height: 56,
      child: FilledButton.icon(
        key: const Key('attendance-submit'),
        style: FilledButton.styleFrom(
          backgroundColor: _nextAction == 'CHECK_OUT'
              ? AppColors.yellow
              : AppColors.green,
          foregroundColor: _nextAction == 'CHECK_OUT'
              ? AppColors.yellowInk
              : Colors.white,
          disabledBackgroundColor: AppColors.line,
          disabledForegroundColor: AppColors.muted,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
          ),
        ),
        onPressed: _canSubmit ? _submit : null,
        icon: _submitting
            ? const SizedBox.square(
                dimension: 18,
                child: CircularProgressIndicator(
                  strokeWidth: 2,
                  color: Colors.white,
                ),
              )
            : Icon(
                _nextAction == 'CHECK_IN' ? Icons.login : Icons.logout,
                size: 20,
              ),
        label: Text(
          _nextAction == null
              ? 'Absensi hari ini selesai'
              : _nextAction == 'CHECK_IN'
              ? 'Check-in sekarang'
              : 'Check-out sekarang',
        ),
      ),
    );
  }

  Widget _buildClockCard() {
    final gps = _gps;
    final distance = _distance;
    final office = _office;
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.line),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(
                Icons.business_outlined,
                size: 14,
                color: AppColors.muted,
              ),
              const SizedBox(width: 6),
              Expanded(
                child: Text(
                  office?.name ?? 'Kantor belum disetel',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 11.5,
                    fontWeight: FontWeight.w600,
                    color: AppColors.muted,
                  ),
                ),
              ),
              if (office != null)
                Text(
                  'Radius ${office.radiusMeters.toStringAsFixed(0)} m',
                  style: const TextStyle(
                    fontSize: 10.5,
                    fontWeight: FontWeight.w600,
                    color: AppColors.muted,
                  ),
                ),
            ],
          ),
          const SizedBox(height: 10),
          Align(alignment: Alignment.centerLeft, child: _locationPill()),
          const SizedBox(height: 8),
          Text(
            _clockText(_now),
            style: const TextStyle(
              fontSize: 40,
              fontWeight: FontWeight.w800,
              letterSpacing: -1.2,
              height: 1.05,
              color: AppColors.ink,
              fontFeatures: tabularFigures,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            _dateText(_now),
            style: const TextStyle(fontSize: 12, color: AppColors.muted),
          ),
          const SizedBox(height: 12),
          const Divider(),
          const SizedBox(height: 8),
          Row(
            children: [
              const Icon(Icons.gps_fixed, size: 15, color: AppColors.muted),
              const SizedBox(width: 6),
              Expanded(
                child: Text(
                  gps == null
                      ? 'Lokasi belum diambil.'
                      : 'Akurasi GPS: ${gps.accuracyMeters.toStringAsFixed(0)} m'
                            '${distance == null ? '' : ' • jarak ${distance.toStringAsFixed(0)} m'}',
                  style: const TextStyle(fontSize: 11.5, color: AppColors.muted),
                ),
              ),
              TextButton(
                key: const Key('refresh-location'),
                onPressed: _locating ? null : _readLocation,
                style: TextButton.styleFrom(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                  minimumSize: Size.zero,
                  tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    if (_locating)
                      const SizedBox.square(
                        dimension: 14,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    else
                      const Icon(Icons.my_location, size: 15),
                    const SizedBox(width: 5),
                    const Text('Perbarui'),
                  ],
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _locationPill() {
    final positive = _locationPositive;
    final foreground = positive ? AppColors.greenDark : AppColors.yellowInk;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: positive ? AppColors.greenSoft : AppColors.yellowSoft,
        borderRadius: BorderRadius.circular(999),
        border: Border.all(
          color: positive ? AppColors.greenLine : AppColors.yellowLine,
        ),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 6,
            height: 6,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: positive ? AppColors.green : AppColors.amber,
            ),
          ),
          const SizedBox(width: 6),
          Text(
            _locationLabel,
            style: TextStyle(
              fontSize: 11,
              fontWeight: FontWeight.w700,
              color: foreground,
            ),
          ),
        ],
      ),
    );
  }

  List<Widget> _buildWarnings() {
    final office = _office;
    final gps = _gps;
    final distance = _distance;
    final warnings = <Widget>[];

    if (gps != null && gps.accuracyMeters > AppConfig.accuracyThresholdMeters) {
      warnings.add(
        _warning(
          key: const Key('accuracy-warning'),
          icon: Icons.gps_off,
          text:
              'Akurasi GPS di atas '
              '${AppConfig.accuracyThresholdMeters.toStringAsFixed(0)} m. '
              'Tunggu GPS lebih baik.',
        ),
      );
    }
    if (gps?.isMocked == true) {
      warnings.add(
        _warning(
          key: const Key('mock-warning'),
          icon: Icons.warning_amber,
          text: 'Mock location terdeteksi. Absensi diblokir.',
        ),
      );
    }
    if (!_wfhToday &&
        distance != null &&
        office != null &&
        distance > office.radiusMeters) {
      warnings.add(
        _warning(
          key: const Key('geofence-warning'),
          icon: Icons.location_off,
          text: 'Anda berada di luar radius kantor.',
        ),
      );
    }
    if (_error != null) {
      warnings.add(
        _warning(
          key: const Key('attendance-error'),
          icon: Icons.error_outline,
          text: _error!,
        ),
      );
    }

    if (warnings.isEmpty) return const [];
    return [
      ...warnings.expand(
        (widget) => [
          widget,
          const SizedBox(height: 8),
        ],
      ),
      const SizedBox(height: 4),
    ];
  }

  Widget _warning({
    required Key key,
    required IconData icon,
    required String text,
  }) {
    return Container(
      key: key,
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
      decoration: BoxDecoration(
        color: AppColors.dangerSoft,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: AppColors.danger.withValues(alpha: 0.22)),
      ),
      child: Row(
        children: [
          Icon(icon, size: 15, color: AppColors.danger),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              text,
              style: const TextStyle(
                fontSize: 11.5,
                fontWeight: FontWeight.w500,
                color: AppColors.danger,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildTodayCard() {
    final checkIn = _firstOf((log) => log.isCheckIn);
    final checkOut = _firstOf((log) => log.isCheckOut);
    final suspicious = _today.any((log) => log.isSuspicious);
    final complete = checkIn != null && checkOut != null;

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
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Expanded(
                child: Text(
                  'Status hari ini',
                  style: TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w700,
                    color: AppColors.ink,
                  ),
                ),
              ),
              const SizedBox(width: 8),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
                decoration: BoxDecoration(
                  color: complete
                      ? AppColors.greenSoft
                      : checkIn != null
                      ? AppColors.yellowSoft
                      : AppColors.tableHead,
                  borderRadius: BorderRadius.circular(999),
                  border: Border.all(
                    color: complete
                        ? AppColors.greenLine
                        : checkIn != null
                        ? AppColors.yellowLine
                        : AppColors.line,
                  ),
                ),
                child: Text(
                  _todayStatus,
                  style: TextStyle(
                    fontSize: 10.5,
                    fontWeight: FontWeight.w700,
                    color: complete
                        ? AppColors.greenDark
                        : checkIn != null
                        ? AppColors.yellowInk
                        : AppColors.muted,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 14),
          Row(
            children: [
              Expanded(
                child: _summaryCell(
                  label: 'Jam masuk',
                  value: checkIn == null
                      ? '—'
                      : _timeText(checkIn.timestampServer.toLocal()),
                ),
              ),
              Container(width: 1, height: 34, color: AppColors.line),
              Expanded(
                child: _summaryCell(
                  label: 'Jam pulang',
                  value: checkOut == null
                      ? '—'
                      : _timeText(checkOut.timestampServer.toLocal()),
                ),
              ),
              Container(width: 1, height: 34, color: AppColors.line),
              Expanded(
                child: _summaryCell(
                  label: 'Jarak',
                  value: checkIn == null
                      ? '—'
                      : '${checkIn.distanceMeters.toStringAsFixed(0)} m',
                ),
              ),
            ],
          ),
          if (suspicious) ...[
            const SizedBox(height: 10),
            Row(
              children: const [
                Icon(Icons.warning_amber, size: 14, color: AppColors.amber),
                SizedBox(width: 6),
                Expanded(
                  child: Text(
                    'Ada absensi yang ditandai perlu ditinjau.',
                    style: TextStyle(fontSize: 11, color: AppColors.muted),
                  ),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }

  Widget _summaryCell({required String label, required String value}) {
    return Column(
      children: [
        Text(
          label,
          style: const TextStyle(
            fontSize: 10,
            fontWeight: FontWeight.w600,
            letterSpacing: 0.3,
            color: AppColors.muted,
          ),
        ),
        const SizedBox(height: 3),
        Text(
          value,
          style: const TextStyle(
            fontSize: 16,
            fontWeight: FontWeight.w700,
            color: AppColors.ink,
            fontFeatures: tabularFigures,
          ),
        ),
      ],
    );
  }

  Widget _buildOfficeCard() {
    final office = _office;
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
          Row(
            children: [
              const Icon(Icons.business_outlined, size: 16, color: AppColors.muted),
              const SizedBox(width: 7),
              Expanded(
                child: Text(
                  office?.name ?? 'Lokasi kantor belum tersedia',
                  style: const TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w700,
                    color: AppColors.ink,
                  ),
                ),
              ),
              if (office != null)
                Text(
                  'Radius ${office.radiusMeters.toStringAsFixed(0)} m',
                  style: const TextStyle(
                    fontSize: 10.5,
                    fontWeight: FontWeight.w600,
                    color: AppColors.muted,
                  ),
                ),
            ],
          ),
          if (_wfhToday) ...[
            const SizedBox(height: 8),
            const Text(
              'Mode WFH disetujui — geofence kantor dilewati.',
              key: Key('wfh-mode'),
              style: TextStyle(
                fontSize: 11.5,
                fontWeight: FontWeight.w600,
                color: AppColors.yellowInk,
              ),
            ),
          ],
          const SizedBox(height: 10),
          ClipRRect(
            borderRadius: BorderRadius.circular(10),
            child: GeofenceMap(office: office, gps: _gps),
          ),
        ],
      ),
    );
  }
}
