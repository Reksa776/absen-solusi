package com.absensi.absensi_mobile

import android.content.Context
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel

/**
 * Menyimpan salinan token dan baseUrl pada SharedPreferences polos
 * (`bg_access_token`, `bg_api_base_url`) agar dapat dibaca tanpa Keystore,
 * lalu menyalakan atau menghentikan [BackgroundSyncService].
 */
class BackgroundSyncBridge(private val context: Context) :
    MethodChannel.MethodCallHandler {

    companion object {
        const val CHANNEL = "absensi/background_sync"
        private const val PREFS_NAME = "absensi_background"
        private const val KEY_TOKEN = "bg_access_token"
        private const val KEY_BASE_URL = "bg_api_base_url"
        private const val KEY_SEEN_IDS = "seen_notification_ids"
    }

    private val prefs =
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    override fun onMethodCall(call: MethodCall, result: MethodChannel.Result) {
        when (call.method) {
            "syncCredentials" -> {
                val token = call.argument<String>("token").orEmpty()
                val baseUrl = call.argument<String>("baseUrl").orEmpty()
                prefs.edit()
                    .putString(KEY_TOKEN, token)
                    .putString(KEY_BASE_URL, baseUrl)
                    .apply()
                result.success(null)
            }
            "clearCredentials" -> {
                prefs.edit()
                    .remove(KEY_TOKEN)
                    .remove(KEY_BASE_URL)
                    .apply()
                result.success(null)
            }
            "readSeenIds" -> {
                val ids = prefs.getStringSet(KEY_SEEN_IDS, emptySet())
                result.success(ids?.toList() ?: emptyList<String>())
            }
            "writeSeenIds" -> {
                val ids = call.argument<List<String>>("ids") ?: emptyList()
                prefs.edit().putStringSet(KEY_SEEN_IDS, ids.toSet()).apply()
                result.success(null)
            }
            "startService" -> {
                BackgroundSyncService.start(context)
                result.success(null)
            }
            "stopService" -> {
                BackgroundSyncService.stop(context)
                result.success(null)
            }
            else -> result.notImplemented()
        }
    }
}
