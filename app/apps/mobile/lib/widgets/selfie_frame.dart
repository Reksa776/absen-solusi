import 'dart:math' as math;
import 'dart:typed_data';

import 'package:material_ui/material_ui.dart';

import '../theme/app_theme.dart';

/// Bingkai selfie bulat dengan ring hijau (dalam radius) atau kuning (luar radius).
/// Foto ditampilkan dengan [BoxFit.cover] dan mirror horizontal hanya untuk
/// tampilan; byte asli yang dikirim ke API tidak diubah.
class SelfieCircleFrame extends StatelessWidget {
  const SelfieCircleFrame({
    super.key,
    required this.size,
    required this.insideGeofence,
    this.photo,
    this.onTap,
    this.showFaceGuide = true,
  });

  final double size;
  final bool insideGeofence;
  final Uint8List? photo;
  final VoidCallback? onTap;
  final bool showFaceGuide;

  Color get ringColor => insideGeofence ? AppColors.green : AppColors.amber;

  @override
  Widget build(BuildContext context) {
    final inner = size - 20;
    final content = photo == null
        ? _placeholder()
        : Transform.flip(
            flipX: true,
            child: Image.memory(
              photo!,
              width: inner,
              height: inner,
              fit: BoxFit.cover,
              gaplessPlayback: true,
              filterQuality: FilterQuality.medium,
              errorBuilder: (context, error, stackTrace) => _placeholder(),
            ),
          );

    return Semantics(
      button: onTap != null,
      label: photo == null
          ? 'Ambil selfie kamera depan'
          : 'Foto selfie siap dikirim',
      child: GestureDetector(
        onTap: onTap,
        child: SizedBox(
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
                  color: AppColors.surface,
                  border: Border.all(
                    color: ringColor.withValues(alpha: 0.18),
                    width: 7,
                  ),
                ),
              ),
              Container(
                width: size - 14,
                height: size - 14,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  border: Border.all(color: ringColor, width: 3),
                ),
                child: ClipOval(
                  child: SizedBox(width: inner, height: inner, child: content),
                ),
              ),
              if (showFaceGuide && photo == null)
                Positioned.fill(
                  child: IgnorePointer(
                    child: CustomPaint(
                      painter: FaceGuidePainter(
                        color: AppColors.ink.withValues(alpha: 0.18),
                      ),
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _placeholder() {
    return Container(
      color: AppColors.tableHead,
      alignment: Alignment.center,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(
            Icons.camera_front_rounded,
            size: 34,
            color: AppColors.green,
          ),
          const SizedBox(height: 6),
          Text(
            'Ambil selfie',
            style: TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w700,
              color: AppColors.greenDark,
            ),
          ),
        ],
      ),
    );
  }
}

/// Panduan wajah halus: oval kepala dan garis bahu.
class FaceGuidePainter extends CustomPainter {
  const FaceGuidePainter({required this.color});

  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    final center = Offset(size.width / 2, size.height / 2);
    final stroke = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.2
      ..strokeCap = StrokeCap.round
      ..color = color;

    final head = Rect.fromCenter(
      center: center.translate(0, -size.height * 0.07),
      width: size.width * 0.42,
      height: size.height * 0.52,
    );
    canvas.drawOval(head, stroke);

    final shoulders = Rect.fromCenter(
      center: center.translate(0, size.height * 0.36),
      width: size.width * 0.62,
      height: size.height * 0.34,
    );
    canvas.drawArc(shoulders, math.pi * 1.08, math.pi * 0.84, false, stroke);

    final tick = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.2
      ..strokeCap = StrokeCap.round
      ..color = color.withValues(alpha: 0.8);
    final radius = size.width * 0.42;
    for (final angle in [0.0, math.pi / 2, math.pi, math.pi * 1.5]) {
      final direction = Offset(math.cos(angle), math.sin(angle));
      canvas.drawLine(
        center + direction * (radius + 6),
        center + direction * (radius + 14),
        tick,
      );
    }
  }

  @override
  bool shouldRepaint(covariant FaceGuidePainter oldDelegate) =>
      oldDelegate.color != color;
}
