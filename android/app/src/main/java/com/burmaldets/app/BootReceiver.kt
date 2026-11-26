package com.burmaldets.app

import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** После перезагрузки телефона снова слушаем «Гудвин». Если Android не разрешит запустить микрофон из фона — просим одно нажатие. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        Macros.schedule(ctx)
        Macros.event(ctx, "boot")
        if (!WakeService.listenOn(ctx) && !Macros.needsService(ctx)) return
        if (WakeService.start(ctx)) return
        channels(ctx)
        val pi = PendingIntent.getActivity(ctx, 2, Intent(ctx, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        val n = Notification.Builder(ctx, WakeService.CH_WAKE)
            .setSmallIcon(R.drawable.ic_shef)
            .setContentTitle("Гудвин ждёт")
            .setContentText("Нажмите один раз — и Гудвин снова будет слушать")
            .setContentIntent(pi)
            .setAutoCancel(true)
            .build()
        ctx.getSystemService(NotificationManager::class.java).notify(9, n)
    }
}
