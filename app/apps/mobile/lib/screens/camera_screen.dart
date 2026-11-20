import 'dart:typed_data';

import 'package:camera/camera.dart';
import 'package:material_ui/material_ui.dart';

import '../theme/app_theme.dart';
import '../widgets/selfie_frame.dart';

class CameraScreen extends StatefulWidget {
  const CameraScreen({super.key, this.insideGeofence = true});

  /// True bila GPS berada dalam radius kantor (ring hijau), false untuk kuning.
  final bool insideGeofence;

  @override
  State<CameraScreen> createState() => _CameraScreenState();
}

class _CameraScreenState extends State<CameraScreen> {
  CameraController? _controller;
  Uint8List? _captured;
  String? _error;
  bool _taking = false;
  bool _isFront = true;

  @override
  void initState() {
    super.initState();
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
        setState(() => _error = 'Kamera tidak dapat dibuka. Periksa izin kamera.');
      }
    }
  }

  Future<void> _capture() async {
    final controller = _controller;
    if (controller == null || !controller.value.isInitialized || _taking) return;
    setState(() => _taking = true);
    try {
      final photo = await controller.takePicture();
      final bytes = await photo.readAsBytes();
      if (!mounted) return;
      setState(() {
        _captured = bytes;
        _taking = false;
      });
    } catch (_) {
      if (mounted) {
        setState(() {
          _taking = false;
          _error = 'Foto gagal diambil. Coba lagi.';
        });
      }
    }
  }

  @override
  void dispose() {
    _controller?.dispose();
    super.dispose();
  }

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
          icon: const Icon(Icons.close),
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
                        style: const TextStyle(color: Colors.white70, fontSize: 14),
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
            ? const Center(child: CircularProgressIndicator(color: AppColors.yellow))
            : _captured != null
            ? _reviewView()
            : _liveView(controller),
      ),
    );
  }

  Widget _liveView(CameraController controller) {
    final size = _circleSize(context);
    final ringColor = widget.insideGeofence ? AppColors.green : AppColors.amber;

    return Column(
      children: [
        const Spacer(),
        Text(
          widget.insideGeofence
              ? 'Dalam radius kantor · kamera depan'
              : 'Di luar radius / WFH · kamera depan',
          style: TextStyle(
            color: ringColor == AppColors.green
                ? const Color(0xFF86EFAC)
                : const Color(0xFFFDE047),
            fontSize: 12,
            fontWeight: FontWeight.w600,
          ),
        ),
        const SizedBox(height: 18),
        _CircularPreview(
          controller: controller,
          size: size,
          mirrored: _isFront,
          ringColor: ringColor,
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
              border: Border.all(color: ringColor, width: 4),
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
                      color: ringColor,
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

  Widget _reviewView() {
    final size = _circleSize(context);
    final ringColor = widget.insideGeofence ? AppColors.green : AppColors.amber;

    return Column(
      children: [
        const Spacer(),
        const Text(
          'Pratinjau foto',
          style: TextStyle(color: Colors.white70, fontSize: 12, fontWeight: FontWeight.w600),
        ),
        const SizedBox(height: 16),
        Container(
          width: size,
          height: size,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            border: Border.all(color: ringColor, width: 3),
          ),
          child: ClipOval(
            child: Transform.flip(
              flipX: _isFront,
              child: Image.memory(
                _captured!,
                width: size,
                height: size,
                fit: BoxFit.cover,
                gaplessPlayback: true,
                filterQuality: FilterQuality.medium,
              ),
            ),
          ),
        ),
        const SizedBox(height: 10),
        const Text(
          'Tampilan cermin. File asli dikirim tanpa perubahan.',
          style: TextStyle(color: Colors.white38, fontSize: 11),
        ),
        const Spacer(),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 24),
          child: Row(
            children: [
              Expanded(
                child: OutlinedButton(
                  key: const Key('camera-retake'),
                  onPressed: _taking
                      ? null
                      : () => setState(() => _captured = null),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: Colors.white,
                    side: const BorderSide(color: Color(0x33FFFFFF)),
                  ),
                  child: const Text('Ambil ulang'),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: FilledButton(
                  key: const Key('camera-confirm'),
                  onPressed: () => Navigator.of(context).pop<Uint8List>(_captured),
                  style: FilledButton.styleFrom(backgroundColor: AppColors.green),
                  child: const Text('Gunakan foto'),
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 26),
      ],
    );
  }

  double _circleSize(BuildContext context) {
    final width = MediaQuery.sizeOf(context).width;
    return (width - 88).clamp(200.0, 280.0);
  }
}

class _CircularPreview extends StatelessWidget {
  const _CircularPreview({
    required this.controller,
    required this.size,
    required this.mirrored,
    required this.ringColor,
  });

  final CameraController controller;
  final double size;
  final bool mirrored;
  final Color ringColor;

  @override
  Widget build(BuildContext context) {
    // Rasio sensor dipakai apa adanya: jangan pernah memaksa AspectRatio(1)
    // karena itu membuat gambar gepeng. FittedBox(cover) yang memotong rapi.
    final aspect = controller.value.aspectRatio;
    Widget preview = FittedBox(
      fit: BoxFit.cover,
      clipBehavior: Clip.hardEdge,
      child: SizedBox(
        width: size,
        height: size * aspect,
        child: CameraPreview(controller),
      ),
    );
    if (mirrored) {
      preview = Transform.flip(flipX: true, child: preview);
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
              border: Border.all(color: ringColor.withValues(alpha: 0.22), width: 6),
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
