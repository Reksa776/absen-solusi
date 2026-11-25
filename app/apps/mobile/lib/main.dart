import 'package:material_ui/material_ui.dart';

import 'api/api_client.dart';
import 'app.dart';
import 'services/auth_service.dart';
import 'services/background_sync_service.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final api = ApiClient();
  runApp(
    AbsensiApp(
      auth: AuthService(api: api, backgroundSync: BackgroundSyncController()),
    ),
  );
}
