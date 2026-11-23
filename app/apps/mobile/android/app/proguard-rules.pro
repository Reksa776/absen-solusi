# Flutter / plugin default rules are applied by the Flutter Gradle plugin.
# Keep ML Kit (google_mlkit_face_detection) classes intact; R8 otherwise
# obfuscates/strips them and release builds fail at runtime with
# "Attempt to invoke virtual method 'java.lang.Class java.lang.Object.getClass()'
# on a null object reference".
-keep class com.google.mlkit.** { *; }
-keep class com.google.android.gms.internal.mlkit_** { *; }
-keep class com.google.android.libraries.vision.** { *; }
-keep class com.google_mlkit_commons.** { *; }
-keep class com.google_mlkit_face_detection.** { *; }
-dontwarn com.google.mlkit.**
-dontwarn com.google.android.gms.**
