import 'dart:convert';
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:absensi_mobile/screens/camera_screen.dart';
import 'package:absensi_mobile/services/face_verification_service.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';

/// PNG 1x1 valid agar `Image.memory` punya data gambar nyata di widget test.
final Uint8List _photo = base64Decode(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
);

Widget _review({
  required FaceVerificationResult? verification,
  bool verifying = false,
  VoidCallback? onConfirm,
  VoidCallback? onRetake,
}) {
  return MaterialApp(
    home: Scaffold(
      body: SelfieReviewView(
        photo: _photo,
        size: 240,
        ringColor: const Color(0xFF15803D),
        mirrored: true,
        verifying: verifying,
        verification: verification,
        onRetake: onRetake ?? () {},
        onConfirm: onConfirm,
      ),
    ),
  );
}

void main() {
  group('FaceVerificationService.evaluateFaceBoxes', () {
    const imageSize = ui.Size(720, 1280);

    test('foto tanpa wajah ditolak', () {
      final result = FaceVerificationService.evaluateFaceBoxes(
        faces: const [],
        imageSize: imageSize,
      );
      expect(result.status, FaceVerificationStatus.noFace);
      expect(result.isVerified, isFalse);
      expect(result.allowsSubmission, isFalse);
      expect(result.message, contains('Tidak ada wajah terdeteksi'));
    });

    test('wajah proporsional di tengah frame terverifikasi', () {
      final result = FaceVerificationService.evaluateFaceBoxes(
        faces: const [ui.Rect.fromLTWH(220, 420, 280, 340)],
        imageSize: imageSize,
      );
      expect(result.status, FaceVerificationStatus.verified);
      expect(result.isVerified, isTrue);
      expect(result.allowsSubmission, isTrue);
    });

    test('wajah dekat/terpotong tepi frame tetap diterima', () {
      // Box melewati tepi kiri dan kanan; rotasi EXIF tidak boleh membuat
      // aturan tepi menolak wajah yang jelas terlihat.
      final result = FaceVerificationService.evaluateFaceBoxes(
        faces: const [ui.Rect.fromLTWH(-40, 420, 800, 340)],
        imageSize: imageSize,
      );
      expect(result.status, FaceVerificationStatus.verified);
      expect(result.isVerified, isTrue);
    });

    test('wajah kecil di latar belakang ditolak', () {
      // 50 px < 8% dari sisi terpendek (720 * 0.08 = 57.6 px).
      final result = FaceVerificationService.evaluateFaceBoxes(
        faces: const [ui.Rect.fromLTWH(330, 600, 50, 60)],
        imageSize: imageSize,
      );
      expect(result.status, FaceVerificationStatus.tooFar);
      expect(result.isVerified, isFalse);
      expect(result.allowsSubmission, isFalse);
      expect(result.message, contains('Wajah terlalu jauh'));
    });

    test('dimensi tertukar akibat rotasi EXIF tetap lolos', () {
      // Foto portrait dideteksi dengan koordinat landscape (1280x720).
      final result = FaceVerificationService.evaluateFaceBoxes(
        faces: const [ui.Rect.fromLTWH(420, 220, 340, 280)],
        imageSize: const ui.Size(1280, 720),
      );
      expect(result.status, FaceVerificationStatus.verified);
    });

    test('unavailable tidak memblokir pengiriman', () {
      expect(FaceVerificationResult.unavailable.allowsSubmission, isTrue);
      expect(FaceVerificationResult.unavailable.isVerified, isFalse);
      expect(
        FaceVerificationResult.unavailableWith('MlKitException: model missing')
            .detail,
        'MlKitException: model missing',
      );
      expect(FaceVerificationResult.unavailableWith('').detail, isNull);
    });
  });

  group('SelfieReviewView verifikasi wajah', () {
    testWidgets('foto tanpa wajah menonaktifkan kirim absen', (tester) async {
      var confirmed = false;
      await tester.pumpWidget(
        _review(
          verification: FaceVerificationResult.noFace,
          onConfirm: () => confirmed = true,
        ),
      );
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('camera-face-warning')), findsOneWidget);
      expect(
        find.text(
          'Tidak ada wajah terdeteksi. Pastikan wajah terlihat jelas di kamera.',
        ),
        findsOneWidget,
      );
      expect(find.byKey(const Key('camera-confirm')), findsNothing);
      expect(find.byKey(const Key('camera-retake')), findsOneWidget);
      expect(confirmed, isFalse);
    });

    testWidgets('wajah terverifikasi mengaktifkan kirim absen', (tester) async {
      var confirmed = false;
      await tester.pumpWidget(
        _review(
          verification: FaceVerificationResult.verified,
          onConfirm: () => confirmed = true,
        ),
      );
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('camera-face-verified')), findsOneWidget);
      expect(find.text('Wajah terverifikasi'), findsOneWidget);
      expect(find.byKey(const Key('camera-face-warning')), findsNothing);

      final button = tester.widget<FilledButton>(
        find.byKey(const Key('camera-confirm')),
      );
      expect(button.onPressed, isNotNull);

      await tester.tap(find.byKey(const Key('camera-confirm')));
      await tester.pump();
      expect(confirmed, isTrue);
    });

    testWidgets('ML Kit tidak tersedia tetap mengizinkan kirim absen', (
      tester,
    ) async {
      var confirmed = false;
      await tester.pumpWidget(
        _review(
          verification: FaceVerificationResult.unavailable,
          onConfirm: () => confirmed = true,
        ),
      );
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('camera-face-unavailable')), findsOneWidget);
      expect(
        find.text('Verifikasi wajah otomatis tidak tersedia di perangkat ini'),
        findsOneWidget,
      );
      expect(find.byKey(const Key('camera-face-warning')), findsNothing);

      final button = tester.widget<FilledButton>(
        find.byKey(const Key('camera-confirm')),
      );
      expect(button.onPressed, isNotNull);

      await tester.tap(find.byKey(const Key('camera-confirm')));
      await tester.pump();
      expect(confirmed, isTrue);
    });

    testWidgets('indikator verifikasi tampil dan kirim masih tersembunyi', (
      tester,
    ) async {
      await tester.pumpWidget(
        _review(verification: null, verifying: true, onConfirm: () {}),
      );
      await tester.pump();

      expect(find.text('Memverifikasi wajah...'), findsOneWidget);
      expect(find.byKey(const Key('camera-face-verifying')), findsOneWidget);
      expect(find.byKey(const Key('camera-confirm')), findsNothing);
    });
  });
}
