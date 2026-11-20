import 'package:material_ui/material_ui.dart';

/// Token warna aplikasi: putih, hijau zamrud, kuning amber.
/// Tidak memakai gradasi dekoratif maupun glassmorphism.
abstract final class AppColors {
  static const Color surface = Color(0xFFFFFFFF);
  static const Color canvas = Color(0xFFF7F9F8);
  static const Color line = Color(0xFFE2E8E4);
  static const Color tableHead = Color(0xFFF1F5F2);

  static const Color green = Color(0xFF15803D);
  static const Color greenDark = Color(0xFF166534);
  static const Color greenSoft = Color(0xFFDCFCE7);
  static const Color greenLine = Color(0xFFBBF7D0);

  static const Color yellow = Color(0xFFEAB308);
  static const Color amber = Color(0xFFF59E0B);
  static const Color yellowSoft = Color(0xFFFEF9C3);
  static const Color yellowLine = Color(0xFFFDE047);
  static const Color yellowInk = Color(0xFF422006);

  static const Color ink = Color(0xFF0F172A);
  static const Color muted = Color(0xFF475569);
  static const Color danger = Color(0xFFB91C1C);
  static const Color dangerSoft = Color(0xFFFEE2E2);
}

const List<FontFeature> tabularFigures = [FontFeature.tabularFigures()];

ThemeData buildAppTheme() {
  final scheme = ColorScheme.fromSeed(seedColor: AppColors.green).copyWith(
    primary: AppColors.green,
    onPrimary: Colors.white,
    primaryContainer: AppColors.greenSoft,
    onPrimaryContainer: AppColors.greenDark,
    secondary: AppColors.yellow,
    onSecondary: AppColors.yellowInk,
    secondaryContainer: AppColors.yellowSoft,
    onSecondaryContainer: AppColors.yellowInk,
    surface: AppColors.surface,
    onSurface: AppColors.ink,
    onSurfaceVariant: AppColors.muted,
    outline: AppColors.line,
    outlineVariant: AppColors.line,
    error: AppColors.danger,
    surfaceContainerHighest: AppColors.tableHead,
  );

  final base = ThemeData(colorScheme: scheme, useMaterial3: true);
  final text = base.textTheme.apply(
    bodyColor: AppColors.ink,
    displayColor: AppColors.ink,
  );

  OutlineInputBorder border(Color color, double width) => OutlineInputBorder(
    borderRadius: BorderRadius.circular(10),
    borderSide: BorderSide(color: color, width: width),
  );

  return base.copyWith(
    scaffoldBackgroundColor: AppColors.canvas,
    textTheme: text.copyWith(
      headlineMedium: text.headlineMedium?.copyWith(
        fontSize: 28,
        fontWeight: FontWeight.w800,
        letterSpacing: -0.6,
      ),
      headlineSmall: text.headlineSmall?.copyWith(
        fontSize: 22,
        fontWeight: FontWeight.w800,
        letterSpacing: -0.4,
      ),
      titleLarge: text.titleLarge?.copyWith(
        fontSize: 18,
        fontWeight: FontWeight.w700,
      ),
      titleMedium: text.titleMedium?.copyWith(
        fontSize: 15,
        fontWeight: FontWeight.w700,
      ),
      titleSmall: text.titleSmall?.copyWith(
        fontSize: 13,
        fontWeight: FontWeight.w700,
      ),
      bodyMedium: text.bodyMedium?.copyWith(fontSize: 14, color: AppColors.ink),
      bodySmall: text.bodySmall?.copyWith(fontSize: 12, color: AppColors.muted),
      labelLarge: text.labelLarge?.copyWith(
        fontSize: 14,
        fontWeight: FontWeight.w700,
        letterSpacing: 0,
      ),
      labelSmall: text.labelSmall?.copyWith(
        fontSize: 10,
        fontWeight: FontWeight.w700,
        letterSpacing: 0.4,
        color: AppColors.muted,
      ),
    ),
    appBarTheme: const AppBarTheme(
      backgroundColor: AppColors.surface,
      foregroundColor: AppColors.ink,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      scrolledUnderElevation: 0,
      centerTitle: false,
      titleTextStyle: TextStyle(
        fontSize: 16,
        fontWeight: FontWeight.w700,
        color: AppColors.ink,
        letterSpacing: -0.2,
      ),
      iconTheme: IconThemeData(color: AppColors.ink, size: 22),
      actionsIconTheme: IconThemeData(color: AppColors.ink, size: 22),
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: AppColors.surface,
      indicatorColor: AppColors.greenSoft,
      elevation: 0,
      height: 66,
      labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,
      indicatorShape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(999),
      ),
      labelTextStyle: WidgetStateProperty.resolveWith((states) {
        final selected = states.contains(WidgetState.selected);
        return TextStyle(
          fontSize: 11,
          fontWeight: FontWeight.w700,
          letterSpacing: 0.1,
          color: selected ? AppColors.greenDark : AppColors.muted,
        );
      }),
      iconTheme: WidgetStateProperty.resolveWith((states) {
        final selected = states.contains(WidgetState.selected);
        return IconThemeData(
          size: 22,
          color: selected ? AppColors.green : AppColors.muted,
        );
      }),
    ),
    cardTheme: CardThemeData(
      color: AppColors.surface,
      elevation: 0,
      margin: EdgeInsets.zero,
      surfaceTintColor: Colors.transparent,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(14),
        side: const BorderSide(color: AppColors.line),
      ),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: AppColors.green,
        foregroundColor: Colors.white,
        disabledBackgroundColor: AppColors.line,
        disabledForegroundColor: AppColors.muted,
        minimumSize: const Size.fromHeight(50),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
        textStyle: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: AppColors.ink,
        side: const BorderSide(color: AppColors.line),
        minimumSize: const Size.fromHeight(48),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
        textStyle: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(
        foregroundColor: AppColors.greenDark,
        textStyle: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: AppColors.surface,
      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
      labelStyle: const TextStyle(color: AppColors.muted, fontWeight: FontWeight.w500),
      hintStyle: const TextStyle(color: AppColors.muted, fontWeight: FontWeight.w400),
      prefixIconColor: AppColors.muted,
      suffixIconColor: AppColors.muted,
      border: border(AppColors.line, 1.2),
      enabledBorder: border(AppColors.line, 1.2),
      focusedBorder: border(AppColors.green, 1.6),
      errorBorder: border(AppColors.danger, 1.2),
      focusedErrorBorder: border(AppColors.danger, 1.6),
    ),
    dividerTheme: const DividerThemeData(
      color: AppColors.line,
      thickness: 1,
      space: 1,
    ),
    snackBarTheme: SnackBarThemeData(
      backgroundColor: AppColors.ink,
      contentTextStyle: const TextStyle(color: Colors.white, fontSize: 13),
      behavior: SnackBarBehavior.floating,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
    ),
    progressIndicatorTheme: const ProgressIndicatorThemeData(color: AppColors.green),
    checkboxTheme: CheckboxThemeData(
      fillColor: WidgetStateProperty.resolveWith(
        (states) => states.contains(WidgetState.selected)
            ? AppColors.green
            : Colors.transparent,
      ),
      side: const BorderSide(color: AppColors.muted, width: 1.4),
    ),
  );
}
