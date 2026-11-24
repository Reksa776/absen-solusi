import 'package:material_ui/material_ui.dart';

import '../api/api_client.dart';
import '../models/in_app_notification.dart';
import '../services/auth_service.dart';

class NotificationsScreen extends StatefulWidget {
  const NotificationsScreen({super.key, required this.auth});

  final AuthService auth;

  @override
  State<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends State<NotificationsScreen> {
  InboxPage? _page;
  bool _loading = true;
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final page = await widget.auth.api.myNotifications();
      if (!mounted) return;
      setState(() {
        _page = page;
        _loading = false;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _error = messageForApiError(error);
        _loading = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _error = 'Notifikasi tidak dapat dimuat.';
        _loading = false;
      });
    }
  }

  Future<void> _markRead(InAppNotification item) async {
    if (_busy || item.isRead) return;
    setState(() => _busy = true);
    try {
      await widget.auth.api.markNotificationRead(item.id);
      await _load();
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = messageForApiError(error);
      });
    } finally {
      if (mounted && _busy) setState(() => _busy = false);
    }
  }

  Future<void> _markAllRead() async {
    if (_busy || (_page?.unreadCount ?? 0) == 0) return;
    setState(() => _busy = true);
    try {
      await widget.auth.api.markAllNotificationsRead();
      await _load();
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = messageForApiError(error);
      });
    } finally {
      if (mounted && _busy) setState(() => _busy = false);
    }
  }

  String _stamp(DateTime value) {
    final local = value.toLocal();
    String two(int part) => part.toString().padLeft(2, '0');
    return '${two(local.day)}/${two(local.month)}/${local.year} '
        '${two(local.hour)}:${two(local.minute)}';
  }

  @override
  Widget build(BuildContext context) {
    final page = _page;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Notifikasi'),
        actions: [
          TextButton(
            key: const Key('notifications-read-all'),
            onPressed: _busy || (page?.unreadCount ?? 0) == 0
                ? null
                : _markAllRead,
            child: const Text('Baca semua'),
          ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  if (_error != null)
                    Text(
                      _error!,
                      style: TextStyle(
                        color: Theme.of(context).colorScheme.error,
                      ),
                    ),
                  if (page == null || page.notifications.isEmpty)
                    const Padding(
                      padding: EdgeInsets.only(top: 32),
                      child: Center(child: Text('Belum ada notifikasi.')),
                    )
                  else ...[
                    Text('${page.unreadCount} belum dibaca'),
                    const SizedBox(height: 8),
                    for (final item in page.notifications)
                      Card(
                        key: Key('notification-${item.id}'),
                        color: item.isRead
                            ? null
                            : Theme.of(context).colorScheme.secondaryContainer,
                        child: ListTile(
                          leading: Icon(
                            item.type.contains('REJECTED')
                                ? Icons.error_outline
                                : Icons.notifications_active_outlined,
                          ),
                          title: Text(item.title),
                          subtitle: Text(
                            '${item.body}\n${_stamp(item.createdAt)}',
                          ),
                          isThreeLine: true,
                          trailing: item.isRead
                              ? const Icon(Icons.done, size: 18)
                              : IconButton(
                                  key: Key('notification-read-${item.id}'),
                                  tooltip: 'Tandai dibaca',
                                  onPressed: _busy
                                      ? null
                                      : () => _markRead(item),
                                  icon: const Icon(
                                    Icons.mark_email_read_outlined,
                                  ),
                                ),
                        ),
                      ),
                  ],
                ],
              ),
            ),
    );
  }
}
