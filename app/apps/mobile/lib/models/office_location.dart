class OfficeLocation {
  const OfficeLocation({
    required this.id,
    required this.name,
    required this.latitude,
    required this.longitude,
    required this.radiusMeters,
    required this.timezone,
    required this.workStart,
    required this.workEnd,
    required this.isActive,
  });

  factory OfficeLocation.fromJson(Map<String, dynamic> json) {
    return OfficeLocation(
      id: json['id'] as String? ?? '',
      name: json['name'] as String? ?? '',
      latitude: (json['latitude'] as num?)?.toDouble() ?? 0,
      longitude: (json['longitude'] as num?)?.toDouble() ?? 0,
      radiusMeters: (json['radiusMeters'] as num?)?.toDouble() ?? 0,
      timezone: json['timezone'] as String? ?? 'UTC',
      workStart: json['workStart'] as String? ?? '',
      workEnd: json['workEnd'] as String? ?? '',
      isActive: json['isActive'] as bool? ?? true,
    );
  }

  final String id;
  final String name;
  final double latitude;
  final double longitude;
  final double radiusMeters;
  final String timezone;
  final String workStart;
  final String workEnd;
  final bool isActive;
}
