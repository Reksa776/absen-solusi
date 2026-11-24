import 'package:material_ui/material_ui.dart';

import '../services/permission_onboarding_service.dart';
import '../theme/app_theme.dart';

class PermissionOnboardingScreen extends StatefulWidget {
  const PermissionOnboardingScreen({
    super.key,
    required this.service,
    required this.onFinished,
    this.initialStatus,
  });

  final PermissionOnboardingService service;
  final VoidCallback onFinished;
  final PermissionSnapshot? initialStatus;

  @override
  State<PermissionOnboardingScreen> createState() =>
      _PermissionOnboardingScreenState();
}

class _PermissionOnboardingScreenState
    extends State<PermissionOnboardingScreen> {
  late PermissionSnapshot? _status = widget.initialStatus;
  bool _busy = false;

  Future<void> _allowAll() async {
    setState(() => _busy = true);
    final status = await widget.service.requestAll();
    if (!mounted) return;
    setState(() {
      _status = status;
      _busy = false;
    });
    if (status.allGranted) {
      widget.onFinished();
      return;
    }
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text(
          'Sebagian izin belum diberikan. Beberapa fitur presensi mungkin terbatas.',
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final missing = _status?.missing ?? const <String>[];
    return Scaffold(
      backgroundColor: AppColors.canvas,
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(20),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 520),
              child: Container(
                padding: const EdgeInsets.all(20),
                decoration: BoxDecoration(
                  color: AppColors.surface,
                  borderRadius: BorderRadius.circular(14),
                  border: Border.all(color: AppColors.line),
                ),
                child: Column(
                  key: const Key('permission-onboarding'),
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    const Text(
                      'Izin akses aplikasi',
                      style: TextStyle(
                        fontSize: 22,
                        fontWeight: FontWeight.w800,
                        letterSpacing: -0.4,
                        color: AppColors.ink,
                      ),
                    ),
                    const SizedBox(height: 4),
                    const Text(
                      'Izin berikut dipakai hanya untuk presensi dan pengingat. '
                      'Tidak ada akses latar tanpa tindakan Anda.',
                      style: TextStyle(
                        fontSize: 12,
                        height: 1.5,
                        color: AppColors.muted,
                      ),
                    ),
                    const SizedBox(height: 16),
                    const _PermissionRow(
                      icon: Icons.my_location,
                      title: 'Lokasi GPS',
                      description:
                          'Memverifikasi titik kehadiran kantor atau lapangan '
                          'dan menghitung jarak ke geofence.',
                    ),
                    const SizedBox(height: 8),
                    const _PermissionRow(
                      icon: Icons.camera_front_outlined,
                      title: 'Kamera',
                      description:
                          'Mengambil selfie verifikasi wajah saat presensi dan '
                          'foto bukti kunjungan atau izin.',
                    ),
                    const SizedBox(height: 8),
                    const _PermissionRow(
                      icon: Icons.alarm,
                      title: 'Notifikasi & alarm',
                      description:
                          'Mengirim alarm jam masuk/pulang serta status '
                          'persetujuan revisi dan perangkat.',
                    ),
                    if (missing.isNotEmpty) ...[
                      const SizedBox(height: 10),
                      Text(
                        'Belum diberikan: ${missing.join(', ')}.',
                        key: const Key('permission-missing'),
                        style: const TextStyle(
                          fontSize: 11,
                          color: AppColors.danger,
                        ),
                      ),
                    ],
                    const SizedBox(height: 18),
                    SizedBox(
                      height: 46,
                      child: FilledButton(
                        key: const Key('permission-allow-all'),
                        onPressed: _busy ? null : _allowAll,
                        child: Text(
                          _busy ? 'Meminta izin…' : 'Izinkan Semua & Lanjutkan',
                        ),
                      ),
                    ),
                    const SizedBox(height: 8),
                    TextButton(
                      key: const Key('permission-later'),
                      onPressed: _busy ? null : widget.onFinished,
                      child: const Text('Lanjutkan tanpa izin'),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _PermissionRow extends StatelessWidget {
  const _PermissionRow({
    required this.icon,
    required this.title,
    required this.description,
  });

  final IconData icon;
  final String title;
  final String description;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.canvas,
        borderRadius: BorderRadius.circular(11),
        border: Border.all(color: AppColors.line),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 20, color: AppColors.greenDark),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: const TextStyle(
                    fontSize: 12.5,
                    fontWeight: FontWeight.w700,
                    color: AppColors.ink,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  description,
                  style: const TextStyle(
                    fontSize: 11,
                    height: 1.45,
                    color: AppColors.muted,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
