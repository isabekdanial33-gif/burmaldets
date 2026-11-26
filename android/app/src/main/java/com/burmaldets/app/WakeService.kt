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
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import org.json.JSONArray
import org.json.JSONObject
import org.vosk.Model
import org.vosk.Recognizer
import java.io.File
import kotlin.math.abs

/**
 * Слушает слово «Гудвин» постоянно — и при выключенном экране, и на блокировке.
 * Распознавание идёт прямо на телефоне (Vosk), звук никуда не отправляется.
 * Пока Гудвин разговаривает, микрофон отдаётся распознаванию команд, потом служба снова слушает.
 */
class WakeService : Service() {

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
         * Насколько уверенно в законченной фразе прозвучало имя: -1 — не было; иначе уверенность Vosk в слове «гудвин» (0..1).
         * Выученная фраза в одно слово (например «отец») — обычное слово, поэтому считается, только если сказана отдельной
         * репликой («Отец!») или обращением с паузой («Отец, … »).
         */
        fun nameScore(text: String, words: JSONArray? = null): Double {
            val t = norm(text)
            if (t.isEmpty()) return -1.0
            if (WAKE.containsMatchIn(t)) {
                if (words == null) return 1.0
                for (i in 0 until words.length()) {
                    val w = words.optJSONObject(i) ?: continue
                    if (norm(w.optString("word")).startsWith("гудвин")) return w.optDouble("conf", 1.0).let { if (it >= 0.4) it else -1.0 }
                }
                return 1.0
            }
            for (p in extra) {
                if (!p.contains(' ')) {
                    if (t == p) return 0.7
                    if (words != null && words.length() > 1) {
                        val w0 = words.optJSONObject(0)
                        val w1 = words.optJSONObject(1)
                        if (w0 != null && w1 != null && norm(w0.optString("word")) == p && w1.optDouble("start") - w0.optDouble("end") >= 0.18) return 0.7
                    }
                } else if (" $t ".contains(" $p ")) return 0.7
            }
            return -1.0
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
            if (!paused && once == null && mode == Mode.IDLE) {
                mode = Mode.WAKE
                startEar()
            }
        } else if (mode == Mode.WAKE) {
            mode = Mode.IDLE
            stopEar()
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
    /** Плавающая кнопка: нажали — как будто позвали по имени. */
    val bubble by lazy { Bubble(this) { wake(fromBubble = true) } }
    private var paused = false
    private var lastWake = 0L
    private var cpuLock: PowerManager.WakeLock? = null

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
        watchPhone()
        if (Bubble.enabled(this)) main.post { if (MainActivity.current?.isVisible != true) bubble.show() }
        // процессор не засыпает, пока слушаем (иначе на части телефонов микрофон «глохнет» при выключенном экране)
        cpuLock = (getSystemService(POWER_SERVICE) as PowerManager).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "shef:listen").apply {
            setReferenceCounted(false)
            acquire()
        }
        Thread {
            try {
                loadModel(this)
                main.post {
                    if (!paused && once == null && listenOn(this)) {
                        mode = Mode.WAKE
                        startEar()
                    }
                }
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
        mode = Mode.IDLE
        stopEar()
        cpuLock?.let { if (it.isHeld) it.release() }
        super.onDestroy()
    }

    // ================= Микрофон: один на всё время =================
    // Раньше микрофон то и дело передавался между слухом имени, распознаванием Google и Vosk —
    // он щёлкал вкл/выкл по нескольку раз за фразу. Теперь его держит одна служба и не отпускает:
    // меняется только то, куда идёт звук (имя / команда / обучение / никуда).
    private enum class Mode { IDLE, WAKE, CMD, ONCE }

    @Volatile private var mode = Mode.IDLE
    @Volatile private var earRun = false
    @Volatile private var earThread: Thread? = null
    /** Пересоздать распознаватель (новая фраза). */
    @Volatile private var fresh = false
    @Volatile private var verifying = false
    @Volatile private var blockedWarned = false

    /** Разовая фраза (обучение имени или запасное распознавание). */
    @Volatile private var once: ((String) -> Unit)? = null
    @Volatile private var onceDeadline = 0L
    @Volatile private var oncePartial = ""

    /** Команда: звук уходит в приложение (там его распознаёт Gemini), Vosk на телефоне — запасной текст. */
    private val cmdText = StringBuilder()
    @Volatile private var cmdDone: java.util.concurrent.CountDownLatch? = null

    private fun startEar() {
        if (earThread != null) return
        earRun = true
        earThread = Thread({ earLoop() }, "goodwin-ear").also { it.start() }
    }

    private fun stopEar() {
        earRun = false
        val t = earThread
        earThread = null
        if (t != null && t !== Thread.currentThread()) try { t.join(700) } catch (_: Exception) {}
    }

    private fun earLoop() {
        val rate = 16000
        val min = AudioRecord.getMinBufferSize(rate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
        val ar = try {
            AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION, rate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, maxOf(min, rate * 2 * 2))
        } catch (e: Exception) {
            Log.w(TAG, "AudioRecord", e)
            null
        }
        if (ar == null || ar.state != AudioRecord.STATE_INITIALIZED) {
            ar?.release()
            Log.w(TAG, "микрофон не открылся")
            if (earThread === Thread.currentThread()) earThread = null
            once?.let { finishOnce("") }
            cmdDone?.countDown()
            main.postDelayed({ if (mode != Mode.IDLE) startEar() }, 3000)
            return
        }
        ar.startRecording()
        Log.i(TAG, "микрофон включён")
        val buf = ShortArray(1600) // 0,1 с
        var rec: Recognizer? = null
        var recMode = Mode.IDLE
        val utt = ArrayDeque<ShortArray>()
        var zeroMs = 0
        val web = java.io.ByteArrayOutputStream()
        try {
            while (earRun) {
                val n = ar.read(buf, 0, buf.size)
                if (n <= 0) {
                    if (n < 0) Thread.sleep(100)
                    continue
                }
                val m = mode
                // система «заглушила» микрофон (бывает в фоне при выключенном экране) — сообщаем один раз
                var peak = 0
                for (i in 0 until n) { val a = abs(buf[i].toInt()); if (a > peak) peak = a }
                if (peak == 0 && m == Mode.WAKE) {
                    zeroMs += n / 16
                    if (zeroMs > 20000 && !blockedWarned) {
                        blockedWarned = true
                        main.post { micBlocked() }
                    }
                } else if (peak > 0) zeroMs = 0
                // сменился режим — закрываем прошлую фразу и начинаем новую
                if (m != recMode || fresh || (rec == null && m != Mode.IDLE && model != null)) {
                    if (recMode == Mode.CMD) {
                        rec?.let { r -> try { addCmd(JSONObject(r.finalResult).optString("text")) } catch (_: Exception) {} }
                        flushWeb(web)
                        cmdDone?.countDown()
                    }
                    try { rec?.close() } catch (_: Exception) {}
                    rec = null
                    fresh = false
                    recMode = m
                    utt.clear()
                    web.reset()
                    val md = model
                    if (md != null && m != Mode.IDLE) rec = Recognizer(md, 16000f).also { if (m == Mode.WAKE) it.setWords(true) }
                }
                when (m) {
                    Mode.IDLE -> {}
                    Mode.WAKE -> {
                        val r = rec ?: continue
                        if (!verifying) {
                            utt.addLast(buf.copyOf(n))
                            while (utt.size > 120) utt.removeFirst() // не больше 12 с
                        }
                        if (r.acceptWaveForm(buf, n)) {
                            val j = JSONObject(r.result)
                            val audio = utt.toList()
                            utt.clear()
                            if (!verifying) onWakeResult(j, audio)
                        }
                    }
                    Mode.CMD -> {
                        for (i in 0 until n) {
                            web.write(buf[i].toInt() and 0xff)
                            web.write((buf[i].toInt() shr 8) and 0xff)
                        }
                        if (web.size() >= 8000) flushWeb(web) // каждые 0,25 с
                        rec?.let { r -> if (r.acceptWaveForm(buf, n)) addCmd(JSONObject(r.result).optString("text")) }
                    }
                    Mode.ONCE -> {
                        val r = rec ?: continue
                        if (r.acceptWaveForm(buf, n)) {
                            // пустой результат — это просто пауза перед речью, слушаем дальше
                            val t = JSONObject(r.result).optString("text")
                            if (t.isNotBlank()) finishOnce(t)
                        } else {
                            val p = JSONObject(r.partialResult).optString("partial")
                            if (p.isNotBlank() && p != oncePartial) {
                                oncePartial = p
                                MainActivity.current?.emit("stt-partial", JSONObject.quote(p))
                            }
                        }
                        if (once != null && System.currentTimeMillis() > onceDeadline) {
                            finishOnce(JSONObject(r.finalResult).optString("text").ifBlank { oncePartial })
                        }
                    }
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "ear", e)
        } finally {
            if (recMode == Mode.CMD) cmdDone?.countDown()
            try { rec?.close() } catch (_: Exception) {}
            try { ar.stop() } catch (_: Exception) {}
            ar.release()
            Log.i(TAG, "микрофон выключен")
        }
    }

    private fun flushWeb(web: java.io.ByteArrayOutputStream) {
        if (web.size() == 0) return
        val b64 = android.util.Base64.encodeToString(web.toByteArray(), android.util.Base64.NO_WRAP)
        web.reset()
        MainActivity.current?.emit("pcm", JSONObject.quote(b64))
    }

    private fun addCmd(t: String) {
        if (t.isBlank()) return
        synchronized(cmdText) { if (cmdText.isNotEmpty()) cmdText.append(' '); cmdText.append(t) }
    }

    /** Приложение слушает команду: звук идёт к нему кусками по 0,25 с (событие «pcm»). Микрофон при этом не переключается. */
    fun cmdStart() {
        paused = true
        once?.let { finishOnce("") }
        synchronized(cmdText) { cmdText.setLength(0) }
        cmdDone = java.util.concurrent.CountDownLatch(1)
        mode = Mode.CMD
        fresh = true
        startEar()
    }

    /** Команда закончилась (решает приложение по паузе). Возвращает, что расслышал Vosk на телефоне, — запасной текст. */
    fun cmdStop(): String {
        val l = cmdDone
        // атомарно: если тем временем началось обучение (ONCE), его не сбиваем
        synchronized(this) {
            if (mode != Mode.CMD) return synchronized(cmdText) { cmdText.toString() }
            mode = Mode.IDLE
        }
        if (earThread != null) try { l?.await(800, java.util.concurrent.TimeUnit.MILLISECONDS) } catch (_: Exception) {}
        // имя не слушаем — Гудвин сейчас ответит; микрофон остаётся включённым (без щелчков), звук никуда не идёт
        if (!listenOn(this)) main.post { if (mode == Mode.IDLE) stopEar() }
        return synchronized(cmdText) { cmdText.toString() }
    }

    /** Гудвин разговаривает: звук никуда не идёт, но микрофон не выключаем — иначе он щёлкает между фразами. */
    fun pause() {
        paused = true
        once?.let { finishOnce("") }
        if (mode != Mode.CMD) mode = Mode.IDLE
        if (!listenOn(this) && mode == Mode.IDLE) stopEar()
    }

    /** Совсем отдать микрофон (нужно распознаванию Google, оно не умеет делить микрофон). */
    fun release() {
        paused = true
        once?.let { finishOnce("") }
        mode = Mode.IDLE
        stopEar()
    }

    /** Снова слушать имя. Во время обучения имени — не мешаем ему. */
    fun resume() {
        if (once != null) return
        paused = false
        if (!listenOn(this)) {
            mode = Mode.IDLE
            stopEar()
            return
        }
        if (mode != Mode.WAKE) {
            mode = Mode.WAKE
            fresh = true
        }
        startEar()
    }

    /** Одна фраза целиком через Vosk (обучение имени или запасное распознавание). Имя в это время не будит. */
    fun listenOnce(timeoutMs: Int, cb: (String) -> Unit) {
        if (model == null) {
            cb("")
            return
        }
        paused = true
        once?.let { finishOnce("") }
        once = cb
        oncePartial = ""
        onceDeadline = System.currentTimeMillis() + timeoutMs
        synchronized(this) { mode = Mode.ONCE }
        fresh = true
        startEar()
    }

    private fun finishOnce(text: String) {
        val cb = once ?: return
        once = null
        if (mode == Mode.ONCE) mode = Mode.IDLE
        main.post { cb(text) }
    }

    /** Законченная фраза в режиме ожидания имени. */
    private fun onWakeResult(j: JSONObject, audio: List<ShortArray>) {
        val text = j.optString("text")
        val score = nameScore(text, j.optJSONArray("result"))
        if (score < 0) return
        val key = getSharedPreferences("shef", Context.MODE_PRIVATE).getString("gk", "") ?: ""
        Log.i(TAG, "кандидат «$text» уверенность $score")
        // чёткое «Гудвин» — сразу; сомнительное — спрашиваем Gemini по записи (если есть ключ и сеть)
        if (score >= 0.85 || (key.isEmpty() && score >= 0.6)) {
            wake()
            return
        }
        if (key.isEmpty()) return
        verifying = true
        Thread {
            val ok = try { verifyName(key, audio) } catch (_: Exception) { null }
            verifying = false
            Log.i(TAG, "проверка облаком: $ok")
            // облако не ответило (нет сети, лимит) — как раньше: будим при уверенности от 0.6
            if (ok == true || (ok == null && score >= 0.6)) wake()
        }.start()
    }

    private fun verifyName(key: String, audio: List<ShortArray>): Boolean? {
        val n = audio.sumOf { it.size }
        if (n < 3200) return null
        val bb = java.nio.ByteBuffer.allocate(44 + n * 2).order(java.nio.ByteOrder.LITTLE_ENDIAN)
        bb.put("RIFF".toByteArray()).putInt(36 + n * 2).put("WAVE".toByteArray()).put("fmt ".toByteArray())
            .putInt(16).putShort(1).putShort(1).putInt(16000).putInt(32000).putShort(2).putShort(16)
            .put("data".toByteArray()).putInt(n * 2)
        for (a in audio) for (s in a) bb.putShort(s)
        val wav = android.util.Base64.encodeToString(bb.array(), android.util.Base64.NO_WRAP)
        val body = JSONObject()
            .put("contents", JSONArray().put(JSONObject().put("role", "user").put("parts", JSONArray()
                .put(JSONObject().put("text", "Голосового ассистента зовут «Гудвин». Прозвучало ли в этой записи это имя — отчётливо, именно это слово (похожие обычные слова не считаются)? Ответь одним словом: да или нет."))
                .put(JSONObject().put("inlineData", JSONObject().put("mimeType", "audio/wav").put("data", wav))))))
            .put("generationConfig", JSONObject().put("temperature", 0).put("maxOutputTokens", 5).put("thinkingConfig", JSONObject().put("thinkingLevel", "minimal")))
            .toString().toByteArray()
        val started = System.currentTimeMillis()
        for (m in listOf("gemini-3.5-flash-lite", "gemini-flash-lite-latest")) {
            if (System.currentTimeMillis() - started > 4000) break
            try {
                val c = java.net.URL("https://generativelanguage.googleapis.com/v1beta/models/$m:generateContent").openConnection() as java.net.HttpURLConnection
                c.connectTimeout = 3000
                c.readTimeout = 4000
                c.requestMethod = "POST"
                c.doOutput = true
                c.setRequestProperty("Content-Type", "application/json")
                c.setRequestProperty("x-goog-api-key", key)
                c.outputStream.use { it.write(body) }
                if (c.responseCode != 200) continue
                val parts = JSONObject(c.inputStream.bufferedReader().readText()).optJSONArray("candidates")
                    ?.optJSONObject(0)?.optJSONObject("content")?.optJSONArray("parts") ?: continue
                val sb = StringBuilder()
                for (i in 0 until parts.length()) {
                    val p = parts.optJSONObject(i) ?: continue
                    if (!p.optBoolean("thought")) sb.append(p.optString("text"))
                }
                val t = sb.toString().trim().lowercase()
                return if (t.startsWith("да")) true else if (t.startsWith("нет")) false else null
            } catch (e: Exception) {
                Log.w(TAG, "verify $m", e)
            }
        }
        return null
    }

    /** Микрофон молчит нулями — Android не даёт слушать в фоне. Подсказываем, как разрешить. */
    private fun micBlocked() {
        Journal.add(this, "ошибка", "микрофон в фоне выдаёт тишину — телефон не даёт слушать при выключенном экране")
        val i = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, android.net.Uri.parse("package:$packageName"))
        val pi = PendingIntent.getActivity(this, 3, i, PendingIntent.FLAG_IMMUTABLE)
        (getSystemService(NOTIFICATION_SERVICE) as NotificationManager).notify(10, Notification.Builder(this, CH_WAKE)
            .setSmallIcon(R.drawable.ic_shef).setContentTitle("Гудвин не слышит в фоне")
            .setContentText("Телефон глушит микрофон. Батарея → «Без ограничений», разрешите автозапуск и микрофон «всегда».")
            .setStyle(Notification.BigTextStyle().bigText("Телефон глушит микрофон, когда экран выключен. Откройте: Батарея → «Без ограничений», разрешите автозапуск (если есть) и микрофон. Потом откройте Гудвина один раз."))
            .setContentIntent(pi).setAutoCancel(true).build())
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
