import 'dart:async';
import 'dart:io';
import 'dart:typed_data';

import 'package:material_ui/material_ui.dart';

import '../api/api_client.dart';
import '../core/app_config.dart';
import '../models/attendance_log.dart';
import '../models/broadcast.dart';
import '../models/employee_request.dart';
import '../models/leave.dart';
import '../models/member_device.dart';
import '../models/office_location.dart';
import '../models/offline_attendance.dart';
import '../models/schedule.dart';
import '../models/warning_letter.dart';
import '../services/app_update_service.dart';
import '../services/attendance_reminder_service.dart';
import '../services/auth_service.dart';
import '../services/location_service.dart';
import '../services/offline_attendance_queue.dart';
import '../services/push_service.dart';
import '../theme/app_theme.dart';
import '../widgets/geofence_map.dart' show distanceMeters;
import 'broadcasts_screen.dart';
import 'camera_screen.dart';
import 'client_visits_screen.dart';
import 'correction_form_screen.dart';
import 'employee_requests_screen.dart';
import 'history_screen.dart';
import 'leave_form_screen.dart';
import 'payslips_screen.dart';
import 'profile_screen.dart';
import 'schedule_screen.dart';
import 'warning_letters_screen.dart';
import 'work_permit_form_screen.dart';
import 'work_projections_screen.dart';
import 'workspace_picker_screen.dart';

typedef PhotoTaker = Future<Uint8List?> Function(BuildContext context);

const List<String> _monthShort = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'Mei',
  'Jun',
  'Jul',
  'Agu',
  'Sep',
  'Okt',
  'Nov',
  'Des',
];

String _two(int value) => value.toString().padLeft(2, '0');

String _timeText(DateTime value) => '${_two(value.hour)}:${_two(value.minute)}';

String _shortDate(DateTime value) {
  final local = value.toLocal();
  return '${local.day} ${_monthShort[local.month - 1]} ${local.year}';
}

String _zoneLabel(String timezone) {
  return switch (timezone) {
    'Asia/Jakarta' => 'WIB',
    'Asia/Makassar' => 'WITA',
    'Asia/Jayapura' => 'WIT',
    _ => timezone.isEmpty ? 'WIB' : timezone,
  };
}

class HomeScreen extends StatefulWidget {
  const HomeScreen({
    super.key,
    required this.auth,
    this.locationService,
    this.photoTaker,
    this.pushService,
    this.offlineQueue,
    this.reminderService,
    this.updateService,
    this.onOpenActivity,
    this.embedded = false,
  });

  final AuthService auth;
  final LocationService? locationService;
  final PhotoTaker? photoTaker;
  final PushService? pushService;
  final OfflineAttendanceQueue? offlineQueue;
  final AttendanceReminderService? reminderService;
  final AppUpdateService? updateService;
  final VoidCallback? onOpenActivity;
  final bool embedded;

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  late final LocationService _location;
  late final OfflineAttendanceQueue _offlineQueue;
  late final AttendanceReminderService _reminders;
  int _pendingOffline = 0;
  bool _syncingOffline = false;
  Timer? _offlineRetry;
  List<OfficeLocation> _offices = const [];
  List<AttendanceLog> _today = const [];
  WorkSchedule? _schedule;
  MemberDevice? _device;
  bool _refreshingDevice = false;
  bool _wfhToday = false;
  List<BroadcastMessage> _broadcasts = const [];
  List<WarningLetter> _warnings = const [];
  LeaveBalance? _leaveBalance;
  Uint8List? _avatarBytes;
  Uint8List? _companyLogoBytes;
  bool _showMoreServices = false;
  bool _outOfTown = false;
  String _outOfTownReason = '';
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
    _reminders = widget.reminderService ?? AttendanceReminderService();
    unawaited(_refreshOffline().then((_) => _syncOffline()));
    // Retry berkala: koneksi yang pulih menyinkronkan antrean tanpa aksi user.
    _offlineRetry = Timer.periodic(const Duration(seconds: 30), (_) {
      if (_pendingOffline > 0 && !_syncingOffline) unawaited(_syncOffline());
    });
    unawaited(
      PushRegistrar.register(
        widget.auth.api,
        widget.pushService ?? const NoopPushService(),
      ),
    );
    unawaited(_loadAvatar());
    unawaited(_loadCompanyLogo());
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
        widget.auth.api.myBroadcasts(),
        widget.auth.api.myWarningLetters(),
      ]);
      if (!mounted) return;
      setState(() {
        _offices = results[0] as List<OfficeLocation>;
        _today = (results[1] as List<AttendanceLog>)
            .where(_isToday)
            .toList(growable: false);
        _wfhToday = (results[2] as List<WfhRequest>).any(
          (row) =>
              row.status == 'APPROVED' && _isSameDay(row.date, DateTime.now()),
        );
        _broadcasts = results[3] as List<BroadcastMessage>;
        _warnings = results[4] as List<WarningLetter>;
        _loading = false;
      });
      try {
        final schedule = await widget.auth.api.workSchedule();
        if (mounted) setState(() => _schedule = schedule);
      } catch (_) {
        // Kartu header tetap bisa dipakai; jadwal tampil kosong bila gagal.
      }
      try {
        final device = await widget.auth.api.myDevice();
        if (mounted) setState(() => _device = device);
      } catch (_) {
        // Status perangkat bersifat informatif; server tetap menolak aksi
        // check-in jika perangkat belum disetujui.
      }
      try {
        final balance = await widget.auth.api.myLeaveBalance();
        if (mounted) setState(() => _leaveBalance = balance);
      } catch (_) {
        // Kuota cuti bersifat informatif; badge menampilkan tanda kosong.
      }
      unawaited(_syncReminders());
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

  Future<void> _loadAvatar() async {
    try {
      final photo = await widget.auth.api.myProfilePhoto();
      if (!photo.hasPhoto) return;
      final bytes = await widget.auth.api.profilePhotoBytes(photo.photoUrl!);
      if (!mounted || bytes == null) return;
      setState(() => _avatarBytes = bytes);
    } catch (_) {
      // Avatar jatuh ke inisial bila foto belum tersedia.
    }
  }

  Future<void> _loadCompanyLogo() async {
    try {
      final bytes = await widget.auth.api.companyLogoBytes();
      if (!mounted) return;
      setState(() => _companyLogoBytes = bytes);
    } catch (_) {
      // Logo opsional; header memakai ikon perusahaan bila belum diunggah.
    }
  }

  Future<void> _refreshDevice() async {
    if (_refreshingDevice) return;
    setState(() => _refreshingDevice = true);
    try {
      final device = await widget.auth.api.myDevice();
      if (!mounted) return;
      setState(() => _device = device);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            device == null
                ? 'Perangkat ini belum terdaftar. Login ulang dari aplikasi mobile.'
                : device.isApproved
                ? 'Perangkat sudah disetujui dan siap dipakai absensi.'
                : device.isRevoked
                ? 'Perangkat dicabut. Minta Admin HR mengaktifkan perangkat baru.'
                : 'Perangkat masih menunggu persetujuan Admin HR.',
          ),
        ),
      );
    } on ApiException catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(messageForApiError(error))));
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Status perangkat tidak dapat diperiksa.'),
        ),
      );
    } finally {
      if (mounted) setState(() => _refreshingDevice = false);
    }
  }

  Future<void> _syncReminders() async {
    try {
      final settings = await _reminders.loadSettings();
      if (!settings.enabled) return;
      final schedule = await widget.auth.api.workSchedule();
      await _reminders.sync(
        schedule: schedule,
        settings: settings,
        checkedInToday: _today.any((row) => row.isCheckIn),
        checkedOutToday: _today.any((row) => row.isCheckOut),
      );
    } catch (_) {
      // Pengingat bersifat opsional dan tidak boleh mengganggu absensi.
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
    return _isSameDay(date, DateTime.now());
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
    if (_outOfTown) return true;
    final office = _office;
    final distance = _distance;
    if (office == null || distance == null) return false;
    return distance <= office.radiusMeters;
  }

  bool get _deviceBlocked {
    final device = _device;
    return device != null && !device.isApproved;
  }

  String get _locationLabel {
    if (_outOfTown) return 'Dinas luar kota';
    if (_wfhToday) return 'Di luar radius / WFH';
    if (_gps == null) return 'Lokasi dicek saat absen';
    return _insideRadius ? 'Dalam radius kantor' : 'Di luar radius kantor';
  }

  bool get _locationPositive =>
      _outOfTown || _wfhToday || (_gps != null && _insideRadius);

  String get _name => widget.auth.user?.name ?? 'Pengguna';

  String get _initials {
    final parts = _name
        .trim()
        .split(RegExp(r'\s+'))
        .where((part) => part.isNotEmpty)
        .take(2);
    final letters = parts
        .map((part) => part.substring(0, 1).toUpperCase())
        .join();
    return letters.isEmpty ? 'A' : letters;
  }

  AttendanceLog? _firstOf(bool Function(AttendanceLog) test) {
    for (final log in _today) {
      if (test(log)) return log;
    }
    return null;
  }

  Future<void> _showLocationHelp(LocationUnavailableException error) async {
    if (!error.canOpenSettings) return;
    final open = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Lokasi tidak tersedia'),
        content: Text(error.message),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('Tutup'),
          ),
          FilledButton(
            key: const Key('location-open-settings'),
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: const Text('Buka pengaturan'),
          ),
        ],
      ),
    );
    if (open == true) {
      await _location.openSettings(error.problem);
    }
  }

  Future<Uint8List?> _takePhoto(
    BuildContext context, {
    required OfficeLocation? office,
    required bool inside,
    required double? distance,
  }) {
    final custom = widget.photoTaker;
    if (custom != null) return custom(context);
    return Navigator.of(context).push<Uint8List>(
      MaterialPageRoute<Uint8List>(
        builder: (_) => CameraScreen(
          insideGeofence: inside,
          officeName: office?.name,
          distanceMeters: distance,
          wfh: _wfhToday || _outOfTown,
        ),
      ),
    );
  }

  /// Izin GPS diminta saat tombol presensi ditekan, bukan saat aplikasi dibuka.
  Future<void> _startAttendance() async {
    final action = _nextAction;
    if (action == null || _locating || _submitting) return;

    setState(() {
      _locating = true;
      _error = null;
    });

    GpsReading reading;
    try {
      reading = await _location.current();
    } on LocationUnavailableException catch (error) {
      if (!mounted) return;
      setState(() {
        _locating = false;
        _error = error.message;
      });
      await _showLocationHelp(error);
      return;
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _locating = false;
        _error = 'Lokasi tidak dapat dibaca. Coba lagi.';
      });
      return;
    }

    if (!mounted) return;
    setState(() {
      _gps = reading;
      _locating = false;
    });

    if (reading.isMocked ||
        reading.accuracyMeters > AppConfig.accuracyThresholdMeters) {
      // Peringatan ditampilkan lewat _buildWarnings; kamera tidak dibuka.
      return;
    }

    final office = _office;
    final distance = _distance;
    final inside =
        _wfhToday ||
        (office != null && distance != null && distance <= office.radiusMeters);
    final photo = await _takePhoto(
      context,
      office: office,
      inside: inside,
      distance: distance,
    );
    if (photo == null || !mounted) return;
    await _send(action, reading, photo);
  }

  Future<void> _send(String action, GpsReading gps, Uint8List photo) async {
    setState(() {
      _submitting = true;
      _error = null;
    });
    final deviceInfo = '${Theme.of(context).platform.name}-mobile';
    try {
      final api = widget.auth.api;
      final workMode = _outOfTown ? 'OUT_OF_TOWN' : 'OFFICE';
      final reason = _outOfTown ? _outOfTownReason.trim() : null;
      if (action == 'CHECK_IN') {
        await api.checkIn(
          latitude: gps.latitude,
          longitude: gps.longitude,
          accuracyMeters: gps.accuracyMeters,
          isMockLocation: gps.isMocked,
          photoBytes: photo,
          deviceInfo: deviceInfo,
          workMode: workMode,
          outOfTownReason: reason,
        );
      } else {
        await api.checkOut(
          latitude: gps.latitude,
          longitude: gps.longitude,
          accuracyMeters: gps.accuracyMeters,
          isMockLocation: gps.isMocked,
          photoBytes: photo,
          deviceInfo: deviceInfo,
          workMode: workMode,
          outOfTownReason: reason,
        );
      }
      unawaited(
        _reminders.cancelToday(
          checkIn: action == 'CHECK_IN',
          checkOut: action == 'CHECK_OUT',
        ),
      );
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
          workMode: _outOfTown ? 'OUT_OF_TOWN' : 'OFFICE',
          outOfTownReason: _outOfTown ? _outOfTownReason.trim() : null,
        ),
      );
      await _refreshOffline();
      if (!mounted) return;
      setState(() => _error = null);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            'Tidak ada koneksi. Absensi disimpan dan akan disinkronkan.',
          ),
        ),
      );
    } catch (_) {
      if (!mounted) return;
      setState(
        () =>
            _error = 'Absensi gagal dikirim dan tidak dapat disimpan offline.',
      );
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
          SnackBar(
            content: Text('$synced absensi offline berhasil disinkronkan.'),
          ),
        );
        await _load();
      } else {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Sinkronisasi gagal. Periksa koneksi Anda.'),
          ),
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
    if (!mounted) return;
    await _loadCompanyLogo();
    await _load();
  }

  void _openProfile() {
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => ProfileScreen(
          auth: widget.auth,
          updateService: widget.updateService,
          standalone: true,
        ),
      ),
    );
  }

  void _openPage(Widget page) {
    Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => page));
  }

  Future<void> _openCorrection() async {
    final saved = await Navigator.of(context).push<bool>(
      MaterialPageRoute<bool>(
        builder: (_) => CorrectionFormScreen(auth: widget.auth),
      ),
    );
    if (saved == true && mounted) await _load();
  }

  List<WarningLetter> get _activeWarnings =>
      _warnings.where((row) => row.isActive).toList(growable: false);

  Future<void> _openBroadcasts() async {
    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => BroadcastsScreen(auth: widget.auth),
      ),
    );
    if (mounted) await _load();
  }

  Future<void> _openWarnings() async {
    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => WarningLettersScreen(auth: widget.auth),
      ),
    );
    if (mounted) await _load();
  }

  Future<void> _openModeSheet() async {
    var selectedOutOfTown = _outOfTown;
    final reason = TextEditingController(text: _outOfTownReason);
    String? validation;
    final saved = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(18)),
      ),
      builder: (sheetContext) => StatefulBuilder(
        builder: (context, setSheetState) => SafeArea(
          top: false,
          child: Padding(
            padding: EdgeInsets.fromLTRB(
              18,
              12,
              18,
              MediaQuery.viewInsetsOf(sheetContext).bottom + 18,
            ),
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Center(
                    child: Container(
                      width: 36,
                      height: 4,
                      margin: const EdgeInsets.only(bottom: 14),
                      decoration: BoxDecoration(
                        color: AppColors.line,
                        borderRadius: BorderRadius.circular(999),
                      ),
                    ),
                  ),
                  const Text(
                    'Mode presensi',
                    style: TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.w800,
                      color: AppColors.ink,
                    ),
                  ),
                  const SizedBox(height: 3),
                  const Text(
                    'Presensi kantor memakai geofence dan selfie. Dinas luar kota '
                    'tetap dicatat dan menunggu persetujuan approver.',
                    style: TextStyle(
                      fontSize: 11.5,
                      height: 1.4,
                      color: AppColors.muted,
                    ),
                  ),
                  const SizedBox(height: 12),
                  Row(
                    children: [
                      _modeButton(
                        key: const Key('home-mode-office'),
                        label: 'Kantor',
                        icon: Icons.business_outlined,
                        selected: !selectedOutOfTown,
                        onTap: () =>
                            setSheetState(() => selectedOutOfTown = false),
                      ),
                      const SizedBox(width: 8),
                      _modeButton(
                        key: const Key('home-mode-out-of-town'),
                        label: 'Luar kota',
                        icon: Icons.flight_takeoff,
                        selected: selectedOutOfTown,
                        onTap: () =>
                            setSheetState(() => selectedOutOfTown = true),
                      ),
                    ],
                  ),
                  if (selectedOutOfTown) ...[
                    const SizedBox(height: 10),
                    TextField(
                      key: const Key('home-out-of-town-reason'),
                      controller: reason,
                      minLines: 2,
                      maxLines: 3,
                      maxLength: 500,
                      onChanged: (_) {
                        if (validation != null) {
                          setSheetState(() => validation = null);
                        }
                      },
                      decoration: const InputDecoration(
                        hintText: 'Tujuan dan keperluan dinas luar kota (min. 10 karakter)',
                        counterText: '',
                        isDense: true,
                      ),
                    ),
                  ],
                  if (validation != null) ...[
                    const SizedBox(height: 6),
                    Text(
                      validation!,
                      key: const Key('home-mode-error'),
                      style: const TextStyle(
                        fontSize: 11,
                        color: AppColors.danger,
                      ),
                    ),
                  ],
                  const SizedBox(height: 14),
                  SizedBox(
                    height: 46,
                    child: FilledButton(
                      key: const Key('home-mode-save'),
                      onPressed: () {
                        if (selectedOutOfTown &&
                            reason.text.trim().length < 10) {
                          setSheetState(
                            () => validation =
                                'Alasan dinas luar kota minimal 10 karakter.',
                          );
                          return;
                        }
                        Navigator.of(sheetContext).pop(true);
                      },
                      child: const Text('Simpan mode'),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
    if (saved == true && mounted) {
      setState(() {
        _outOfTown = selectedOutOfTown;
        _outOfTownReason = selectedOutOfTown ? reason.text.trim() : '';
      });
    }
    reason.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: widget.auth,
      builder: (context, _) {
        final warnings = _buildWarnings();
        return Scaffold(
          backgroundColor: AppColors.canvas,
          body: SafeArea(
            bottom: false,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                _buildTopBar(),
                Expanded(
                  child: _loading
                      ? const Center(child: CircularProgressIndicator())
                      : RefreshIndicator(
                          color: AppColors.green,
                          onRefresh: () async {
                            await _load();
                            await _syncOffline();
                          },
                          child: SingleChildScrollView(
                            physics: const AlwaysScrollableScrollPhysics(),
                            padding: const EdgeInsets.fromLTRB(14, 14, 14, 18),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.stretch,
                              children: [
                                if (_deviceBlocked) ...[
                                  _deviceBanner(_device!),
                                  const SizedBox(height: 10),
                                ],
                                if (_pendingOffline > 0) ...[
                                  _offlineBanner(),
                                  const SizedBox(height: 10),
                                ],
                                _companyScheduleCard(),
                                if (_activeWarnings.isNotEmpty) ...[
                                  const SizedBox(height: 10),
                                  _buildWarningBanner(_activeWarnings.first),
                                ],
                                if (warnings.isNotEmpty)
                                  const SizedBox(height: 10),
                                ...warnings,
                                const SizedBox(height: 14),
                                _serviceGrid(),
                                const SizedBox(height: 12),
                                _attendanceSummaryBanner(),
                                const SizedBox(height: 10),
                                const Text(
                                  'Selfie diambil lewat kamera depan setelah lokasi dicek.',
                                  textAlign: TextAlign.center,
                                  style: TextStyle(
                                    fontSize: 10.5,
                                    color: AppColors.muted,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                ),
              ],
            ),
          ),
          bottomNavigationBar: _loading ? null : _buildStickyCta(),
        );
      },
    );
  }

  Widget _buildTopBar() {
    final workspace = widget.auth.activeWorkspace;
    final quota = _leaveBalance?.remainingDays;
    return Container(
      key: const Key('home-top-bar'),
      decoration: const BoxDecoration(
        color: AppColors.surface,
        border: Border(bottom: BorderSide(color: AppColors.line)),
      ),
      padding: const EdgeInsets.fromLTRB(14, 9, 14, 9),
      child: Column(
        children: [
          Row(
            children: [
              _companyLogo(size: 36, onDark: false),
              const SizedBox(width: 9),
              Expanded(
                child: InkWell(
                  key: const Key('home-switch-workspace'),
                  borderRadius: BorderRadius.circular(8),
                  onTap: _openWorkspacePicker,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        workspace?.name ?? 'Absensi',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.w800,
                          color: AppColors.ink,
                        ),
                      ),
                      const SizedBox(height: 1),
                      const Text(
                        'Portal absensi karyawan',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(fontSize: 10, color: AppColors.muted),
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(width: 8),
              InkWell(
                key: const Key('home-profile'),
                borderRadius: BorderRadius.circular(999),
                onTap: _openProfile,
                child: Container(
                  width: 38,
                  height: 38,
                  clipBehavior: Clip.antiAlias,
                  decoration: BoxDecoration(
                    color: AppColors.greenSoft,
                    shape: BoxShape.circle,
                    border: Border.all(color: AppColors.greenLine),
                  ),
                  alignment: Alignment.center,
                  child: _avatarBytes == null
                      ? Text(
                          _initials,
                          style: const TextStyle(
                            fontSize: 13,
                            fontWeight: FontWeight.w800,
                            color: AppColors.greenDark,
                          ),
                        )
                      : Image.memory(_avatarBytes!, fit: BoxFit.cover),
                ),
              ),
            ],
          ),
          const SizedBox(height: 7),
          Row(
            children: [
              Expanded(
                child: InkWell(
                  key: const Key('home-profile-name'),
                  borderRadius: BorderRadius.circular(6),
                  onTap: _openProfile,
                  child: Row(
                    children: [
                      Flexible(
                        child: Text(
                          _name,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            fontSize: 15,
                            fontWeight: FontWeight.w800,
                            letterSpacing: -0.2,
                            color: AppColors.ink,
                          ),
                        ),
                      ),
                      const SizedBox(width: 3),
                      const Icon(
                        Icons.chevron_right,
                        size: 15,
                        color: AppColors.muted,
                      ),
                    ],
                  ),
                ),
              ),
              _topBadge(
                key: const Key('home-leave-quota'),
                icon: Icons.beach_access_outlined,
                text: 'Kuota Cuti ${quota ?? '—'}',
              ),
              const SizedBox(width: 6),
              _topBadge(
                key: const Key('home-timezone'),
                icon: Icons.public,
                text: _zoneLabel(_schedule?.timezone ?? 'Asia/Jakarta'),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _companyLogo({required double size, required bool onDark}) {
    final bytes = _companyLogoBytes;
    if (bytes == null) {
      return Container(
        key: const Key('home-company-logo'),
        width: size,
        height: size,
        decoration: BoxDecoration(
          color: onDark ? Colors.white.withValues(alpha: 0.16) : AppColors.teal,
          borderRadius: BorderRadius.circular(10),
        ),
        alignment: Alignment.center,
        child: Icon(
          Icons.business_outlined,
          size: size * 0.5,
          color: Colors.white,
        ),
      );
    }
    return Container(
      key: const Key('home-company-logo'),
      width: size,
      height: size,
      padding: EdgeInsets.all(size * 0.1),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: onDark ? Colors.white : AppColors.line),
      ),
      alignment: Alignment.center,
      child: Image.memory(
        bytes,
        fit: BoxFit.contain,
        errorBuilder: (_, _, _) => Icon(
          Icons.business_outlined,
          size: size * 0.5,
          color: AppColors.teal,
        ),
      ),
    );
  }

  Widget _topBadge({
    required Key key,
    required IconData icon,
    required String text,
  }) {
    return Container(
      key: key,
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
      decoration: BoxDecoration(
        color: AppColors.tableHead,
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: AppColors.line),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 11, color: AppColors.muted),
          const SizedBox(width: 4),
          Text(
            text,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              fontSize: 9.5,
              fontWeight: FontWeight.w700,
              color: AppColors.ink,
              fontFeatures: tabularFigures,
            ),
          ),
        ],
      ),
    );
  }

  Widget _companyScheduleCard() {
    final schedule = _schedule;
    final now = DateTime.now();
    final day = schedule?.dayFor(now);
    final holiday = schedule?.holidayOn(now);
    final isWorkday = day?.isWorkday == true && holiday == null;
    final hours = isWorkday
        ? '${day!.startTime} ··· ${day.endTime}'
        : 'Hari Libur';
    final tolerance =
        day?.lateToleranceMinutes ?? schedule?.lateToleranceMinutes ?? 0;
    final checkIn = _firstOf((log) => log.isCheckIn);
    final broadcast = _broadcasts.isEmpty ? null : _broadcasts.first;
    final workspace = widget.auth.activeWorkspace;

    return Container(
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.line),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Material(
            color: AppColors.teal,
            child: InkWell(
              key: const Key('home-broadcast-banner'),
              onTap: broadcast == null ? null : _openBroadcasts,
              child: Padding(
                padding: const EdgeInsets.all(14),
                child: Row(
                  children: [
                    _companyLogo(size: 38, onDark: true),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            workspace?.name ?? 'Absensi',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              fontSize: 13,
                              fontWeight: FontWeight.w800,
                              color: Colors.white,
                            ),
                          ),
                          const SizedBox(height: 2),
                          Text(
                            broadcast?.title ??
                                'Portal absensi dan jadwal kerja karyawan.',
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                              fontSize: 10.5,
                              height: 1.3,
                              color: Colors.white.withValues(alpha: 0.88),
                            ),
                          ),
                        ],
                      ),
                    ),
                    if (broadcast != null)
                      Icon(
                        Icons.chevron_right,
                        size: 18,
                        color: Colors.white.withValues(alpha: 0.75),
                      ),
                  ],
                ),
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Row(
                  children: [
                    const Expanded(
                      child: Text(
                        'Jadwal Anda Hari Ini',
                        style: TextStyle(
                          fontSize: 11,
                          fontWeight: FontWeight.w600,
                          color: AppColors.muted,
                        ),
                      ),
                    ),
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 8,
                        vertical: 3,
                      ),
                      decoration: BoxDecoration(
                        color: isWorkday
                            ? AppColors.greenSoft
                            : AppColors.tableHead,
                        borderRadius: BorderRadius.circular(999),
                        border: Border.all(
                          color: isWorkday
                              ? AppColors.greenLine
                              : AppColors.line,
                        ),
                      ),
                      child: Text(
                        isWorkday ? 'Hari Kerja' : 'Hari Libur',
                        style: TextStyle(
                          fontSize: 9,
                          fontWeight: FontWeight.w700,
                          color: isWorkday
                              ? AppColors.greenDark
                              : AppColors.muted,
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 5),
                Row(
                  crossAxisAlignment: CrossAxisAlignment.center,
                  children: [
                    Flexible(
                      child: Text(
                        hours,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontSize: 24,
                          height: 1.1,
                          fontWeight: FontWeight.w800,
                          letterSpacing: -0.6,
                          color: AppColors.ink,
                          fontFeatures: tabularFigures,
                        ),
                      ),
                    ),
                    if (isWorkday && tolerance > 0) ...[
                      const SizedBox(width: 8),
                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 7,
                          vertical: 3,
                        ),
                        decoration: BoxDecoration(
                          color: AppColors.yellowSoft,
                          borderRadius: BorderRadius.circular(999),
                          border: Border.all(color: AppColors.yellowLine),
                        ),
                        child: Text(
                          '$tolerance menit',
                          style: const TextStyle(
                            fontSize: 9,
                            fontWeight: FontWeight.w700,
                            color: AppColors.yellowInk,
                            fontFeatures: tabularFigures,
                          ),
                        ),
                      ),
                    ],
                  ],
                ),
                const SizedBox(height: 4),
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Icon(
                      Icons.free_breakfast_outlined,
                      size: 13,
                      color: AppColors.muted,
                    ),
                    const SizedBox(width: 5),
                    Expanded(
                      child: Text(
                        holiday != null
                            ? '${holiday.name} · ${holiday.typeLabel}'
                            : 'Istirahat mengikuti kebijakan kantor.',
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontSize: 10.5,
                          height: 1.3,
                          color: AppColors.muted,
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 11),
                Container(
                  key: const Key('home-checkin-strip'),
                  padding: const EdgeInsets.symmetric(
                    horizontal: 10,
                    vertical: 8,
                  ),
                  decoration: BoxDecoration(
                    color: AppColors.greenDark,
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Row(
                    children: [
                      Icon(
                        checkIn == null
                            ? Icons.login
                            : Icons.check_circle_outline,
                        size: 15,
                        color: Colors.white,
                      ),
                      const SizedBox(width: 7),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              'Status hari ini',
                              style: TextStyle(
                                fontSize: 8.5,
                                fontWeight: FontWeight.w600,
                                color: Colors.white.withValues(alpha: 0.72),
                              ),
                            ),
                            const SizedBox(height: 1),
                            Text(
                              checkIn == null
                                  ? 'Belum Presensi Masuk'
                                  : 'Presensi Masuk, '
                                        '${_shortDate(checkIn.workDate ?? checkIn.timestampServer)} '
                                        '(${_timeText(checkIn.timestampServer.toLocal())})',
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                fontSize: 11,
                                height: 1.25,
                                fontWeight: FontWeight.w700,
                                color: Colors.white,
                                fontFeatures: tabularFigures,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _serviceGrid() {
    final services = _services();
    final visible = _showMoreServices ? services : services.take(4).toList();
    return Container(
      padding: const EdgeInsets.fromLTRB(10, 12, 10, 6),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.line),
      ),
      child: Column(
        children: [
          GridView.builder(
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            padding: EdgeInsets.zero,
            gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
              crossAxisCount: 4,
              mainAxisExtent: 80,
              crossAxisSpacing: 4,
              mainAxisSpacing: 4,
            ),
            itemCount: visible.length,
            itemBuilder: (context, index) => _serviceTile(visible[index]),
          ),
          TextButton.icon(
            key: const Key('home-services-toggle'),
            onPressed: () =>
                setState(() => _showMoreServices = !_showMoreServices),
            style: TextButton.styleFrom(
              minimumSize: const Size(0, 32),
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
              textStyle: const TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.w700,
              ),
            ),
            icon: Icon(
              _showMoreServices ? Icons.expand_less : Icons.expand_more,
              size: 17,
            ),
            label: Text(_showMoreServices ? 'Tutup' : 'Lainnya'),
          ),
        ],
      ),
    );
  }

  Widget _serviceTile(_ServiceItem item) {
    return InkWell(
      key: Key(item.key),
      borderRadius: BorderRadius.circular(10),
      onTap: item.onTap,
      child: Column(
        mainAxisAlignment: MainAxisAlignment.start,
        children: [
          Container(
            width: 44,
            height: 44,
            decoration: BoxDecoration(
              color: AppColors.tableHead,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: AppColors.line),
            ),
            child: Icon(item.icon, size: 20, color: AppColors.ink),
          ),
          const SizedBox(height: 5),
          Text(
            item.label,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            textAlign: TextAlign.center,
            style: const TextStyle(
              fontSize: 9.5,
              height: 1.15,
              fontWeight: FontWeight.w600,
              color: AppColors.ink,
            ),
          ),
        ],
      ),
    );
  }

  List<_ServiceItem> _services() {
    return [
      _ServiceItem(
        key: 'service-lembur',
        label: 'Lembur',
        icon: Icons.more_time_outlined,
        onTap: () => _openPage(EmployeeRequestsScreen(auth: widget.auth)),
      ),
      _ServiceItem(
        key: 'service-cuti',
        label: 'Cuti',
        icon: Icons.beach_access_outlined,
        onTap: () => _openPage(LeaveFormScreen(auth: widget.auth)),
      ),
      _ServiceItem(
        key: 'service-izin',
        label: 'Izin',
        icon: Icons.badge_outlined,
        onTap: () => _openPage(WorkPermitFormScreen(auth: widget.auth)),
      ),
      _ServiceItem(
        key: 'service-proyeksi',
        label: 'Proyeksi',
        icon: Icons.track_changes_outlined,
        onTap: () => _openPage(WorkProjectionsScreen(auth: widget.auth)),
      ),
      _ServiceItem(
        key: 'service-kunjungan',
        label: 'Kunjungan Klien',
        icon: Icons.location_on_outlined,
        onTap: () => _openPage(ClientVisitsScreen(auth: widget.auth)),
      ),
      _ServiceItem(
        key: 'service-kalender',
        label: 'Kalender Libur',
        icon: Icons.event_busy_outlined,
        onTap: () => _openPage(ScheduleScreen(auth: widget.auth)),
      ),
      _ServiceItem(
        key: 'service-slip',
        label: 'Slip Gaji',
        icon: Icons.receipt_long_outlined,
        onTap: () => _openPage(PayslipsScreen(auth: widget.auth)),
      ),
      _ServiceItem(
        key: 'service-surat-peringatan',
        label: 'Surat Peringatan',
        icon: Icons.gpp_maybe_outlined,
        onTap: () => _openPage(WarningLettersScreen(auth: widget.auth)),
      ),
      _ServiceItem(
        key: 'service-revisi',
        label: 'Revisi Presensi',
        icon: Icons.edit_calendar_outlined,
        onTap: _openCorrection,
      ),
      _ServiceItem(
        key: 'service-broadcast',
        label: 'Broadcast',
        icon: Icons.campaign_outlined,
        onTap: () => _openPage(BroadcastsScreen(auth: widget.auth)),
      ),
      _ServiceItem(
        key: 'service-profil',
        label: 'Profil Saya',
        icon: Icons.person_outline_rounded,
        onTap: _openProfile,
      ),
    ];
  }

  Widget _attendanceSummaryBanner() {
    return Material(
      key: const Key('home-attendance-summary'),
      color: AppColors.surface,
      borderRadius: BorderRadius.circular(12),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap:
            widget.onOpenActivity ??
            () => _openPage(HistoryScreen(auth: widget.auth)),
        child: Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: AppColors.line),
          ),
          child: Row(
            children: [
              Container(
                width: 38,
                height: 38,
                decoration: BoxDecoration(
                  color: AppColors.greenSoft,
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(color: AppColors.greenLine),
                ),
                child: const Icon(
                  Icons.insert_chart_outlined,
                  size: 19,
                  color: AppColors.greenDark,
                ),
              ),
              const SizedBox(width: 10),
              const Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Ringkasan Kehadiran',
                      style: TextStyle(
                        fontSize: 12.5,
                        fontWeight: FontWeight.w800,
                        color: AppColors.ink,
                      ),
                    ),
                    SizedBox(height: 2),
                    Text(
                      'Periksa kinerja rekap Anda bulan ini',
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        fontSize: 10.5,
                        height: 1.3,
                        color: AppColors.muted,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              Container(
                width: 26,
                height: 26,
                decoration: const BoxDecoration(
                  color: AppColors.green,
                  shape: BoxShape.circle,
                ),
                child: const Icon(
                  Icons.arrow_outward,
                  size: 14,
                  color: Colors.white,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildStickyCta() {
    final action = _nextAction;
    final busy = _locating || _submitting;
    final blocked = _deviceBlocked;
    final label = blocked
        ? 'Menunggu persetujuan perangkat'
        : action == null
        ? 'Presensi hari ini selesai'
        : _locating
        ? 'Mengambil lokasi…'
        : _submitting
        ? 'Mengirim presensi…'
        : action == 'CHECK_IN'
        ? 'Presensi Masuk'
        : 'Presensi Keluar';
    return Container(
      decoration: const BoxDecoration(
        color: AppColors.surface,
        border: Border(top: BorderSide(color: AppColors.line)),
      ),
      padding: const EdgeInsets.fromLTRB(14, 7, 14, 9),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Row(
            children: [
              Expanded(
                child: InkWell(
                  key: const Key('home-mode-select'),
                  borderRadius: BorderRadius.circular(8),
                  onTap: busy ? null : _openModeSheet,
                  child: Padding(
                    padding: const EdgeInsets.symmetric(vertical: 3),
                    child: Row(
                      children: [
                        Icon(
                          _outOfTown
                              ? Icons.flight_takeoff
                              : Icons.business_outlined,
                          size: 15,
                          color: AppColors.muted,
                        ),
                        const SizedBox(width: 6),
                        Flexible(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              const Text(
                                'Mode presensi',
                                style: TextStyle(
                                  fontSize: 8.5,
                                  color: AppColors.muted,
                                ),
                              ),
                              Text(
                                _outOfTown ? 'Dinas luar kota' : 'Kantor',
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(
                                  fontSize: 10.5,
                                  fontWeight: FontWeight.w700,
                                  color: AppColors.ink,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 8),
              _locationPill(),
            ],
          ),
          const SizedBox(height: 6),
          SizedBox(
            height: 50,
            child: FilledButton.icon(
              key: const Key('attendance-submit'),
              style: FilledButton.styleFrom(
                backgroundColor: action == 'CHECK_OUT'
                    ? AppColors.crimson
                    : AppColors.green,
                foregroundColor: Colors.white,
                disabledBackgroundColor: AppColors.line,
                disabledForegroundColor: AppColors.muted,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(999),
                ),
                textStyle: const TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w800,
                ),
              ),
              onPressed: action == null || busy || blocked
                  ? null
                  : _startAttendance,
              icon: busy
                  ? const SizedBox.square(
                      dimension: 16,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: Colors.white,
                      ),
                    )
                  : Icon(
                      action == 'CHECK_OUT' ? Icons.logout : Icons.login,
                      size: 18,
                    ),
              label: Text(label, maxLines: 1, overflow: TextOverflow.ellipsis),
            ),
          ),
        ],
      ),
    );
  }

  Widget _locationPill() {
    final positive = _locationPositive;
    final neutral = _gps == null && !_wfhToday;
    final foreground = neutral
        ? AppColors.muted
        : positive
        ? AppColors.greenDark
        : AppColors.yellowInk;
    final distance = _distance;
    return ConstrainedBox(
      constraints: const BoxConstraints(maxWidth: 156),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
        decoration: BoxDecoration(
          color: neutral
              ? AppColors.tableHead
              : positive
              ? AppColors.greenSoft
              : AppColors.yellowSoft,
          borderRadius: BorderRadius.circular(999),
          border: Border.all(
            color: neutral
                ? AppColors.line
                : positive
                ? AppColors.greenLine
                : AppColors.yellowLine,
          ),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 5,
              height: 5,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: neutral
                    ? AppColors.muted
                    : positive
                    ? AppColors.green
                    : AppColors.amber,
              ),
            ),
            const SizedBox(width: 5),
            Flexible(
              child: Text(
                [
                  _locationLabel,
                  if (distance != null) '${distance.toStringAsFixed(0)} m',
                ].join(' · '),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontSize: 9.5,
                  fontWeight: FontWeight.w700,
                  color: foreground,
                  fontFeatures: tabularFigures,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _offlineBanner() {
    return Container(
      key: const Key('offline-queue-banner'),
      padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 9),
      decoration: BoxDecoration(
        color: AppColors.yellowSoft,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppColors.yellowLine),
      ),
      child: Row(
        children: [
          const Icon(Icons.cloud_off, size: 16, color: AppColors.yellowInk),
          const SizedBox(width: 7),
          Expanded(
            child: Text(
              '$_pendingOffline absensi menunggu sinkronisasi',
              style: const TextStyle(
                fontSize: 11.5,
                fontWeight: FontWeight.w600,
                color: AppColors.yellowInk,
                fontFeatures: tabularFigures,
              ),
            ),
          ),
          TextButton(
            key: const Key('sync-offline-now'),
            onPressed: _syncingOffline ? null : _syncOffline,
            style: TextButton.styleFrom(
              minimumSize: const Size(0, 30),
              padding: const EdgeInsets.symmetric(horizontal: 6),
              foregroundColor: AppColors.yellowInk,
              textStyle: const TextStyle(
                fontSize: 10.5,
                fontWeight: FontWeight.w700,
              ),
            ),
            child: Text(_syncingOffline ? 'Menyinkronkan…' : 'Sinkronkan'),
          ),
        ],
      ),
    );
  }

  Widget _buildWarningBanner(WarningLetter item) {
    return Material(
      key: const Key('home-warning-banner'),
      color: AppColors.dangerSoft,
      borderRadius: BorderRadius.circular(10),
      child: InkWell(
        borderRadius: BorderRadius.circular(10),
        onTap: _openWarnings,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 9),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(10),
            border: Border.all(color: AppColors.danger.withValues(alpha: 0.28)),
          ),
          child: Row(
            children: [
              const Icon(
                Icons.gpp_maybe_outlined,
                size: 16,
                color: AppColors.danger,
              ),
              const SizedBox(width: 7),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      '${item.level} aktif · ${item.letterNumber}',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: 11,
                        fontWeight: FontWeight.w800,
                        color: AppColors.danger,
                        fontFeatures: tabularFigures,
                      ),
                    ),
                    const SizedBox(height: 1),
                    Text(
                      item.isAcknowledged
                          ? 'Surat peringatan sudah dikonfirmasi dibaca.'
                          : 'Buka profil untuk membaca dan mengonfirmasi surat.',
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: 10,
                        height: 1.3,
                        color: AppColors.muted,
                      ),
                    ),
                  ],
                ),
              ),
              const Icon(Icons.chevron_right, size: 17, color: AppColors.muted),
            ],
          ),
        ),
      ),
    );
  }

  Widget _deviceBanner(MemberDevice device) {
    final revoked = device.isRevoked;
    return Container(
      key: const Key('device-pending-banner'),
      padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 9),
      decoration: BoxDecoration(
        color: revoked ? AppColors.dangerSoft : AppColors.yellowSoft,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(
          color: revoked
              ? AppColors.danger.withValues(alpha: 0.3)
              : AppColors.yellowLine,
        ),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(
            revoked ? Icons.phonelink_erase : Icons.verified_user_outlined,
            size: 16,
            color: revoked ? AppColors.danger : AppColors.yellowInk,
          ),
          const SizedBox(width: 7),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  revoked
                      ? 'Perangkat sudah direset Admin HR'
                      : 'Perangkat menunggu persetujuan Admin HR',
                  style: TextStyle(
                    fontSize: 11.5,
                    fontWeight: FontWeight.w700,
                    color: revoked ? AppColors.danger : AppColors.yellowInk,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  '${device.deviceName} · ${device.platform}. Presensi diblokir '
                  'sampai perangkat disetujui.',
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 10,
                    height: 1.35,
                    color: revoked ? AppColors.danger : AppColors.muted,
                  ),
                ),
                const SizedBox(height: 6),
                OutlinedButton.icon(
                  key: const Key('device-check-again'),
                  onPressed: _refreshingDevice ? null : _refreshDevice,
                  style: OutlinedButton.styleFrom(
                    minimumSize: const Size(0, 34),
                    padding: const EdgeInsets.symmetric(horizontal: 10),
                    textStyle: const TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  icon: _refreshingDevice
                      ? const SizedBox.square(
                          dimension: 13,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.refresh, size: 15),
                  label: Text(
                    _refreshingDevice ? 'Memeriksa…' : 'Cek Status Ulang',
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _modeButton({
    required Key key,
    required String label,
    required IconData icon,
    required bool selected,
    required VoidCallback onTap,
  }) {
    return Expanded(
      child: Material(
        color: selected ? AppColors.greenSoft : AppColors.surface,
        borderRadius: BorderRadius.circular(9),
        child: InkWell(
          key: key,
          borderRadius: BorderRadius.circular(9),
          onTap: onTap,
          child: Container(
            padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 8),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(9),
              border: Border.all(
                color: selected ? AppColors.greenLine : AppColors.line,
              ),
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(
                  icon,
                  size: 15,
                  color: selected ? AppColors.greenDark : AppColors.muted,
                ),
                const SizedBox(width: 6),
                Flexible(
                  child: Text(
                    label,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      fontSize: 11.5,
                      fontWeight: FontWeight.w700,
                      color: selected ? AppColors.greenDark : AppColors.muted,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
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
        !_outOfTown &&
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
      ...warnings.expand((widget) => [widget, const SizedBox(height: 8)]),
    ];
  }

  Widget _warning({
    required Key key,
    required IconData icon,
    required String text,
  }) {
    return Container(
      key: key,
      padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 8),
      decoration: BoxDecoration(
        color: AppColors.dangerSoft,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: AppColors.danger.withValues(alpha: 0.22)),
      ),
      child: Row(
        children: [
          Icon(icon, size: 15, color: AppColors.danger),
          const SizedBox(width: 7),
          Expanded(
            child: Text(
              text,
              style: const TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.w500,
                color: AppColors.danger,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _ServiceItem {
  const _ServiceItem({
    required this.key,
    required this.label,
    required this.icon,
    required this.onTap,
  });

  final String key;
  final String label;
  final IconData icon;
  final VoidCallback onTap;
}
