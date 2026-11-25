package com.absensi.absensi_mobile

import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.SystemClock
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Foreground service mandiri yang memegang seluruh loop sinkronisasi notifikasi.
 *
 * Polling HTTP `GET /api/notifications/me` dijalankan setiap 10 detik dari
 * background thread native, lalu notifikasi baru ditampilkan langsung lewat
 * [NotificationManagerCompat]. Karena tidak lagi bergantung pada Dart Engine,
 * sinkronisasi tetap berjalan ketika Activity dihancurkan (aplikasi di-swipe
 * dari Recent Apps) selama service ini hidup; [onTaskRemoved] menjadwalkan
 * ulang service lewat [AlarmManager] sebagai jaring pengaman.
 */
class BackgroundSyncService : Service() {

    companion object {
        const val PREFS_NAME = "absensi_background"
        const val KEY_TOKEN = "bg_access_token"
        const val KEY_BASE_URL = "bg_api_base_url"
        const val KEY_SEEN_IDS = "seen_notification_ids"

        const val EXTRA_NOTIFICATION_ID = "notification_id"
        const val EXTRA_LINK_URL = "notification_link"

        private const val CHANNEL_STATUS = "background_sync_status"
        private const val CHANNEL_ALERTS = "approval_alerts_high"
        private const val NOTIFICATION_ID_STATUS = 8610
        private const val RESTART_REQUEST_CODE = 8611
        private const val RESTART_DELAY_MS = 1_500L
        private const val POLL_INTERVAL_SECONDS = 10L
        private const val CONNECT_TIMEOUT_MS = 8_000
        private const val READ_TIMEOUT_MS = 8_000
        private const val MAX_SEEN_IDS = 200
        private const val LIST_LIMIT = 20
        private const val TAG = "BackgroundSync"

        fun prefs(context: Context): SharedPreferences =
            context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

        fun hasCredentials(context: Context): Boolean =
            !prefs(context).getString(KEY_TOKEN, null).isNullOrBlank()

        /** Menjalankan service; melempar bila platform menolak. */
        fun start(context: Context) {
            val intent = Intent(context, BackgroundSyncService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }

        /**
         * Versi aman untuk dipanggil dari BroadcastReceiver atau lintasan yang
         * tidak boleh crash, misalnya batasan foreground service Android 15.
         */
        fun startSafely(context: Context): Boolean {
            return try {
                start(context)
                true
            } catch (error: RuntimeException) {
                Log.w(TAG, "Service tidak dapat dijalankan sekarang: ${error.message}")
                false
            }
        }

        fun stop(context: Context) {
            cancelRestart(context)
            context.stopService(Intent(context, BackgroundSyncService::class.java))
        }

        /**
         * Menjadwalkan service kembali hidup ~1,5 detik setelah aplikasi
         * ditutup dari Recent Apps atau setelah boot selesai.
         */
        fun scheduleRestart(context: Context) {
            val pendingIntent = restartIntent(context) ?: return
            val alarmManager =
                context.getSystemService(AlarmManager::class.java) ?: return
            val triggerAt = SystemClock.elapsedRealtime() + RESTART_DELAY_MS
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
                    alarmManager.set(
                        AlarmManager.ELAPSED_REALTIME_WAKEUP,
                        triggerAt,
                        pendingIntent,
                    )
                }
            } catch (error: SecurityException) {
                Log.w(TAG, "Alarm presisi ditolak, memakai alarm biasa.")
                alarmManager.set(
                    AlarmManager.ELAPSED_REALTIME_WAKEUP,
                    triggerAt,
                    pendingIntent,
                )
            }
        }

        private fun cancelRestart(context: Context) {
            val pendingIntent = restartIntent(context) ?: return
            val alarmManager =
                context.getSystemService(AlarmManager::class.java) ?: return
            alarmManager.cancel(pendingIntent)
            pendingIntent.cancel()
        }

        private fun restartIntent(context: Context): PendingIntent? {
            val intent = Intent(context, BackgroundSyncService::class.java)
            val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                PendingIntent.getForegroundService(
                    context,
                    RESTART_REQUEST_CODE,
                    intent,
                    flags,
                )
            } else {
                PendingIntent.getService(context, RESTART_REQUEST_CODE, intent, flags)
            }
        }

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
    }

    private var executor: ScheduledExecutorService? = null
    private var pollTask: ScheduledFuture<*>? = null
    private val polling = AtomicBoolean(false)

    override fun onCreate() {
        super.onCreate()
        createChannels()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // startForeground wajib dipanggil lebih dulu: service yang dijalankan
        // lewat startForegroundService akan dianggap gagal bila langsung
        // stopSelf tanpa pernah masuk mode foreground.
        startForegroundCompat()
        if (!hasCredentials(this)) {
            Log.d(TAG, "Token kosong; service dihentikan.")
            stopSelf()
            return START_NOT_STICKY
        }
        ensurePolling()
        // START_STICKY: Android membangunkan ulang service bila proses dibunuh
        // saat memori rendah, tanpa perlu Intent baru dari Dart.
        return START_STICKY
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        super.onTaskRemoved(rootIntent)
        if (!hasCredentials(this)) return
        Log.i(TAG, "Aplikasi ditutup; menjadwalkan ulang service sinkronisasi.")
        scheduleRestart(this)
    }

    /** Android 15 membatasi foreground service `dataSync` sekitar 6 jam/hari. */
    override fun onTimeout(startId: Int, fgsType: Int) {
        Log.w(TAG, "Batas waktu sinkronisasi tercapai; service dihentikan.")
        stopSelf()
    }

    override fun onDestroy() {
        pollTask?.cancel(true)
        pollTask = null
        executor?.shutdownNow()
        executor = null
        super.onDestroy()
    }

    private fun ensurePolling() {
        if (pollTask != null) return
        val scheduler = executor ?: Executors
            .newSingleThreadScheduledExecutor { runnable ->
                Thread(runnable, "background-sync").apply { isDaemon = true }
            }
            .also { executor = it }
        pollTask = scheduler.scheduleWithFixedDelay(
            { pollOnce() },
            0L,
            POLL_INTERVAL_SECONDS,
            TimeUnit.SECONDS,
        )
    }

    private fun pollOnce() {
        if (!polling.compareAndSet(false, true)) return
        try {
            performPoll()
        } catch (error: Exception) {
            Log.w(TAG, "Siklus sinkronisasi gagal: ${error.message}")
        } finally {
            polling.set(false)
        }
    }

    private fun performPoll() {
        val store = prefs(this)
        val token = store.getString(KEY_TOKEN, null)?.trim().orEmpty()
        val baseUrl = store.getString(KEY_BASE_URL, null)
            ?.trim()
            ?.trimEnd('/')
            .orEmpty()
        if (token.isEmpty() || baseUrl.isEmpty()) {
            Log.d(TAG, "Kredensial latar kosong; service berhenti.")
            stopSelf()
            return
        }
        val body = fetchNotifications(baseUrl, token) ?: return
        handlePayload(store, body)
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

    private fun handlePayload(store: SharedPreferences, body: String) {
        val items = parseItems(body)
        if (items.isEmpty()) return

        val seen = readSeenIds(store)
        val seenSet = seen.toHashSet()
        val fresh = items.filter { !seenSet.contains(it.id) }
        if (fresh.isEmpty()) return

        fresh.forEach { showAlert(it) }
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

    private fun showAlert(item: AlertItem) {
        val notificationId = item.id.hashCode().let { if (it == 0) 1 else it }
        val intent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra(EXTRA_NOTIFICATION_ID, item.id)
            item.linkUrl?.let { putExtra(EXTRA_LINK_URL, it) }
        }
        val pendingIntent = PendingIntent.getActivity(
            this,
            notificationId,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val notification = NotificationCompat.Builder(this, CHANNEL_ALERTS)
            .setSmallIcon(iconRes())
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
            NotificationManagerCompat.from(this).notify(notificationId, notification)
        } catch (error: SecurityException) {
            Log.w(TAG, "Izin notifikasi belum diberikan; alert dilewati.")
        }
    }

    private fun startForegroundCompat() {
        val notification = buildStatusNotification()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                NOTIFICATION_ID_STATUS,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC,
            )
        } else {
            startForeground(NOTIFICATION_ID_STATUS, notification)
        }
    }

    private fun createChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = getSystemService(NotificationManager::class.java) ?: return

        val status = NotificationChannel(
            CHANNEL_STATUS,
            "Sinkronisasi presensi",
            NotificationManager.IMPORTANCE_LOW,
        ).apply {
            description = "Menjaga sinkronisasi presensi dan notifikasi tetap berjalan."
            setSound(null, null)
            enableVibration(false)
            setShowBadge(false)
        }
        manager.createNotificationChannel(status)

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

    private fun buildStatusNotification(): Notification {
        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, CHANNEL_STATUS)
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this).setPriority(Notification.PRIORITY_LOW)
        }
        return builder
            .setSmallIcon(iconRes())
            .setContentTitle("Absensi")
            .setContentText("Sinkronisasi presensi & notifikasi aktif")
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setShowWhen(false)
            .setCategory(Notification.CATEGORY_SERVICE)
            .build()
    }

    private fun iconRes(): Int =
        applicationInfo.icon.takeIf { it != 0 } ?: android.R.drawable.ic_dialog_info

    private data class AlertItem(
        val id: String,
        val title: String,
        val message: String,
        val linkUrl: String?,
    )
}
