import 'dart:async';

import 'package:material_ui/material_ui.dart';

import '../services/push_service.dart';

/// Menampilkan notifikasi push terakhir di dalam aplikasi (foreground).
class PushNotificationListener extends StatefulWidget {
  const PushNotificationListener({
    super.key,
    required this.service,
    required this.child,
  });

  final PushService service;
  final Widget child;

  @override
  State<PushNotificationListener> createState() => _PushNotificationListenerState();
}

class _PushNotificationListenerState extends State<PushNotificationListener> {
  StreamSubscription<PushMessage>? _subscription;
  PushMessage? _latest;

  @override
  void initState() {
    super.initState();
    _subscription = widget.service.messages.listen((message) {
      if (!mounted) return;
      setState(() => _latest = message);
    });
  }

  @override
  void dispose() {
    _subscription?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final latest = _latest;
    return Column(
      children: [
        if (latest != null)
          MaterialBanner(
            key: const Key('push-banner'),
            content: Text(
              latest.title.isEmpty ? latest.body : '${latest.title}: ${latest.body}',
            ),
            leading: const Icon(Icons.notifications_active_outlined),
            actions: [
              TextButton(
                key: const Key('push-banner-dismiss'),
                onPressed: () => setState(() => _latest = null),
                child: const Text('Tutup'),
              ),
            ],
          ),
        Expanded(child: widget.child),
      ],
    );
  }
}
