class ProfilePhotoStatus {
  const ProfilePhotoStatus({
    required this.status,
    this.photoUrl,
    this.rejectionReason,
  });

  factory ProfilePhotoStatus.fromJson(Map<String, dynamic> json) {
    return ProfilePhotoStatus(
      status: json['status'] as String? ?? 'NONE',
      photoUrl: json['photoUrl'] as String?,
      rejectionReason: json['rejectionReason'] as String?,
    );
  }

  final String status;
  final String? photoUrl;
  final String? rejectionReason;

  bool get hasPhoto => photoUrl != null && photoUrl!.isNotEmpty;
  bool get isPending => status == 'PENDING';
  bool get isApproved => status == 'APPROVED';
  bool get isRejected => status == 'REJECTED';

  String get label {
    switch (status) {
      case 'PENDING':
        return 'Menunggu persetujuan';
      case 'APPROVED':
        return 'Disetujui';
      case 'REJECTED':
        return 'Ditolak';
      default:
        return 'Belum ada foto';
    }
  }
}
