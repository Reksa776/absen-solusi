import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:timezone/data/latest.dart' as tz_data;
import 'package:timezone/timezone.dart' as tz;

import '../models/schedule.dart';

class ReminderSettings {
  const ReminderSettings({this.enabled = true, this.minutesBefore = 15});

  final bool enabled;
  final int minutesBefore;

  ReminderSettings copyWith({bool? enabled, int? minutesBefore}) {
    return ReminderSettings(
      enabled: enabled ?? this.enabled,
      minutesBefore: minutesBefore ?? this.minutesBefore,
    );
  }
}

class ReminderSettingsStore {
  ReminderSettingsStore({FlutterSecureStorage? storage})
    : _storage = storage ?? const FlutterSecureStorage();

  static const _enabledKey = 'attendance_reminder_enabled';
  static const _minutesKey = 'attendance_reminder_minutes';

  final FlutterSecureStorage _storage;

  Future<ReminderSettings> read() async {
    try {
      final enabled = await _storage.read(key: _enabledKey);
      final minutes = await _storage.read(key: _minutesKey);
      final parsed = int.tryParse(minutes ?? '');
      return ReminderSettings(
        enabled: enabled == null ? true : enabled == 'true',
        minutesBefore: parsed != null && parsed >= 0 && parsed <= 120
            ? parsed
            : 15,
      );
    } catch (_) {
      return const ReminderSettings();
    }
  }

  Future<void> write(ReminderSettings settings) async {
    try {
      await _storage.write(
        key: _enabledKey,
        value: settings.enabled ? 'true' : 'false',
      );
      await _storage.write(
        key: _minutesKey,
        value: '${settings.minutesBefore}',
      );
    } catch (_) {
      // Penyimpanan pengaturan bersifat opsional; default tetap dipakai.
    }
  }
}

/// Pengingat absensi lokal: check-in sebelum shift dan check-out saat shift
/// berakhir. Jadwal disusun untuk 14 hari ke depan agar hari libur dan akhir
/// pekan bisa dikecualikan tanpa job latar tambahan.
class AttendanceReminderService {
  AttendanceReminderService({
    FlutterLocalNotificationsPlugin? plugin,
    ReminderSettingsStore? store,
  }) : _plugin = plugin ?? FlutterLocalNotificationsPlugin(),
       _store = store ?? ReminderSettingsStore();

  static const int windowDays = 14;
  static const String _channelId = 'attendance_reminder';
  static const int _checkInBase = 710000;
  static const int _checkOutBase = 720000;
  static const int _checkOutLateBase = 730000;

  final FlutterLocalNotificationsPlugin _plugin;
  final ReminderSettingsStore _store;
  bool _ready = false;

  Future<void> init() async {
    if (_ready) return;
    try {
      tz_data.initializeTimeZones();
    } catch (_) {
      // Zona waktu sudah diinisialisasi proses lain.
    }
    try {
      const settings = InitializationSettings(
        android: AndroidInitializationSettings('@mipmap/ic_launcher'),
        iOS: DarwinInitializationSettings(
          requestAlertPermission: true,
          requestBadgePermission: true,
          requestSoundPermission: true,
        ),
      );
      await _plugin.initialize(settings: settings);
      final android = _plugin
          .resolvePlatformSpecificImplementation<
            AndroidFlutterLocalNotificationsPlugin
          >();
      await android?.requestNotificationsPermission();
      await android?.requestExactAlarmsPermission();
      _ready = true;
    } catch (error) {
      debugPrint('Pengingat absensi tidak aktif: $error');
    }
  }

  Future<ReminderSettings> loadSettings() => _store.read();

  /// Tombol uji di Profil memakai channel dan audio yang sama dengan alarm asli.
  Future<bool> showTestAlarm() async {
    await init();
    if (!_ready) return false;
    try {
      await _plugin.show(
        id: 799999,
        title: 'Uji alarm presensi',
        body: 'Alarm presensi aktif. Bunyi ini juga dipakai saat jam masuk/pulang.',
        notificationDetails: _alarmDetails(),
      );
      return true;
    } catch (error) {
      debugPrint('Uji alarm gagal: $error');
      return false;
    }
  }

  Future<void> saveSettings(ReminderSettings settings) async {
    await _store.write(settings);
    if (!settings.enabled) {
      await cancelAll();
    }
  }

  /// Susun ulang pengingat dari jadwal mingguan, mengecualikan hari libur,
  /// akhir pekan, dan absen yang sudah tercatat hari ini.
  Future<void> sync({
    required WorkSchedule schedule,
    required ReminderSettings settings,
    bool checkedInToday = false,
    bool checkedOutToday = false,
    DateTime? now,
  }) async {
    await init();
    if (!_ready) return;
    if (!settings.enabled) {
      await cancelAll();
      return;
    }

    final localNow = now ?? DateTime.now();
    final today = DateTime(localNow.year, localNow.month, localNow.day);
    tz.Location location;
    try {
      location = tz.getLocation(schedule.timezone);
    } catch (_) {
      location = tz.getLocation('Asia/Jakarta');
    }

    for (var offset = 0; offset < windowDays; offset++) {
      await _cancelDay(offset);
      final day = today.add(Duration(days: offset));
      final entry = schedule.dayFor(day);
      if (entry == null || !entry.isWorkday) continue;
      if (schedule.isHoliday(day)) continue;

      final start = _at(location, day, entry.startTime);
      final end = _at(location, day, entry.endTime);
      final endWithLate = end.isBefore(start)
          ? end.add(const Duration(days: 1))
          : end;
      final checkInAt = start.subtract(
        Duration(minutes: settings.minutesBefore),
      );

      if (!(offset == 0 && checkedInToday) && checkInAt.isAfter(localNow)) {
        await _schedule(
          _checkInBase + offset,
          'Pengingat check-in',
          'Shift dimulai pukul ${entry.startTime}. Jangan lupa absen masuk.',
          checkInAt,
        );
      }

      // Pengingat check-out hanya untuk hari ini bila sudah check-in, dan
      // dibatalkan bila check-out sudah tercatat.
      final skipCheckout = offset == 0 && (!checkedInToday || checkedOutToday);
      if (!skipCheckout) {
        final checkoutAt = endWithLate.isAfter(start)
            ? endWithLate
            : start.add(const Duration(hours: 9));
        if (checkoutAt.isAfter(localNow)) {
          await _schedule(
            _checkOutBase + offset,
            'Pengingat check-out',
            'Shift berakhir pukul ${entry.endTime}. Absen pulang sekarang.',
            checkoutAt,
          );
        }
        final lateAt = checkoutAt.add(const Duration(minutes: 15));
        if (lateAt.isAfter(localNow)) {
          await _schedule(
            _checkOutLateBase + offset,
            'Belum check-out',
            'Anda belum absen pulang. Segera lakukan check-out.',
            lateAt,
          );
        }
      }
    }
  }

  /// Batalkan pengingat check-in/check-out hari ini setelah absen tercatat.
  Future<void> cancelToday({
    bool checkIn = false,
    bool checkOut = false,
  }) async {
    await init();
    if (!_ready) return;
    try {
      if (checkIn) await _plugin.cancel(id: _checkInBase);
      if (checkOut) {
        await _plugin.cancel(id: _checkOutBase);
        await _plugin.cancel(id: _checkOutLateBase);
      }
    } catch (_) {
      // Pembatalan gagal bukan alasan menggagalkan absensi.
    }
  }

  Future<void> cancelAll() async {
    await init();
    if (!_ready) return;
    try {
      for (var offset = 0; offset < windowDays; offset++) {
        await _cancelDay(offset);
      }
    } catch (_) {
      // Diamkan: notifikasi mungkin belum pernah dijadwalkan.
    }
  }

  Future<void> _cancelDay(int offset) async {
    try {
      await _plugin.cancel(id: _checkInBase + offset);
      await _plugin.cancel(id: _checkOutBase + offset);
      await _plugin.cancel(id: _checkOutLateBase + offset);
    } catch (_) {
      // Tidak ada jadwal tersimpan.
    }
  }

  tz.TZDateTime _at(tz.Location location, DateTime day, String clock) {
    final parts = clock.split(':');
    final hour = int.tryParse(parts.isNotEmpty ? parts[0] : '') ?? 9;
    final minute = int.tryParse(parts.length > 1 ? parts[1] : '') ?? 0;
    return tz.TZDateTime(location, day.year, day.month, day.day, hour, minute);
  }

  NotificationDetails _alarmDetails() {
    return NotificationDetails(
      android: AndroidNotificationDetails(
        _channelId,
        'Pengingat absensi',
        channelDescription: 'Alarm check-in dan check-out sesuai shift.',
        importance: Importance.max,
        priority: Priority.high,
        category: AndroidNotificationCategory.alarm,
        fullScreenIntent: true,
        playSound: true,
        enableVibration: true,
        vibrationPattern: Int64List.fromList([0, 700, 350, 700, 350, 1200]),
        audioAttributesUsage: AudioAttributesUsage.alarm,
      ),
      iOS: DarwinNotificationDetails(
        presentAlert: true,
        presentBadge: true,
        presentSound: true,
        interruptionLevel: InterruptionLevel.timeSensitive,
      ),
    );
  }

  Future<void> _schedule(
    int id,
    String title,
    String body,
    tz.TZDateTime when,
  ) async {
    final details = _alarmDetails();
    try {
      await _plugin.zonedSchedule(
        id: id,
        title: title,
        body: body,
        scheduledDate: when,
        notificationDetails: details,
        androidScheduleMode: AndroidScheduleMode.exactAllowWhileIdle,
      );
    } catch (_) {
      try {
        await _plugin.zonedSchedule(
          id: id,
          title: title,
          body: body,
          scheduledDate: when,
          notificationDetails: details,
          androidScheduleMode: AndroidScheduleMode.inexactAllowWhileIdle,
        );
      } catch (error) {
        debugPrint('Gagal menjadwalkan pengingat absensi: $error');
      }
    }
  }
}
