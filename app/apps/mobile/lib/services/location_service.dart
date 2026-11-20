import 'package:geolocator/geolocator.dart';

class GpsReading {
  const GpsReading({
    required this.latitude,
    required this.longitude,
    required this.accuracyMeters,
    required this.isMocked,
  });

  final double latitude;
  final double longitude;
  final double accuracyMeters;
  final bool isMocked;
}

enum LocationProblem { serviceDisabled, permissionDenied, permissionDeniedForever }

class LocationUnavailableException implements Exception {
  const LocationUnavailableException(
    this.message, {
    this.problem = LocationProblem.permissionDenied,
  });

  final String message;
  final LocationProblem problem;

  bool get canOpenSettings =>
      problem == LocationProblem.serviceDisabled ||
      problem == LocationProblem.permissionDeniedForever;

  @override
  String toString() => message;
}

class LocationService {
  Future<GpsReading> current() async {
    if (!await Geolocator.isLocationServiceEnabled()) {
      throw const LocationUnavailableException(
        'Layanan lokasi tidak aktif. Aktifkan GPS perangkat.',
        problem: LocationProblem.serviceDisabled,
      );
    }
    var permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
    }
    if (permission == LocationPermission.denied) {
      throw const LocationUnavailableException(
        'Izin lokasi ditolak.',
        problem: LocationProblem.permissionDenied,
      );
    }
    if (permission == LocationPermission.deniedForever) {
      throw const LocationUnavailableException(
        'Izin lokasi ditolak permanen. Buka pengaturan aplikasi.',
        problem: LocationProblem.permissionDeniedForever,
      );
    }

    final position = await Geolocator.getCurrentPosition(
      locationSettings: const LocationSettings(
        accuracy: LocationAccuracy.high,
        timeLimit: Duration(seconds: 20),
      ),
    );
    return GpsReading(
      latitude: position.latitude,
      longitude: position.longitude,
      accuracyMeters: position.accuracy,
      // Geolocator mengekspos flag mock dari provider Android/iOS. Server tetap
      // memeriksa ulang dan menolak flag true; ini bukan satu-satunya kontrol.
      isMocked: position.isMocked,
    );
  }

  /// Membuka pengaturan lokasi (GPS mati) atau pengaturan aplikasi (izin
  /// ditolak permanen) agar karyawan dapat memperbaiki sendiri.
  Future<void> openSettings(LocationProblem problem) async {
    if (problem == LocationProblem.serviceDisabled) {
      await Geolocator.openLocationSettings();
      return;
    }
    await Geolocator.openAppSettings();
  }
}
