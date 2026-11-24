import 'dart:async';
import 'dart:typed_data';

import 'package:material_ui/material_ui.dart';

import '../api/api_client.dart';
import '../models/office_location.dart';
import '../models/member_device.dart';
import '../models/organization.dart';
import '../models/profile_photo.dart';
import '../models/schedule.dart';
import '../models/warning_letter.dart';
import '../services/app_update_service.dart';
import '../services/attendance_reminder_service.dart';
import '../services/auth_service.dart';
import '../services/offline_attendance_queue.dart';
import '../theme/app_theme.dart';
import '../widgets/update_dialog.dart';
import 'camera_screen.dart';
import 'payslips_screen.dart';
import 'schedule_screen.dart';
import 'warning_letters_screen.dart';

/// Tab Profil: identitas, kantor & shift, jadwal kerja, pengingat absensi,
/// antrean offline, versi aplikasi, dan tombol keluar.
class ProfileScreen extends StatefulWidget {
  const ProfileScreen({
    super.key,
    required this.auth,
    this.updateService,
    this.offlineQueue,
    this.reminderService,
    this.standalone = false,
  });

  final AuthService auth;
  final AppUpdateService? updateService;
  final OfflineAttendanceQueue? offlineQueue;
  final AttendanceReminderService? reminderService;

  /// True saat dibuka dari avatar Beranda: tampilkan AppBar dengan tombol kembali.
  final bool standalone;

  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  late final AppUpdateService _updates =
      widget.updateService ?? AppUpdateService();
  late final OfflineAttendanceQueue _queue =
      widget.offlineQueue ?? OfflineAttendanceQueue();
  late final AttendanceReminderService _reminders =
      widget.reminderService ?? AttendanceReminderService();

  OfficeLocation? _office;
  OrganizationProfile? _organization;
  MemberDevice? _device;
  ProfilePhotoStatus? _photo;
  Uint8List? _photoBytes;
  WorkSchedule? _schedule;
  List<WarningLetter> _warnings = const [];
  String? _acknowledgingWarningId;
  ReminderSettings _reminder = const ReminderSettings();
  InstalledAppInfo _installed = InstalledAppInfo.unknown;
  int _pending = 0;
  bool _loading = true;
  bool _checking = false;
  bool _syncing = false;
  bool _savingReminder = false;
  bool _refreshingDevice = false;
  String? _officeError;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _officeError = null;
    });
    // Detail kantor dimuat lebih dulu agar kartu lokasi tidak menunggu
    // pembacaan versi aplikasi atau antrean offline.
    try {
      final offices = await widget.auth.api.activeOffices();
      if (!mounted) return;
      setState(() {
        _office = offices.isEmpty ? null : offices.first;
        _loading = false;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _officeError = messageForApiError(error);
        _loading = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _officeError = 'Detail kantor tidak dapat dimuat.';
        _loading = false;
      });
    }

    try {
      final organization = await widget.auth.api.organizationProfile();
      if (!mounted) return;
      setState(() => _organization = organization);
    } catch (_) {
      // Kartu organisasi menampilkan status kosong bila endpoint gagal.
    }

    try {
      final photo = await widget.auth.api.myProfilePhoto();
      Uint8List? bytes;
      if (photo.hasPhoto) {
        try {
          bytes = await widget.auth.api.profilePhotoBytes(photo.photoUrl!);
        } catch (_) {
          bytes = null;
        }
      }
      if (!mounted) return;
      setState(() {
        _photo = photo;
        _photoBytes = bytes;
      });
    } catch (_) {
      // Foto profil bersifat opsional; kartu menampilkan status kosong.
    }

    try {
      final schedule = await widget.auth.api.workSchedule();
      if (!mounted) return;
      setState(() => _schedule = schedule);
    } catch (_) {
      // Kartu jadwal menampilkan status kosong bila endpoint gagal.
    }

    try {
      final device = await widget.auth.api.myDevice();
      if (mounted) setState(() => _device = device);
    } catch (_) {
      // Status perangkat bersifat informatif; server tetap menolak absensi.
    }

    try {
      final warnings = await widget.auth.api.myWarningLetters();
      if (mounted) setState(() => _warnings = warnings);
    } catch (_) {
      // Kartu SP tidak boleh menghalangi profil bila endpoint gagal.
    }

    final installed = await _updates.installed();
    final pending = await _queue.count();
    final reminder = await _reminders.loadSettings();
    if (!mounted) return;
    setState(() {
      _installed = installed;
      _pending = pending;
      _reminder = reminder;
    });
  }

  Future<void> _syncReminders() async {
    final schedule = _schedule;
    if (schedule == null) return;
    var checkedIn = false;
    var checkedOut = false;
    try {
      final now = DateTime.now();
      final logs = await widget.auth.api.attendanceHistory();
      for (final log in logs) {
        final local = log.timestampServer.toLocal();
        if (local.year != now.year ||
            local.month != now.month ||
            local.day != now.day) {
          continue;
        }
        if (log.isCheckIn) checkedIn = true;
        if (log.isCheckOut) checkedOut = true;
      }
    } catch (_) {
      // Tanpa data absensi hari ini, pengingat tetap dijadwalkan.
    }
    await _reminders.sync(
      schedule: schedule,
      settings: _reminder,
      checkedInToday: checkedIn,
      checkedOutToday: checkedOut,
    );
  }

  Future<void> _setReminderEnabled(bool enabled) async {
    if (_savingReminder) return;
    final next = _reminder.copyWith(enabled: enabled);
    setState(() {
      _reminder = next;
      _savingReminder = true;
    });
    try {
      await _reminders.saveSettings(next);
      await _syncReminders();
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Pengaturan pengingat gagal disimpan.')),
      );
    } finally {
      if (mounted) setState(() => _savingReminder = false);
    }
  }

  Future<void> _setReminderMinutes(int? minutes) async {
    if (minutes == null || _savingReminder) return;
    final next = _reminder.copyWith(minutesBefore: minutes);
    setState(() {
      _reminder = next;
      _savingReminder = true;
    });
    try {
      await _reminders.saveSettings(next);
      await _syncReminders();
    } finally {
      if (mounted) setState(() => _savingReminder = false);
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

  Future<void> _checkForUpdate() async {
    if (_checking) return;
    setState(() => _checking = true);
    try {
      final result = await _updates.checkForUpdate();
      if (!mounted) return;
      if (result == null) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              'Aplikasi sudah versi terbaru (${_installed.version}).',
            ),
          ),
        );
        return;
      }
      await UpdateAvailableDialog.show(
        context,
        service: _updates,
        result: result,
      );
    } on AppUpdateException catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(error.message)));
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            'Tidak dapat memeriksa pembaruan. Periksa koneksi Anda.',
          ),
        ),
      );
    } finally {
      if (mounted) setState(() => _checking = false);
    }
  }

  Future<void> _uploadProfilePhoto() async {
    final bytes = await Navigator.of(context).push<Uint8List>(
      MaterialPageRoute<Uint8List>(
        builder: (_) => const CameraScreen(insideGeofence: true, wfh: true),
      ),
    );
    if (bytes == null || !mounted) return;
    setState(() => _photo = null);
    try {
      final status = await widget.auth.api.uploadProfilePhoto(bytes);
      if (!mounted) return;
      setState(() {
        _photo = status;
        _photoBytes = bytes;
      });
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Foto profil terkirim dan menunggu persetujuan admin.'),
        ),
      );
    } on ApiException catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(messageForApiError(error))));
      unawaited(_load());
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Foto profil gagal diunggah.')),
      );
      unawaited(_load());
    }
  }

  Future<void> _syncOffline() async {
    if (_syncing) return;
    setState(() => _syncing = true);
    try {
      final synced = await _queue.sync(
        (entry) => widget.auth.api.syncOfflineAttendance(entry),
      );
      final pending = await _queue.count();
      if (!mounted) return;
      setState(() => _pending = pending);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            synced > 0
                ? '$synced absensi offline berhasil disinkronkan.'
                : 'Belum ada absensi yang dapat disinkronkan.',
          ),
        ),
      );
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Sinkronisasi gagal. Periksa koneksi.')),
      );
    } finally {
      if (mounted) setState(() => _syncing = false);
    }
  }

  String get _name => widget.auth.user?.name ?? 'Pengguna';
  String get _email => widget.auth.user?.email ?? '';

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

  String get _roleLabel {
    final keys = widget.auth.activeWorkspace?.roleKeys ?? const <String>[];
    if (keys.contains('WORKSPACE_OWNER')) return 'Owner';
    if (keys.contains('ADMIN')) return 'Admin';
    if (keys.contains('HR')) return 'HR';
    if (keys.contains('VIEWER')) return 'Karyawan';
    return 'Anggota workspace';
  }

  @override
  Widget build(BuildContext context) {
    final content = RefreshIndicator(
      color: AppColors.green,
      onRefresh: _load,
      child: SingleChildScrollView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 28),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (!widget.standalone)
              const Text(
                'Profil',
                style: TextStyle(
                  fontSize: 23,
                  fontWeight: FontWeight.w800,
                  letterSpacing: -0.5,
                  color: AppColors.ink,
                ),
              ),
            if (!widget.standalone) const SizedBox(height: 2),
            Text(
              widget.auth.activeWorkspace?.name ?? 'Akun karyawan',
              style: const TextStyle(fontSize: 12, color: AppColors.muted),
            ),
            const SizedBox(height: 14),
            _todayScheduleCard(),
            if (_schedule != null) const SizedBox(height: 12),
            _identityCard(),
            if (_warnings.any((row) => row.isActive)) ...[
              const SizedBox(height: 12),
              _warningCard(),
            ],
            const SizedBox(height: 12),
            _photoCard(),
            if (_device != null && _device!.blocksAttendance) ...[
              const SizedBox(height: 12),
              _deviceCard(_device!),
            ],
            const SizedBox(height: 12),
            _officeCard(),
            const SizedBox(height: 12),
            _organizationCard(),
            const SizedBox(height: 12),
            _scheduleCard(),
            const SizedBox(height: 12),
            _payslipCard(),
            const SizedBox(height: 12),
            _reminderCard(),
            const SizedBox(height: 12),
            _offlineCard(),
            const SizedBox(height: 12),
            _versionCard(),
            const SizedBox(height: 16),
            SizedBox(
              height: 50,
              child: OutlinedButton.icon(
                key: const Key('profile-logout'),
                style: OutlinedButton.styleFrom(
                  foregroundColor: AppColors.danger,
                  side: BorderSide(
                    color: AppColors.danger.withValues(alpha: 0.3),
                  ),
                ),
                onPressed: widget.auth.logout,
                icon: const Icon(Icons.logout, size: 18),
                label: const Text('Keluar dari akun'),
              ),
            ),
            if (_loading) ...[
              const SizedBox(height: 16),
              const Center(
                child: SizedBox.square(
                  dimension: 18,
                  child: CircularProgressIndicator(strokeWidth: 2),
                ),
              ),
            ],
          ],
        ),
      ),
    );
    if (!widget.standalone) {
      return SafeArea(bottom: false, child: content);
    }
    return Scaffold(
      backgroundColor: AppColors.canvas,
      appBar: AppBar(title: const Text('Profil & Pengaturan')),
      body: SafeArea(top: false, child: content),
    );
  }

  Future<void> _acknowledgeWarning(WarningLetter item) async {
    setState(() => _acknowledgingWarningId = item.id);
    try {
      final updated = await widget.auth.api.acknowledgeWarningLetter(item.id);
      if (!mounted) return;
      setState(() {
        _warnings = [
          for (final row in _warnings)
            if (row.id == updated.id) updated else row,
        ];
      });
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Konfirmasi baca surat tersimpan.')),
      );
    } on ApiException catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(messageForApiError(error))));
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Konfirmasi gagal disimpan.')),
      );
    } finally {
      if (mounted) setState(() => _acknowledgingWarningId = null);
    }
  }

  Widget _warningCard() {
    final active = _warnings
        .where((row) => row.isActive)
        .toList(growable: false);
    return Container(
      key: const Key('profile-warning-card'),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.dangerSoft,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.danger.withValues(alpha: 0.28)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(
                Icons.gpp_maybe_outlined,
                size: 17,
                color: AppColors.danger,
              ),
              const SizedBox(width: 7),
              const Expanded(
                child: Text(
                  'Surat peringatan aktif',
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w800,
                    color: AppColors.danger,
                  ),
                ),
              ),
              TextButton(
                onPressed: () async {
                  await Navigator.of(context).push(
                    MaterialPageRoute<void>(
                      builder: (_) => WarningLettersScreen(auth: widget.auth),
                    ),
                  );
                  if (mounted) await _load();
                },
                child: const Text('Lihat semua'),
              ),
            ],
          ),
          for (final item in active) ...[
            const Divider(height: 16),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 8,
                    vertical: 3,
                  ),
                  decoration: BoxDecoration(
                    color: AppColors.surface,
                    borderRadius: BorderRadius.circular(999),
                    border: Border.all(
                      color: AppColors.danger.withValues(alpha: 0.25),
                    ),
                  ),
                  child: Text(
                    item.level,
                    style: const TextStyle(
                      fontSize: 10.5,
                      fontWeight: FontWeight.w800,
                      color: AppColors.danger,
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        item.letterNumber,
                        style: const TextStyle(
                          fontSize: 11.5,
                          fontWeight: FontWeight.w700,
                          color: AppColors.ink,
                          fontFeatures: tabularFigures,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        item.violationReason,
                        maxLines: 3,
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
              ],
            ),
            const SizedBox(height: 9),
            if (item.isAcknowledged)
              Text(
                'Sudah dikonfirmasi dibaca',
                style: const TextStyle(
                  fontSize: 10.5,
                  fontWeight: FontWeight.w700,
                  color: AppColors.greenDark,
                ),
              )
            else
              SizedBox(
                height: 42,
                child: FilledButton.icon(
                  key: Key('profile-warning-ack-${item.id}'),
                  onPressed: _acknowledgingWarningId == item.id
                      ? null
                      : () => _acknowledgeWarning(item),
                  icon: _acknowledgingWarningId == item.id
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
        ],
      ),
    );
  }

  Widget _card({required Widget child}) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.line),
      ),
      child: child,
    );
  }

  Widget _todayScheduleCard() {
    final schedule = _schedule;
    if (schedule == null) return const SizedBox.shrink();
    final now = DateTime.now();
    final day = schedule.dayFor(now);
    final holiday = schedule.isHoliday(now);
    final isWorkday = !holiday && (day?.isWorkday ?? false);
    final hours = isWorkday ? day!.hours : 'Libur';
    return Container(
      key: const Key('profile-today-schedule'),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 11),
      decoration: BoxDecoration(
        color: AppColors.yellowSoft,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.yellowLine),
      ),
      child: Row(
        children: [
          const Icon(Icons.schedule, size: 17, color: AppColors.yellowInk),
          const SizedBox(width: 8),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'Jam kerja hari ini',
                  style: TextStyle(
                    fontSize: 10.5,
                    fontWeight: FontWeight.w600,
                    color: AppColors.yellowInk,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  '${schedule.workPatternName} · ${day?.label ?? 'Hari ini'}',
                  style: const TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                    color: AppColors.ink,
                  ),
                ),
              ],
            ),
          ),
          Text(
            hours,
            style: const TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.w800,
              color: AppColors.yellowInk,
              fontFeatures: tabularFigures,
            ),
          ),
        ],
      ),
    );
  }

  Widget _identityCard() {
    return _card(
      child: Row(
        children: [
          Container(
            width: 55,
            height: 55,
            decoration: BoxDecoration(
              color: AppColors.greenSoft,
              shape: BoxShape.circle,
              border: Border.all(color: AppColors.yellow, width: 2),
            ),
            child: Center(
              child: Text(
                _initials,
                style: const TextStyle(
                  fontSize: 19,
                  fontWeight: FontWeight.w800,
                  color: AppColors.greenDark,
                ),
              ),
            ),
          ),
          const SizedBox(width: 13),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  _name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w800,
                    color: AppColors.ink,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  _email,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 11.5,
                    color: AppColors.muted,
                  ),
                ),
                const SizedBox(height: 7),
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 9,
                    vertical: 4,
                  ),
                  decoration: BoxDecoration(
                    color: AppColors.yellowSoft,
                    borderRadius: BorderRadius.circular(999),
                    border: Border.all(color: AppColors.yellowLine),
                  ),
                  child: Text(
                    _roleLabel,
                    style: const TextStyle(
                      fontSize: 10.5,
                      fontWeight: FontWeight.w700,
                      color: AppColors.yellowInk,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _photoCard() {
    final photo = _photo;
    final bytes = _photoBytes;
    final status = photo?.label ?? 'Belum ada foto';
    final pending = photo?.isPending ?? false;
    final rejected = photo?.isRejected ?? false;
    final approved = photo?.isApproved ?? false;
    return _card(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(
                Icons.badge_outlined,
                size: 15,
                color: AppColors.muted,
              ),
              const SizedBox(width: 7),
              const Expanded(
                child: Text(
                  'Foto profil',
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w700,
                    color: AppColors.ink,
                  ),
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(
                  color: approved
                      ? AppColors.greenSoft
                      : rejected
                      ? AppColors.dangerSoft
                      : AppColors.yellowSoft,
                  borderRadius: BorderRadius.circular(999),
                  border: Border.all(
                    color: approved
                        ? AppColors.greenLine
                        : rejected
                        ? AppColors.danger.withValues(alpha: 0.25)
                        : AppColors.yellowLine,
                  ),
                ),
                child: Text(
                  status,
                  key: const Key('profile-photo-status'),
                  style: TextStyle(
                    fontSize: 10,
                    fontWeight: FontWeight.w700,
                    color: approved
                        ? AppColors.greenDark
                        : rejected
                        ? AppColors.danger
                        : AppColors.yellowInk,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              Container(
                width: 64,
                height: 64,
                decoration: BoxDecoration(
                  color: AppColors.tableHead,
                  shape: BoxShape.circle,
                  border: Border.all(color: AppColors.line),
                ),
                clipBehavior: Clip.antiAlias,
                child: bytes == null
                    ? Center(
                        child: Text(
                          _initials,
                          style: const TextStyle(
                            fontSize: 19,
                            fontWeight: FontWeight.w800,
                            color: AppColors.greenDark,
                          ),
                        ),
                      )
                    : Image.memory(bytes, fit: BoxFit.cover),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      pending
                          ? 'Foto baseline menunggu verifikasi admin.'
                          : rejected
                          ? (photo?.rejectionReason ??
                                'Foto ditolak. Unggah foto baru yang jelas.')
                          : approved
                          ? 'Foto baseline sudah diverifikasi.'
                          : 'Unggah foto wajah untuk baseline verifikasi.',
                      style: const TextStyle(
                        fontSize: 11.5,
                        height: 1.4,
                        color: AppColors.muted,
                      ),
                    ),
                    const SizedBox(height: 7),
                    OutlinedButton.icon(
                      key: const Key('profile-upload-photo'),
                      onPressed: pending ? null : _uploadProfilePhoto,
                      icon: const Icon(Icons.photo_camera_outlined, size: 16),
                      label: Text(
                        pending
                            ? 'Menunggu persetujuan'
                            : approved || rejected
                            ? 'Perbarui foto'
                            : 'Ambil foto profil',
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _deviceCard(MemberDevice device) {
    final revoked = device.isRevoked;
    return Container(
      key: const Key('profile-device-banner'),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: revoked ? AppColors.dangerSoft : AppColors.yellowSoft,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(
          color: revoked
              ? AppColors.danger.withValues(alpha: 0.3)
              : AppColors.yellowLine,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(
                revoked ? Icons.phonelink_erase : Icons.verified_user_outlined,
                size: 16,
                color: revoked ? AppColors.danger : AppColors.yellowInk,
              ),
              const SizedBox(width: 7),
              Expanded(
                child: Text(
                  revoked
                      ? 'Perangkat sudah direset Admin HR'
                      : 'Perangkat baru menunggu persetujuan Admin HR',
                  style: TextStyle(
                    fontSize: 12.5,
                    fontWeight: FontWeight.w700,
                    color: revoked ? AppColors.danger : AppColors.yellowInk,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 5),
          Text(
            '${device.deviceName} · ${device.platform}. Check-in dan check-out '
            'diblokir sampai perangkat disetujui.',
            style: TextStyle(
              fontSize: 11,
              height: 1.4,
              color: revoked ? AppColors.danger : AppColors.muted,
            ),
          ),
          const SizedBox(height: 8),
          OutlinedButton.icon(
            key: const Key('profile-device-check-again'),
            onPressed: _refreshingDevice ? null : _refreshDevice,
            icon: _refreshingDevice
                ? const SizedBox.square(
                    dimension: 13,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.refresh, size: 15),
            label: Text(_refreshingDevice ? 'Memeriksa…' : 'Cek Status Ulang'),
          ),
        ],
      ),
    );
  }

  Widget _officeCard() {
    final office = _office;
    return _card(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(
                Icons.business_outlined,
                size: 15,
                color: AppColors.muted,
              ),
              const SizedBox(width: 7),
              const Expanded(
                child: Text(
                  'Kantor & shift',
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w700,
                    color: AppColors.ink,
                  ),
                ),
              ),
              Text(
                office == null
                    ? 'Belum disetel'
                    : 'Radius ${office.radiusMeters.toStringAsFixed(0)} m',
                style: const TextStyle(
                  fontSize: 10.5,
                  fontWeight: FontWeight.w600,
                  color: AppColors.muted,
                  fontFeatures: tabularFigures,
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          _infoRow(
            label: 'Lokasi',
            value: office?.name ?? (_officeError ?? 'Belum ada lokasi aktif'),
          ),
          _infoRow(
            label: 'Shift',
            value: office == null
                ? '—'
                : '${office.workStart}–${office.workEnd}',
            mono: true,
          ),
          _infoRow(
            label: 'Zona waktu',
            value: office?.timezone ?? '—',
            mono: true,
          ),
          _infoRow(
            label: 'Workspace',
            value: widget.auth.activeWorkspace?.name ?? '—',
          ),
        ],
      ),
    );
  }

  Widget _organizationCard() {
    final organization = _organization;
    return _card(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(
                Icons.account_tree_outlined,
                size: 15,
                color: AppColors.muted,
              ),
              const SizedBox(width: 7),
              const Expanded(
                child: Text(
                  'Divisi & jabatan',
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w700,
                    color: AppColors.ink,
                  ),
                ),
              ),
              if (organization?.hasAssignment ?? false)
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 8,
                    vertical: 3,
                  ),
                  decoration: BoxDecoration(
                    color: AppColors.greenSoft,
                    borderRadius: BorderRadius.circular(999),
                    border: Border.all(color: AppColors.greenLine),
                  ),
                  child: const Text(
                    'Ditempatkan',
                    style: TextStyle(
                      fontSize: 10,
                      fontWeight: FontWeight.w700,
                      color: AppColors.greenDark,
                    ),
                  ),
                ),
            ],
          ),
          const SizedBox(height: 10),
          _infoRow(
            label: 'Divisi',
            value: organization?.division?.name ?? 'Belum ditempatkan',
          ),
          _infoRow(
            label: 'Jabatan',
            value: organization?.position?.name ?? 'Belum ditempatkan',
          ),
          const SizedBox(height: 2),
          const Text(
            'Perubahan penempatan dilakukan oleh admin workspace.',
            style: TextStyle(fontSize: 10.5, color: AppColors.muted),
          ),
        ],
      ),
    );
  }

  Widget _scheduleCard() {
    final schedule = _schedule;
    final workdays = schedule == null
        ? const <String>[]
        : schedule.weekly
              .where((day) => day.isWorkday)
              .map((day) => day.label)
              .toList(growable: false);
    return _card(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(
                Icons.calendar_month_outlined,
                size: 15,
                color: AppColors.muted,
              ),
              const SizedBox(width: 7),
              const Expanded(
                child: Text(
                  'Pola kerja minggu ini',
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w700,
                    color: AppColors.ink,
                  ),
                ),
              ),
              if (schedule != null)
                Text(
                  schedule.hours,
                  key: const Key('profile-schedule-hours'),
                  style: const TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w700,
                    color: AppColors.ink,
                    fontFeatures: tabularFigures,
                  ),
                ),
            ],
          ),
          const SizedBox(height: 6),
          Text(
            schedule == null
                ? 'Jadwal kerja belum dapat dimuat dari server.'
                : '${schedule.workPatternName} • '
                      '${workdays.isEmpty ? 'Tidak ada hari kerja' : workdays.join(', ')}',
            style: const TextStyle(
              fontSize: 11.5,
              height: 1.4,
              color: AppColors.muted,
            ),
          ),
          const SizedBox(height: 10),
          SizedBox(
            width: double.infinity,
            child: OutlinedButton.icon(
              key: const Key('profile-schedule'),
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute<void>(
                  builder: (_) => ScheduleScreen(
                    auth: widget.auth,
                    initialSchedule: schedule,
                  ),
                ),
              ),
              icon: const Icon(Icons.event_note_outlined, size: 16),
              label: const Text('Lihat jadwal & hari libur'),
            ),
          ),
        ],
      ),
    );
  }

  Widget _payslipCard() {
    return _card(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(
                Icons.receipt_long_outlined,
                size: 15,
                color: AppColors.muted,
              ),
              const SizedBox(width: 7),
              const Expanded(
                child: Text(
                  'Slip gaji',
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w700,
                    color: AppColors.ink,
                  ),
                ),
              ),
              const Text(
                'FINALIZED / PAID',
                style: TextStyle(
                  fontSize: 9.5,
                  fontWeight: FontWeight.w700,
                  color: AppColors.muted,
                ),
              ),
            ],
          ),
          const SizedBox(height: 6),
          const Text(
            'Lihat rincian penerimaan, potongan, dan take home pay milik Anda.',
            style: TextStyle(
              fontSize: 11.5,
              height: 1.4,
              color: AppColors.muted,
            ),
          ),
          const SizedBox(height: 10),
          SizedBox(
            width: double.infinity,
            child: OutlinedButton.icon(
              key: const Key('profile-payslips'),
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute<void>(
                  builder: (_) => PayslipsScreen(auth: widget.auth),
                ),
              ),
              icon: const Icon(Icons.payments_outlined, size: 16),
              label: const Text('Buka slip gaji'),
            ),
          ),
        ],
      ),
    );
  }

  Widget _reminderCard() {
    return _card(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.alarm, size: 15, color: AppColors.muted),
              const SizedBox(width: 7),
              const Expanded(
                child: Text(
                  'Pengingat Alarm Absensi',
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w700,
                    color: AppColors.ink,
                  ),
                ),
              ),
              Switch(
                key: const Key('profile-reminder-toggle'),
                value: _reminder.enabled,
                onChanged: _savingReminder ? null : _setReminderEnabled,
              ),
            ],
          ),
          const SizedBox(height: 2),
          Text(
            _reminder.enabled
                ? 'Pengingat check-in ${_reminder.minutesBefore} menit sebelum shift '
                      'dan check-out saat shift berakhir. Hari libur dilewati.'
                : 'Pengingat alarm absensi dimatikan.',
            style: const TextStyle(
              fontSize: 11.5,
              height: 1.4,
              color: AppColors.muted,
            ),
          ),
          if (_reminder.enabled) ...[
            const SizedBox(height: 10),
            Row(
              children: [
                const Expanded(
                  child: Text(
                    'Ingatkan sebelum shift',
                    style: TextStyle(
                      fontSize: 11.5,
                      fontWeight: FontWeight.w600,
                      color: AppColors.ink,
                    ),
                  ),
                ),
                DropdownButton<int>(
                  key: const Key('profile-reminder-minutes'),
                  value: _reminder.minutesBefore,
                  underline: const SizedBox.shrink(),
                  style: const TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                    color: AppColors.ink,
                    fontFeatures: tabularFigures,
                  ),
                  items: const [5, 10, 15, 30, 45, 60]
                      .map(
                        (minutes) => DropdownMenuItem<int>(
                          value: minutes,
                          child: Text('$minutes menit'),
                        ),
                      )
                      .toList(growable: false),
                  onChanged: _savingReminder ? null : _setReminderMinutes,
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }

  Widget _infoRow({
    required String label,
    required String value,
    bool mono = false,
  }) {
    return Padding(
      padding: const EdgeInsets.only(top: 8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 92,
            child: Text(
              label,
              style: const TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.w500,
                color: AppColors.muted,
              ),
            ),
          ),
          Expanded(
            child: Text(
              value,
              textAlign: TextAlign.right,
              style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w600,
                color: AppColors.ink,
                fontFeatures: mono ? tabularFigures : null,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _offlineCard() {
    final pending = _pending > 0;
    return _card(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(
                pending ? Icons.cloud_off : Icons.cloud_done_outlined,
                size: 15,
                color: pending ? AppColors.amber : AppColors.green,
              ),
              const SizedBox(width: 7),
              const Expanded(
                child: Text(
                  'Sinkronisasi offline',
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w700,
                    color: AppColors.ink,
                  ),
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
                decoration: BoxDecoration(
                  color: pending ? AppColors.yellowSoft : AppColors.greenSoft,
                  borderRadius: BorderRadius.circular(999),
                  border: Border.all(
                    color: pending ? AppColors.yellowLine : AppColors.greenLine,
                  ),
                ),
                child: Text(
                  pending ? '$_pending tertunda' : 'Tersinkron',
                  key: const Key('profile-offline-status'),
                  style: TextStyle(
                    fontSize: 10.5,
                    fontWeight: FontWeight.w700,
                    color: pending ? AppColors.yellowInk : AppColors.greenDark,
                    fontFeatures: tabularFigures,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 6),
          Text(
            pending
                ? 'Absensi tersimpan di perangkat dan akan dikirim saat koneksi pulih.'
                : 'Semua absensi di perangkat sudah terkirim ke server.',
            style: const TextStyle(
              fontSize: 11.5,
              height: 1.4,
              color: AppColors.muted,
            ),
          ),
          if (pending) ...[
            const SizedBox(height: 10),
            OutlinedButton.icon(
              key: const Key('profile-sync-offline'),
              onPressed: _syncing ? null : _syncOffline,
              icon: _syncing
                  ? const SizedBox.square(
                      dimension: 14,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.sync, size: 16),
              label: Text(_syncing ? 'Menyinkronkan…' : 'Sinkronkan sekarang'),
            ),
          ],
        ],
      ),
    );
  }

  Widget _versionCard() {
    return _card(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(
                Icons.system_update_alt,
                size: 15,
                color: AppColors.muted,
              ),
              const SizedBox(width: 7),
              const Expanded(
                child: Text(
                  'Versi aplikasi',
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w700,
                    color: AppColors.ink,
                  ),
                ),
              ),
              Text(
                'v${_installed.version} (${_installed.buildNumber})',
                key: const Key('profile-app-version'),
                style: const TextStyle(
                  fontSize: 10.5,
                  fontWeight: FontWeight.w600,
                  color: AppColors.muted,
                  fontFeatures: tabularFigures,
                ),
              ),
            ],
          ),
          const SizedBox(height: 6),
          const Text(
            'Periksa rilis terbaru dari server kantor. Pembaruan wajib akan ditandai sebelum dipasang.',
            style: TextStyle(
              fontSize: 11.5,
              height: 1.4,
              color: AppColors.muted,
            ),
          ),
          const SizedBox(height: 10),
          SizedBox(
            width: double.infinity,
            child: OutlinedButton.icon(
              key: const Key('profile-check-update'),
              onPressed: _checking ? null : _checkForUpdate,
              icon: _checking
                  ? const SizedBox.square(
                      dimension: 14,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.refresh, size: 16),
              label: Text(_checking ? 'Memeriksa…' : 'Cek Update Aplikasi'),
            ),
          ),
        ],
      ),
    );
  }
}
