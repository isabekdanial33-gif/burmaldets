package com.burmaldets.app

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.content.Context
import android.graphics.Path
import android.graphics.Rect
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import org.json.JSONArray
import org.json.JSONObject

/**
 * «Руки» Бурмалдеца: видит, что на экране любого приложения, нажимает, печатает, листает, жмёт «Назад»/«Домой».
 * Включается человеком в «Специальных возможностях». Пароли Бурмалдец не вводит.
 */
class ShefAccess : AccessibilityService() {

    companion object {
        @Volatile var inst: ShefAccess? = null

        fun isOn(ctx: Context): Boolean {
            if (inst != null) return true
            val list = Settings.Secure.getString(ctx.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES) ?: return false
            return list.contains(ctx.packageName + "/")
        }
    }

    /** Узлы последнего «взгляда» на экран: номер в списке → элемент. */
    private val seen = ArrayList<AccessibilityNodeInfo>()

    override fun onServiceConnected() {
        inst = this
    }

    override fun onUnbind(intent: android.content.Intent?): Boolean {
        inst = null
        return super.onUnbind(intent)
    }

    private var lastPkg = ""
    private fun appName(pkg: String) = try {
        packageManager.getApplicationLabel(packageManager.getApplicationInfo(pkg, 0)).toString()
    } catch (_: Exception) {
        pkg
    }

    private var lastNoteKey = ""
    private var lastNoteAt = 0L

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        val e = event ?: return
        val pkg = e.packageName?.toString() ?: return
        if (pkg == packageName) return
        when (e.eventType) {
            AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED -> {
                if (pkg == lastPkg || pkg == "com.android.systemui") return
                lastPkg = pkg
                if (Macros.hasTrigger(this, "app_opened")) Macros.event(this, "app_opened", JSONObject().put("package", pkg).put("app", appName(pkg)))
            }
            AccessibilityEvent.TYPE_NOTIFICATION_STATE_CHANGED -> {
                val n = e.parcelableData as? android.app.Notification
                val ex = n?.extras
                val title = ex?.getCharSequence(android.app.Notification.EXTRA_TITLE)?.toString().orEmpty()
                val body = (ex?.getCharSequence(android.app.Notification.EXTRA_BIG_TEXT) ?: ex?.getCharSequence(android.app.Notification.EXTRA_TEXT))?.toString().orEmpty()
                val text = "$title $body " + e.text.joinToString(" ")
                // служебные «идёт загрузка», «Бурмалдец слушает» и т.п. не запоминаем
                val ongoing = n != null && (n.flags and android.app.Notification.FLAG_ONGOING_EVENT) != 0
                if (!ongoing && (title.isNotBlank() || body.isNotBlank())) Notes.add(JSONObject().put("app", appName(pkg)).put("package", pkg).put("title", title.take(80)).put("text", body.take(400)).put("time", System.currentTimeMillis()))
                if (!Macros.hasTrigger(this, "notification")) return
                // одно и то же уведомление Android присылает по нескольку раз — сценарий запускаем один раз
                val key = "$pkg|$title|$body"
                val nowMs = System.currentTimeMillis()
                if (key == lastNoteKey && nowMs - lastNoteAt < 90000) return
                lastNoteKey = key
                lastNoteAt = nowMs
                Macros.event(this, "notification", JSONObject().put("package", pkg).put("app", appName(pkg)).put("text", text).put("title", title).put("body", body))
            }
        }
    }
    override fun onInterrupt() {}

    private fun label(n: AccessibilityNodeInfo): String {
        val parts = listOfNotNull(
            n.text?.toString(),
            n.contentDescription?.toString()?.takeIf { it != n.text?.toString() },
            if (Build.VERSION.SDK_INT >= 26) n.hintText?.toString()?.takeIf { n.text.isNullOrBlank() } else null,
        ).map { it.replace(Regex("\\s+"), " ").trim() }.filter { it.isNotEmpty() }
        return parts.joinToString(" · ").take(90)
    }

    private fun kind(n: AccessibilityNodeInfo): String {
        val c = n.className?.toString() ?: ""
        return when {
            n.isEditable -> "поле"
            n.isCheckable -> if (n.isChecked) "вкл" else "выкл"
            c.endsWith("Button") || c.endsWith("ImageButton") -> "кнопка"
            n.isClickable -> "нажимается"
            n.isScrollable -> "список"
            else -> "текст"
        }
    }

    /** Что на экране: пронумерованный список элементов (для Gemini). */
    fun read(): JSONObject {
        seen.clear()
        val root = rootInActiveWindow ?: return JSONObject().put("ok", false).put("error", "экран недоступен (заблокирован или защищён)")
        val items = JSONArray()
        fun walk(n: AccessibilityNodeInfo?, depth: Int) {
            if (n == null || depth > 40 || seen.size >= 160) return
            if (!n.isVisibleToUser) return
            val l = label(n)
            val useful = l.isNotEmpty() || n.isEditable || n.isScrollable || (n.isCheckable)
            if (useful) {
                val i = seen.size
                seen += n
                var s = "$i ${kind(n)}"
                if (n.isPassword) s += " (пароль)"
                if (l.isNotEmpty()) s += " «$l»"
                n.viewIdResourceName?.substringAfter(":id/")?.takeIf { it.length < 40 }?.let { s += " #$it" }
                items.put(s)
            }
            for (k in 0 until n.childCount) walk(n.getChild(k), depth + 1)
        }
        walk(root, 0)
        val pkg = root.packageName?.toString() ?: ""
        val app = try {
            packageManager.getApplicationLabel(packageManager.getApplicationInfo(pkg, 0)).toString()
        } catch (_: Exception) {
            pkg
        }
        return JSONObject().put("ok", true).put("app", app).put("package", pkg).put("items", items).put("count", items.length())
    }

    private fun node(i: Int): AccessibilityNodeInfo? = seen.getOrNull(i)?.takeIf { it.refresh() }

    fun labelOf(i: Int): String = seen.getOrNull(i)?.let { label(it) + " " + (it.viewIdResourceName ?: "") } ?: ""
    fun isPassword(i: Int): Boolean = seen.getOrNull(i)?.isPassword == true

    fun tap(i: Int): JSONObject {
        val n = node(i) ?: return JSONObject().put("ok", false).put("error", "элемент $i не найден — сначала посмотри на экран заново")
        var p: AccessibilityNodeInfo? = n
        while (p != null && !p.isClickable) p = p.parent
        if (p != null && p.performAction(AccessibilityNodeInfo.ACTION_CLICK)) return JSONObject().put("ok", true)
        // не нажимается как элемент — касаемся пальцем по координатам
        val r = Rect()
        n.getBoundsInScreen(r)
        return gesture(r.exactCenterX(), r.exactCenterY(), r.exactCenterX(), r.exactCenterY(), 60)
    }

    fun longTap(i: Int): JSONObject {
        val n = node(i) ?: return JSONObject().put("ok", false).put("error", "элемент $i не найден")
        val r = Rect()
        n.getBoundsInScreen(r)
        return gesture(r.exactCenterX(), r.exactCenterY(), r.exactCenterX(), r.exactCenterY(), 800)
    }

    fun type(i: Int, text: String, append: Boolean): JSONObject {
        val n = (if (i >= 0) node(i) else null) ?: findFocus(AccessibilityNodeInfo.FOCUS_INPUT)
            ?: return JSONObject().put("ok", false).put("error", "не нашёл поле ввода")
        if (n.isPassword) return JSONObject().put("ok", false).put("error", "это поле пароля — пароли человек вводит сам")
        n.performAction(AccessibilityNodeInfo.ACTION_FOCUS)
        val full = if (append) (n.text?.toString() ?: "") + text else text
        val b = Bundle().apply { putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, full) }
        return JSONObject().put("ok", n.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, b))
    }

    fun scroll(dir: String, i: Int): JSONObject {
        val target = (if (i >= 0) node(i) else null) ?: seen.firstOrNull { it.isScrollable && it.refresh() }
        val fwd = dir == "down" || dir == "right"
        if (target != null && target.performAction(if (fwd) AccessibilityNodeInfo.ACTION_SCROLL_FORWARD else AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD)) {
            return JSONObject().put("ok", true)
        }
        val m = resources.displayMetrics
        val w = m.widthPixels.toFloat()
        val h = m.heightPixels.toFloat()
        return when (dir) {
            "up" -> gesture(w / 2, h * 0.3f, w / 2, h * 0.75f, 300)
            "left" -> gesture(w * 0.2f, h / 2, w * 0.85f, h / 2, 300)
            "right" -> gesture(w * 0.85f, h / 2, w * 0.2f, h / 2, 300)
            else -> gesture(w / 2, h * 0.75f, w / 2, h * 0.3f, 300)
        }
    }

    private fun gesture(x1: Float, y1: Float, x2: Float, y2: Float, ms: Long): JSONObject {
        val path = Path().apply {
            moveTo(x1, y1)
            lineTo(x2, y2)
        }
        val ok = dispatchGesture(GestureDescription.Builder().addStroke(GestureDescription.StrokeDescription(path, 0, ms)).build(), null, null)
        return JSONObject().put("ok", ok)
    }

    fun global(action: String): JSONObject {
        val a = when (action) {
            "back" -> GLOBAL_ACTION_BACK
            "home" -> GLOBAL_ACTION_HOME
            "recents" -> GLOBAL_ACTION_RECENTS
            "notifications" -> GLOBAL_ACTION_NOTIFICATIONS
            "quick_settings" -> GLOBAL_ACTION_QUICK_SETTINGS
            "power_menu" -> GLOBAL_ACTION_POWER_DIALOG
            "lock" -> if (Build.VERSION.SDK_INT >= 28) GLOBAL_ACTION_LOCK_SCREEN else return JSONObject().put("ok", false)
            "screenshot" -> if (Build.VERSION.SDK_INT >= 28) GLOBAL_ACTION_TAKE_SCREENSHOT else return JSONObject().put("ok", false)
            else -> return JSONObject().put("ok", false).put("error", "нет действия $action")
        }
        return JSONObject().put("ok", performGlobalAction(a))
    }

    /** Нажать кнопку по надписи (для «отправить» в мессенджере после подтверждения). */
    fun tapText(vararg words: String): Boolean {
        val root = rootInActiveWindow ?: return false
        for (w in words) {
            val found = root.findAccessibilityNodeInfosByText(w) + root.findAccessibilityNodeInfosByViewId(w)
            for (n in found) {
                var p: AccessibilityNodeInfo? = n
                while (p != null && !p.isClickable) p = p.parent
                if (p != null && p.isVisibleToUser && p.performAction(AccessibilityNodeInfo.ACTION_CLICK)) return true
            }
        }
        return false
    }
}
