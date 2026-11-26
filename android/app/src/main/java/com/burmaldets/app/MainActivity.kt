package com.burmaldets.app

import android.Manifest
import android.annotation.SuppressLint
import android.app.AlertDialog
import android.app.KeyguardManager
import android.app.NotificationManager
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.util.Base64
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.exifinterface.media.ExifInterface
import androidx.webkit.WebViewAssetLoader
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

/**
 * Гудвин — голосовой ассистент; внутри ещё каталог рецептов для режима повара (работает без интернета).
 * Корзина, холодильник, избранное — общие для сайта и Гудвина на этом телефоне.
 */
class MainActivity : ComponentActivity() {
    companion object {
        const val EXTRA_WAKE = "wake"
        const val EXTRA_CMD = "cmd"
        const val EXTRA_SHEET = "sheet"
        const val HOST = "https://appassets.androidplatform.net/"
        @Volatile var current: MainActivity? = null
    }

    lateinit var web: WebView
    private lateinit var voice: Voice
    private lateinit var device: Device
    private val io = Executors.newCachedThreadPool()
    private val prefs by lazy { getSharedPreferences("shef", MODE_PRIVATE) }
    var isVisible = false
        private set
    private var pendingWake = false
    private var pendingCmd: String? = null
    private var pendingSay: String? = null
    private var shefOpen = false
    private var overLock = false
    /** «Шторка» поверх другого приложения (позвали кнопкой или по имени), а не весь экран. */
    var sheet = false
        private set
    private lateinit var root: android.widget.FrameLayout

    private fun applySheet(v: Boolean) {
        sheet = v
        if (::root.isInitialized) root.setBackgroundColor(if (v) 0 else 0xFF03040A.toInt())
    }

    // ---------- фото ----------
    private var photoCb: ((String?) -> Unit)? = null
    private var photoFile: File? = null
    private val takePicture = registerForActivityResult(ActivityResultContracts.TakePicture()) { ok ->
        val cb = photoCb ?: return@registerForActivityResult
        photoCb = null
        val f = photoFile
        if (!ok || f == null) cb(null) else io.execute { cb(jpegBase64(f)) }
    }
    private var fileChooserCb: ValueCallback<Array<Uri>>? = null
    private val pickContent = registerForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        fileChooserCb?.onReceiveValue(if (uri != null) arrayOf(uri) else null)
        fileChooserCb = null
    }
    /** Разовые разрешения по запросу Гудвина (контакты, звонки). */
    private var permCb: ((Boolean) -> Unit)? = null
    private val askOne = registerForActivityResult(ActivityResultContracts.RequestPermission()) { ok ->
        val cb = permCb
        permCb = null
        cb?.invoke(ok)
    }
    private fun withPerm(perm: String, then: (Boolean) -> Unit) {
        if (has(perm)) return then(true)
        if (permCb != null) return then(false)
        permCb = then
        askOne.launch(perm)
    }

    /** Выбор файла по запросу Гудвина (обои из галереи, мелодия из файлов). */
    private var pickCb: ((Uri?) -> Unit)? = null
    private val pickAny = registerForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        val cb = pickCb
        pickCb = null
        cb?.invoke(uri)
    }

    private val askPerms = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { res ->
        if (res[Manifest.permission.RECORD_AUDIO] == true || has(Manifest.permission.RECORD_AUDIO)) WakeService.refresh(this)
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        current = this
        channels(this)
        voice = Voice(this) { n, j -> emit(n, j) }
        device = Device(this)
        val loader = WebViewAssetLoader.Builder().addPathHandler("/", WebViewAssetLoader.AssetsPathHandler(this).let { assets ->
            WebViewAssetLoader.PathHandler { path ->
                val p = if (path.isBlank() || path.endsWith("/")) path + "index.html" else path
                assets.handle("www/$p") ?: assets.handle("www/index.html")
            }
        }).build()
        web = WebView(this)
        // страница рисует фон сама — так «шторка» может быть полупрозрачной поверх другого приложения
        web.setBackgroundColor(0)
        with(web.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            allowFileAccess = false
            allowContentAccess = false
            textZoom = 100
        }
        web.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                if (request.url.host == "appassets.androidplatform.net") loader.shouldInterceptRequest(request.url) else null
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (request.url.host == "appassets.androidplatform.net") return false
                // внешние ссылки (источник рецепта, видео) — в браузере
                device.openUrl(request.url.toString())
                return true
            }
        }
        web.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(view: WebView, cb: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                fileChooserCb?.onReceiveValue(null)
                fileChooserCb = cb
                pickContent.launch("image/*")
                return true
            }
        }
        web.addJavascriptInterface(Bridge(), "ShefNative")
        root = android.widget.FrameLayout(this)
        applySheet(intent?.getBooleanExtra(EXTRA_SHEET, false) == true)
        root.addView(web, android.widget.FrameLayout.LayoutParams(-1, -1))
        setContentView(root)
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG || BuildConfig.WEB_DEBUG)
        // Android 15+ рисует приложение под строкой состояния — отодвигаем страницу от системных панелей
        androidx.core.view.ViewCompat.setOnApplyWindowInsetsListener(root) { v, insets ->
            val b = insets.getInsets(androidx.core.view.WindowInsetsCompat.Type.systemBars() or androidx.core.view.WindowInsetsCompat.Type.displayCutout())
            v.setPadding(b.left, b.top, b.right, b.bottom)
            androidx.core.view.WindowInsetsCompat.CONSUMED
        }
        pendingCmd = intent?.getStringExtra(EXTRA_CMD)
        // экран пересоздан сразу после смены обоев — договариваем «готово»
        if (System.currentTimeMillis() - prefs.getLong("wallAt", 0) < 30000) {
            prefs.edit().remove("wallAt").apply()
            pendingSay = "Готово, обои поменял."
        }
        val wake = intent?.getBooleanExtra(EXTRA_WAKE, false) == true || pendingCmd != null || pendingSay != null
        if (wake) prepareWake()
        // режим колонки: сразу голограмма, экран не гаснет
        val speaker = prefs.getBoolean("speaker", false)
        if (speaker) speakerWindow(true)
        // Гудвин — прежде всего ассистент: открываемся сразу на его экране (каталог рецептов — по ✕ или в режиме повара)
        web.loadUrl(HOST + "index.html#/shef")
        setup()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        val cmd = intent.getStringExtra(EXTRA_CMD)
        if (cmd != null) {
            prepareWake()
            WakeService.instance?.pause()
            if (shefOpen) emit("command", JSONObject.quote(cmd))
            else {
                pendingCmd = cmd
                pendingWake = true
                web.evaluateJavascript("location.hash='#/shef'", null)
            }
        } else if (intent.getBooleanExtra(EXTRA_WAKE, false)) {
            applySheet(intent.getBooleanExtra(EXTRA_SHEET, false))
            prepareWake()
            onWake()
        } else if (intent.action == Intent.ACTION_MAIN) {
            // открыли с рабочего стола — весь экран
            applySheet(false)
            emit("layout", "{\"sheet\":false}")
        }
    }

    override fun onResume() {
        super.onResume()
        isVisible = true
        WakeService.instance?.bubble?.appVisible(true)
        (getSystemService(NOTIFICATION_SERVICE) as NotificationManager).cancel(WakeService.WAKE_NOTE_ID)
    }

    override fun onPause() {
        isVisible = false
        WakeService.instance?.bubble?.appVisible(false)
        super.onPause()
    }

    override fun onDestroy() {
        current = null
        voice.shutdown()
        web.destroy()
        super.onDestroy()
    }

    @Deprecated("old api")
    override fun onBackPressed() {
        if (shefOpen) emit("back", "null")
        else if (web.canGoBack()) web.goBack()
        else moveTaskToBack(true)
    }

    /** Показ поверх блокировки и включение экрана — только когда разбудили голосом. */
    private fun prepareWake() {
        overLock = (getSystemService(KEYGUARD_SERVICE) as KeyguardManager).isKeyguardLocked
        if (Build.VERSION.SDK_INT >= 27) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
        } else {
            @Suppress("DEPRECATION")
            window.addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON)
        }
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }

    private fun speakerWindow(on: Boolean) {
        if (on) {
            window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            if (Build.VERSION.SDK_INT >= 27) setShowWhenLocked(true)
        } else {
            window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            if (Build.VERSION.SDK_INT >= 27) setShowWhenLocked(false)
        }
    }

    private fun clearWake() {
        if (prefs.getBoolean("speaker", false)) return
        if (Build.VERSION.SDK_INT >= 27) {
            setShowWhenLocked(false)
            setTurnScreenOn(false)
        }
        window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }

    fun onWake() {
        WakeService.instance?.pause()
        if (shefOpen) emit("wake", "{\"sheet\":$sheet}")
        else {
            pendingWake = true
            web.evaluateJavascript("location.hash='#/shef'", null)
        }
    }

    fun emit(name: String, json: String) {
        runOnUiThread {
            web.evaluateJavascript("window.__shefEvent&&window.__shefEvent(${JSONObject.quote(name)},${JSONObject.quote(json)})", null)
        }
    }

    private fun reply(id: String, json: String) {
        runOnUiThread { web.evaluateJavascript("window.__shefCb&&window.__shefCb(${JSONObject.quote(id)},${JSONObject.quote(json)})", null) }
    }

    // ---------- первая настройка ----------
    private fun has(p: String) = ContextCompat.checkSelfPermission(this, p) == PackageManager.PERMISSION_GRANTED

    private fun setup() {
        // разрешения спрашивает экран первого запуска (шаг «Доступ»), тут только запускаем слух и кнопку
        if (has(Manifest.permission.RECORD_AUDIO) || Bubble.enabled(this)) WakeService.refresh(this)
    }

    /** Разрешения, которые дают «невозможное»: просыпаться из фона и не засыпать. Спрашиваем по одному разу. */
    private fun extraSetup() {
        if (!Settings.canDrawOverlays(this) && !prefs.getBoolean("askedOverlay", false)) {
            prefs.edit().putBoolean("askedOverlay", true).apply()
            dialog("Чтобы Гудвин появлялся сам",
                "Разрешите «Поверх других приложений». Тогда на слово «Гудвин» экран включится и Гудвин появится даже на заблокированном телефоне.") {
                startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName")))
            }
            return
        }
        val pm = getSystemService(POWER_SERVICE) as PowerManager
        if (!pm.isIgnoringBatteryOptimizations(packageName) && !prefs.getBoolean("askedBattery", false)) {
            prefs.edit().putBoolean("askedBattery", true).apply()
            dialog("Чтобы Гудвин не засыпал",
                "Разрешите работу без ограничений батареи — иначе телефон может выключить Гудвина ночью. Расход — несколько процентов в сутки.") {
                @SuppressLint("BatteryLife")
                val i = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$packageName"))
                startActivity(i)
            }
            return
        }
        if (Build.VERSION.SDK_INT >= 34) {
            val nm = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
            if (!nm.canUseFullScreenIntent() && !prefs.getBoolean("askedFsi", false)) {
                prefs.edit().putBoolean("askedFsi", true).apply()
                dialog("Запасной способ проснуться", "Разрешите полноэкранные уведомления — пригодится, если система не даст открыть Гудвина поверх блокировки.") {
                    startActivity(Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, Uri.parse("package:$packageName")))
                }
            }
        }
    }

    private fun dialog(title: String, text: String, ok: () -> Unit) {
        AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert)
            .setTitle(title).setMessage(text)
            .setPositiveButton("Разрешить") { _, _ -> try { ok() } catch (_: Exception) {} }
            .setNegativeButton("Позже", null)
            .show()
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        // вернулись из настроек — спросим следующее
        if (hasFocus) WakeService.instance?.let { s -> s.main.post { s.applyMode() } }
    }

    private var lastSetup = 0L
    private fun extraSetupLater() {
        val now = System.currentTimeMillis()
        if (now - lastSetup < 1500) return
        lastSetup = now
        web.postDelayed({ extraSetup() }, 600)
    }

    // ---------- фото ----------
    private fun jpegBase64(f: File): String? = try {
        val o = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(f.absolutePath, o)
        var s = 1
        while (maxOf(o.outWidth, o.outHeight) / (s * 2) >= 1024) s *= 2
        var bmp = BitmapFactory.decodeFile(f.absolutePath, BitmapFactory.Options().apply { inSampleSize = s })
        val rot = when (ExifInterface(f.absolutePath).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)) {
            ExifInterface.ORIENTATION_ROTATE_90 -> 90f
            ExifInterface.ORIENTATION_ROTATE_180 -> 180f
            ExifInterface.ORIENTATION_ROTATE_270 -> 270f
            else -> 0f
        }
        val k = 1024f / maxOf(bmp.width, bmp.height)
        val m = Matrix().apply {
            if (k < 1f) postScale(k, k)
            if (rot != 0f) postRotate(rot)
        }
        bmp = Bitmap.createBitmap(bmp, 0, 0, bmp.width, bmp.height, m, true)
        val out = ByteArrayOutputStream()
        bmp.compress(Bitmap.CompressFormat.JPEG, 82, out)
        f.delete()
        Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
    } catch (e: Exception) {
        Journal.add(this, "ошибка", "фото: ${e.message}")
        null
    }

    // ---------- мост для Гудвина ----------
    inner class Bridge {
        @JavascriptInterface
        fun platform() = "android"

        @JavascriptInterface
        fun call(id: String, method: String, args: String) {
            val a = try { JSONObject(args) } catch (_: Exception) { JSONObject() }
            val done = { j: JSONObject -> reply(id, j.toString()) }
            when (method) {
                "fetch" -> io.execute { done(fetch(a)) }
                "http" -> io.execute { done(httpGet(a.optString("url"))) }
                "notifications" -> done(JSONObject().put("ok", ShefAccess.inst != null).put("list", Notes.recent(System.currentTimeMillis() - a.optLong("minutes", 720) * 60000L, a.optString("app"))))
                "log" -> io.execute { Journal.line(this@MainActivity, a.optString("line")); done(JSONObject().put("ok", true)) }
                else -> runOnUiThread {
                    try {
                        uiCall(method, a, done)
                    } catch (e: Exception) {
                        Journal.add(this@MainActivity, "ошибка", "$method: ${e.message}")
                        done(JSONObject().put("ok", false).put("error", e.message))
                    }
                }
            }
        }
    }

    private fun uiCall(method: String, a: JSONObject, done: (JSONObject) -> Unit) {
        when (method) {
            "ready" -> {
                shefOpen = true
                val w = pendingWake || (intent?.getBooleanExtra(EXTRA_WAKE, false) == true)
                pendingWake = false
                intent?.removeExtra(EXTRA_WAKE)
                intent?.removeExtra(EXTRA_CMD)
                val cmd = pendingCmd
                pendingCmd = null
                if (w || cmd != null) WakeService.instance?.pause()
                val sayIt = pendingSay
                pendingSay = null
                done(JSONObject().put("wake", w).put("cmd", cmd ?: JSONObject.NULL).put("say", sayIt ?: JSONObject.NULL).put("sheet", sheet))
            }
            "sleep" -> {
                voice.cancelListen()
                val svc = WakeService.instance
                if (svc != null) svc.resume() else WakeService.refresh(this)
                done(JSONObject().put("ok", true))
            }
            "close", "leave" -> {
                shefOpen = false
                voice.stop()
                voice.cancelListen()
                WakeService.instance?.resume()
                clearWake()
                // «шторка» — уходим обратно в то приложение, поверх которого показались
                if (method == "close" && (overLock || sheet)) {
                    overLock = false
                    moveTaskToBack(true)
                    applySheet(false)
                }
                done(JSONObject().put("ok", true))
            }
            "speak" -> voice.speak(a.optString("text"), done, a.optDouble("volume", 1.0).toFloat(), a.optDouble("rate", 1.0).toFloat())
            "stopSpeak" -> {
                voice.stop()
                done(JSONObject().put("ok", true))
            }
            "listen" -> voice.listen { t, how -> done(JSONObject().put("text", t).put("how", how)) }
            // обучение имени: одна фраза тем же распознавателем, что слушает имя, — чтобы узнать, как он слышит голос хозяина
            "wakeHear" -> {
                voice.stop()
                voice.cancelListen()
                val timeout = a.optInt("timeout", 6000)
                if (WakeService.instance == null) WakeService.start(this)
                var waited = 0
                val h = android.os.Handler(mainLooper)
                fun go() {
                    val svc = WakeService.instance
                    if (svc == null || WakeService.model == null) {
                        if (svc != null) io.execute { try { WakeService.loadModel(this) } catch (_: Exception) {} }
                        waited += 300
                        if (waited > 15000) done(JSONObject().put("error", "слух не запустился"))
                        else h.postDelayed({ go() }, 300)
                        return
                    }
                    svc.listenOnce(timeout) { t -> done(JSONObject().put("text", t)) }
                }
                go()
            }
            "wakeExtra" -> {
                val list = a.optJSONArray("list") ?: org.json.JSONArray()
                getSharedPreferences("shef", MODE_PRIVATE).edit().putString("wakeExtra", list.toString()).apply()
                WakeService.loadExtra(this)
                done(JSONObject().put("ok", true).put("n", WakeService.extra.size))
            }
            "cancelListen" -> {
                voice.cancelListen()
                done(JSONObject().put("ok", true))
            }
            // ---------- управление телефоном ----------
            "screenStatus" -> done(JSONObject().put("on", ShefAccess.isOn(this)).put("connected", ShefAccess.inst != null))
            "screenSettings" -> {
                startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                done(JSONObject().put("ok", true))
            }
            "appInfo" -> {
                startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                done(JSONObject().put("ok", true))
            }
            "screenRead", "screenTap", "screenLongTap", "screenType", "screenScroll", "phoneAction", "screenLabel", "tapSend" -> {
                val acc = ShefAccess.inst
                if (acc == null) done(JSONObject().put("ok", false).put("error", "screen_control_off"))
                else done(
                    when (method) {
                        "screenRead" -> acc.read().also { r -> if (r.optString("package") == packageName) r.put("note", "На экране сам Гудвин. Сначала открой нужное приложение (open_app) или phone_action home.") }
                        "screenTap" -> acc.tap(a.optInt("i", -1))
                        "screenLongTap" -> acc.longTap(a.optInt("i", -1))
                        "screenType" -> acc.type(a.optInt("i", -1), a.optString("text"), a.optBoolean("append", false))
                        "screenScroll" -> acc.scroll(a.optString("dir", "down"), a.optInt("i", -1))
                        "screenLabel" -> JSONObject().put("label", acc.labelOf(a.optInt("i", -1))).put("password", acc.isPassword(a.optInt("i", -1)))
                        "tapSend" -> JSONObject().put("ok", acc.tapText("com.whatsapp:id/send", "com.whatsapp.w4b:id/send", "Отправить", "Send"))
                        else -> acc.global(a.optString("action"))
                    },
                )
            }
            "openMessage" -> done(device.openMessage(a.optString("app", "sms"), a.optString("number"), a.optString("text")))
            "navigate" -> done(device.navigate(a.optString("place"), a.optString("mode", "drive")))
            "openSettings" -> done(device.openSettings(a.optString("what")))
            "status" -> done(device.status())
            "brightness" -> {
                if (!Settings.System.canWrite(this)) done(JSONObject().put("ok", false).put("need", "writeSettings"))
                else {
                    val cr = contentResolver
                    val cur = try { Settings.System.getInt(cr, Settings.System.SCREEN_BRIGHTNESS) } catch (_: Exception) { 128 }
                    val target = when {
                        a.has("percent") -> Math.round(a.optDouble("percent", 50.0) * 2.55).toInt()
                        a.optString("direction") == "up" -> cur + 64
                        else -> cur - 64
                    }.coerceIn(1, 255)
                    Settings.System.putInt(cr, Settings.System.SCREEN_BRIGHTNESS_MODE, Settings.System.SCREEN_BRIGHTNESS_MODE_MANUAL)
                    Settings.System.putInt(cr, Settings.System.SCREEN_BRIGHTNESS, target)
                    done(JSONObject().put("ok", true).put("percent", Math.round(target / 2.55).toInt()))
                }
            }
            "dnd" -> {
                val nm = getSystemService(android.app.NotificationManager::class.java)
                if (!nm.isNotificationPolicyAccessGranted) done(JSONObject().put("ok", false).put("need", "dnd"))
                else {
                    val on = a.optBoolean("on", true)
                    nm.setInterruptionFilter(if (on) android.app.NotificationManager.INTERRUPTION_FILTER_PRIORITY else android.app.NotificationManager.INTERRUPTION_FILTER_ALL)
                    done(JSONObject().put("ok", true).put("on", on))
                }
            }
            "ringer" -> done(device.ringer(a.optString("mode")))
            "addEvent" -> done(device.addEvent(a.optString("title"), a.optLong("start"), a.optInt("minutes", 60)))
            // ---------- сценарии ----------
            "macroList" -> done(JSONObject().put("macros", Macros.all(this)).put("exact", Build.VERSION.SDK_INT < 31 || (getSystemService(ALARM_SERVICE) as android.app.AlarmManager).canScheduleExactAlarms())
                .put("writeSettings", Settings.System.canWrite(this)).put("dnd", (getSystemService(NOTIFICATION_SERVICE) as NotificationManager).isNotificationPolicyAccessGranted)
                .put("screen", ShefAccess.isOn(this)))
            "macroAdd" -> done(Macros.add(this, a.optJSONObject("macro") ?: JSONObject()))
            "macroDelete" -> done(Macros.remove(this, a.optString("id")))
            "macroToggle" -> done(Macros.setEnabled(this, a.optString("id"), a.optBoolean("on", true)))
            "macroRun" -> done(Macros.runById(this, a.optString("id"), "вручную"))
            "grant" -> {
                val i = when (a.optString("what")) {
                    "exact" -> Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:$packageName"))
                    "writeSettings" -> Intent(Settings.ACTION_MANAGE_WRITE_SETTINGS, Uri.parse("package:$packageName"))
                    "dnd" -> Intent(Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS)
                    else -> Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName"))
                }
                try { startActivity(i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) } catch (_: Exception) {}
                done(JSONObject().put("ok", true))
            }
            // ---------- обои и мелодии ----------
            "wallpaper" -> {
                val target = a.optString("target", "both")
                prefs.edit().putLong("wallAt", System.currentTimeMillis()).apply()
                when (a.optString("source")) {
                    "gallery" -> {
                        pickCb = { uri -> if (uri == null) done(JSONObject().put("ok", false).put("error", "картинку не выбрали")) else io.execute { done(device.setWallpaper(contentResolver.openInputStream(uri)!!, target)) } }
                        pickAny.launch("image/*")
                    }
                    "camera" -> {
                        val dir = File(cacheDir, "photos").apply { mkdirs() }
                        val f = File(dir, "wall-${System.currentTimeMillis()}.jpg")
                        photoFile = f
                        photoCb = { b64 -> if (b64 == null) done(JSONObject().put("ok", false).put("error", "фото не сделано")) else done(device.setWallpaper(java.io.ByteArrayInputStream(Base64.decode(b64, Base64.DEFAULT)), target)) }
                        takePicture.launch(FileProvider.getUriForFile(this, "com.burmaldets.app.files", f))
                    }
                    "url" -> io.execute { done(device.setWallpaperUrl(a.optString("url"), target)) }
                    else -> io.execute { done(device.setWallpaperColor(a.optString("color", "#101820"), a.optString("color2"), target)) }
                }
            }
            "ringtones" -> io.execute { done(device.ringtones(a.optString("type", "ringtone"))) }
            "ringtone" -> {
                val type = a.optString("type", "ringtone")
                val after = { r: JSONObject ->
                    if (r.optString("error") == "need_write_settings") {
                        try { startActivity(Intent(Settings.ACTION_MANAGE_WRITE_SETTINGS, Uri.parse("package:$packageName")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) } catch (_: Exception) {}
                    }
                    done(r)
                }
                if (a.optString("source") == "file") {
                    if (!Settings.System.canWrite(this)) after(JSONObject().put("ok", false).put("error", "need_write_settings").put("tell_user", "Нужно разрешить Гудвину «Изменение системных настроек» — открываю этот экран, включите и повторите."))
                    else {
                        pickCb = { uri -> if (uri == null) done(JSONObject().put("ok", false).put("error", "файл не выбрали")) else io.execute { after(device.setRingtoneFile(uri, type)) } }
                        pickAny.launch("audio/*")
                    }
                } else io.execute { after(device.setRingtone(a.optString("name"), type)) }
            }
            "speakerMode" -> {
                val on = a.optBoolean("on", false)
                prefs.edit().putBoolean("speaker", on).apply()
                speakerWindow(on)
                done(JSONObject().put("ok", true))
            }
            "voices" -> done(JSONObject().put("voices", voice.voices()))
            "setVoice" -> {
                voice.setVoice(a.optString("name"))
                done(JSONObject().put("ok", true))
            }
            "perms" -> {
                val pm = getSystemService(POWER_SERVICE) as PowerManager
                done(JSONObject()
                    .put("mic", has(Manifest.permission.RECORD_AUDIO))
                    .put("overlay", Settings.canDrawOverlays(this))
                    .put("notifications", Build.VERSION.SDK_INT < 33 || has(Manifest.permission.POST_NOTIFICATIONS))
                    .put("battery", pm.isIgnoringBatteryOptimizations(packageName))
                    .put("access", ShefAccess.isOn(this))
                    .put("wake", prefs.getBoolean("wake", true))
                    .put("bubble", Bubble.enabled(this)))
            }
            "askPerm" -> {
                try {
                    when (a.optString("which")) {
                        "mic", "notifications" -> {
                            val need = mutableListOf(Manifest.permission.RECORD_AUDIO)
                            if (Build.VERSION.SDK_INT >= 33) need += Manifest.permission.POST_NOTIFICATIONS
                            if (need.all { has(it) }) startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName")))
                            else askPerms.launch(need.toTypedArray())
                        }
                        "overlay" -> startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName")))
                        "battery" -> {
                            @SuppressLint("BatteryLife")
                            val i = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$packageName"))
                            startActivity(i)
                        }
                        "access" -> startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
                    }
                } catch (_: Exception) {
                }
                done(JSONObject().put("ok", true))
            }
            "bubble" -> {
                val on = a.optBoolean("on", true)
                Bubble.setEnabled(this, on)
                if (on && !Settings.canDrawOverlays(this)) {
                    try { startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName"))) } catch (_: Exception) {}
                }
                WakeService.refresh(this)
                done(JSONObject().put("ok", true).put("overlay", Settings.canDrawOverlays(this)))
            }
            "wakeEnable" -> {
                val on = a.optBoolean("on", true)
                prefs.edit().putBoolean("wake", on).apply()
                WakeService.refresh(this)
                done(JSONObject().put("ok", true))
            }
            "takePhoto" -> {
                val dir = File(cacheDir, "photos").apply { mkdirs() }
                val f = File(dir, "shot-${System.currentTimeMillis()}.jpg")
                photoFile = f
                photoCb = { b64 -> done(if (b64 != null) JSONObject().put("jpeg", b64) else JSONObject()) }
                takePicture.launch(FileProvider.getUriForFile(this, "com.burmaldets.app.files", f))
            }
            "playMusic" -> done(device.playMusic(a.optString("query"), a.optString("prefer"), a.optString("kind"), a.optString("title"), a.optString("artist")))
            "birthdays" -> withPerm(Manifest.permission.READ_CONTACTS) { ok ->
                if (!ok) done(JSONObject().put("ok", false).put("error", "denied"))
                else io.execute { done(device.birthdays()) }
            }
            "callLog" -> withPerm(Manifest.permission.READ_CALL_LOG) { ok ->
                if (!ok) done(JSONObject().put("ok", false).put("error", "denied"))
                else io.execute { done(device.callLog(a.optInt("limit", 8), a.optBoolean("missed", false))) }
            }
            "calendar" -> withPerm(Manifest.permission.READ_CALENDAR) { ok ->
                if (!ok) done(JSONObject().put("ok", false).put("error", "denied"))
                else io.execute { done(device.events(a.optInt("days", 1))) }
            }
            "location" -> withPerm(Manifest.permission.ACCESS_COARSE_LOCATION) { ok ->
                if (!ok) done(JSONObject().put("ok", false).put("error", "denied"))
                else done(lastLocation())
            }
            "contacts" -> withPerm(Manifest.permission.READ_CONTACTS) { ok ->
                if (!ok) done(JSONObject().put("ok", false).put("error", "denied"))
                else io.execute { done(device.contacts()) }
            }
            "call" -> withPerm(Manifest.permission.CALL_PHONE) { ok -> done(device.call(a.optString("number"), ok)) }
            "openApp" -> done(device.openApp(a.optString("name")))
            "setTimer" -> done(device.setTimer(a.optInt("seconds"), a.optString("label", "Гудвин")))
            "setAlarm" -> done(device.setAlarm(a.optInt("hour", -1), a.optInt("minute", 0), a.optString("label", "Гудвин")))
            "torch" -> done(device.torch(a.optBoolean("on", true)))
            "volume" -> done(device.volume(a.optDouble("percent", Double.NaN), a.optString("direction")))
            "media" -> done(device.media(a.optString("action")))
            "share" -> done(device.share(a.optString("text")))
            "openUrl" -> done(device.openUrl(a.optString("url")))
            else -> done(JSONObject().put("ok", false).put("error", "unknown $method"))
        }
    }

    /** Запрос к Gemini прямо с телефона (ключ — в сборке владельца). */
    /** Последнее известное место (без GPS-поиска — мгновенно). Нужно для погоды «здесь». */
    @android.annotation.SuppressLint("MissingPermission")
    private fun lastLocation(): JSONObject {
        val lm = getSystemService(LOCATION_SERVICE) as android.location.LocationManager
        val best = listOf("network", "fused", "gps", "passive").mapNotNull { p ->
            try { if (lm.allProviders.contains(p)) lm.getLastKnownLocation(p) else null } catch (_: Exception) { null }
        }.maxByOrNull { it.time }
        return if (best == null) JSONObject().put("ok", false).put("error", "no_fix")
        else JSONObject().put("ok", true).put("lat", best.latitude).put("lon", best.longitude).put("age_min", (System.currentTimeMillis() - best.time) / 60000)
    }

    /** Открытые данные (погода, курсы, новости, Википедия) — только с этих сайтов. */
    private val WEB_OK = setOf("api.open-meteo.com", "geocoding-api.open-meteo.com", "open.er-api.com", "api.coingecko.com", "ru.wikipedia.org", "en.wikipedia.org", "news.google.com", "nominatim.openstreetmap.org")

    private fun httpGet(url: String): JSONObject {
        return try {
            var u = URL(url)
            if (u.protocol != "https" || u.host !in WEB_OK) return JSONObject().put("status", 400).put("body", "{\"error\":\"host\"}")
            var c: HttpURLConnection
            var code: Int
            var hop = 0
            while (true) {
                c = u.openConnection() as HttpURLConnection
                c.connectTimeout = 8000
                c.readTimeout = 10000
                // редиректы — только внутри белого списка (не больше трёх переходов)
                c.instanceFollowRedirects = false
                c.setRequestProperty("User-Agent", "ShefAssistant/1.0 (Android)")
                c.setRequestProperty("Accept-Language", "ru")
                code = c.responseCode
                if (code !in 300..399 || hop++ >= 3) break
                val next = URL(u, c.getHeaderField("Location") ?: break)
                c.disconnect()
                if (next.protocol != "https" || next.host !in WEB_OK) return JSONObject().put("status", 400).put("body", "{\"error\":\"redirect\"}")
                u = next
            }
            val text = (if (code in 200..299) c.inputStream else c.errorStream)?.use { s -> readCapped(s) } ?: ""
            JSONObject().put("status", code).put("body", text)
        } catch (e: Exception) {
            JSONObject().put("status", 0).put("body", "{\"error\":${JSONObject.quote(e.message ?: "network")}}")
        }
    }

    private fun readCapped(s: java.io.InputStream, max: Int = 600_000): String {
        val out = java.io.ByteArrayOutputStream()
        val buf = ByteArray(16384)
        while (out.size() < max) {
            val n = s.read(buf)
            if (n < 0) break
            out.write(buf, 0, n)
        }
        return String(out.toByteArray(), Charsets.UTF_8)
    }

    /**
     * Запрос к ИИ-провайдеру, которого выбрал пользователь (ключ — его, хранится в приложении).
     * Без CORS-ограничений WebView. Двоичное тело — в base64 (заголовок x-body-b64), двоичный ответ — тоже base64.
     */
    private fun fetch(a: JSONObject): JSONObject {
        return try {
            val u = URL(a.optString("url"))
            val local = u.host == "localhost" || u.host == "127.0.0.1" || u.host.startsWith("192.168.") || u.host.startsWith("10.")
            if (u.protocol != "https" && !(u.protocol == "http" && local)) return JSONObject().put("status", 400).put("body", "{\"error\":\"https only\"}")
            val c = u.openConnection() as HttpURLConnection
            c.requestMethod = a.optString("method", "GET")
            c.connectTimeout = 10000
            c.readTimeout = a.optInt("timeout", 40000).coerceIn(5000, 120000)
            val h = a.optJSONObject("headers") ?: JSONObject()
            val b64 = h.has("x-body-b64")
            for (k in h.keys()) if (k != "x-body-b64") c.setRequestProperty(k, h.optString(k))
            val body = a.optString("body")
            if (body.isNotEmpty() && c.requestMethod != "GET") {
                c.doOutput = true
                c.outputStream.use { it.write(if (b64) Base64.decode(body, Base64.DEFAULT) else body.toByteArray()) }
            }
            val code = c.responseCode
            val stream = if (code in 200..299) c.inputStream else c.errorStream
            val out = JSONObject().put("status", code).put("type", c.contentType ?: "")
            if (a.optBoolean("binary") && code in 200..299) out.put("b64", Base64.encodeToString(stream?.use { it.readBytes() } ?: ByteArray(0), Base64.NO_WRAP)).put("body", "")
            else out.put("body", stream?.use { readCapped(it, 4_000_000) } ?: "")
        } catch (e: Exception) {
            JSONObject().put("status", 0).put("body", "{\"error\":${JSONObject.quote(e.message ?: "network")}}")
        }
    }
}
