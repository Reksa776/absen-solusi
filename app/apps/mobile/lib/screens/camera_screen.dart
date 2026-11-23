import 'dart:async';

import 'package:camera/camera.dart';
import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';

import '../services/face_verification_service.dart';
import '../theme/app_theme.dart';
import '../widgets/selfie_frame.dart';

class CameraScreen extends StatefulWidget {
  const CameraScreen({
    super.key,
    this.insideGeofence = true,
    this.officeName,
    this.distanceMeters,
    this.wfh = false,
    this.faceVerification,
  });

  /// True bila GPS berada dalam radius kantor (ring hijau), false untuk kuning.
  final bool insideGeofence;

  /// Nama kantor/lokasi aktif yang ditampilkan di atas lingkaran kamera.
  final String? officeName;

  /// Jarak GPS ke kantor dalam meter, bila sudah diketahui.
  final double? distanceMeters;

  /// True bila hari ini bekerja dari rumah (geofence dilewati).
  final bool wfh;

  /// Service verifikasi wajah yang bisa diganti pada widget test.
  final FaceVerificationService? faceVerification;

  @override
  State<CameraScreen> createState() => _CameraScreenState();
}

class _CameraScreenState extends State<CameraScreen> {
  CameraController? _controller;
  Uint8List? _captured;
  FaceVerificationResult? _faceResult;
  bool _verifying = false;
  String? _error;
  bool _taking = false;
  bool _isFront = true;
  late final FaceVerificationService _faceVerification;
  late final bool _ownsFaceVerification;
  int _captureToken = 0;

  @override
  void initState() {
    super.initState();
    _ownsFaceVerification = widget.faceVerification == null;
    _faceVerification = widget.faceVerification ?? FaceVerificationService();
    // Kamera selfie selalu portrait agar preview tidak terpotong/gepeng saat
    // perangkat berputar.
    SystemChrome.setPreferredOrientations(const [DeviceOrientation.portraitUp]);
    _initialize();
  }

  Future<void> _initialize() async {
    try {
      final cameras = await availableCameras();
      if (cameras.isEmpty) {
        setState(() => _error = 'Kamera tidak tersedia di perangkat ini.');
        return;
      }
      // Absensi wajib selfie: pakai kamera depan, fallback ke kamera pertama.
      CameraDescription selected = cameras.first;
      for (final camera in cameras) {
        if (camera.lensDirection == CameraLensDirection.front) {
          selected = camera;
          break;
        }
      }
      final controller = CameraController(
        selected,
        ResolutionPreset.medium,
        enableAudio: false,
      );
      await controller.initialize();
      if (!mounted) {
        await controller.dispose();
        return;
      }
      setState(() {
        _controller = controller;
        _isFront = selected.lensDirection == CameraLensDirection.front;
      });
    } catch (_) {
      if (mounted) {
        setState(
          () => _error = 'Kamera tidak dapat dibuka. Periksa izin kamera.',
        );
      }
    }
  }

  Future<void> _capture() async {
    final controller = _controller;
    if (controller == null || !controller.value.isInitialized || _taking) {
      return;
    }
    final token = ++_captureToken;
    setState(() {
      _taking = true;
      _error = null;
    });
    try {
      final photo = await controller.takePicture();
      final bytes = await photo.readAsBytes();
      if (!mounted || token != _captureToken) return;
      // Tampilkan pratinjau dulu, lalu verifikasi wajah dengan ML Kit.
      setState(() {
        _captured = bytes;
        _faceResult = null;
        _verifying = true;
        _taking = false;
      });
      final result = await _faceVerification.verifyFile(photo.path);
      if (!mounted || token != _captureToken) return;
      setState(() {
        _faceResult = result;
        _verifying = false;
      });
    } catch (_) {
      if (mounted && token == _captureToken) {
        setState(() {
          _taking = false;
          _verifying = false;
          _error = 'Foto gagal diambil. Coba lagi.';
        });
      }
    }
  }

  void _retake() {
    _captureToken++;
    setState(() {
      _captured = null;
      _faceResult = null;
      _verifying = false;
    });
  }

  @override
  void dispose() {
    _captureToken++;
    _controller?.dispose();
    if (_ownsFaceVerification) {
      unawaited(_faceVerification.dispose());
    }
    SystemChrome.setPreferredOrientations(DeviceOrientation.values);
    super.dispose();
  }

  Color get _ringColor =>
      widget.insideGeofence ? AppColors.green : AppColors.amber;

  @override
  Widget build(BuildContext context) {
    final controller = _controller;
    return Scaffold(
      backgroundColor: const Color(0xFF0B1220),
      appBar: AppBar(
        backgroundColor: const Color(0xFF0B1220),
        foregroundColor: Colors.white,
        title: const Text(
          'Selfie absensi',
          style: TextStyle(color: Colors.white, fontWeight: FontWeight.w700),
        ),
        leading: IconButton(
          tooltip: 'Tutup',
          onPressed: () => Navigator.of(context).maybePop(),
          icon: const Icon(Icons.close, color: Colors.white),
        ),
      ),
      body: SafeArea(
        child: _error != null
            ? Center(
                child: Padding(
                  padding: const EdgeInsets.all(24),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        _error!,
                        textAlign: TextAlign.center,
                        style: const TextStyle(
                          color: Colors.white70,
                          fontSize: 14,
                        ),
                      ),
                      const SizedBox(height: 14),
                      OutlinedButton(
                        onPressed: () => Navigator.of(context).maybePop(),
                        child: const Text('Kembali'),
                      ),
                    ],
                  ),
                ),
              )
            : controller == null
            ? const Center(
                child: CircularProgressIndicator(color: AppColors.yellow),
              )
            : _captured != null
            ? _reviewView()
            : _liveView(controller),
      ),
    );
  }

  Widget _liveView(CameraController controller) {
    final size = _circleSize(context);

    return Column(
      children: [
        const Spacer(),
        _locationCard(),
        const SizedBox(height: 18),
        _CircularPreview(
          controller: controller,
          size: size,
          ringColor: _ringColor,
        ),
        const SizedBox(height: 18),
        const Text(
          'Posisikan wajah di dalam lingkaran',
          style: TextStyle(color: Colors.white60, fontSize: 12),
        ),
        const Spacer(),
        GestureDetector(
          key: const Key('camera-capture'),
          onTap: _taking ? null : _capture,
          child: Container(
            width: 76,
            height: 76,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: _taking ? AppColors.tableHead : Colors.white,
              border: Border.all(color: _ringColor, width: 4),
            ),
            alignment: Alignment.center,
            child: _taking
                ? const SizedBox.square(
                    dimension: 22,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : Container(
                    width: 54,
                    height: 54,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: _ringColor,
                    ),
                  ),
          ),
        ),
        const SizedBox(height: 10),
        const Text(
          'Ketuk untuk mengambil foto',
          style: TextStyle(color: Colors.white54, fontSize: 11),
        ),
        const SizedBox(height: 26),
      ],
    );
  }

  String get _radiusLabel {
    if (widget.insideGeofence) return 'Dalam radius kantor';
    return widget.wfh ? 'Di luar radius / WFH' : 'Di luar radius kantor';
  }

  Widget _locationCard() {
    final positive = widget.insideGeofence;
    final foreground = positive
        ? const Color(0xFFDCFCE7)
        : const Color(0xFFFEF9C3);
    final background = positive
        ? const Color(0x3315803D)
        : const Color(0x33EAB308);
    final border = positive ? const Color(0x6615803D) : const Color(0x66EAB308);
    final distance = widget.distanceMeters;

    return Container(
      key: const Key('camera-location'),
      margin: const EdgeInsets.symmetric(horizontal: 24),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: border),
      ),
      child: Row(
        children: [
          Icon(
            Icons.location_on_outlined,
            size: 17,
            color: positive ? const Color(0xFF86EFAC) : const Color(0xFFFDE047),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  widget.officeName?.isNotEmpty == true
                      ? widget.officeName!
                      : 'Lokasi kantor',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 12.5,
                    fontWeight: FontWeight.w700,
                    color: foreground,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  [
                    _radiusLabel,
                    if (distance != null)
                      '${distance.toStringAsFixed(0)} m dari kantor',
                  ].join(' · '),
                  style: TextStyle(
                    fontSize: 11,
                    color: foreground.withValues(alpha: 0.85),
                    fontFeatures: tabularFigures,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _reviewView() {
    // Kirim tetap diblokir selama verifikasi berjalan, atau saat ML Kit aktif
    // dan menolak foto. Bila ML Kit tidak tersedia, kirim diizinkan.
    final canSend = !_verifying && (_faceResult?.allowsSubmission ?? false);
    return Column(
      children: [
        const SizedBox(height: 16),
        _locationCard(),
        const SizedBox(height: 16),
        Expanded(
          child: SelfieReviewView(
            photo: _captured!,
            size: _circleSize(context),
            ringColor: _ringColor,
            mirrored: _isFront,
            verifying: _verifying,
            verification: _faceResult,
            onRetake: _retake,
            onConfirm: canSend
                ? () => Navigator.of(context).pop<Uint8List>(_captured)
                : null,
          ),
        ),
      ],
    );
  }

  double _circleSize(BuildContext context) {
    final width = MediaQuery.sizeOf(context).width;
    return (width - 88).clamp(200.0, 280.0);
  }
}

/// Pratinjau foto selfie beserta status verifikasi wajah.
///
/// Dipisahkan dari [CameraScreen] supaya skenario "wajah tidak terdeteksi"
/// dan "wajah terverifikasi" bisa diuji tanpa native kamera/ML Kit.
class SelfieReviewView extends StatelessWidget {
  const SelfieReviewView({
    super.key,
    required this.photo,
    required this.size,
    required this.ringColor,
    required this.mirrored,
    required this.onRetake,
    this.verifying = false,
    this.verification,
    this.onConfirm,
  });

  final Uint8List photo;
  final double size;
  final Color ringColor;

  /// True untuk kamera depan: foto ditampilkan seperti cermin, byte JPEG asli
  /// yang dikirim ke API tetap tanpa mirror.
  final bool mirrored;
  final bool verifying;
  final FaceVerificationResult? verification;
  final VoidCallback onRetake;
  final VoidCallback? onConfirm;

  @override
  Widget build(BuildContext context) {
    final verified = !verifying && verification?.isVerified == true;
    final canConfirm =
        !verifying &&
        verification?.allowsSubmission == true &&
        onConfirm != null;

    return SingleChildScrollView(
      padding: const EdgeInsets.only(bottom: 8),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Text(
            'Pratinjau foto',
            style: TextStyle(
              color: Colors.white70,
              fontSize: 12,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: 16),
          Container(
            width: size,
            height: size,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              border: Border.all(
                color: verified ? AppColors.green : ringColor,
                width: 3,
              ),
            ),
            child: ClipOval(
              child: Transform.flip(
                flipX: mirrored,
                child: Image.memory(
                  photo,
                  width: size,
                  height: size,
                  fit: BoxFit.cover,
                  gaplessPlayback: true,
                  filterQuality: FilterQuality.medium,
                  errorBuilder: (context, error, stackTrace) => Container(
                    color: AppColors.tableHead,
                    alignment: Alignment.center,
                    child: const Icon(
                      Icons.broken_image_outlined,
                      color: Colors.white54,
                      size: 32,
                    ),
                  ),
                ),
              ),
            ),
          ),
          const SizedBox(height: 10),
          const Text(
            'Tampilan cermin. File asli dikirim tanpa perubahan.',
            textAlign: TextAlign.center,
            style: TextStyle(color: Colors.white38, fontSize: 11),
          ),
          const SizedBox(height: 14),
          _statusBanner(),
          const SizedBox(height: 18),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 24),
            child: Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    key: const Key('camera-retake'),
                    onPressed: onRetake,
                    style: OutlinedButton.styleFrom(
                      foregroundColor: Colors.white,
                      side: const BorderSide(color: Color(0x33FFFFFF)),
                    ),
                    child: const Text('Ambil ulang'),
                  ),
                ),
                if (canConfirm) ...[
                  const SizedBox(width: 12),
                  Expanded(
                    child: FilledButton(
                      key: const Key('camera-confirm'),
                      onPressed: onConfirm,
                      style: FilledButton.styleFrom(
                        backgroundColor: AppColors.green,
                      ),
                      child: const Text('Kirim Absen'),
                    ),
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _statusBanner() {
    if (verifying) {
      return _banner(
        key: const Key('camera-face-verifying'),
        background: AppColors.yellowSoft,
        border: AppColors.yellowLine,
        leading: const SizedBox.square(
          dimension: 13,
          child: CircularProgressIndicator(
            strokeWidth: 2,
            color: AppColors.yellowInk,
          ),
        ),
        text: const Text(
          'Memverifikasi wajah...',
          style: TextStyle(
            fontSize: 12,
            fontWeight: FontWeight.w600,
            color: AppColors.yellowInk,
          ),
        ),
      );
    }

    final result = verification;
    if (result == null) return const SizedBox.shrink();

    if (result.isUnavailable) {
      final detail = result.detail;
      return _banner(
        key: const Key('camera-face-unavailable'),
        background: AppColors.yellowSoft,
        border: AppColors.yellowLine,
        leading: const Icon(
          Icons.info_outline,
          size: 15,
          color: AppColors.yellowInk,
        ),
        text: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              result.message,
              style: const TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w600,
                color: AppColors.yellowInk,
              ),
            ),
            if (detail != null)
              Padding(
                padding: const EdgeInsets.only(top: 2),
                child: Text(
                  detail,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 10.5,
                    color: AppColors.yellowInk,
                  ),
                ),
              ),
          ],
        ),
      );
    }

    if (result.isVerified) {
      return _banner(
        key: const Key('camera-face-verified'),
        background: AppColors.greenSoft,
        border: AppColors.greenLine,
        leading: const Icon(
          Icons.verified_user,
          size: 15,
          color: AppColors.green,
        ),
        text: const Text(
          'Wajah terverifikasi',
          style: TextStyle(
            fontSize: 12,
            fontWeight: FontWeight.w700,
            color: AppColors.greenDark,
          ),
        ),
      );
    }

    return _banner(
      key: const Key('camera-face-warning'),
      background: AppColors.dangerSoft,
      border: AppColors.danger.withValues(alpha: 0.35),
      leading: const Icon(
        Icons.face_retouching_off,
        size: 15,
        color: AppColors.danger,
      ),
      text: Text(
        result.message,
        style: const TextStyle(
          fontSize: 11.5,
          fontWeight: FontWeight.w600,
          color: AppColors.danger,
        ),
      ),
    );
  }

  Widget _banner({
    required Key key,
    required Color background,
    required Color border,
    required Widget leading,
    required Widget text,
  }) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 24),
      child: Container(
        key: key,
        width: double.infinity,
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
        decoration: BoxDecoration(
          color: background,
          borderRadius: BorderRadius.circular(10),
          border: Border.all(color: border),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.center,
          children: [
            leading,
            const SizedBox(width: 8),
            Expanded(child: text),
          ],
        ),
      ),
    );
  }
}

class _CircularPreview extends StatelessWidget {
  const _CircularPreview({
    required this.controller,
    required this.size,
    required this.ringColor,
  });

  final CameraController controller;
  final double size;
  final Color ringColor;

  @override
  Widget build(BuildContext context) {
    // Di portrait, CameraPreview memakai 1 / aspectRatio sebagai rasio
    // lebar:tinggi. Kotak preview harus memakai rasio yang sama persis agar
    // wajah tidak melebar; FittedBox(cover) yang memotong tepinya ke lingkaran.
    //
    // Preview TIDAK di-flip: CameraPreview Android untuk kamera depan sudah
    // dimirroring oleh platform (gerak kiri tampil kiri seperti cermin).
    final portraitAspectRatio = 1 / controller.value.aspectRatio;
    final preview = FittedBox(
      fit: BoxFit.cover,
      clipBehavior: Clip.hardEdge,
      child: SizedBox(
        width: size,
        height: size / portraitAspectRatio,
        child: CameraPreview(controller),
      ),
    );

    return SizedBox(
      width: size,
      height: size,
      child: Stack(
        alignment: Alignment.center,
        children: [
          Container(
            width: size,
            height: size,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              border: Border.all(
                color: ringColor.withValues(alpha: 0.22),
                width: 6,
              ),
            ),
          ),
          ClipOval(
            child: SizedBox(width: size, height: size, child: preview),
          ),
          Container(
            width: size,
            height: size,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              border: Border.all(color: ringColor, width: 3),
            ),
          ),
          Positioned.fill(
            child: IgnorePointer(
              child: CustomPaint(
                painter: FaceGuidePainter(
                  color: Colors.white.withValues(alpha: 0.38),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
