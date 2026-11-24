import 'dart:math' as math;

import 'package:material_ui/material_ui.dart';

import '../models/office_location.dart';
import '../services/location_service.dart';

double distanceMeters(double lat1, double lon1, double lat2, double lon2) {
  const radius = 6371000.0;
  double rad(double value) => value * math.pi / 180;
  final dLat = rad(lat2 - lat1);
  final dLon = rad(lon2 - lon1);
  final a =
      math.sin(dLat / 2) * math.sin(dLat / 2) +
      math.cos(rad(lat1)) *
          math.cos(rad(lat2)) *
          math.sin(dLon / 2) *
          math.sin(dLon / 2);
  return 2 * radius * math.asin(math.sqrt(a));
}

class GeofenceMap extends StatelessWidget {
  const GeofenceMap({super.key, required this.office, this.gps});

  final OfficeLocation? office;
  final GpsReading? gps;

  @override
  Widget build(BuildContext context) {
    final currentOffice = office;
    if (currentOffice == null) {
      return const SizedBox(
        height: 150,
        child: Center(child: Text('Lokasi kantor belum tersedia')),
      );
    }
    return ClipRRect(
      borderRadius: BorderRadius.circular(16),
      child: SizedBox(
        height: 170,
        width: double.infinity,
        child: CustomPaint(
          painter: _GeofencePainter(
            office: currentOffice,
            gps: gps,
            colorScheme: Theme.of(context).colorScheme,
          ),
        ),
      ),
    );
  }
}

class _GeofencePainter extends CustomPainter {
  _GeofencePainter({
    required this.office,
    required this.gps,
    required this.colorScheme,
  });

  final OfficeLocation office;
  final GpsReading? gps;
  final ColorScheme colorScheme;

  @override
  void paint(Canvas canvas, Size size) {
    final background = Paint()..color = colorScheme.surfaceContainerHighest;
    canvas.drawRect(Offset.zero & size, background);

    final center = Offset(size.width / 2, size.height / 2);
    final radius = math.min(size.width, size.height) * 0.34;
    final circle = Paint()
      ..color = colorScheme.primary.withValues(alpha: 0.12)
      ..style = PaintingStyle.fill;
    final border = Paint()
      ..color = colorScheme.primary.withValues(alpha: 0.65)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2;
    canvas.drawCircle(center, radius, circle);
    canvas.drawCircle(center, radius, border);

    final officeDot = Paint()..color = colorScheme.primary;
    canvas.drawCircle(center, 7, officeDot);
    final officeLabel = TextPainter(
      text: TextSpan(
        text: office.name,
        style: TextStyle(color: colorScheme.onSurface, fontSize: 11),
      ),
      textDirection: TextDirection.ltr,
    )..layout();
    officeLabel.paint(canvas, center + const Offset(10, -20));

    final reading = gps;
    if (reading == null) return;
    final distance = distanceMeters(
      reading.latitude,
      reading.longitude,
      office.latitude,
      office.longitude,
    );
    final scale = math.min(
      distance / math.max(office.radiusMeters, 1) * radius,
      radius * 1.5,
    );
    final angle = math.atan2(
      reading.latitude - office.latitude,
      reading.longitude - office.longitude,
    );
    final user = center + Offset(math.cos(angle), -math.sin(angle)) * scale;
    final userPaint = Paint()
      ..color = distance <= office.radiusMeters
          ? Colors.green.shade700
          : Colors.red.shade700;
    canvas.drawCircle(user, 8, userPaint);
    canvas.drawCircle(
      user,
      8,
      Paint()
        ..color = Colors.white
        ..style = PaintingStyle.stroke
        ..strokeWidth = 2,
    );
  }

  @override
  bool shouldRepaint(covariant _GeofencePainter oldDelegate) {
    return oldDelegate.gps != gps ||
        oldDelegate.office != office ||
        oldDelegate.colorScheme != colorScheme;
  }
}
