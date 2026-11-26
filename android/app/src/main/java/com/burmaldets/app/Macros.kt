package com.burmaldets.app

import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.VibrationEffect
import android.os.Vibrator
import android.provider.Settings
import android.speech.tts.TextToSpeech
import org.json.JSONArray
import org.json.JSONObject
import java.util.Calendar
import java.util.Locale

/**
 * Сценарии «когда X → сделай Y» (как в MacroDroid). Хранятся на телефоне и работают без открытого Бурмалдеца:
 * время — через будильники системы, события (зарядка, наушники, экран, Wi-Fi, Bluetooth) — через службу Бурмалдеца,
 * открытие приложений и уведомления — через «Специальные возможности».
 */
object Macros {
    private const val KEY = "macros"
    const val ACTION_FIRE = "com.burmaldets.app.MACRO"

    private val worker by lazy { HandlerThread("shef-macros").apply { start() } }
    private val bg by lazy { Handler(worker.looper) }

    private fun prefs(ctx: Context) = ctx.getSharedPreferences("shef", Context.MODE_PRIVATE)

    fun all(ctx: Context): JSONArray = try {
        JSONArray(prefs(ctx).getString(KEY, "[]"))
    } catch (_: Exception) {
        JSONArray()
    }

    @Volatile private var types: Set<String>? = null
    fun hasTrigger(ctx: Context, type: String): Boolean {
        val t = types ?: all(ctx).let { a -> (0 until a.length()).mapNotNull { i -> a.getJSONObject(i).takeIf { it.optBoolean("enabled", true) }?.optJSONObject("trigger")?.optString("type") }.toSet() }.also { types = it }
        return type in t
    }

    private fun save(ctx: Context, arr: JSONArray) {
        types = null
        prefs(ctx).edit().putString(KEY, arr.toString()).apply()
        schedule(ctx)
        WakeService.refresh(ctx)
    }

    fun add(ctx: Context, m: JSONObject): JSONObject {
        val arr = all(ctx)
        val id = m.optString("id").ifBlank { "m" + System.currentTimeMillis().toString(36) }
        m.put("id", id).put("enabled", m.optBoolean("enabled", true)).put("created", System.currentTimeMillis())
        val out = JSONArray()
        for (i in 0 until arr.length()) if (arr.getJSONObject(i).optString("id") != id) out.put(arr.getJSONObject(i))
        out.put(m)
        save(ctx, out)
        return JSONObject().put("ok", true).put("id", id)
    }

    fun remove(ctx: Context, id: String): JSONObject {
        val arr = all(ctx)
        val out = JSONArray()
        var found = false
        for (i in 0 until arr.length()) if (arr.getJSONObject(i).optString("id") == id) found = true else out.put(arr.getJSONObject(i))
        cancelAlarm(ctx, id)
        save(ctx, out)
        return JSONObject().put("ok", found)
    }

    fun setEnabled(ctx: Context, id: String, on: Boolean): JSONObject {
        val arr = all(ctx)
        var found = false
        for (i in 0 until arr.length()) arr.getJSONObject(i).let { if (it.optString("id") == id) { it.put("enabled", on); found = true } }
        if (!on) cancelAlarm(ctx, id)
        save(ctx, arr)
        return JSONObject().put("ok", found)
    }

    /** Нужна ли постоянная служба (события, а не только время/голос). */
    fun needsService(ctx: Context): Boolean {
        val arr = all(ctx)
        for (i in 0 until arr.length()) {
            val m = arr.getJSONObject(i)
            if (!m.optBoolean("enabled", true)) continue
            val t = m.optJSONObject("trigger")?.optString("type") ?: continue
            if (t !in setOf("time", "interval", "voice", "app_opened", "notification", "boot")) return true
        }
        return false
    }

    // ---------- время ----------
    private fun pi(ctx: Context, id: String) = PendingIntent.getBroadcast(
        ctx, id.hashCode(), Intent(ctx, MacroReceiver::class.java).setAction(ACTION_FIRE).putExtra("id", id),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

    private fun cancelAlarm(ctx: Context, id: String) {
        (ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager).cancel(pi(ctx, id))
    }

    /** Следующее срабатывание «в 07:30 по будням». days: 1=пн … 7=вс; пусто — каждый день. */
    fun nextTime(t: JSONObject, from: Long = System.currentTimeMillis()): Long {
        if (t.optString("type") == "interval") return from + t.optInt("minutes", 60).coerceAtLeast(1) * 60000L
        // напоминание: точный момент в миллисекундах
        if (t.optLong("at", 0L) > 0L) return t.optLong("at")
        val (h, m) = t.optString("time", "08:00").split(":").let { (it.getOrNull(0)?.toIntOrNull() ?: 8) to (it.getOrNull(1)?.toIntOrNull() ?: 0) }
        val days = t.optJSONArray("days")?.let { a -> (0 until a.length()).map { a.optInt(it) }.toSet() } ?: emptySet()
        val c = Calendar.getInstance().apply { timeInMillis = from; set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0); set(Calendar.HOUR_OF_DAY, h); set(Calendar.MINUTE, m) }
        if (t.optString("date").isNotBlank()) {
            // разовый: конкретная дата
            val d = t.optString("date").split("-").map { it.toIntOrNull() ?: 0 }
            if (d.size == 3) c.set(d[0], d[1] - 1, d[2])
            return c.timeInMillis
        }
        repeat(8) {
            val dow = (c.get(Calendar.DAY_OF_WEEK) + 5) % 7 + 1 // пн=1
            if (c.timeInMillis > from + 1000 && (days.isEmpty() || dow in days)) return c.timeInMillis
            c.add(Calendar.DAY_OF_MONTH, 1)
        }
        return c.timeInMillis
    }

    fun schedule(ctx: Context) {
        val am = ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        val arr = all(ctx)
        for (i in 0 until arr.length()) {
            val m = arr.getJSONObject(i)
            val t = m.optJSONObject("trigger") ?: continue
            val id = m.optString("id")
            if (t.optString("type") !in setOf("time", "interval")) continue
            if (!m.optBoolean("enabled", true)) {
                cancelAlarm(ctx, id)
                continue
            }
            val at = nextTime(t)
            if (at < System.currentTimeMillis()) continue
            val p = pi(ctx, id)
            try {
                if (Build.VERSION.SDK_INT < 31 || am.canScheduleExactAlarms()) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, p)
                else am.setWindow(AlarmManager.RTC_WAKEUP, at, 60000, p)
            } catch (_: Exception) {
                am.set(AlarmManager.RTC_WAKEUP, at, p)
            }
        }
    }

    // ---------- события ----------
    /** Пришло событие телефона: запускаем подходящие сценарии. */
    fun event(ctx: Context, type: String, data: JSONObject = JSONObject()) {
        if (!hasTrigger(ctx, type)) return
        val arr = all(ctx)
        for (i in 0 until arr.length()) {
            val m = arr.getJSONObject(i)
            if (!m.optBoolean("enabled", true)) continue
            val t = m.optJSONObject("trigger") ?: continue
            if (t.optString("type") != type || !matches(t, data)) continue
            run(ctx, m, "событие $type", data)
        }
    }

    private fun has(hay: String, needle: String) = needle.isBlank() || hay.lowercase().contains(needle.lowercase().trim())

    private fun matches(t: JSONObject, d: JSONObject): Boolean = when (t.optString("type")) {
        "battery_low" -> d.optInt("level", 100) <= t.optInt("level", 20) && d.optInt("prev", 100) > t.optInt("level", 20)
        "battery_high" -> d.optInt("level", 0) >= t.optInt("level", 90) && d.optInt("prev", 0) < t.optInt("level", 90)
        "app_opened" -> has(d.optString("app") + " " + d.optString("package"), t.optString("app"))
        "notification" -> has(d.optString("app") + " " + d.optString("package"), t.optString("app")) && has(d.optString("text"), t.optString("text"))
        "wifi_on", "wifi_off" -> has(d.optString("ssid"), t.optString("ssid"))
        "bluetooth_on", "bluetooth_off" -> has(d.optString("device"), t.optString("device"))
        else -> true
    }

    fun runById(ctx: Context, id: String, why: String): JSONObject {
        val arr = all(ctx)
        for (i in 0 until arr.length()) {
            val m = arr.getJSONObject(i)
            if (m.optString("id") == id) {
                run(ctx, m, why)
                return JSONObject().put("ok", true)
            }
        }
        return JSONObject().put("ok", false).put("error", "нет сценария $id")
    }

    // ---------- выполнение ----------
    /** {app} {from} {text} {level} {device} {ssid} в текстах действий — данные события (например, кто написал и что). */
    private fun fill(a: JSONObject, d: JSONObject): JSONObject {
        if (d.length() == 0) return a
        val out = JSONObject(a.toString())
        for (k in listOf("text", "title", "query", "to")) {
            val v = out.optString(k)
            if (!v.contains('{')) continue
            out.put(k, v.replace("{app}", d.optString("app")).replace("{from}", d.optString("title")).replace("{text}", d.optString("body").ifBlank { d.optString("text") })
                .replace("{level}", d.optString("level")).replace("{device}", d.optString("device")).replace("{ssid}", d.optString("ssid")))
        }
        return out
    }

    fun run(ctx: Context, m: JSONObject, why: String, data: JSONObject = JSONObject()) {
        val app = ctx.applicationContext
        val acts = m.optJSONArray("actions") ?: return
        Journal.add(app, "сценарий", "«${m.optString("name")}» — $why")
        bg.post {
            for (k in 0 until acts.length()) {
                try {
                    step(app, fill(acts.getJSONObject(k), data))
                } catch (e: Exception) {
                    Journal.add(app, "ошибка", "сценарий «${m.optString("name")}», шаг ${k + 1}: ${e.message}")
                }
            }
        }
    }

    private val main = Handler(android.os.Looper.getMainLooper())
    private fun onMain(f: () -> Unit) = main.post { try { f() } catch (_: Exception) {} }

    private var tts: TextToSpeech? = null
    private var ttsReady = false
    private fun speak(ctx: Context, text: String) {
        val t = tts
        if (t == null) {
            tts = TextToSpeech(ctx) { st ->
                ttsReady = st == TextToSpeech.SUCCESS
                if (ttsReady) {
                    tts?.language = Locale("ru", "RU")
                    tts?.speak(text, TextToSpeech.QUEUE_ADD, null, "m" + System.nanoTime())
                }
            }
        } else if (ttsReady) t.speak(text, TextToSpeech.QUEUE_ADD, null, "m" + System.nanoTime())
        Thread.sleep((800 + text.length * 70L).coerceAtMost(15000))
    }

    private fun step(ctx: Context, a: JSONObject) {
        val d = Device(ctx)
        when (a.optString("type")) {
            "speak" -> speak(ctx, a.optString("text"))
            "notify" -> {
                channels(ctx)
                val n = Notification.Builder(ctx, WakeService.CH_WAKE).setSmallIcon(R.drawable.ic_shef)
                    .setContentTitle(a.optString("title").ifBlank { "Бурмалдец" }).setContentText(a.optString("text"))
                    .setStyle(Notification.BigTextStyle().bigText(a.optString("text"))).setAutoCancel(true).build()
                ctx.getSystemService(NotificationManager::class.java).notify((System.currentTimeMillis() % 100000).toInt() + 100, n)
            }
            "vibrate" -> {
                val v = ctx.getSystemService(Vibrator::class.java)
                v?.vibrate(VibrationEffect.createOneShot((a.optDouble("seconds", 0.5) * 1000).toLong().coerceIn(50, 5000), VibrationEffect.DEFAULT_AMPLITUDE))
            }
            "wait" -> Thread.sleep((a.optDouble("seconds", 1.0) * 1000).toLong().coerceIn(0, 600000))
            "torch" -> d.torch(a.optBoolean("on", true))
            "volume" -> d.volume(a.optDouble("percent", Double.NaN), a.optString("direction"))
            "ringer" -> d.ringer(a.optString("mode"))
            "dnd" -> {
                val nm = ctx.getSystemService(NotificationManager::class.java)
                if (nm.isNotificationPolicyAccessGranted) nm.setInterruptionFilter(if (a.optBoolean("on", true)) NotificationManager.INTERRUPTION_FILTER_PRIORITY else NotificationManager.INTERRUPTION_FILTER_ALL)
                else Journal.add(ctx, "недоработка", "нет доступа к «Не беспокоить» — выдайте Бурмалдецу в настройках")
            }
            "brightness" -> {
                if (Settings.System.canWrite(ctx)) {
                    Settings.System.putInt(ctx.contentResolver, Settings.System.SCREEN_BRIGHTNESS_MODE, Settings.System.SCREEN_BRIGHTNESS_MODE_MANUAL)
                    Settings.System.putInt(ctx.contentResolver, Settings.System.SCREEN_BRIGHTNESS, (a.optDouble("percent", 50.0) * 2.55).toInt().coerceIn(1, 255))
                } else Journal.add(ctx, "недоработка", "нет разрешения менять яркость — выдайте Бурмалдецу «Изменение системных настроек»")
            }
            "open_app" -> onMain { d.openApp(a.optString("app")) }
            "open_url" -> onMain { d.openUrl(a.optString("url")) }
            "play_music" -> onMain { d.playMusic(a.optString("query"), a.optString("app"), a.optString("kind"), a.optString("title"), a.optString("artist")) }
            "media" -> d.media(a.optString("action", "play"))
            "timer" -> onMain { d.setTimer(a.optInt("seconds", 60), a.optString("text").ifBlank { "Бурмалдец" }) }
            "alarm" -> onMain {
                val (h, mi) = a.optString("time", "07:00").split(":").let { (it.getOrNull(0)?.toIntOrNull() ?: 7) to (it.getOrNull(1)?.toIntOrNull() ?: 0) }
                d.setAlarm(h, mi, a.optString("text").ifBlank { "Бурмалдец" })
            }
            "navigate" -> onMain { d.navigate(a.optString("place"), a.optString("mode", "drive")) }
            "open_settings" -> onMain { d.openSettings(a.optString("what")) }
            "phone_action" -> ShefAccess.inst?.global(a.optString("action"))
            "tap_text" -> {
                Thread.sleep(400)
                ShefAccess.inst?.tapText(a.optString("text"))
            }
            "call" -> onMain { d.call(a.optString("number"), androidx.core.content.ContextCompat.checkSelfPermission(ctx, android.Manifest.permission.CALL_PHONE) == android.content.pm.PackageManager.PERMISSION_GRANTED) }
            "send_message" -> {
                onMain { d.openMessage(a.optString("app", "sms"), a.optString("number"), a.optString("text")) }
                Thread.sleep(3000)
                ShefAccess.inst?.tapText("com.whatsapp:id/send", "com.whatsapp.w4b:id/send", "Отправить", "Send")
            }
            "shef" -> onMain {
                // сложная команда — открываем Бурмалдеца, он выполнит её как голосовую
                ctx.startActivity(Intent(ctx, MainActivity::class.java).putExtra(MainActivity.EXTRA_CMD, a.optString("text")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP))
            }
        }
    }
}

/** Будильник сценария сработал (или телефон перезагрузился — расставляем заново). */
class MacroReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        when (intent.action) {
            Macros.ACTION_FIRE -> {
                val id = intent.getStringExtra("id") ?: return
                val arr = Macros.all(ctx)
                for (i in 0 until arr.length()) {
                    val m = arr.getJSONObject(i)
                    if (m.optString("id") != id || !m.optBoolean("enabled", true)) continue
                    val t = m.optJSONObject("trigger")
                    Macros.run(ctx, m, "время")
                    // разовый сценарий на дату — выключаем после срабатывания
                    if (m.optBoolean("reminder")) Macros.remove(ctx, id)
                    else if (t != null && (t.optString("date").isNotBlank() || t.optLong("at", 0L) > 0L)) Macros.setEnabled(ctx, id, false)
                }
                Macros.schedule(ctx)
            }
            Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_MY_PACKAGE_REPLACED -> {
                Macros.schedule(ctx)
                Macros.event(ctx, "boot")
            }
        }
    }
}
