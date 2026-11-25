import 'dart:async';

import 'package:material_ui/material_ui.dart';

import '../api/api_client.dart';
import '../models/broadcast.dart';
import '../models/in_app_notification.dart';
import '../services/auth_service.dart';
import '../services/background_sync_service.dart';
import '../services/live_sync.dart';
import '../theme/app_theme.dart';
import 'broadcasts_screen.dart';
import 'requests_tab.dart';

String _two(int value) => value.toString().padLeft(2, '0');

/// Tab Pesan: pengingat/broadcast dan seluruh status submisi karyawan.
class MessagesTab extends StatefulWidget {
  const MessagesTab({
    super.key,
    required this.auth,
    this.readiness,
    this.onUnreadChanged,
  });

  final AuthService auth;

  /// Status izin notifikasi latar; ditampilkan sebagai strip singkat di atas
  /// daftar pesan.
  final BackgroundReadinessController? readiness;

  final ValueChanged<int>? onUnreadChanged;

  @override
  State<MessagesTab> createState() => _MessagesTabState();
}

class _MessagesTabState extends State<MessagesTab> {
  InboxPage? _page;
  List<BroadcastMessage> _broadcasts = const [];
  int _segment = 0;
  String _filter = 'ALL';
  bool _loading = true;
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    LiveSync.instance.addListener(_onLiveSync);
    _load();
  }

  @override
  void dispose() {
    LiveSync.instance.removeListener(_onLiveSync);
    super.dispose();
  }

  void _onLiveSync() {
    if (mounted) unawaited(_load(silent: true));
  }

  Future<void> _load({bool silent = false}) async {
    if (!silent) {
      setState(() {
        _loading = true;
        _error = null;
      });
    }
    try {
      final results = await Future.wait([
        widget.auth.api.myNotifications(),
        widget.auth.api.myBroadcasts(),
      ]);
      if (!mounted) return;
      final page = results[0] as InboxPage;
      setState(() {
        _page = page;
        _broadcasts = results[1] as List<BroadcastMessage>;
        _loading = false;
      });
      widget.onUnreadChanged?.call(page.unreadCount);
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _error = messageForApiError(error);
        _loading = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _error = 'Pesan tidak dapat dimuat.';
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
      setState(() => _error = messageForApiError(error));
    } finally {
      if (mounted) setState(() => _busy = false);
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
      setState(() => _error = messageForApiError(error));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      bottom: false,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 10),
            child: Row(
              children: [
                const Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Pesan',
                        style: TextStyle(
                          fontSize: 23,
                          fontWeight: FontWeight.w800,
                          letterSpacing: -0.5,
                          color: AppColors.ink,
                        ),
                      ),
                      SizedBox(height: 2),
                      Text(
                        'Pengingat, pengumuman, dan status pengajuan.',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(fontSize: 12, color: AppColors.muted),
                      ),
                    ],
                  ),
                ),
                if (_segment == 0)
                  IconButton(
                    key: const Key('messages-read-all'),
                    tooltip: 'Tandai semua sudah dibaca',
                    onPressed: _busy || (_page?.unreadCount ?? 0) == 0
                        ? null
                        : _markAllRead,
                    icon: const Icon(Icons.done_all, size: 20),
                  ),
              ],
            ),
          ),
          _backgroundStatus(),
          _segmented(),
          Expanded(
            child: _segment == 0
                ? _reminders()
                : RequestsTab(auth: widget.auth, compact: true, combined: true),
          ),
        ],
      ),
    );
  }

  /// Strip status singkat: hijau "Aktif" saat pengecualian baterai sudah ada,
  /// kuning dengan tombol "Aktifkan Sekarang" hanya bila pengguna menolak.
  Widget _backgroundStatus() {
    final readiness = widget.readiness;
    if (readiness == null) return const SizedBox.shrink();
    return AnimatedBuilder(
      animation: readiness,
      builder: (context, _) {
        if (!readiness.isChecked || !readiness.isSupported) {
          return const SizedBox.shrink();
        }
        final active = readiness.batteryOptimizationIgnored;
        return Container(
          key: const Key('messages-background-status'),
          margin: const EdgeInsets.fromLTRB(16, 0, 16, 10),
          padding: const EdgeInsets.fromLTRB(12, 6, 6, 6),
          decoration: BoxDecoration(
            color: active ? AppColors.greenSoft : AppColors.yellowSoft,
            borderRadius: BorderRadius.circular(10),
            border: Border.all(
              color: active ? AppColors.greenLine : AppColors.yellowLine,
            ),
          ),
          child: Row(
            children: [
              Icon(
                active
                    ? Icons.notifications_active_outlined
                    : Icons.notifications_off_outlined,
                size: 16,
                color: active ? AppColors.greenDark : AppColors.yellowInk,
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  'Notifikasi Latar Belakang: ${active ? 'Aktif' : 'Nonaktif'}',
                  style: TextStyle(
                    fontSize: 11.5,
                    fontWeight: FontWeight.w700,
                    color: active ? AppColors.greenDark : AppColors.yellowInk,
                  ),
                ),
              ),
              if (!active)
                TextButton(
                  key: const Key('messages-background-enable'),
                  onPressed: readiness.isBusy ? null : readiness.enableNow,
                  style: TextButton.styleFrom(
                    foregroundColor: AppColors.yellowInk,
                    visualDensity: VisualDensity.compact,
                    padding: const EdgeInsets.symmetric(horizontal: 10),
                    textStyle: const TextStyle(
                      fontSize: 11.5,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  child: Text(
                    readiness.isBusy ? 'Membuka…' : 'Aktifkan Sekarang',
                  ),
                ),
            ],
          ),
        );
      },
    );
  }

  Widget _segmented() {
    final unread = _page?.unreadCount ?? 0;
    return Container(
      margin: const EdgeInsets.fromLTRB(16, 0, 16, 10),
      decoration: const BoxDecoration(
        border: Border(bottom: BorderSide(color: AppColors.line)),
      ),
      child: Row(
        children: [
          _segmentButton(0, 'Pengingat', badge: unread == 0 ? null : '$unread'),
          _segmentButton(1, 'Submisi'),
        ],
      ),
    );
  }

  Widget _segmentButton(int value, String label, {String? badge}) {
    final active = _segment == value;
    return Expanded(
      child: InkWell(
        key: Key('messages-segment-$value'),
        onTap: () => setState(() => _segment = value),
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 10),
          decoration: BoxDecoration(
            border: Border(
              bottom: BorderSide(
                color: active ? AppColors.green : Colors.transparent,
                width: 2,
              ),
            ),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Text(
                label,
                style: TextStyle(
                  fontSize: 12.5,
                  fontWeight: FontWeight.w700,
                  color: active ? AppColors.greenDark : AppColors.muted,
                ),
              ),
              if (badge != null) ...[
                const SizedBox(width: 6),
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 6,
                    vertical: 2,
                  ),
                  decoration: BoxDecoration(
                    color: AppColors.amber,
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Text(
                    badge,
                    style: const TextStyle(
                      fontSize: 9,
                      fontWeight: FontWeight.w800,
                      color: AppColors.yellowInk,
                      fontFeatures: tabularFigures,
                    ),
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  Widget _reminders() {
    if (_loading) return const Center(child: CircularProgressIndicator());
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _filterChips(),
        if (_error != null)
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
            child: Text(
              _error!,
              key: const Key('messages-error'),
              style: const TextStyle(fontSize: 11, color: AppColors.danger),
            ),
          ),
        Expanded(child: _reminderList()),
      ],
    );
  }

  Widget _filterChips() {
    const filters = [
      ('ALL', 'Semua'),
      ('UNREAD', 'Belum Dibaca'),
      ('READ', 'Telah Dibaca'),
    ];
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
      child: Row(
        children: [
          for (final (value, label) in filters)
            Padding(
              padding: const EdgeInsets.only(right: 8),
              child: Material(
                color: _filter == value
                    ? AppColors.greenSoft
                    : AppColors.surface,
                borderRadius: BorderRadius.circular(999),
                child: InkWell(
                  key: Key('messages-filter-$value'),
                  borderRadius: BorderRadius.circular(999),
                  onTap: () => setState(() => _filter = value),
                  child: Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 11,
                      vertical: 6,
                    ),
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(999),
                      border: Border.all(
                        color: _filter == value
                            ? AppColors.greenLine
                            : AppColors.line,
                      ),
                    ),
                    child: Text(
                      label,
                      style: TextStyle(
                        fontSize: 11,
                        fontWeight: FontWeight.w700,
                        color: _filter == value
                            ? AppColors.greenDark
                            : AppColors.muted,
                      ),
                    ),
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }

  Widget _reminderList() {
    final page = _page;
    final notifications = (page?.notifications ?? const <InAppNotification>[])
        .where((item) {
          if (_filter == 'UNREAD') return !item.isRead;
          if (_filter == 'READ') return item.isRead;
          return true;
        })
        .toList(growable: false);
    final showBroadcasts = _filter == 'ALL' && _broadcasts.isNotEmpty;
    if (notifications.isEmpty && !showBroadcasts) {
      return Center(
        child: Container(
          key: const Key('messages-empty'),
          margin: const EdgeInsets.all(16),
          padding: const EdgeInsets.symmetric(vertical: 34, horizontal: 20),
          decoration: BoxDecoration(
            color: AppColors.surface,
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: AppColors.line),
          ),
          child: const Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                Icons.notifications_none_rounded,
                size: 27,
                color: AppColors.muted,
              ),
              SizedBox(height: 8),
              Text(
                'Belum ada pesan.',
                style: TextStyle(fontSize: 12, color: AppColors.muted),
              ),
            ],
          ),
        ),
      );
    }
    return RefreshIndicator(
      color: AppColors.green,
      onRefresh: _load,
      child: ListView(
        key: const Key('messages-list'),
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
        children: [
          if (showBroadcasts) ...[
            const _SectionLabel('Broadcast'),
            const SizedBox(height: 7),
            for (final item in _broadcasts) _broadcastCard(item),
            const SizedBox(height: 12),
          ],
          if (notifications.isNotEmpty) ...[
            const _SectionLabel('Notifikasi'),
            const SizedBox(height: 7),
            for (final item in notifications) _notificationCard(item),
          ],
        ],
      ),
    );
  }

  Widget _notificationCard(InAppNotification item) {
    return Container(
      key: Key('notification-${item.id}'),
      margin: const EdgeInsets.only(bottom: 8),
      child: Material(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(12),
        child: InkWell(
          borderRadius: BorderRadius.circular(12),
          onTap: () => _markRead(item),
          child: Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: AppColors.line),
            ),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  width: 36,
                  height: 36,
                  decoration: BoxDecoration(
                    color: item.isRead
                        ? AppColors.tableHead
                        : AppColors.greenSoft,
                    borderRadius: BorderRadius.circular(9),
                    border: Border.all(
                      color: item.isRead ? AppColors.line : AppColors.greenLine,
                    ),
                  ),
                  child: Icon(
                    _iconFor(item),
                    size: 18,
                    color: item.isRead ? AppColors.muted : AppColors.greenDark,
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          if (!item.isRead)
                            Container(
                              width: 6,
                              height: 6,
                              margin: const EdgeInsets.only(right: 6),
                              decoration: const BoxDecoration(
                                shape: BoxShape.circle,
                                color: AppColors.green,
                              ),
                            ),
                          Expanded(
                            child: Text(
                              item.title,
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                fontSize: 12.5,
                                height: 1.25,
                                fontWeight: FontWeight.w700,
                                color: AppColors.greenDark,
                              ),
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 3),
                      Text(
                        item.body,
                        maxLines: 3,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontSize: 11,
                          height: 1.35,
                          color: AppColors.muted,
                        ),
                      ),
                      const SizedBox(height: 5),
                      Text(
                        _stamp(item.createdAt),
                        style: const TextStyle(
                          fontSize: 9.5,
                          color: AppColors.muted,
                          fontFeatures: tabularFigures,
                        ),
                      ),
                    ],
                  ),
                ),
                if (!item.isRead)
                  IconButton(
                    key: Key('notification-read-${item.id}'),
                    tooltip: 'Tandai dibaca',
                    visualDensity: VisualDensity.compact,
                    onPressed: _busy ? null : () => _markRead(item),
                    icon: const Icon(Icons.done, size: 17),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _broadcastCard(BroadcastMessage item) {
    return Container(
      key: Key('message-broadcast-${item.id}'),
      margin: const EdgeInsets.only(bottom: 8),
      child: Material(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(12),
        child: InkWell(
          borderRadius: BorderRadius.circular(12),
          onTap: () => Navigator.of(context).push(
            MaterialPageRoute<void>(
              builder: (_) => BroadcastsScreen(auth: widget.auth),
            ),
          ),
          child: Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(12),
              border: Border.all(
                color: item.isImportant ? AppColors.yellowLine : AppColors.line,
              ),
            ),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  width: 36,
                  height: 36,
                  decoration: BoxDecoration(
                    color: item.isImportant
                        ? AppColors.yellowSoft
                        : AppColors.greenSoft,
                    borderRadius: BorderRadius.circular(9),
                  ),
                  child: Icon(
                    Icons.campaign_outlined,
                    size: 18,
                    color: item.isImportant
                        ? AppColors.yellowInk
                        : AppColors.greenDark,
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        item.title,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontSize: 12.5,
                          height: 1.25,
                          fontWeight: FontWeight.w700,
                          color: AppColors.greenDark,
                        ),
                      ),
                      const SizedBox(height: 3),
                      Text(
                        item.content,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontSize: 11,
                          height: 1.35,
                          color: AppColors.muted,
                        ),
                      ),
                      const SizedBox(height: 5),
                      Text(
                        '${item.audienceLabel} · '
                        '${_stamp(item.publishedAt ?? item.createdAt)}',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontSize: 9.5,
                          color: AppColors.muted,
                          fontFeatures: tabularFigures,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  IconData _iconFor(InAppNotification item) {
    final type = item.type.toUpperCase();
    if (type.contains('LEAVE')) return Icons.beach_access_outlined;
    if (type.contains('OVERTIME')) return Icons.more_time;
    if (type.contains('PERMIT')) return Icons.badge_outlined;
    if (type.contains('CORRECTION')) return Icons.edit_calendar_outlined;
    if (type.contains('REJECT')) return Icons.error_outline;
    if (type.contains('BROADCAST')) return Icons.campaign_outlined;
    return Icons.notifications_active_outlined;
  }

  String _stamp(DateTime value) {
    final local = value.toLocal();
    return '${_two(local.day)}/${_two(local.month)}/${local.year} '
        '${_two(local.hour)}:${_two(local.minute)}';
  }
}

class _SectionLabel extends StatelessWidget {
  const _SectionLabel(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    return Text(
      text,
      style: const TextStyle(
        fontSize: 11,
        fontWeight: FontWeight.w700,
        letterSpacing: 0.2,
        color: AppColors.muted,
      ),
    );
  }
}
