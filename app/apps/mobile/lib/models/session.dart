import 'user.dart';
import 'workspace.dart';

class SessionProfile {
  const SessionProfile({
    required this.user,
    required this.workspaces,
    this.activeTenantId,
  });

  factory SessionProfile.fromJson(Map<String, dynamic> json) {
    return SessionProfile(
      user: User.fromJson(
        (json['user'] as Map<String, dynamic>? ?? const {}),
      ),
      activeTenantId: json['activeTenantId'] as String?,
      workspaces: (json['workspaces'] as List<dynamic>? ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(Workspace.fromJson)
          .toList(growable: false),
    );
  }

  final User user;
  final List<Workspace> workspaces;
  final String? activeTenantId;
}

class AuthResult extends SessionProfile {
  const AuthResult({
    required super.user,
    required super.workspaces,
    required this.token,
    super.activeTenantId,
  });

  factory AuthResult.fromJson(Map<String, dynamic> json) {
    final profile = SessionProfile.fromJson(json);
    return AuthResult(
      user: profile.user,
      workspaces: profile.workspaces,
      activeTenantId: profile.activeTenantId,
      token: json['token'] as String? ?? '',
    );
  }

  final String token;
}

class SwitchWorkspaceResult {
  const SwitchWorkspaceResult({
    required this.activeTenantId,
    required this.workspace,
    required this.roleKeys,
  });

  factory SwitchWorkspaceResult.fromJson(Map<String, dynamic> json) {
    return SwitchWorkspaceResult(
      activeTenantId: json['activeTenantId'] as String? ?? '',
      workspace: Workspace.fromJson(
        json['workspace'] as Map<String, dynamic>? ?? const {},
      ),
      roleKeys: (json['roleKeys'] as List<dynamic>? ?? const [])
          .map((entry) => entry.toString())
          .toList(growable: false),
    );
  }

  final String activeTenantId;
  final Workspace workspace;
  final List<String> roleKeys;
}
