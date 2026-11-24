import 'dart:async';
import 'dart:typed_data';

import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';
import 'package:material_ui/material_ui.dart';
import 'package:url_launcher/url_launcher.dart';

import '../models/attendance_log.dart';
import '../services/auth_service.dart';
import '../theme/app_theme.dart';
import 'correction_form_screen.dart';

const _monthShort = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'Mei',
  'Jun',
  'Jul',
  'Agu',
  'Sep',
  'Okt',
  'Nov',
  'Des',
];

String _two(int value) => value.toString().padLeft(2, '0');

/// Halaman detail untuk satu kejadian presensi saja (Masuk atau Keluar).
class ActivityDetailScreen extends StatelessWidget {
  const ActivityDetailScreen({
    super.key,
    required this.auth,
    required this.type,
    this.log,
    this.date,
  });

  final AuthService auth;

  /// `CHECK_IN` atau `CHECK_OUT`; menentukan label dan target revisi.
  final String type;
  final AttendanceLog? log;
  final DateTime? date;

  bool get _isCheckIn => type == 'CHECK_IN';

  String get _typeLabel => _isCheckIn ? 'Masuk' : 'Keluar';

  String _time(DateTime value) {
    final local = value.toLocal();
    return '${_two(local.hour)}:${_two(local.minute)}';
  }

  String _dateLabel(DateTime value) {
    final local = value.toLocal();
    return '${local.day} ${_monthShort[local.month - 1]} ${local.year}';
  }

  DateTime get _eventDate =>
      log?.workDate ?? date ?? log?.timestampServer ?? DateTime.now();

  String _coordinate(double? value) =>
      value == null ? '—' : value.toStringAsFixed(7);

  String get _spotLabel {
    final row = log;
    if (row == null) return 'Belum tercatat';
    if (row.isOutOfTown) return 'Dinas Luar Kota';
    if (row.outOfRadius) return 'Di Luar Radius';
    return 'Sesuai Spot Presensi';
  }

  Color get _spotColor {
    final row = log;
    if (row == null) return AppColors.muted;
    if (row.isOutOfTown) return AppColors.yellowInk;
    if (row.outOfRadius) return AppColors.danger;
    return AppColors.green;
  }

  Future<void> _openRevision(BuildContext context) async {
    final row = log;
    final saved = await Navigator.of(context).push<bool>(
      MaterialPageRoute<bool>(
        fullscreenDialog: true,
        builder: (_) => CorrectionFormScreen(
          auth: auth,
          initialDate: _eventDate.toLocal(),
          initialCheckInTime: _isCheckIn
              ? row?.timestampServer.toLocal()
              : null,
          initialCheckOutTime: _isCheckIn
              ? null
              : row?.timestampServer.toLocal(),
          initialKind: 'ADJUST',
          logType: type,
          attendanceLogId: row?.id,
        ),
      ),
    );
    if (saved == true && context.mounted) Navigator.of(context).pop(true);
  }

  Future<void> _openMap(BuildContext context, AttendanceLog row) async {
    final latitude = row.latitude;
    final longitude = row.longitude;
    if (latitude == null || longitude == null) return;
    final point = LatLng(latitude, longitude);
    await showModalBottomSheet<void>(
      context: context,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(18)),
      ),
      builder: (sheetContext) => SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 14, 16, 16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                'Lokasi $_typeLabel',
                style: const TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w800,
                  color: AppColors.ink,
                ),
              ),
              const SizedBox(height: 8),
              ClipRRect(
                borderRadius: BorderRadius.circular(12),
                child: SizedBox(
                  height: 220,
                  child: FlutterMap(
                    key: const Key('activity-detail-map-preview'),
                    options: MapOptions(
                      initialCenter: point,
                      initialZoom: 17,
                      minZoom: 3,
                      maxZoom: 19,
                      interactionOptions: const InteractionOptions(
                        flags:
                            InteractiveFlag.drag |
                            InteractiveFlag.pinchZoom |
                            InteractiveFlag.doubleTapZoom,
                      ),
                    ),
                    children: [
                      TileLayer(
                        urlTemplate:
                            'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                        userAgentPackageName: 'com.absensi.absensi_mobile',
                      ),
                      MarkerLayer(
                        markers: [
                          Marker(
                            width: 44,
                            height: 44,
                            alignment: Alignment.topCenter,
                            point: point,
                            child: const Icon(
                              Icons.location_on,
                              size: 40,
                              color: AppColors.green,
                            ),
                          ),
                        ],
                      ),
                      RichAttributionWidget(
                        attributions: [
                          TextSourceAttribution(
                            'OpenStreetMap contributors',
                            onTap: () => unawaited(
                              launchUrl(
                                Uri.parse(
                                  'https://www.openstreetmap.org/copyright',
                                ),
                                mode: LaunchMode.externalApplication,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 10),
              SizedBox(
                height: 46,
                child: FilledButton.icon(
                  key: const Key('activity-detail-open-maps'),
                  onPressed: () => _openExternalMap(latitude, longitude),
                  icon: const Icon(Icons.map_outlined, size: 17),
                  label: const Text('Buka di Google Maps'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _openExternalMap(double latitude, double longitude) async {
    final uri = Uri.https('www.google.com', '/maps/search/', {
      'api': '1',
      'query': '$latitude,$longitude',
    });
    await launchUrl(uri, mode: LaunchMode.externalApplication);
  }

  @override
  Widget build(BuildContext context) {
    final row = log;
    final eventAt = row?.timestampServer;
    return Scaffold(
      key: const Key('activity-detail'),
      backgroundColor: AppColors.canvas,
      appBar: AppBar(title: const Text('Detail Aktivitas')),
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Expanded(
            child: ListView(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
              children: [
                _summary(eventAt),
                const SizedBox(height: 14),
                _selfie(row),
                const SizedBox(height: 14),
                _location(context, row),
                const SizedBox(height: 14),
                _device(row),
              ],
            ),
          ),
          _revisionBar(context),
        ],
      ),
    );
  }

  Widget _summary(DateTime? eventAt) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0xFFF1F5F3),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.line),
      ),
      child: Row(
        children: [
          Container(
            width: 38,
            height: 38,
            decoration: BoxDecoration(
              color: _isCheckIn ? AppColors.greenSoft : AppColors.surface,
              borderRadius: BorderRadius.circular(11),
              border: Border.all(
                color: _isCheckIn ? AppColors.greenLine : AppColors.line,
              ),
            ),
            child: Icon(
              _isCheckIn ? Icons.login : Icons.logout,
              size: 18,
              color: _isCheckIn ? AppColors.greenDark : AppColors.muted,
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Text(
              _typeLabel,
              key: const Key('activity-detail-type'),
              style: const TextStyle(
                fontSize: 19,
                fontWeight: FontWeight.w800,
                letterSpacing: -0.3,
                color: AppColors.ink,
              ),
            ),
          ),
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Text(
                eventAt == null ? '—' : _time(eventAt),
                key: const Key('activity-detail-time'),
                style: const TextStyle(
                  fontSize: 24,
                  height: 1,
                  fontWeight: FontWeight.w800,
                  letterSpacing: -0.5,
                  color: AppColors.ink,
                  fontFeatures: tabularFigures,
                ),
              ),
              const SizedBox(height: 4),
              Text(
                _dateLabel(_eventDate),
                key: const Key('activity-detail-date'),
                style: const TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w600,
                  color: AppColors.muted,
                  fontFeatures: tabularFigures,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _selfie(AttendanceLog? row) {
    if (row == null || row.photoUrl.isEmpty) return _photoPlaceholder();
    return ClipRRect(
      key: const Key('activity-detail-photo'),
      borderRadius: BorderRadius.circular(14),
      child: FutureBuilder<Uint8List?>(
        future: auth.api.attendancePhotoBytes(row.photoUrl),
        builder: (context, snapshot) {
          if (snapshot.connectionState != ConnectionState.done) {
            return Container(
              height: 180,
              color: AppColors.tableHead,
              child: const Center(
                child: SizedBox.square(
                  dimension: 18,
                  child: CircularProgressIndicator(strokeWidth: 2),
                ),
              ),
            );
          }
          final bytes = snapshot.data;
          if (bytes == null || bytes.isEmpty) return _photoPlaceholder();
          return Image.memory(
            bytes,
            height: 180,
            width: double.infinity,
            fit: BoxFit.cover,
            errorBuilder: (_, _, _) => _photoPlaceholder(),
          );
        },
      ),
    );
  }

  Widget _photoPlaceholder() {
    return Container(
      key: const Key('activity-detail-photo-empty'),
      height: 110,
      decoration: BoxDecoration(
        color: AppColors.tableHead,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.line),
      ),
      child: const Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(Icons.no_photography_outlined, size: 24, color: AppColors.muted),
          SizedBox(height: 5),
          Text(
            'Foto selfie tidak tersedia',
            style: TextStyle(fontSize: 10.5, color: AppColors.muted),
          ),
        ],
      ),
    );
  }

  Widget _location(BuildContext context, AttendanceLog? row) {
    final canOpenMap = row?.latitude != null && row?.longitude != null;
    return _section(
      key: const Key('activity-detail-location'),
      icon: Icons.place_outlined,
      title: 'Lokasi',
      children: [
        _keyValue(
          'Status',
          _spotLabel,
          valueColor: _spotColor,
          valueKey: const Key('activity-detail-status'),
        ),
        const Divider(height: 14),
        _keyValue(
          'Longitude',
          _coordinate(row?.longitude),
          valueKey: const Key('activity-detail-longitude'),
        ),
        const Divider(height: 14),
        _keyValue(
          'Latitude',
          _coordinate(row?.latitude),
          valueKey: const Key('activity-detail-latitude'),
        ),
        const SizedBox(height: 12),
        SizedBox(
          height: 44,
          child: OutlinedButton.icon(
            key: const Key('activity-detail-map'),
            onPressed: canOpenMap && row != null
                ? () => _openMap(context, row)
                : null,
            icon: const Icon(Icons.map_outlined, size: 17),
            label: const Text('Lihat di Peta'),
          ),
        ),
      ],
    );
  }

  Widget _device(AttendanceLog? row) {
    return _section(
      key: const Key('activity-detail-device'),
      icon: Icons.smartphone_outlined,
      title: 'Perangkat',
      children: [
        _keyValue(
          'Nama',
          row?.deviceName ?? row?.deviceInfo ?? '—',
          valueKey: const Key('activity-detail-device-name'),
        ),
        const Divider(height: 14),
        _keyValue(
          'ID Perangkat',
          row?.deviceId ?? '—',
          valueKey: const Key('activity-detail-device-id'),
        ),
        const Divider(height: 14),
        _keyValue(
          'Model Perangkat',
          row?.deviceModel ?? '—',
          valueKey: const Key('activity-detail-device-model'),
        ),
        const Divider(height: 14),
        _keyValue(
          'Pembuat Perangkat',
          row?.deviceManufacturer ?? '—',
          valueKey: const Key('activity-detail-device-manufacturer'),
        ),
      ],
    );
  }

  Widget _section({
    required Key key,
    required IconData icon,
    required String title,
    required List<Widget> children,
  }) {
    return Container(
      key: key,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.line),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Icon(icon, size: 17, color: AppColors.green),
              const SizedBox(width: 6),
              Text(
                title,
                style: const TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w800,
                  color: AppColors.ink,
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          ...children,
        ],
      ),
    );
  }

  Widget _keyValue(
    String label,
    String value, {
    Color? valueColor,
    Key? valueKey,
  }) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(
          width: 120,
          child: Text(
            label,
            style: const TextStyle(fontSize: 11.5, color: AppColors.muted),
          ),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: Text(
            value,
            key: valueKey,
            textAlign: TextAlign.right,
            style: TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w700,
              color: valueColor ?? AppColors.ink,
              fontFeatures: tabularFigures,
            ),
          ),
        ),
      ],
    );
  }

  Widget _revisionBar(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(16, 10, 16, 10),
      decoration: const BoxDecoration(
        color: AppColors.surface,
        border: Border(top: BorderSide(color: AppColors.line)),
      ),
      child: SafeArea(
        top: false,
        child: SizedBox(
          height: 50,
          child: FilledButton.icon(
            key: const Key('activity-detail-revise'),
            onPressed: () => _openRevision(context),
            style: FilledButton.styleFrom(
              backgroundColor: AppColors.green,
              foregroundColor: Colors.white,
              shape: const StadiumBorder(),
            ),
            icon: const Icon(Icons.history, size: 18),
            label: const Text('Revisi Kehadiran'),
          ),
        ),
      ),
    );
  }
}
