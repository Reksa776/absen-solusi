import 'dart:async';

import 'package:camera/camera.dart';
import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';

import '../services/face_verification_service.dart';
import '../theme/app_theme.dart';
import '../widgets/selfie_frame.dart';

/// Sumber foto selfie. Produksi memakai `takePicture()` dari kamera depan;
/// widget test menyuntikkan foto palsu agar alur auto-submit bisa diuji.
typedef SelfieCapture = Future<CapturedSelfie?> Function();

/// Hasil jepretan: file JPEG untuk ML Kit dan byte asli untuk dikirim ke API.
class CapturedSelfie {
  const CapturedSelfie({required this.path, required this.bytes});

  final String path;
  final Uint8List bytes;
}

/// Kamera selfie absensi sekali-jepret.
///
/// Tidak ada layar konfirmasi: setelah shutter ditekan, foto diverifikasi wajah
/// di latar belakang sambil menampilkan animasi pindai, lalu langsung
/// dikembalikan lewat `Navigator.pop` agar pemanggil bisa submit presensi.
class CameraScreen extends StatefulWidget {
  const CameraScreen({
    super.key,
    this.insideGeofence = true,
    this.officeName,
    this.distanceMeters,
    this.wfh = false,
    this.faceVerification,
    this.captureOverride,
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

  /// Pengganti kamera native pada widget test. Bila diisi, plugin kamera tidak
  /// diinisialisasi dan tombol shutter memakai sumber foto ini.
  final SelfieCapture? captureOverride;

  @override
  State<CameraScreen> createState() => _CameraScreenState();
}

class _CameraScreenState extends State<CameraScreen> {
  CameraController? _controller;
  bool _processing = false;
  String? _warning;
  String? _error;
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
    if (widget.captureOverride == null) _initialize();
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
      setState(() => _controller = controller);
    } catch (_) {
      if (mounted) {
        setState(
          () => _error = 'Kamera tidak dapat dibuka. Periksa izin kamera.',
        );
      }
    }
  }

  /// Jepret, verifikasi wajah, lalu langsung kembalikan foto bila valid.
  Future<void> _capture() async {
    if (_processing) return;
    final token = ++_captureToken;
    setState(() {
      _processing = true;
      _warning = null;
      _error = null;
    });
    try {
      final photo = await _takeSelfie();
      if (!mounted || token != _captureToken) return;
      if (photo == null) {
        setState(() {
          _processing = false;
          _warning = 'Foto gagal diambil. Coba lagi.';
        });
        return;
      }
      final result = await _faceVerification.verifyFile(photo.path);
      if (!mounted || token != _captureToken) return;
      if (result.allowsSubmission) {
        // Wajah valid (atau ML Kit tidak tersedia): auto-submit tanpa tombol
        // konfirmasi kedua.
        Navigator.of(context).pop<Uint8List>(photo.bytes);
        return;
      }
      setState(() {
        _processing = false;
        _warning =
            'Wajah tidak terdeteksi, posisikan wajah di lingkaran lalu ketuk kembali';
      });
    } catch (_) {
      if (!mounted || token != _captureToken) return;
      setState(() {
        _processing = false;
        _warning = 'Foto gagal diambil. Coba lagi.';
      });
    }
  }

  Future<CapturedSelfie?> _takeSelfie() async {
    final override = widget.captureOverride;
    if (override != null) return override();
    final controller = _controller;
    if (controller == null || !controller.value.isInitialized) return null;
    final photo = await controller.takePicture();
    return CapturedSelfie(path: photo.path, bytes: await photo.readAsBytes());
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
            : controller == null && widget.captureOverride == null
            ? const Center(
                child: CircularProgressIndicator(color: AppColors.yellow),
              )
            : _liveView(controller),
      ),
    );
  }

  Widget _liveView(CameraController? controller) {
    final size = _circleSize(context);

    return Column(
      children: [
        Expanded(
          child: LayoutBuilder(
            builder: (context, constraints) => SingleChildScrollView(
              padding: const EdgeInsets.symmetric(vertical: 12),
              child: ConstrainedBox(
                constraints: BoxConstraints(
                  minHeight: (constraints.maxHeight - 24).clamp(
                    0.0,
                    double.infinity,
                  ),
                ),
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    _locationCard(),
                    const SizedBox(height: 18),
                    _CircularPreview(
                      controller: controller,
                      size: size,
                      ringColor: _ringColor,
                      processing: _processing,
                    ),
                    const SizedBox(height: 16),
                    if (_processing)
                      const Text(
                        'Memindai & mengirim absensi...',
                        key: Key('camera-scan-status'),
                        style: TextStyle(
                          color: Colors.white70,
                          fontSize: 12,
                          fontWeight: FontWeight.w600,
                        ),
                      )
                    else
                      const Text(
                        'Posisikan wajah di dalam lingkaran',
                        style: TextStyle(color: Colors.white60, fontSize: 12),
                      ),
                    if (_warning != null) _warningBanner(),
                  ],
                ),
              ),
            ),
          ),
        ),
        GestureDetector(
          key: const Key('camera-capture'),
          onTap: _processing ? null : _capture,
          child: Container(
            width: 76,
            height: 76,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: _processing ? AppColors.tableHead : Colors.white,
              border: Border.all(color: _ringColor, width: 4),
            ),
            alignment: Alignment.center,
            child: _processing
                ? const SizedBox.square(
                    dimension: 22,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: AppColors.green,
                    ),
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
        Text(
          _processing
              ? 'Mohon tunggu, jangan tutup layar'
              : 'Ketuk untuk mengambil foto',
          style: const TextStyle(color: Colors.white54, fontSize: 11),
        ),
        const SizedBox(height: 26),
      ],
    );
  }

  Widget _warningBanner() {
    const foreground = Color(0xFFFCA5A5);
    return Container(
      key: const Key('camera-warning'),
      margin: const EdgeInsets.fromLTRB(24, 12, 24, 0),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
      decoration: BoxDecoration(
        color: AppColors.danger.withValues(alpha: 0.16),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppColors.danger.withValues(alpha: 0.45)),
      ),
      child: Row(
        children: [
          const Icon(Icons.face_retouching_off, size: 15, color: foreground),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              _warning!,
              style: const TextStyle(
                fontSize: 11.5,
                height: 1.35,
                fontWeight: FontWeight.w600,
                color: foreground,
              ),
            ),
          ),
        ],
      ),
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

  double _circleSize(BuildContext context) {
    final width = MediaQuery.sizeOf(context).width;
    return (width - 88).clamp(200.0, 280.0);
  }
}

/// Lingkaran kamera depan dengan garis pemindai saat siaga dan cincin progress
/// saat foto sedang diverifikasi/dikirim.
class _CircularPreview extends StatelessWidget {
  const _CircularPreview({
    required this.controller,
    required this.size,
    required this.ringColor,
    required this.processing,
  });

  final CameraController? controller;
  final double size;
  final Color ringColor;
  final bool processing;

  @override
  Widget build(BuildContext context) {
    final controller = this.controller;
    final Widget preview;
    if (controller == null) {
      preview = Container(
        color: AppColors.tableHead,
        alignment: Alignment.center,
        child: const Icon(
          Icons.camera_front_rounded,
          color: Colors.white54,
          size: 40,
        ),
      );
    } else {
      // Di portrait, CameraPreview memakai 1 / aspectRatio sebagai rasio
      // lebar:tinggi. Kotak preview harus memakai rasio yang sama persis agar
      // wajah tidak melebar; FittedBox(cover) yang memotong tepinya ke lingkaran.
      //
      // Preview TIDAK di-flip: CameraPreview Android untuk kamera depan sudah
      // dimirroring oleh platform (gerak kiri tampil kiri seperti cermin).
      final portraitAspectRatio = 1 / controller.value.aspectRatio;
      preview = FittedBox(
        fit: BoxFit.cover,
        clipBehavior: Clip.hardEdge,
        child: SizedBox(
          width: size,
          height: size / portraitAspectRatio,
          child: CameraPreview(controller),
        ),
      );
    }

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
            child: SizedBox(
              width: size,
              height: size,
              child: Stack(
                fit: StackFit.expand,
                children: [
                  preview,
                  if (!processing)
                    const Positioned.fill(
                      child: IgnorePointer(
                        child: _ScanSweep(
                          key: Key('camera-scan-sweep'),
                          color: AppColors.green,
                        ),
                      ),
                    ),
                ],
              ),
            ),
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
          if (processing) ...[
            Positioned.fill(
              child: IgnorePointer(
                child: ClipOval(
                  child: Container(color: const Color(0x990B1220)),
                ),
              ),
            ),
            SizedBox(
              width: size - 6,
              height: size - 6,
              child: CircularProgressIndicator(
                key: const Key('camera-scan-progress'),
                strokeWidth: 3,
                color: AppColors.green,
                backgroundColor: AppColors.amber.withValues(alpha: 0.3),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

/// Garis pemindai horizontal tipis yang bergerak naik-turun di dalam lingkaran.
class _ScanSweep extends StatefulWidget {
  const _ScanSweep({super.key, required this.color});

  final Color color;

  @override
  State<_ScanSweep> createState() => _ScanSweepState();
}

class _ScanSweepState extends State<_ScanSweep>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller =
      AnimationController(
        vsync: this,
        duration: const Duration(milliseconds: 1700),
      )..repeat(reverse: true);
  late final Animation<double> _position = CurvedAnimation(
    parent: _controller,
    curve: Curves.easeInOut,
  );

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _position,
      builder: (context, _) => Align(
        alignment: Alignment(0, _position.value * 1.8 - 0.9),
        child: Container(
          height: 1.6,
          margin: const EdgeInsets.symmetric(horizontal: 20),
          decoration: BoxDecoration(
            gradient: LinearGradient(
              colors: [
                widget.color.withValues(alpha: 0),
                widget.color.withValues(alpha: 0.9),
                widget.color.withValues(alpha: 0),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
