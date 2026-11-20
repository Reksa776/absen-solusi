class InAppNotification {
  const InAppNotification({
    required this.id,
    required this.type,
    required this.title,
    required this.body,
    required this.isRead,
    required this.createdAt,
    this.linkUrl,
  });

  final String id;
  final String type;
  final String title;
  final String body;
  final String? linkUrl;
  final bool isRead;
  final DateTime createdAt;

  factory InAppNotification.fromJson(Map<String, dynamic> json) {
    return InAppNotification(
      id: json['id'] as String? ?? '',
      type: json['type'] as String? ?? '',
      title: json['title'] as String? ?? '',
      body: json['body'] as String? ?? '',
      linkUrl: json['linkUrl'] as String?,
      isRead: json['isRead'] as bool? ?? false,
      createdAt:
          DateTime.tryParse(json['createdAt'] as String? ?? '') ??
          DateTime.fromMillisecondsSinceEpoch(0, isUtc: true),
    );
  }
}

class InboxPage {
  const InboxPage({required this.notifications, required this.unreadCount});

  final List<InAppNotification> notifications;
  final int unreadCount;

  factory InboxPage.fromJson(Map<String, dynamic> json) {
    final rows = json['notifications'];
    return InboxPage(
      notifications: rows is List
          ? rows
                .whereType<Map<String, dynamic>>()
                .map(InAppNotification.fromJson)
                .toList(growable: false)
          : const [],
      unreadCount: json['unreadCount'] as int? ?? 0,
    );
  }
}
