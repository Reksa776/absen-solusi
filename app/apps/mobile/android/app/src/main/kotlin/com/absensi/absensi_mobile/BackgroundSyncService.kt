package com.absensi.absensi_mobile

import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.os.Build
import android.os.PowerManager
import android.os.SystemClock
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Penjadwal dan inti sinkronisasi notifikasi latar tanpa notifikasi status.
 *
 * Tidak ada foreground service di sini: Android tidak pernah diminta
 * menampilkan notifikasi permanen. Rantai sinkronisasi dijaga oleh
 * [AlarmManager] yang membangunkan [BackgroundSyncAlarmReceiver] setiap 15
 * detik, lalu receiver tersebut menjadwalkan alarm berikutnya sebelum
 * melakukan `GET /api/notifications/me`.
 *
 * Hanya channel [CHANNEL_ALERTS] (`IMPORTANCE_HIGH`) yang dipakai, dan hanya
 * ketika benar-benar ada notifikasi baru (approve / reject / broadcast).
 */
object BackgroundSyncService {

    const val PREFS_NAME = "absensi_background"
    const val KEY_TOKEN = "bg_access_token"
    const val KEY_BASE_URL = "bg_api_base_url"
    const val KEY_SEEN_IDS = "seen_notification_ids"

    const val EXTRA_NOTIFICATION_ID = "notification_id"
    const val EXTRA_LINK_URL = "notification_link"

    const val TAG = "BackgroundSync"

    private const val CHANNEL_ALERTS = "approval_alerts_high"
    private const val ALARM_REQUEST_CODE = 8611
    private const val POLL_INTERVAL_MS = 15_000L
    private const val WAKE_LOCK_TIMEOUT_MS = 10_000L
    private const val CONNECT_TIMEOUT_MS = 5_000
    private const val READ_TIMEOUT_MS = 5_000
    private const val MAX_SEEN_IDS = 200
    private const val LIST_LIMIT = 20

    private val polling = AtomicBoolean(false)

    fun prefs(context: Context): SharedPreferences =
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    fun hasCredentials(context: Context): Boolean =
        !prefs(context).getString(KEY_TOKEN, null).isNullOrBlank()

    /**
     * Memulai rantai alarm sinkronisasi. Mengembalikan false bila pengguna
     * belum login sehingga tidak ada yang perlu dijadwalkan.
     */
    fun start(context: Context): Boolean {
        if (!hasCredentials(context)) {
            cancelAlarm(context)
            return false
        }
        scheduleNext(context)
        return true
    }

    /** Menghentikan rantai alarm, misalnya saat logout. */
    fun stop(context: Context) {
        cancelAlarm(context)
    }

    /**
     * Menjadwalkan satu alarm berikutnya. Dipanggil saat login, saat boot,
     * dan dari [BackgroundSyncAlarmReceiver] sebelum polling agar rantai tidak
     * pernah putus walau satu siklus HTTP gagal.
     */
    fun scheduleNext(context: Context) {
        val appContext = context.applicationContext
        if (!hasCredentials(appContext)) {
            cancelAlarm(appContext)
            return
        }
        val alarmManager = appContext.getSystemService(AlarmManager::class.java) ?: return
        val pendingIntent = alarmIntent(appContext)
        val triggerAt = SystemClock.elapsedRealtime() + POLL_INTERVAL_MS
        try {
            val canBeExact = Build.VERSION.SDK_INT < Build.VERSION_CODES.S ||
                alarmManager.canScheduleExactAlarms()
            if (canBeExact) {
                alarmManager.setExactAndAllowWhileIdle(
                    AlarmManager.ELAPSED_REALTIME_WAKEUP,
                    triggerAt,
                    pendingIntent,
                )
            } else {
                // Android 12+ tanpa izin alarm presisi: tetap bangunkan
                // perangkat dengan alarm non-presisi yang diizinkan.
                alarmManager.setAndAllowWhileIdle(
                    AlarmManager.ELAPSED_REALTIME_WAKEUP,
                    triggerAt,
                    pendingIntent,
                )
            }
        } catch (error: SecurityException) {
            Log.w(TAG, "Alarm presisi ditolak, memakai alarm biasa.")
            try {
                alarmManager.setAndAllowWhileIdle(
                    AlarmManager.ELAPSED_REALTIME_WAKEUP,
                    triggerAt,
                    pendingIntent,
                )
            } catch (fallbackError: SecurityException) {
                Log.w(TAG, "Alarm tidak dapat dijadwalkan: ${fallbackError.message}")
            }
        }
    }

    private fun cancelAlarm(context: Context) {
        val alarmManager = context.getSystemService(AlarmManager::class.java) ?: return
        val pendingIntent = alarmIntent(context)
        alarmManager.cancel(pendingIntent)
        pendingIntent.cancel()
    }

    private fun alarmIntent(context: Context): PendingIntent {
        val intent = Intent(context, BackgroundSyncAlarmReceiver::class.java)
        return PendingIntent.getBroadcast(
            context,
            ALARM_REQUEST_CODE,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    /**
     * Wakelock singkat agar satu siklus HTTP selesai walau layar mati.
     * Timeout 10 detik menjaga baterai tetap hemat.
     */
    fun acquireWakeLock(context: Context): PowerManager.WakeLock? {
        return try {
            val powerManager =
                context.getSystemService(Context.POWER_SERVICE) as? PowerManager
                    ?: return null
            @Suppress("DEPRECATION")
            powerManager.newWakeLock(
                PowerManager.PARTIAL_WAKE_LOCK,
                "absensi:background-sync",
            ).apply {
                setReferenceCounted(false)
                acquire(WAKE_LOCK_TIMEOUT_MS)
            }
        } catch (error: Exception) {
            Log.w(TAG, "Wakelock tidak tersedia: ${error.message}")
            null
        }
    }

    /** Satu siklus: ambil notifikasi terbaru lalu tampilkan yang belum dilihat. */
    fun pollOnce(context: Context) {
        val appContext = context.applicationContext
        if (!polling.compareAndSet(false, true)) return
        try {
            ensureAlertChannel(appContext)
            val store = prefs(appContext)
            val token = store.getString(KEY_TOKEN, null)?.trim().orEmpty()
            val baseUrl = store.getString(KEY_BASE_URL, null)
                ?.trim()
                ?.trimEnd('/')
                .orEmpty()
            if (token.isEmpty() || baseUrl.isEmpty()) {
                Log.d(TAG, "Kredensial latar kosong; alarm dihentikan.")
                stop(appContext)
                return
            }
            val body = fetchNotifications(baseUrl, token) ?: return
            handlePayload(appContext, store, body)
        } finally {
            polling.set(false)
        }
    }

    private fun fetchNotifications(baseUrl: String, token: String): String? {
        var connection: HttpURLConnection? = null
        try {
            val url = URL("$baseUrl/api/notifications/me?limit=$LIST_LIMIT")
            connection = (url.openConnection() as HttpURLConnection).apply {
                requestMethod = "GET"
                connectTimeout = CONNECT_TIMEOUT_MS
                readTimeout = READ_TIMEOUT_MS
                setRequestProperty("Authorization", "Bearer $token")
                setRequestProperty("Accept", "application/json")
            }
            val status = connection.responseCode
            if (status < 200 || status >= 300) {
                Log.w(TAG, "Polling notifikasi gagal: HTTP $status")
                return null
            }
            return connection.inputStream
                .bufferedReader(Charsets.UTF_8)
                .use { it.readText() }
        } catch (error: Exception) {
            Log.w(TAG, "Polling notifikasi gagal: ${error.message}")
            return null
        } finally {
            connection?.disconnect()
        }
    }

    private fun handlePayload(
        context: Context,
        store: SharedPreferences,
        body: String,
    ) {
        val items = parseItems(body)
        if (items.isEmpty()) return

        val seen = readSeenIds(store)
        val seenSet = seen.toHashSet()
        val fresh = items.filter { !seenSet.contains(it.id) }
        if (fresh.isEmpty()) return

        fresh.forEach { showAlert(context, it) }
        Log.i(TAG, "${fresh.size} notifikasi baru ditampilkan.")

        // ID dari respons dianggap terbaru sehingga berada di depan daftar.
        val merged = LinkedHashSet<String>(items.map { it.id })
        merged.addAll(seen)
        writeSeenIds(store, merged.toList())
    }

    private fun parseItems(body: String): List<AlertItem> {
        val rows = extractRows(body) ?: return emptyList()
        val items = ArrayList<AlertItem>(rows.length())
        for (index in 0 until rows.length()) {
            val row = rows.optJSONObject(index) ?: continue
            val id = row.optString("id").trim()
            if (id.isEmpty()) continue
            val title = row.optString("title").trim().ifEmpty { "Notifikasi baru" }
            val message = row.optString("message").trim()
                .ifEmpty { row.optString("body").trim() }
            val link = row.optString("linkUrl").trim()
            items.add(AlertItem(id, title, message, link.ifEmpty { null }))
        }
        return items
    }

    private fun extractRows(body: String): JSONArray? {
        val trimmed = body.trim()
        if (trimmed.isEmpty()) return null
        return try {
            if (trimmed.startsWith("[")) {
                JSONArray(trimmed)
            } else {
                val root = JSONObject(trimmed)
                var rows = root.optJSONArray("notifications")
                if (rows == null) rows = root.optJSONArray("items")
                if (rows == null) {
                    val data = root.optJSONObject("data")
                    rows = if (data != null) {
                        data.optJSONArray("notifications") ?: data.optJSONArray("items")
                    } else {
                        root.optJSONArray("data")
                    }
                }
                rows
            }
        } catch (error: Exception) {
            Log.w(TAG, "Respons notifikasi bukan JSON yang valid.")
            null
        }
    }

    private fun showAlert(context: Context, item: AlertItem) {
        val notificationId = item.id.hashCode().let { if (it == 0) 1 else it }
        val intent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra(EXTRA_NOTIFICATION_ID, item.id)
            item.linkUrl?.let { putExtra(EXTRA_LINK_URL, it) }
        }
        val pendingIntent = PendingIntent.getActivity(
            context,
            notificationId,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val notification = NotificationCompat.Builder(context, CHANNEL_ALERTS)
            .setSmallIcon(iconRes(context))
            .setContentTitle(item.title)
            .setContentText(item.message)
            .setStyle(NotificationCompat.BigTextStyle().bigText(item.message))
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setDefaults(NotificationCompat.DEFAULT_ALL)
            .setAutoCancel(true)
            .setWhen(System.currentTimeMillis())
            .setShowWhen(true)
            .setContentIntent(pendingIntent)
            .build()
        try {
            NotificationManagerCompat.from(context).notify(notificationId, notification)
        } catch (error: SecurityException) {
            Log.w(TAG, "Izin notifikasi belum diberikan; alert dilewati.")
        }
    }

    private fun ensureAlertChannel(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        if (manager.getNotificationChannel(CHANNEL_ALERTS) != null) return
        val alerts = NotificationChannel(
            CHANNEL_ALERTS,
            "Persetujuan & pengumuman",
            NotificationManager.IMPORTANCE_HIGH,
        ).apply {
            description = "Hasil persetujuan dan pengumuman baru yang masuk."
            enableVibration(true)
            enableLights(true)
            lockscreenVisibility = Notification.VISIBILITY_PUBLIC
        }
        manager.createNotificationChannel(alerts)
    }

    private fun iconRes(context: Context): Int =
        context.applicationInfo.icon.takeIf { it != 0 } ?: android.R.drawable.ic_dialog_info

    /** ID yang sudah tampil disimpan berurutan sebagai teks satu per baris. */
    fun readSeenIds(store: SharedPreferences): List<String> {
        val raw = try {
            store.getString(KEY_SEEN_IDS, "")
        } catch (error: ClassCastException) {
            null
        }
        if (raw == null) {
            // Migrasi dari format lama (StringSet) tanpa kehilangan data.
            val legacy = try {
                store.getStringSet(KEY_SEEN_IDS, emptySet()).orEmpty()
            } catch (error: ClassCastException) {
                emptySet<String>()
            }
            val migrated = legacy.filterNotNull().take(MAX_SEEN_IDS)
            writeSeenIds(store, migrated)
            return migrated
        }
        return raw.split('\n')
            .map { it.trim() }
            .filter { it.isNotEmpty() }
    }

    /** Disimpan berurutan dari yang terbaru agar pemotongan 200 ID tepat. */
    fun writeSeenIds(store: SharedPreferences, ids: List<String>) {
        store.edit()
            .putString(KEY_SEEN_IDS, ids.take(MAX_SEEN_IDS).joinToString("\n"))
            .apply()
    }

    private data class AlertItem(
        val id: String,
        val title: String,
        val message: String,
        val linkUrl: String?,
    )
}
