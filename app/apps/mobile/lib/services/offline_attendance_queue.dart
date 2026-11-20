import 'dart:convert';
import 'dart:math';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../models/offline_attendance.dart';

abstract class OfflineQueueStorage {
  Future<String?> read();
  Future<void> write(String value);
}

class SecureOfflineQueueStorage implements OfflineQueueStorage {
  SecureOfflineQueueStorage({FlutterSecureStorage? storage})
    : _storage = storage ?? const FlutterSecureStorage();

  static const _key = 'absensi.offline.queue.v1';
  final FlutterSecureStorage _storage;

  @override
  Future<String?> read() => _storage.read(key: _key);

  @override
  Future<void> write(String value) => _storage.write(key: _key, value: value);
}

class MemoryOfflineQueueStorage implements OfflineQueueStorage {
  String? _value;

  @override
  Future<String?> read() async => _value;

  @override
  Future<void> write(String value) async {
    _value = value;
  }
}

class OfflineAttendanceQueue {
  OfflineAttendanceQueue({OfflineQueueStorage? storage})
    : _storage = storage ?? SecureOfflineQueueStorage();

  final OfflineQueueStorage _storage;

  Future<List<OfflineAttendanceEntry>> pending() async {
    String? raw;
    try {
      raw = await _storage.read();
    } catch (_) {
      return const [];
    }
    if (raw == null || raw.isEmpty) return const [];
    try {
      final decoded = jsonDecode(raw);
      if (decoded is! List) return const [];
      return decoded
          .whereType<Map<String, dynamic>>()
          .map(OfflineAttendanceEntry.fromJson)
          .toList(growable: false);
    } catch (_) {
      return const [];
    }
  }

  Future<int> count() async => (await pending()).length;

  Future<void> add(OfflineAttendanceEntry entry) async {
    final entries = [...await pending(), entry];
    await _save(entries);
  }

  Future<void> remove(String idempotencyKey) async {
    final entries = (await pending())
        .where((entry) => entry.idempotencyKey != idempotencyKey)
        .toList(growable: false);
    await _save(entries);
  }

  Future<int> sync(
    Future<void> Function(OfflineAttendanceEntry entry) send,
  ) async {
    final entries = await pending();
    var synced = 0;
    for (final entry in entries) {
      try {
        await send(entry);
        await remove(entry.idempotencyKey);
        synced += 1;
      } catch (_) {
        // Hentikan antrean pada kegagalan pertama agar urutan check-in/out tetap terjaga.
        break;
      }
    }
    return synced;
  }

  Future<void> _save(List<OfflineAttendanceEntry> entries) async {
    await _storage.write(
      jsonEncode(entries.map((entry) => entry.toJson()).toList()),
    );
  }
}

String createIdempotencyKey() {
  final random = Random.secure();
  final bytes = List<int>.generate(16, (_) => random.nextInt(256));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  String hex(int value) => value.toRadixString(16).padLeft(2, '0');
  final value = bytes.map(hex).join();
  return '${value.substring(0, 8)}-${value.substring(8, 12)}-'
      '${value.substring(12, 16)}-${value.substring(16, 20)}-'
      '${value.substring(20)}';
}
