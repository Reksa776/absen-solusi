import 'package:material_ui/material_ui.dart';

import '../api/api_client.dart';
import '../models/office_location.dart';
import '../services/app_update_service.dart';
import '../services/auth_service.dart';
import '../services/offline_attendance_queue.dart';
import '../theme/app_theme.dart';
import '../widgets/update_dialog.dart';

/// Tab Profil: identitas, kantor & shift, antrean offline, versi aplikasi,
/// dan tombol keluar.
class ProfileScreen extends StatefulWidget {
  const ProfileScreen({
    super.key,
    required this.auth,
    this.updateService,
    this.offlineQueue,
  });

  final AuthService auth;
  final AppUpdateService? updateService;
  final OfflineAttendanceQueue? offlineQueue;

  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  late final AppUpdateService _updates =
      widget.updateService ?? AppUpdateService();
  late final OfflineAttendanceQueue _queue =
      widget.offlineQueue ?? OfflineAttendanceQueue();

  OfficeLocation? _office;
  InstalledAppInfo _installed = InstalledAppInfo.unknown;
  int _pending = 0;
  bool _loading = true;
  bool _checking = false;
  bool _syncing = false;
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

    final installed = await _updates.installed();
    final pending = await _queue.count();
    if (!mounted) return;
    setState(() {
      _installed = installed;
      _pending = pending;
    });
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
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(error.message)));
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Tidak dapat memeriksa pembaruan. Periksa koneksi Anda.'),
        ),
      );
    } finally {
      if (mounted) setState(() => _checking = false);
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
    return SafeArea(
      bottom: false,
      child: RefreshIndicator(
        color: AppColors.green,
        onRefresh: _load,
        child: SingleChildScrollView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 28),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
            const Text(
              'Profil',
              style: TextStyle(
                fontSize: 23,
                fontWeight: FontWeight.w800,
                letterSpacing: -0.5,
                color: AppColors.ink,
              ),
            ),
            const SizedBox(height: 2),
            Text(
              widget.auth.activeWorkspace?.name ?? 'Akun karyawan',
              style: const TextStyle(fontSize: 12, color: AppColors.muted),
            ),
            const SizedBox(height: 14),
            _identityCard(),
            const SizedBox(height: 12),
            _officeCard(),
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
                office == null ? 'Belum disetel' : 'Radius ${office.radiusMeters.toStringAsFixed(0)} m',
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
                padding: const EdgeInsets.symmetric(
                  horizontal: 9,
                  vertical: 4,
                ),
                decoration: BoxDecoration(
                  color: pending
                      ? AppColors.yellowSoft
                      : AppColors.greenSoft,
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
              label: Text(
                _checking ? 'Memeriksa…' : 'Cek Update Aplikasi',
              ),
            ),
          ),
        ],
      ),
    );
  }
}
