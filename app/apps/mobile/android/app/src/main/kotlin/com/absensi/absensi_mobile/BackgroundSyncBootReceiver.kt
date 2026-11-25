package com.absensi.absensi_mobile

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * Menjadwalkan ulang rantai alarm sinkronisasi setelah perangkat menyala atau
 * aplikasi diperbarui, selama pengguna masih memiliki token login tersimpan.
 *
 * Tidak ada foreground service yang dinyalakan di sini, sehingga tidak ada
 * notifikasi status yang muncul setelah boot.
 */
class BackgroundSyncBootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        val action = intent?.action ?: return
        when (action) {
            Intent.ACTION_BOOT_COMPLETED,
            Intent.ACTION_MY_PACKAGE_REPLACED,
            "android.intent.action.QUICKBOOT_POWERON",
            "com.htc.intent.action.QUICKBOOT_POWERON",
            -> Unit
            else -> return
        }
        if (!BackgroundSyncService.hasCredentials(context)) return
        BackgroundSyncService.start(context)
        Log.i("BackgroundSync", "Alarm sinkronisasi dijadwalkan ulang setelah boot.")
    }
}
