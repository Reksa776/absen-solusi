import 'dart:io';
import 'dart:math' as math;
import 'dart:ui' as ui;

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:google_mlkit_face_detection/google_mlkit_face_detection.dart';

/// Hasil verifikasi wajah pada foto selfie.
enum FaceVerificationStatus {
  /// Minimal satu wajah manusia terdeteksi dan ukurannya wajar.
  verified,

  /// Tidak ada wajah sama sekali pada foto.
  noFace,

  /// Ada wajah, tetapi terlalu kecil/jauh dari kamera.
  tooFar,

  /// ML Kit tidak tersedia (Google Play Services/model belum siap, atau
  /// environment test tanpa platform channel).
  unavailable,
}

class FaceVerificationResult {
  const FaceVerificationResult._(this.status, this.message, [this.detail]);

  final FaceVerificationStatus status;

  /// Pesan siap tampil di UI.
  final String message;

  /// Detail teknis opsional (mis. pesan `PlatformException` dari ML Kit).
  final String? detail;

  bool get isVerified => status == FaceVerificationStatus.verified;

  bool get isUnavailable => status == FaceVerificationStatus.unavailable;

  /// Foto boleh dikirim bila wajah terverifikasi, atau bila engine ML Kit
  /// memang tidak tersedia di perangkat ini (jangan memblokir absensi).
  bool get allowsSubmission => isVerified || isUnavailable;

  static const FaceVerificationResult verified = FaceVerificationResult._(
    FaceVerificationStatus.verified,
    'Wajah terverifikasi',
  );

  static const FaceVerificationResult noFace = FaceVerificationResult._(
    FaceVerificationStatus.noFace,
    'Tidak ada wajah terdeteksi. Pastikan wajah terlihat jelas di kamera.',
  );

  static const FaceVerificationResult tooFar = FaceVerificationResult._(
    FaceVerificationStatus.tooFar,
    'Wajah terlalu jauh dari kamera. Dekatkan wajah lalu coba lagi.',
  );

  static const FaceVerificationResult unavailable = FaceVerificationResult._(
    FaceVerificationStatus.unavailable,
    'Verifikasi wajah otomatis tidak tersedia di perangkat ini',
  );

  /// Varian [unavailable] yang menyertakan pesan error native untuk diagnosa.
  static FaceVerificationResult unavailableWith([String? detail]) {
    final trimmed = detail?.trim();
    if (trimmed == null || trimmed.isEmpty) return unavailable;
    return FaceVerificationResult._(
      FaceVerificationStatus.unavailable,
      unavailable.message,
      trimmed,
    );
  }
}

/// Memverifikasi bahwa foto selfie benar-benar berisi wajah manusia.
///
/// Deteksi memakai Google ML Kit (`google_mlkit_face_detection`). Aturan
/// sengaja dibuat longgar: cukup ada satu wajah yang ukurannya wajar, tanpa
/// membandingkan bounding box terhadap batas tepi foto. Perbandingan tepi
/// sering salah tolak karena orientasi EXIF JPEG kamera depan (dimensi hasil
/// decode bisa tertukar dengan koordinat `boundingBox` dari ML Kit).
class FaceVerificationService {
  FaceVerificationService([this._detector]);

  /// Mode akurat dengan wajah minimal 15% dari lebar frame.
  static final FaceDetectorOptions detectorOptions = FaceDetectorOptions(
    performanceMode: FaceDetectorMode.accurate,
    minFaceSize: 0.15,
    enableTracking: false,
  );

  /// Sisi terpendek bounding box wajah minimal 8% dari sisi terpendek gambar.
  /// Memakai sisi terpendek (bukan lebar/tinggi spesifik) agar tetap benar
  /// saat dimensi gambar tertukar akibat rotasi EXIF 90°/270°.
  static const double _minFaceRatio = 0.08;

  FaceDetector? _detector;
  bool _disposed = false;

  /// Mengecek file JPEG hasil `takePicture()`.
  Future<FaceVerificationResult> verifyFile(String path) async {
    if (_disposed) return FaceVerificationResult.unavailable;
    try {
      final size = await _decodeImageSize(path);
      if (size == null || size.isEmpty) {
        debugPrint('FaceVerification: gagal membaca dimensi foto $path');
        return FaceVerificationResult.unavailable;
      }
      final detector = _detector ??= FaceDetector(options: detectorOptions);
      final faces = await detector.processImage(InputImage.fromFilePath(path));
      if (_disposed) return FaceVerificationResult.unavailable;
      final result = evaluateFaceBoxes(
        faces: faces.map((face) => face.boundingBox).toList(growable: false),
        imageSize: size,
      );
      if (!result.isVerified) {
        debugPrint(
          'FaceVerification: ditolak (${result.status.name}), '
          '${faces.length} wajah, gambar ${size.width}x${size.height}',
        );
      }
      return result;
    } on MissingPluginException catch (error) {
      debugPrint('FaceVerification: plugin ML Kit tidak tersedia ($error)');
      return FaceVerificationResult.unavailableWith(error.message);
    } on PlatformException catch (error) {
      debugPrint(
        'FaceVerification: ML Kit gagal (${error.code}: ${error.message})',
      );
      return FaceVerificationResult.unavailableWith(error.message);
    } catch (error) {
      debugPrint('FaceVerification: error tak terduga ($error)');
      return FaceVerificationResult.unavailable;
    }
  }

  /// Logika murni (tanpa native) agar mudah diuji di unit test.
  ///
  /// Hanya memeriksa: ada wajah, dan ukuran wajah wajar. Tidak ada pemeriksaan
  /// batas tepi agar wajah dekat tepi lingkaran tetap diterima.
  static FaceVerificationResult evaluateFaceBoxes({
    required List<ui.Rect> faces,
    required ui.Size imageSize,
  }) {
    if (faces.isEmpty) return FaceVerificationResult.noFace;
    if (imageSize.isEmpty) return FaceVerificationResult.unavailable;

    final shortSide = math.min(imageSize.width, imageSize.height);
    final minFaceSide = shortSide * _minFaceRatio;

    var sawAnyFace = false;
    for (final box in faces) {
      if (box.width <= 0 || box.height <= 0) continue;
      sawAnyFace = true;
      if (math.min(box.width, box.height) >= minFaceSide) {
        return FaceVerificationResult.verified;
      }
    }

    // Kotak wajah ada tetapi semuanya terlalu kecil (mis. wajah jauh).
    return sawAnyFace
        ? FaceVerificationResult.tooFar
        : FaceVerificationResult.noFace;
  }

  /// Membaca dimensi foto tanpa perlu knowledge native ML Kit.
  Future<ui.Size?> _decodeImageSize(String path) async {
    try {
      final codec = await ui.instantiateImageCodec(
        await File(path).readAsBytes(),
      );
      try {
        final frame = await codec.getNextFrame();
        try {
          return ui.Size(
            frame.image.width.toDouble(),
            frame.image.height.toDouble(),
          );
        } finally {
          frame.image.dispose();
        }
      } finally {
        codec.dispose();
      }
    } catch (_) {
      return null;
    }
  }

  /// Wajib dipanggil saat layar kamera ditutup agar native detector dilepas.
  Future<void> dispose() async {
    if (_disposed) return;
    _disposed = true;
    final detector = _detector;
    _detector = null;
    if (detector == null) return;
    try {
      await detector.close();
    } catch (_) {
      // Detector native mungkin sudah tidak aktif; tidak perlu mengganggu UI.
    }
  }
}
