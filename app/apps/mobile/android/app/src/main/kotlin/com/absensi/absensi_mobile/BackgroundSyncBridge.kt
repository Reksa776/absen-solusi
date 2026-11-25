package com.absensi.absensi_mobile

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.PowerManager
import android.provider.Settings
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

    /**
     * True bila aplikasi sudah dikecualikan dari optimasi baterai. Tanpa
     * pengecualian ini banyak OEM membunuh foreground service saat layar mati.
     */
    private fun isBatteryOptimizationIgnored(): Boolean {
        val powerManager = context.getSystemService(Context.POWER_SERVICE) as? PowerManager
            ?: return true
        return powerManager.isIgnoringBatteryOptimizations(context.packageName)
    }

    /**
     * Menampilkan dialog sistem "Izinkan / Tolak" pengecualian baterai langsung
     * di atas aplikasi, tanpa pengguna harus mencari menu Pengaturan HP.
     *
     * @return true bila aplikasi sudah dikecualikan, false bila dialog baru
     *         saja diminta sehingga statusnya perlu dibaca ulang saat resume.
     */
    @SuppressLint("BatteryLife")
    private fun requestBatteryExemption(): Boolean {
        if (isBatteryOptimizationIgnored()) return true
        val direct = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)
            .setData(Uri.parse("package:\${context.packageName}"))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        return try {
            context.startActivity(direct)
            false
        } catch (_: Exception) {
            // Sebagian OEM memblokir dialog langsung; buka daftar pengecualian.
            try {
                context.startActivity(
                    Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                )
            } catch (_: Exception) {
                // Tidak ada pengaturan baterai yang bisa dibuka.
            }
            false
        }
    }

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
            "isBatteryOptimizationIgnored" -> {
                result.success(isBatteryOptimizationIgnored())
            }
            "requestBatteryExemption" -> {
                result.success(requestBatteryExemption())
            }
            else -> result.notImplemented()
        }
    }
}
