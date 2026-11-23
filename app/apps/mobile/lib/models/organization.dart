class OrganizationDivision {
  const OrganizationDivision({required this.id, required this.name});

  factory OrganizationDivision.fromJson(Map<String, dynamic> json) {
    return OrganizationDivision(
      id: json['id'] as String? ?? '',
      name: json['name'] as String? ?? '',
    );
  }

  final String id;
  final String name;
}

class OrganizationPosition {
  const OrganizationPosition({
    required this.id,
    required this.name,
    this.divisionId,
  });

  factory OrganizationPosition.fromJson(Map<String, dynamic> json) {
    return OrganizationPosition(
      id: json['id'] as String? ?? '',
      name: json['name'] as String? ?? '',
      divisionId: json['divisionId'] as String?,
    );
  }

  final String id;
  final String name;
  final String? divisionId;
}

class OrganizationProfile {
  const OrganizationProfile({
    required this.memberId,
    this.division,
    this.position,
  });

  factory OrganizationProfile.fromJson(Map<String, dynamic> json) {
    final division = json['division'];
    final position = json['position'];
    return OrganizationProfile(
      memberId: json['memberId'] as String? ?? '',
      division: division is Map<String, dynamic>
          ? OrganizationDivision.fromJson(division)
          : null,
      position: position is Map<String, dynamic>
          ? OrganizationPosition.fromJson(position)
          : null,
    );
  }

  final String memberId;
  final OrganizationDivision? division;
  final OrganizationPosition? position;

  bool get hasAssignment => division != null || position != null;
}
