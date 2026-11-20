import 'dart:async';

import '../api/api_client.dart';

class PushMessage {
  const PushMessage({
    required this.title,
    required this.body,
    this.data = const {},
  });

  final String title;
  final String body;
  final Map<String, dynamic> data;

  factory PushMessage.fromMap(Map<String, dynamic> json) {
    final data = json['data'];
    return PushMessage(
      title: json['title'] as String? ?? '',
      body: json['body'] as String? ?? '',
      data: data is Map<String, dynamic> ? data : const {},
    );
  }
}

/// Abstraksi transport push di sisi perangkat. Adapter FCM/Expo mengisi
/// [getToken] dan [messages]; test memakai [MemoryPushService].
abstract class PushService {
  Future<String?> getToken();
  Stream<PushMessage> get messages;
  Future<void> dispose();
}

class NoopPushService implements PushService {
  const NoopPushService();

  @override
  Future<String?> getToken() async => null;

  @override
  Stream<PushMessage> get messages => const Stream<PushMessage>.empty();

  @override
  Future<void> dispose() async {}
}

class MemoryPushService implements PushService {
  MemoryPushService({this.token});

  final String? token;
  final StreamController<PushMessage> _controller =
      StreamController<PushMessage>.broadcast();

  @override
  Future<String?> getToken() async => token;

  @override
  Stream<PushMessage> get messages => _controller.stream;

  void emit(PushMessage message) => _controller.add(message);

  @override
  Future<void> dispose() => _controller.close();
}

/// Mendaftarkan token perangkat ke backend. Kegagalan tidak boleh mengganggu
/// alur utama aplikasi, jadi error ditelan dan cukup diabaikan.
class PushRegistrar {
  static Future<void> register(
    ApiClient api,
    PushService service, {
    String platform = 'ANDROID',
  }) async {
    try {
      final token = await service.getToken();
      if (token == null || token.isEmpty) return;
      await api.registerDeviceToken(token: token, platform: platform);
    } catch (_) {
      // Push opsional pada alur utama.
    }
  }
}
