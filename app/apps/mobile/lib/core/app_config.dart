class AppConfig {
  const AppConfig._();

  static const String apiBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'http://103.93.132.214:3013',
  );

  static const double accuracyThresholdMeters = 100;
}
