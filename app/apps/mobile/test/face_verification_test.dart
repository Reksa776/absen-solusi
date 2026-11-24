import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:absensi_mobile/screens/camera_screen.dart';
import 'package:absensi_mobile/services/face_verification_service.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';

class _FakeFaceVerification extends FaceVerificationService {
  _FakeFaceVerification(this.result);

  final FaceVerificationResult result;

  @override
  Future<FaceVerificationResult> verifyFile(String path) async => result;
}

/// Membuka [CameraScreen] lewat Navigator nyata agar hasil `pop` bisa diuji.
Widget _host({
  required SelfieCapture capture,
  required FaceVerificationResult verification,
  required void Function(Uint8List?) onResult,
}) {
  return MaterialApp(
    home: Builder(
      builder: (context) => Scaffold(
        body: Center(
          child: FilledButton(
            key: const Key('open-camera'),
            onPressed: () async {
              final bytes = await Navigator.of(context).push<Uint8List>(
                MaterialPageRoute<Uint8List>(
                  builder: (_) => CameraScreen(
                    captureOverride: capture,
                    faceVerification: _FakeFaceVerification(verification),
                  ),
                ),
              );
              onResult(bytes);
            },
            child: const Text('Buka kamera'),
          ),
        ),
      ),
    ),
  );
}

Future<void> _openCamera(WidgetTester tester) async {
  await tester.tap(find.byKey(const Key('open-camera')));
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 400));
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

  group('CameraScreen auto-submit selfie', () {
    testWidgets('shutter langsung mengembalikan foto tanpa tombol konfirmasi', (
      tester,
    ) async {
      final photo = Uint8List.fromList([1, 2, 3, 4]);
      Uint8List? returned;
      await tester.pumpWidget(
        _host(
          capture: () async =>
              CapturedSelfie(path: '/tmp/selfie.jpg', bytes: photo),
          verification: FaceVerificationResult.verified,
          onResult: (bytes) => returned = bytes,
        ),
      );

      await _openCamera(tester);
      expect(find.byKey(const Key('camera-capture')), findsOneWidget);
      expect(find.byKey(const Key('camera-scan-sweep')), findsOneWidget);
      expect(find.text('Kirim Absen'), findsNothing);
      expect(find.text('Foto Ulang'), findsNothing);

      await tester.tap(find.byKey(const Key('camera-capture')));
      await tester.pump();
      // Selama verifikasi: cincin progress + status pindai, tanpa tombol kirim.
      expect(find.byKey(const Key('camera-scan-progress')), findsOneWidget);
      expect(find.text('Memindai & mengirim absensi...'), findsOneWidget);
      expect(find.text('Kirim Absen'), findsNothing);

      await tester.pump();
      await tester.pump(const Duration(milliseconds: 400));
      await tester.pump(const Duration(milliseconds: 400));

      // Foto langsung dikembalikan ke pemanggil untuk auto-submit presensi.
      expect(returned, photo);
      expect(find.byKey(const Key('camera-capture')), findsNothing);
      expect(find.text('Kirim Absen'), findsNothing);
      expect(find.text('Gunakan Foto'), findsNothing);
      expect(find.text('Foto Ulang'), findsNothing);
      expect(find.text('Ambil Ulang'), findsNothing);
    });

    testWidgets('wajah tidak terdeteksi tetap di kamera tanpa foto ulang', (
      tester,
    ) async {
      Uint8List? returned;
      await tester.pumpWidget(
        _host(
          capture: () async => CapturedSelfie(
            path: '/tmp/selfie.jpg',
            bytes: Uint8List.fromList([9, 9, 9]),
          ),
          verification: FaceVerificationResult.noFace,
          onResult: (bytes) => returned = bytes,
        ),
      );

      await _openCamera(tester);
      await tester.tap(find.byKey(const Key('camera-capture')));
      await tester.pump();
      await tester.pump();

      expect(returned, isNull);
      expect(find.byKey(const Key('camera-warning')), findsOneWidget);
      expect(
        find.text(
          'Wajah tidak terdeteksi, posisikan wajah di lingkaran lalu ketuk kembali',
        ),
        findsOneWidget,
      );
      expect(find.text('Kirim Absen'), findsNothing);
      expect(find.text('Foto Ulang'), findsNothing);
      expect(find.text('Ambil Ulang'), findsNothing);

      // Shutter hijau aktif lagi untuk jepret ulang langsung.
      final shutter = tester.widget<GestureDetector>(
        find.byKey(const Key('camera-capture')),
      );
      expect(shutter.onTap, isNotNull);
      expect(find.byKey(const Key('camera-scan-progress')), findsNothing);
    });
  });
}
