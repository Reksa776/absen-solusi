package com.absensi.absensi_mobile

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import java.util.concurrent.Executors

/**
 * Titik bangun rantai sinkronisasi 15 detik. Tidak ada notifikasi status:
 * receiver hanya menampilkan notifikasi bila benar-benar ada approve / reject
 * / broadcast baru.
 *
 * Urutan kerja sengaja men-jadwalkan alarm berikutnya lebih dulu agar rantai
 * tidak pernah putus walau permintaan HTTP lambat atau gagal. `goAsync()`
 * dipakai supaya `onReceive` bisa langsung kembali, dan `pendingResult`
 * diakhiri setelah siklus selesai (dibatasi wakelock 10 detik).
 */
class BackgroundSyncAlarmReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent?) {
        val appContext = context.applicationContext
        if (!BackgroundSyncService.hasCredentials(appContext)) {
            BackgroundSyncService.stop(appContext)
            return
        }

        // Jadwalkan dulu: HTTP di bawah tidak boleh menunda alarm berikutnya.
        BackgroundSyncService.scheduleNext(appContext)

        val pendingResult = goAsync()
        val executor = Executors.newSingleThreadExecutor { runnable ->
            Thread(runnable, "background-sync-alarm").apply { isDaemon = true }
        }
        executor.execute {
            val wakeLock = BackgroundSyncService.acquireWakeLock(appContext)
            try {
                BackgroundSyncService.pollOnce(appContext)
            } catch (error: Exception) {
                Log.w(
                    BackgroundSyncService.TAG,
                    "Siklus alarm gagal: ${error.message}",
                )
            } finally {
                try {
                    wakeLock?.release()
                } catch (error: Exception) {
                    Log.w(
                        BackgroundSyncService.TAG,
                        "Wakelock gagal dilepas: ${error.message}",
                    )
                }
                pendingResult.finish()
                executor.shutdown()
            }
        }
    }
}
