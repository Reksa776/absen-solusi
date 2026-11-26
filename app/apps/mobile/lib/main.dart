import 'package:material_ui/material_ui.dart';

import 'api/api_client.dart';
import 'app.dart';
import 'services/auth_service.dart';
import 'services/push_notification_service.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final api = ApiClient();
  // FCM menggantikan polling notifikasi AlarmManager lama: pesan approval
  // dikirim server lewat push, bukan dibaca berulang dari /notifications/me.
  final push = PushNotificationService();
  await push.initialize();
  runApp(
    AbsensiApp(
      auth: AuthService(api: api, pushSync: push),
    ),
  );
}
