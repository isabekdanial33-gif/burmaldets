package com.burmaldets.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.provider.Settings
import android.util.Log
import org.json.JSONObject
import org.vosk.Model
import org.vosk.Recognizer
import org.vosk.android.RecognitionListener
import org.vosk.android.SpeechService
import java.io.File

/**
 * Слушает слово «Гудвин» постоянно — и при выключенном экране, и на блокировке.
 * Распознавание идёт прямо на телефоне (Vosk), звук никуда не отправляется.
 * Пока Гудвин разговаривает, микрофон отдаётся распознаванию команд, потом служба снова слушает.
 */
class WakeService : Service(), RecognitionListener {

    companion object {
        const val CH_LISTEN = "shef_listen"
        const val CH_WAKE = "shef_wake"
        const val NOTE_ID = 7
        const val WAKE_NOTE_ID = 8
        private const val TAG = "ShefWake"
        /**
         * «Гудвин» есть в словаре Vosk и слышится чётко (замер: 12 из 12, уверенность 0.99, ложных на обычной речи — 0).
         * Будит только законченная фраза с уверенностью от 0.6 (см. onResult).
         */
        val WAKE = Regex("""(?:^|\s)гудвин\S*(?=\s|$)""")

        /** Как Vosk слышит имя голосом хозяина (из обучения в приложении), если стандартное «гудвин» у него не ловится */
        @Volatile var extra: List<String> = emptyList()
        private val NON_LETTER = Regex("""[^\p{L}\p{N}\s]""")
        private val SPACES = Regex("""\s+""")
        fun norm(t: String) = t.lowercase().replace('ё', 'е').replace(NON_LETTER, " ").replace(SPACES, " ").trim()

        fun loadExtra(ctx: Context) {
            val raw = ctx.getSharedPreferences("shef", Context.MODE_PRIVATE).getString("wakeExtra", "[]") ?: "[]"
            extra = try {
                val a = org.json.JSONArray(raw)
                (0 until a.length()).map { norm(a.optString(it)) }.filter { it.isNotEmpty() }
            } catch (_: Exception) {
                emptyList()
            }
        }

        /**
         * Услышали имя? final — законченная реплика (после паузы). Выученная фраза в одно слово (например «отец») —
         * обычное слово, поэтому будит, только если сказана отдельной репликой («Отец!») или обращением с паузой («Отец, … »).
         */
        fun heardName(text: String, final: Boolean, words: org.json.JSONArray? = null): Boolean {
            val t = norm(text)
            if (t.isEmpty()) return false
            if (WAKE.containsMatchIn(t)) {
                // строго: только законченная фраза и чёткое слово (уверенность распознавателя от 0.6)
                if (!final) return false
                if (words == null) return true
                for (i in 0 until words.length()) {
                    val w = words.optJSONObject(i) ?: continue
                    if (norm(w.optString("word")).startsWith("гудвин")) return w.optDouble("conf", 1.0) >= 0.6
                }
                return true
            }
            for (p in extra) {
                if (!p.contains(' ')) {
                    if (final && t == p) return true
                    // «Отец, включи музыку»: слово первым и после него пауза-запятая (в обычной речи паузы между словами короче)
                    if (final && words != null && words.length() > 1) {
                        val w0 = words.optJSONObject(0)
                        val w1 = words.optJSONObject(1)
                        if (w0 != null && w1 != null && norm(w0.optString("word")) == p && w1.optDouble("start") - w0.optDouble("end") >= 0.18) return true
                    }
                } else if (" $t ".contains(" $p ")) return true
            }
            return false
        }


        @Volatile var instance: WakeService? = null
        @Volatile var model: Model? = null

        fun start(ctx: Context): Boolean = try {
            val i = Intent(ctx, WakeService::class.java)
            if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(i) else ctx.startService(i)
            true
        } catch (e: Exception) {
            Log.w(TAG, "start failed", e)
            false
        }

        fun stop(ctx: Context) {
            ctx.stopService(Intent(ctx, WakeService::class.java))
        }

        fun listenOn(ctx: Context) = ctx.getSharedPreferences("shef", Context.MODE_PRIVATE).getBoolean("wake", true)

        /** Служба нужна, если слушаем имя, показываем плавающую кнопку или есть сценарии на события телефона. */
        fun refresh(ctx: Context) {
            if (listenOn(ctx) || Macros.needsService(ctx) || (Bubble.enabled(ctx) && Bubble.canShow(ctx))) {
                val s = instance
                if (s == null) start(ctx) else s.main.post { s.applyMode() }
            } else stop(ctx)
        }

        /** Модель Vosk лежит в assets — на первом запуске копируем её в память приложения. */
        fun loadModel(ctx: Context): Model {
            model?.let { return it }
            synchronized(this) {
                model?.let { return it }
                val dir = File(ctx.filesDir, "vosk-ru-0.22")
                val mark = File(dir, ".ok")
                if (!mark.exists()) {
                    dir.deleteRecursively()
                    copyAssets(ctx, "vosk", dir)
                    mark.writeText("1")
                }
                return Model(dir.absolutePath).also { model = it }
            }
        }

        private fun copyAssets(ctx: Context, path: String, to: File) {
            val list = ctx.assets.list(path) ?: emptyArray()
            if (list.isEmpty()) {
                to.parentFile?.mkdirs()
                ctx.assets.open(path).use { inp -> to.outputStream().use { inp.copyTo(it) } }
                return
            }
            to.mkdirs()
            for (n in list) copyAssets(ctx, "$path/$n", File(to, n))
        }
    }

    val main = Handler(Looper.getMainLooper())
    private var lastBattery = -1
    private val events = object : android.content.BroadcastReceiver() {
        override fun onReceive(c: Context, i: Intent) {
            when (i.action) {
                Intent.ACTION_POWER_CONNECTED -> Macros.event(c, "charger_on")
                Intent.ACTION_POWER_DISCONNECTED -> Macros.event(c, "charger_off")
                Intent.ACTION_SCREEN_ON -> Macros.event(c, "screen_on")
                Intent.ACTION_SCREEN_OFF -> Macros.event(c, "screen_off")
                Intent.ACTION_USER_PRESENT -> Macros.event(c, "unlock")
                Intent.ACTION_BATTERY_CHANGED -> {
                    val lv = i.getIntExtra(android.os.BatteryManager.EXTRA_LEVEL, -1) * 100 / i.getIntExtra(android.os.BatteryManager.EXTRA_SCALE, 100).coerceAtLeast(1)
                    if (lastBattery >= 0 && lv != lastBattery) {
                        val d = JSONObject().put("level", lv).put("prev", lastBattery)
                        Macros.event(c, "battery_low", d)
                        Macros.event(c, "battery_high", d)
                    }
                    lastBattery = lv
                }
                Intent.ACTION_HEADSET_PLUG -> if (!isInitialStickyBroadcast) Macros.event(c, if (i.getIntExtra("state", 0) == 1) "headphones_on" else "headphones_off")
                android.bluetooth.BluetoothDevice.ACTION_ACL_CONNECTED, android.bluetooth.BluetoothDevice.ACTION_ACL_DISCONNECTED -> {
                    val name = try {
                        @Suppress("DEPRECATION")
                        i.getParcelableExtra<android.bluetooth.BluetoothDevice>(android.bluetooth.BluetoothDevice.EXTRA_DEVICE)?.name ?: ""
                    } catch (_: SecurityException) {
                        ""
                    }
                    Macros.event(c, if (i.action == android.bluetooth.BluetoothDevice.ACTION_ACL_CONNECTED) "bluetooth_on" else "bluetooth_off", JSONObject().put("device", name))
                }
            }
        }
    }
    private var netCb: android.net.ConnectivityManager.NetworkCallback? = null

    private fun watchPhone() {
        val f = android.content.IntentFilter().apply {
            listOf(Intent.ACTION_POWER_CONNECTED, Intent.ACTION_POWER_DISCONNECTED, Intent.ACTION_SCREEN_ON, Intent.ACTION_SCREEN_OFF, Intent.ACTION_USER_PRESENT,
                Intent.ACTION_BATTERY_CHANGED, Intent.ACTION_HEADSET_PLUG, android.bluetooth.BluetoothDevice.ACTION_ACL_CONNECTED, android.bluetooth.BluetoothDevice.ACTION_ACL_DISCONNECTED).forEach { addAction(it) }
        }
        androidx.core.content.ContextCompat.registerReceiver(this, events, f, androidx.core.content.ContextCompat.RECEIVER_NOT_EXPORTED)
        val cm = getSystemService(android.net.ConnectivityManager::class.java)
        val cb = object : android.net.ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: android.net.Network) {
                @Suppress("DEPRECATION")
                val ssid = try { (applicationContext.getSystemService(WIFI_SERVICE) as android.net.wifi.WifiManager).connectionInfo?.ssid?.trim('"') ?: "" } catch (_: Exception) { "" }
                Macros.event(this@WakeService, "wifi_on", JSONObject().put("ssid", ssid))
            }
            override fun onLost(network: android.net.Network) = Macros.event(this@WakeService, "wifi_off")
        }
        try {
            cm.registerNetworkCallback(android.net.NetworkRequest.Builder().addTransportType(android.net.NetworkCapabilities.TRANSPORT_WIFI).build(), cb)
            netCb = cb
        } catch (_: Exception) {
        }
    }

    /** Слушать имя или только следить за сценариями. */
    fun applyMode() {
        if (Bubble.enabled(this) && Bubble.canShow(this)) bubble.show() else bubble.hide()
        if (listenOn(this)) {
            if (!paused && speech == null && model != null) listenForName()
        } else {
            stopRec()
        }
        (getSystemService(NOTIFICATION_SERVICE) as NotificationManager).notify(NOTE_ID, note())
    }

    private fun note(): Notification = Notification.Builder(this, CH_LISTEN)
        .setSmallIcon(R.drawable.ic_shef)
        .setContentTitle(if (listenOn(this)) "Гудвин слушает" else "Гудвин рядом")
        .setContentText(if (listenOn(this)) "Скажите «Гудвин» — даже при выключенном экране" else "Плавающая кнопка и сценарии работают в фоне")
        .setOngoing(true)
        .setContentIntent(PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE))
        .build()
    private var speech: SpeechService? = null
    /** Плавающая кнопка: нажали — как будто позвали по имени. */
    val bubble by lazy { Bubble(this) { wake(fromBubble = true) } }
    private var paused = false
    private var lastWake = 0L
    private var cpuLock: PowerManager.WakeLock? = null
    /** Разовое распознавание фразы (когда на телефоне нет распознавания Google). */
    private var once: ((String) -> Unit)? = null
    private var oncePartial = ""

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        loadExtra(this)
        instance = this
        channels(this)
        val note = note()
        try {
            if (Build.VERSION.SDK_INT >= 30) startForeground(NOTE_ID, note, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
            else startForeground(NOTE_ID, note)
        } catch (e: Exception) {
            // Android 14+ не даёт включить микрофон из фона (например, сразу после перезагрузки) — просим одно нажатие
            Log.w(TAG, "startForeground", e)
            val pi = PendingIntent.getActivity(this, 2, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
            (getSystemService(NOTIFICATION_SERVICE) as NotificationManager).notify(9, Notification.Builder(this, CH_WAKE)
                .setSmallIcon(R.drawable.ic_shef).setContentTitle("Гудвин ждёт")
                .setContentText("Нажмите один раз — и Гудвин снова будет слушать").setContentIntent(pi).setAutoCancel(true).build())
            instance = null
            stopSelf()
            return
        }
        // процессор не засыпает, пока слушаем (иначе на части телефонов микрофон «глохнет» при выключенном экране)
        watchPhone()
        if (Bubble.enabled(this)) main.post { if (MainActivity.current?.isVisible != true) bubble.show() }
        cpuLock = (getSystemService(POWER_SERVICE) as PowerManager).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "shef:listen").apply {
            setReferenceCounted(false)
            acquire()
        }
        Thread {
            try {
                loadModel(this)
                main.post { if (!paused && listenOn(this)) listenForName() }
            } catch (e: Exception) {
                Log.e(TAG, "model", e)
                Journal.add(this, "ошибка", "не загрузилась модель распознавания: ${e.message}")
            }
        }.start()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int = START_STICKY

    override fun onTaskRemoved(rootIntent: Intent?) {
        // смахнули приложение из списка недавних — служба продолжает слушать
        super.onTaskRemoved(rootIntent)
    }

    override fun onDestroy() {
        instance = null
        bubble.hide()
        try { unregisterReceiver(events) } catch (_: Exception) {}
        netCb?.let { try { getSystemService(android.net.ConnectivityManager::class.java).unregisterNetworkCallback(it) } catch (_: Exception) {} }
        stopRec()
        cpuLock?.let { if (it.isHeld) it.release() }
        super.onDestroy()
    }

    private fun stopRec() {
        try {
            speech?.stop()
            speech?.shutdown()
        } catch (_: Exception) {
        }
        speech = null
    }

    private fun listenForName() {
        val m = model ?: return
        stopRec()
        try {
            // полный словарь, а не грамматика: с грамматикой Vosk «натягивает» обычную речь на имя
            val rec = Recognizer(m, 16000f)
            rec.setWords(true)
            speech = SpeechService(rec, 16000f).also { it.startListening(this) }
        } catch (e: Exception) {
            Log.e(TAG, "listen", e)
            main.postDelayed({ if (!paused) listenForName() }, 3000)
        }
    }

    /** Отдать микрофон (Гудвин разговаривает). */
    fun pause() {
        paused = true
        once = null
        stopRec()
    }

    /** Снова слушать имя. */
    fun resume() {
        if (!paused && speech != null) return
        paused = false
        once = null
        if (!listenOn(this)) {
            stopRec()
            return
        }
        listenForName()
    }

    /** Одна фраза целиком через Vosk — запасной вариант распознавания. */
    fun listenOnce(timeoutMs: Int, cb: (String) -> Unit) {
        val m = model
        if (m == null) {
            cb("")
            return
        }
        paused = true
        stopRec()
        once = cb
        oncePartial = ""
        try {
            val rec = Recognizer(m, 16000f)
            speech = SpeechService(rec, 16000f).also { it.startListening(this, timeoutMs) }
        } catch (e: Exception) {
            once = null
            cb("")
        }
    }

    private fun finishOnce(text: String) {
        val cb = once ?: return
        once = null
        stopRec()
        main.post { cb(text) }
    }

    override fun onPartialResult(hypothesis: String?) {
        if (once != null) {
            val p = JSONObject(hypothesis ?: "{}").optString("partial")
            if (p.isNotBlank()) {
                oncePartial = p
                MainActivity.current?.emit("stt-partial", JSONObject.quote(p))
            }
            return
        }
        val p = JSONObject(hypothesis ?: "{}").optString("partial")
        if (heardName(p, false)) wake()
    }

    override fun onResult(hypothesis: String?) {
        val j = JSONObject(hypothesis ?: "{}")
        if (once != null) {
            // пустой результат — это просто пауза перед речью, слушаем дальше
            val t = j.optString("text")
            if (t.isNotBlank()) finishOnce(t)
            return
        }
        if (heardName(j.optString("text"), true, j.optJSONArray("result"))) wake()
    }

    override fun onFinalResult(hypothesis: String?) {
        if (once != null) finishOnce(JSONObject(hypothesis ?: "{}").optString("text").ifBlank { oncePartial })
    }

    override fun onError(exception: Exception?) {
        Log.w(TAG, "error", exception)
        if (once != null) finishOnce(oncePartial)
        else main.postDelayed({ if (!paused && listenOn(this)) listenForName() }, 2000)
    }

    override fun onTimeout() {
        if (once != null) finishOnce(oncePartial)
    }

    /** Услышал «Гудвин»: включаем экран и показываем Гудвина поверх всего, даже поверх блокировки. */
    fun wake(fromBubble: Boolean = false) {
        val now = System.currentTimeMillis()
        if (now - lastWake < (if (fromBubble) 700 else 2500)) return
        lastWake = now
        main.post {
            pause()
            val pm = getSystemService(POWER_SERVICE) as PowerManager
            @Suppress("DEPRECATION")
            pm.newWakeLock(PowerManager.SCREEN_BRIGHT_WAKE_LOCK or PowerManager.ACQUIRE_CAUSES_WAKEUP, "shef:wake").acquire(8000)
            val act0 = MainActivity.current
            // открыт другой экран — показываемся «шторкой» поверх него, а не на весь экран
            val i = Intent(this, MainActivity::class.java)
                .putExtra(MainActivity.EXTRA_WAKE, true)
                .putExtra(MainActivity.EXTRA_SHEET, !(act0 != null && act0.isVisible && !act0.sheet))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
            val act = MainActivity.current
            if (act != null && act.isVisible) {
                act.onWake()
                return@post
            }
            val canOverlay = Settings.canDrawOverlays(this)
            if (canOverlay) {
                try {
                    startActivity(i)
                    return@post
                } catch (e: Exception) {
                    Log.w(TAG, "startActivity", e)
                }
            }
            // без разрешения «поверх других окон» Android не даёт открыть экран из фона — показываем полноэкранное уведомление
            val pi = PendingIntent.getActivity(this, 1, i, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
            val n = Notification.Builder(this, CH_WAKE)
                .setSmallIcon(R.drawable.ic_shef)
                .setContentTitle("Гудвин проснулся")
                .setContentText("Нажмите, чтобы говорить")
                .setCategory(Notification.CATEGORY_CALL)
                .setFullScreenIntent(pi, true)
                .setContentIntent(pi)
                .setAutoCancel(true)
                .setTimeoutAfter(15000)
                .build()
            (getSystemService(NOTIFICATION_SERVICE) as NotificationManager).notify(WAKE_NOTE_ID, n)
            main.postDelayed({ if (MainActivity.current?.isVisible != true) resume() }, 15000)
        }
    }
}

fun channels(ctx: Context) {
    val nm = ctx.getSystemService(NotificationManager::class.java)
    // «тихое» уведомление: без звука и значка в строке состояния (полностью убрать его Android не разрешает)
    nm.createNotificationChannel(NotificationChannel(WakeService.CH_LISTEN, "Гудвин слушает", NotificationManager.IMPORTANCE_MIN).apply {
        setShowBadge(false)
        description = "Постоянное уведомление, пока Гудвин ждёт своё имя"
    })
    nm.createNotificationChannel(NotificationChannel(WakeService.CH_WAKE, "Гудвин проснулся", NotificationManager.IMPORTANCE_HIGH).apply {
        setSound(null, null)
    })
}
