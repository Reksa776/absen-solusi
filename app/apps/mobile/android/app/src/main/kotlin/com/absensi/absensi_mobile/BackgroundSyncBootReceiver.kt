package com.absensi.absensi_mobile

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * Menyalakan kembali [BackgroundSyncService] setelah perangkat menyala atau
 * aplikasi diperbarui, selama pengguna masih memiliki token login tersimpan.
 *
 * Android 15 melarang peluncuran foreground service bertipe `dataSync` dari
 * `BOOT_COMPLETED`, jadi kegagalan peluncuran langsung dialihkan ke alarm
 * penjadwalan ulang.
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
        if (!BackgroundSyncService.startSafely(context)) {
            Log.i("BackgroundSync", "Peluncuran saat boot ditolak; memakai alarm.")
            BackgroundSyncService.scheduleRestart(context)
        }
    }
}
