class WarningLetter {
  const WarningLetter({
    required this.id,
    required this.level,
    required this.letterNumber,
    required this.issuedAt,
    required this.validUntil,
    required this.violationReason,
    required this.issuedByName,
    required this.isActive,
    this.acknowledgedAt,
  });

  factory WarningLetter.fromJson(Map<String, dynamic> json) {
    return WarningLetter(
      id: json['id'] as String? ?? '',
      level: json['level'] as String? ?? 'SP1',
      letterNumber: json['letterNumber'] as String? ?? '',
      issuedAt:
          DateTime.tryParse(json['issuedAt'] as String? ?? '') ??
          DateTime.fromMillisecondsSinceEpoch(0, isUtc: true),
      validUntil:
          DateTime.tryParse(json['validUntil'] as String? ?? '') ??
          DateTime.fromMillisecondsSinceEpoch(0, isUtc: true),
      violationReason: json['violationReason'] as String? ?? '',
      issuedByName: json['issuedByName'] as String? ?? '',
      isActive: json['isActive'] as bool? ?? false,
      acknowledgedAt: DateTime.tryParse(
        json['acknowledgedAt'] as String? ?? '',
      ),
    );
  }

  final String id;
  final String level;
  final String letterNumber;
  final DateTime issuedAt;
  final DateTime validUntil;
  final String violationReason;
  final String issuedByName;
  final bool isActive;
  final DateTime? acknowledgedAt;

  bool get isAcknowledged => acknowledgedAt != null;
}
