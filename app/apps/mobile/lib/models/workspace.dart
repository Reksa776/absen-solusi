class Workspace {
  const Workspace({
    required this.id,
    required this.name,
    required this.slug,
    this.memberId = '',
    this.roleKeys = const [],
  });

  factory Workspace.fromJson(Map<String, dynamic> json) {
    return Workspace(
      id: json['id'] as String? ?? '',
      name: json['name'] as String? ?? '',
      slug: json['slug'] as String? ?? '',
      memberId: json['memberId'] as String? ?? '',
      roleKeys: (json['roleKeys'] as List<dynamic>? ?? const [])
          .map((entry) => entry.toString())
          .toList(growable: false),
    );
  }

  final String id;
  final String name;
  final String slug;
  final String memberId;
  final List<String> roleKeys;
}
