class BroadcastMessage {
  const BroadcastMessage({
    required this.id,
    required this.title,
    required this.content,
    required this.audienceType,
    required this.priority,
    required this.createdByName,
    required this.createdAt,
    this.divisionName,
    this.locationName,
    this.publishedAt,
  });

  factory BroadcastMessage.fromJson(Map<String, dynamic> json) {
    return BroadcastMessage(
      id: json['id'] as String? ?? '',
      title: json['title'] as String? ?? '',
      content: json['content'] as String? ?? '',
      audienceType: json['audienceType'] as String? ?? 'ALL',
      divisionName: json['divisionName'] as String?,
      locationName: json['locationName'] as String?,
      priority: json['priority'] as String? ?? 'NORMAL',
      publishedAt: DateTime.tryParse(json['publishedAt'] as String? ?? ''),
      createdByName: json['createdByName'] as String? ?? '',
      createdAt:
          DateTime.tryParse(json['createdAt'] as String? ?? '') ??
          DateTime.fromMillisecondsSinceEpoch(0, isUtc: true),
    );
  }

  final String id;
  final String title;
  final String content;
  final String audienceType;
  final String? divisionName;
  final String? locationName;
  final String priority;
  final DateTime? publishedAt;
  final String createdByName;
  final DateTime createdAt;

  bool get isImportant => priority == 'PENTING';

  String get audienceLabel => switch (audienceType) {
    'DIVISION' => divisionName ?? 'Divisi',
    'LOCATION' => locationName ?? 'Lokasi',
    _ => 'Semua karyawan',
  };
}
