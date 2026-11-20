class OfflineAttendanceEntry {
  const OfflineAttendanceEntry({
    required this.type,
    required this.latitude,
    required this.longitude,
    required this.accuracyMeters,
    required this.isMockLocation,
    required this.clientCapturedAt,
    required this.photoPath,
    required this.idempotencyKey,
  });

  final String type;
  final double latitude;
  final double longitude;
  final double accuracyMeters;
  final bool isMockLocation;
  final DateTime clientCapturedAt;
  final String photoPath;
  final String idempotencyKey;

  Map<String, dynamic> toJson() => {
    'type': type,
    'latitude': latitude,
    'longitude': longitude,
    'accuracyMeters': accuracyMeters,
    'isMockLocation': isMockLocation,
    'clientCapturedAt': clientCapturedAt.toUtc().toIso8601String(),
    'photoPath': photoPath,
    'idempotencyKey': idempotencyKey,
  };

  factory OfflineAttendanceEntry.fromJson(Map<String, dynamic> json) {
    return OfflineAttendanceEntry(
      type: json['type'] as String? ?? 'CHECK_IN',
      latitude: (json['latitude'] as num?)?.toDouble() ?? 0,
      longitude: (json['longitude'] as num?)?.toDouble() ?? 0,
      accuracyMeters: (json['accuracyMeters'] as num?)?.toDouble() ?? 0,
      isMockLocation: json['isMockLocation'] as bool? ?? false,
      clientCapturedAt:
          DateTime.tryParse(json['clientCapturedAt'] as String? ?? '') ??
          DateTime.now().toUtc(),
      photoPath: json['photoPath'] as String? ?? '',
      idempotencyKey: json['idempotencyKey'] as String? ?? '',
    );
  }
}
