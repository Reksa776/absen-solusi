import 'package:camera/camera.dart';
import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';

import '../theme/app_theme.dart';
import '../widgets/selfie_frame.dart';

class CameraScreen extends StatefulWidget {
  const CameraScreen({
    super.key,
    this.insideGeofence = true,
    this.officeName,
    this.distanceMeters,
    this.wfh = false,
  });

  /// True bila GPS berada dalam radius kantor (ring hijau), false untuk kuning.
  final bool insideGeofence;

  /// Nama kantor/lokasi aktif yang ditampilkan di atas lingkaran kamera.
  final String? officeName;

  /// Jarak GPS ke kantor dalam meter, bila sudah diketahui.
  final double? distanceMeters;

  /// True bila hari ini bekerja dari rumah (geofence dilewati).
  final bool wfh;

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
    SystemChrome.setPreferredOrientations(DeviceOrientation.values);
    super.dispose();
  }

  Color get _ringColor => widget.insideGeofence ? AppColors.green : AppColors.amber;

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

    return Column(
      children: [
        const Spacer(),
        _locationCard(),
        const SizedBox(height: 18),
        _CircularPreview(
          controller: controller,
          size: size,
          mirrored: _isFront,
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
    final border = positive
        ? const Color(0x6615803D)
        : const Color(0x66EAB308);
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
    final size = _circleSize(context);

    return Column(
      children: [
        const Spacer(),
        _locationCard(),
        const SizedBox(height: 16),
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
            border: Border.all(color: _ringColor, width: 3),
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
    // Di portrait, CameraPreview memakai 1 / aspectRatio sebagai rasio
    // lebar:tinggi. Kotak preview harus memakai rasio yang sama persis agar
    // wajah tidak melebar; FittedBox(cover) yang memotong tepinya ke lingkaran.
    final portraitAspectRatio = 1 / controller.value.aspectRatio;
    Widget preview = FittedBox(
      fit: BoxFit.cover,
      clipBehavior: Clip.hardEdge,
      child: SizedBox(
        width: size,
        height: size / portraitAspectRatio,
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
