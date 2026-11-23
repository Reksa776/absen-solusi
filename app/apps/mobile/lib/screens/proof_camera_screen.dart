import 'package:camera/camera.dart';
import 'package:material_ui/material_ui.dart';

import '../theme/app_theme.dart';

/// Kamera dokumen untuk lampiran izin. Terpisah dari kamera selfie absensi
/// sehingga verifikasi wajah ML Kit tidak ikut berjalan.
class ProofCameraScreen extends StatefulWidget {
  const ProofCameraScreen({super.key});

  @override
  State<ProofCameraScreen> createState() => _ProofCameraScreenState();
}

class _ProofCameraScreenState extends State<ProofCameraScreen> {
  CameraController? _controller;
  bool _taking = false;
  String? _error;

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
      CameraDescription selected = cameras.first;
      for (final camera in cameras) {
        if (camera.lensDirection == CameraLensDirection.back) {
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

  Future<void> _capture() async {
    final controller = _controller;
    if (controller == null || !controller.value.isInitialized || _taking) {
      return;
    }
    setState(() {
      _taking = true;
      _error = null;
    });
    try {
      final photo = await controller.takePicture();
      final bytes = await photo.readAsBytes();
      if (!mounted) return;
      Navigator.of(context).pop(bytes);
    } catch (_) {
      if (mounted) {
        setState(() {
          _taking = false;
          _error = 'Foto bukti gagal diambil. Coba lagi.';
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
      backgroundColor: AppColors.ink,
      appBar: AppBar(title: const Text('Foto bukti')),
      body: Column(
        children: [
          Expanded(
            child: Center(
              child: controller == null
                  ? const CircularProgressIndicator()
                  : CameraPreview(controller),
            ),
          ),
          SafeArea(
            top: false,
            child: Padding(
              padding: const EdgeInsets.all(18),
              child: Column(
                children: [
                  if (_error != null) ...[
                    Text(
                      _error!,
                      textAlign: TextAlign.center,
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 12.5,
                      ),
                    ),
                    const SizedBox(height: 10),
                  ],
                  const Text(
                    'Posisikan surat dokter atau bukti izin memenuhi layar.',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      color: Colors.white,
                      fontSize: 12,
                      height: 1.4,
                    ),
                  ),
                  const SizedBox(height: 12),
                  SizedBox(
                    height: 50,
                    child: FilledButton.icon(
                      key: const Key('proof-camera-capture'),
                      onPressed:
                          controller == null || _taking ? null : _capture,
                      icon: _taking
                          ? const SizedBox.square(
                              dimension: 16,
                              child: CircularProgressIndicator(
                                strokeWidth: 2,
                                color: Colors.white,
                              ),
                            )
                          : const Icon(Icons.camera_alt_outlined, size: 19),
                      label: Text(_taking ? 'Mengambil…' : 'Ambil foto bukti'),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
