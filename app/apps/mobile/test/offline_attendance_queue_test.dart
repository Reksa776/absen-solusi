import 'package:absensi_mobile/models/offline_attendance.dart';
import 'package:absensi_mobile/services/offline_attendance_queue.dart';
import 'package:flutter_test/flutter_test.dart';

OfflineAttendanceEntry entry(String key, {String type = 'CHECK_IN'}) {
  return OfflineAttendanceEntry(
    type: type,
    latitude: -6.2,
    longitude: 106.8,
    accuracyMeters: 5,
    isMockLocation: false,
    clientCapturedAt: DateTime.utc(2026, 11, 20, 3),
    photoPath: '/tmp/$key.jpg',
    idempotencyKey: key,
  );
}

void main() {
  test('antrean tersimpan persisten dan payload lengkap', () async {
    final storage = MemoryOfflineQueueStorage();
    final first = OfflineAttendanceQueue(storage: storage);
    await first.add(entry('key-1'));
    await first.add(entry('key-2', type: 'CHECK_OUT'));

    final reopened = OfflineAttendanceQueue(storage: storage);
    final rows = await reopened.pending();
    expect(rows.length, 2);
    expect(rows.first.latitude, -6.2);
    expect(rows.first.photoPath, '/tmp/key-1.jpg');
    expect(rows.first.clientCapturedAt.isUtc, true);
    expect(rows.last.type, 'CHECK_OUT');
    expect(await reopened.count(), 2);
  });

  test(
    'sinkronisasi menghapus yang sukses dan berhenti pada kegagalan',
    () async {
      final queue = OfflineAttendanceQueue(
        storage: MemoryOfflineQueueStorage(),
      );
      await queue.add(entry('key-1'));
      await queue.add(entry('key-2'));
      final attempted = <String>[];

      final synced = await queue.sync((item) async {
        attempted.add(item.idempotencyKey);
        if (item.idempotencyKey == 'key-2') throw Exception('offline');
      });

      expect(synced, 1);
      expect(attempted, ['key-1', 'key-2']);
      expect((await queue.pending()).single.idempotencyKey, 'key-2');
    },
  );

  test('idempotency key adalah UUID v4 unik dan aman dipakai retry', () {
    final pattern = RegExp(
      r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
    );
    final keys = List.generate(100, (_) => createIdempotencyKey());
    expect(keys.every(pattern.hasMatch), true);
    expect(keys.toSet().length, 100);
  });

  test('storage rusak tidak membuat aplikasi crash', () async {
    final storage = MemoryOfflineQueueStorage();
    await storage.write('{bukan json');
    final queue = OfflineAttendanceQueue(storage: storage);
    expect(await queue.pending(), isEmpty);
  });
}
