import 'package:material_ui/material_ui.dart';

import '../models/workspace.dart';
import '../services/auth_service.dart';

class WorkspacePickerScreen extends StatelessWidget {
  const WorkspacePickerScreen({
    super.key,
    required this.auth,
    required this.onSelected,
    this.allowLogout = true,
  });

  final AuthService auth;
  final VoidCallback onSelected;
  final bool allowLogout;

  Future<void> _choose(BuildContext context, Workspace workspace) async {
    if (auth.activeWorkspace?.id == workspace.id) {
      onSelected();
      return;
    }
    final ok = await auth.switchWorkspace(workspace.id);
    if (!context.mounted) return;
    if (ok) onSelected();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Pilih Workspace'),
        actions: [
          if (allowLogout)
            IconButton(
              key: const Key('workspace-logout'),
              tooltip: 'Keluar',
              onPressed: auth.logout,
              icon: const Icon(Icons.logout),
            ),
        ],
      ),
      body: AnimatedBuilder(
        animation: auth,
        builder: (context, _) {
          final workspaces = auth.profile?.workspaces ?? const <Workspace>[];
          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              Text(
                'Halo, ${auth.user?.name ?? 'Pengguna'}',
                style: Theme.of(context).textTheme.titleLarge,
              ),
              const SizedBox(height: 8),
              const Text('Pilih workspace yang akan dipakai untuk absensi.'),
              if (auth.error != null) ...[
                const SizedBox(height: 12),
                Text(
                  auth.error!,
                  key: const Key('workspace-error'),
                  style: TextStyle(color: Theme.of(context).colorScheme.error),
                ),
              ],
              const SizedBox(height: 16),
              for (final workspace in workspaces)
                Card(
                  child: ListTile(
                    key: Key('workspace-${workspace.id}'),
                    leading: CircleAvatar(
                      child: Text(
                        workspace.name.isEmpty
                            ? '?'
                            : workspace.name.characters.first.toUpperCase(),
                      ),
                    ),
                    title: Text(workspace.name),
                    subtitle: Text(workspace.slug),
                    trailing: auth.activeWorkspace?.id == workspace.id
                        ? const Icon(Icons.check_circle)
                        : const Icon(Icons.chevron_right),
                    onTap: auth.isBusy
                        ? null
                        : () => _choose(context, workspace),
                  ),
                ),
            ],
          );
        },
      ),
    );
  }
}
