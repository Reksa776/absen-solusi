class WorkPlanItem {
  const WorkPlanItem({
    required this.id,
    required this.title,
    required this.isCompleted,
    this.completedAt,
    this.proofUrl,
    this.sortOrder = 0,
  });

  final String id;
  final String title;
  final bool isCompleted;
  final DateTime? completedAt;
  final String? proofUrl;
  final int sortOrder;

  factory WorkPlanItem.fromJson(Map<String, dynamic> json) {
    final completedAt = json['completedAt'];
    return WorkPlanItem(
      id: json['id'] as String,
      title: json['title'] as String? ?? '',
      isCompleted: json['isCompleted'] as bool? ?? false,
      completedAt: completedAt is String ? DateTime.tryParse(completedAt) : null,
      proofUrl: json['proofUrl'] as String?,
      sortOrder: json['sortOrder'] as int? ?? 0,
    );
  }
}

class WorkPlan {
  const WorkPlan({
    required this.id,
    required this.workMode,
    required this.date,
    required this.items,
    this.memberId,
    this.attendanceId,
    this.requestId,
    this.locationNote,
    this.planAttachmentUrl,
    this.summaryNote,
    this.completedCount,
    this.totalCount,
  });

  final String id;
  final String workMode;
  final DateTime date;
  final List<WorkPlanItem> items;
  final String? memberId;
  final String? attendanceId;
  final String? requestId;
  final String? locationNote;
  final String? planAttachmentUrl;
  final String? summaryNote;
  final int? completedCount;
  final int? totalCount;

  bool get isRemote => workMode == 'WFH' || workMode == 'WFC';

  int get doneCount =>
      completedCount ?? items.where((item) => item.isCompleted).length;

  int get itemCount => totalCount ?? items.length;

  String get progressLabel => '$doneCount/$itemCount Selesai';

  factory WorkPlan.fromJson(Map<String, dynamic> json) {
    final rawItems = json['items'];
    return WorkPlan(
      id: json['id'] as String,
      workMode: json['workMode'] as String? ?? 'WFH',
      date: DateTime.tryParse(json['date'] as String? ?? '') ?? DateTime.now(),
      items: rawItems is List
          ? rawItems
                .whereType<Map<String, dynamic>>()
                .map(WorkPlanItem.fromJson)
                .toList(growable: false)
          : const [],
      memberId: json['memberId'] as String?,
      attendanceId: json['attendanceId'] as String?,
      requestId: json['requestId'] as String?,
      locationNote: json['locationNote'] as String?,
      planAttachmentUrl: json['planAttachmentUrl'] as String?,
      summaryNote: json['summaryNote'] as String?,
      completedCount: json['completedCount'] as int?,
      totalCount: json['totalCount'] as int?,
    );
  }
}
