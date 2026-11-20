import 'dart:io';

import 'package:material_ui/material_ui.dart';
import 'package:open_filex/open_filex.dart';

import '../services/app_update_service.dart';
import '../theme/app_theme.dart';

class UpdateAvailableDialog extends StatefulWidget {
  const UpdateAvailableDialog({
    super.key,
    required this.service,
    required this.result,
  });

  final AppUpdateService service;
  final AppUpdateResult result;

  static Future<void> show(
    BuildContext context, {
    required AppUpdateService service,
    required AppUpdateResult result,
  }) {
    return showDialog<void>(
      context: context,
      barrierDismissible: !result.info.forceUpdate,
      builder: (_) => UpdateAvailableDialog(service: service, result: result),
    );
  }

  @override
  State<UpdateAvailableDialog> createState() => _UpdateAvailableDialogState();
}

class _UpdateAvailableDialogState extends State<UpdateAvailableDialog> {
  double? _progress;
  File? _file;
  bool _downloading = false;
  String? _error;

  AppVersionInfo get _info => widget.result.info;
  InstalledAppInfo get _installed => widget.result.installed;

  Future<void> _start() async {
    final existing = _file;
    if (existing != null) {
      await _openInstaller(existing);
      return;
    }
    setState(() {
      _downloading = true;
      _error = null;
      _progress = 0;
    });
    try {
      final file = await widget.service.download(
        _info,
        onProgress: (value) {
          if (!mounted) return;
          setState(() => _progress = value);
        },
      );
      if (!mounted) return;
      setState(() => _file = file);
      await _openInstaller(file);
    } on AppUpdateException catch (error) {
      if (!mounted) return;
      setState(() => _error = error.message);
    } catch (_) {
      if (!mounted) return;
      setState(() => _error = 'Unduhan gagal. Periksa koneksi lalu coba lagi.');
    } finally {
      if (mounted) {
        setState(() {
          _downloading = false;
          _progress = _file == null ? null : _progress;
        });
      }
    }
  }

  Future<void> _openInstaller(File file) async {
    final result = await OpenFilex.open(
      file.path,
      type: 'application/vnd.android.package-archive',
    );
    if (result.type == ResultType.done || !mounted) return;
    setState(() {
      _error =
          'Installer tidak dapat dibuka. Aktifkan izin “Pasang aplikasi tak dikenal” untuk Absensi, lalu coba lagi.';
    });
  }

  @override
  Widget build(BuildContext context) {
    final forced = _info.forceUpdate;
    final percent = ((_progress ?? 0) * 100).clamp(0, 100).round();

    return PopScope(
      canPop: !forced && !_downloading,
      child: AlertDialog(
        backgroundColor: AppColors.surface,
        surfaceTintColor: Colors.transparent,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
          side: const BorderSide(color: AppColors.line),
        ),
        titlePadding: const EdgeInsets.fromLTRB(20, 20, 20, 6),
        contentPadding: const EdgeInsets.fromLTRB(20, 0, 20, 8),
        actionsPadding: const EdgeInsets.fromLTRB(12, 0, 16, 14),
        title: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
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
                Icons.system_update_alt,
                size: 20,
                color: AppColors.greenDark,
              ),
            ),
            const SizedBox(width: 12),
            const Expanded(
              child: Text(
                'Pembaruan tersedia',
                style: TextStyle(
                  fontSize: 17,
                  fontWeight: FontWeight.w800,
                  letterSpacing: -0.3,
                  color: AppColors.ink,
                ),
              ),
            ),
          ],
        ),
        content: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 420),
          child: SingleChildScrollView(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  'Versi ${_info.latestVersion} · build ${_info.buildNumber}',
                  key: const Key('update-version'),
                  style: const TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w700,
                    color: AppColors.ink,
                    fontFeatures: tabularFigures,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  'Terpasang: ${_installed.version} · build ${_installed.buildNumber}',
                  style: const TextStyle(
                    fontSize: 11.5,
                    color: AppColors.muted,
                    fontFeatures: tabularFigures,
                  ),
                ),
                if (forced) ...[
                  const SizedBox(height: 12),
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 10,
                      vertical: 7,
                    ),
                    decoration: BoxDecoration(
                      color: AppColors.yellowSoft,
                      borderRadius: BorderRadius.circular(8),
                      border: Border.all(color: AppColors.yellowLine),
                    ),
                    child: const Row(
                      children: [
                        Icon(
                          Icons.lock_clock,
                          size: 14,
                          color: AppColors.yellowInk,
                        ),
                        SizedBox(width: 7),
                        Expanded(
                          child: Text(
                            'Pembaruan ini wajib dipasang untuk melanjutkan absensi.',
                            style: TextStyle(
                              fontSize: 11.5,
                              fontWeight: FontWeight.w600,
                              color: AppColors.yellowInk,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
                if (_info.changelog.isNotEmpty) ...[
                  const SizedBox(height: 12),
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: AppColors.canvas,
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(color: AppColors.line),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'Yang baru',
                          style: TextStyle(
                            fontSize: 10.5,
                            fontWeight: FontWeight.w700,
                            letterSpacing: 0.6,
                            color: AppColors.muted,
                          ),
                        ),
                        const SizedBox(height: 5),
                        Text(
                          _info.changelog,
                          style: const TextStyle(
                            fontSize: 12.5,
                            height: 1.45,
                            color: AppColors.ink,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
                if (_downloading || _progress != null) ...[
                  const SizedBox(height: 14),
                  ClipRRect(
                    borderRadius: BorderRadius.circular(999),
                    child: LinearProgressIndicator(
                      key: const Key('update-progress'),
                      value: _downloading
                          ? (_progress ?? 0).clamp(0.0, 1.0)
                          : 1,
                      minHeight: 6,
                      backgroundColor: AppColors.line,
                      color: AppColors.green,
                    ),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    _downloading
                        ? 'Mengunduh $percent%'
                        : 'Unduhan selesai, membuka installer…',
                    style: const TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w600,
                      color: AppColors.muted,
                      fontFeatures: tabularFigures,
                    ),
                  ),
                ],
                if (_error != null) ...[
                  const SizedBox(height: 12),
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Icon(
                        Icons.error_outline,
                        size: 15,
                        color: AppColors.danger,
                      ),
                      const SizedBox(width: 7),
                      Expanded(
                        child: Text(
                          _error!,
                          key: const Key('update-error'),
                          style: const TextStyle(
                            fontSize: 11.5,
                            height: 1.4,
                            color: AppColors.danger,
                          ),
                        ),
                      ),
                    ],
                  ),
                ],
              ],
            ),
          ),
        ),
        actions: [
          if (!forced)
            TextButton(
              key: const Key('update-later'),
              onPressed: _downloading ? null : () => Navigator.of(context).pop(),
              child: const Text('Nanti'),
            ),
          FilledButton(
            key: const Key('update-now'),
            style: FilledButton.styleFrom(
              backgroundColor: AppColors.green,
              foregroundColor: Colors.white,
              minimumSize: const Size(148, 44),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(10),
              ),
            ),
            onPressed: _downloading ? null : _start,
            child: _downloading
                ? const SizedBox.square(
                    dimension: 16,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: Colors.white,
                    ),
                  )
                : Text(_file == null ? 'Update Sekarang' : 'Buka Installer'),
          ),
        ],
      ),
    );
  }
}
