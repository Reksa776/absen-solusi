class MemberDevice {
  const MemberDevice({
    required this.id,
    required this.deviceId,
    required this.deviceName,
    required this.platform,
    required this.status,
    required this.lastSeenAt,
  });

  factory MemberDevice.fromJson(Map<String, dynamic> json) {
    return MemberDevice(
      id: json['id'] as String? ?? '',
      deviceId: json['deviceId'] as String? ?? '',
      deviceName: json['deviceName'] as String? ?? '',
      platform: json['platform'] as String? ?? '',
      status: json['status'] as String? ?? 'PENDING',
      lastSeenAt:
          DateTime.tryParse(json['lastSeenAt'] as String? ?? '') ??
          DateTime.fromMillisecondsSinceEpoch(0, isUtc: true),
    );
  }

  final String id;
  final String deviceId;
  final String deviceName;
  final String platform;
  final String status;
  final DateTime lastSeenAt;

  bool get isPending => status == 'PENDING';
  bool get isApproved => status == 'APPROVED';
  bool get isRevoked => status == 'REVOKED';
  bool get blocksAttendance => !isApproved;
}
