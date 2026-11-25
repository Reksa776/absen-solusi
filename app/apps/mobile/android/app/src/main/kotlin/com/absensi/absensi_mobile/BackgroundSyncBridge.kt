package com.absensi.absensi_mobile

import android.content.Context
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel

/**
 * Menyimpan salinan token dan baseUrl pada SharedPreferences polos
 * (`bg_access_token`, `bg_api_base_url`) agar dapat dibaca tanpa Keystore,
 * lalu menyalakan atau menghentikan [BackgroundSyncService].
 *
 * Dart hanya bertugas menyiapkan kredensial dan memicu service; seluruh loop
 * HTTP 10 detik berjalan di dalam service tersebut.
 */
class BackgroundSyncBridge(private val context: Context) :
    MethodChannel.MethodCallHandler {

    companion object {
        const val CHANNEL = "absensi/background_sync"
        private const val MAX_SEEN_IDS = 200
    }

    private val prefs get() = BackgroundSyncService.prefs(context)

    override fun onMethodCall(call: MethodCall, result: MethodChannel.Result) {
        when (call.method) {
            "syncCredentials" -> {
                val token = call.argument<String>("token").orEmpty().trim()
                val baseUrl = call.argument<String>("baseUrl").orEmpty().trim()
                if (token.isEmpty() || baseUrl.isEmpty()) {
                    BackgroundSyncService.stop(context)
                    result.success(false)
                    return
                }
                prefs.edit()
                    .putString(BackgroundSyncService.KEY_TOKEN, token)
                    .putString(BackgroundSyncService.KEY_BASE_URL, baseUrl)
                    .apply()
                result.success(true)
            }
            "clearCredentials" -> {
                prefs.edit()
                    .remove(BackgroundSyncService.KEY_TOKEN)
                    .remove(BackgroundSyncService.KEY_BASE_URL)
                    .remove(BackgroundSyncService.KEY_SEEN_IDS)
                    .apply()
                result.success(null)
            }
            "readSeenIds" -> {
                result.success(BackgroundSyncService.readSeenIds(prefs))
            }
            "writeSeenIds" -> {
                val ids = call.argument<List<String>>("ids") ?: emptyList()
                val normalized = LinkedHashSet<String>()
                ids.filter { it.isNotBlank() }.forEach { normalized.add(it) }
                BackgroundSyncService.writeSeenIds(
                    prefs,
                    normalized.toList().take(MAX_SEEN_IDS),
                )
                result.success(null)
            }
            "startService" -> {
                result.success(BackgroundSyncService.startSafely(context))
            }
            "stopService" -> {
                BackgroundSyncService.stop(context)
                result.success(null)
            }
            else -> result.notImplemented()
        }
    }
}
