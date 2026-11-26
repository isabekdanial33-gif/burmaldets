package com.burmaldets.app

import android.animation.ValueAnimator
import android.annotation.SuppressLint
import android.content.Context
import android.graphics.BlurMaskFilter
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.PixelFormat
import android.graphics.RadialGradient
import android.graphics.RectF
import android.graphics.Shader
import android.graphics.SweepGradient
import android.os.Build
import android.provider.Settings
import android.view.Gravity
import android.view.HapticFeedbackConstants
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.view.animation.OvershootInterpolator
import android.widget.Toast
import kotlin.math.abs
import kotlin.math.hypot
import kotlin.math.sin

/**
 * Плавающая кнопка Бурмалдеца поверх всех приложений (как «пузырь» чата).
 * Нажать — Бурмалдец слушает; перетащить — куда удобно (прилипает к краю); бросить на ✕ внизу — спрятать.
 * Живёт в службе WakeService, поэтому видна и когда само приложение закрыто.
 */
class Bubble(private val ctx: Context, private val onTap: () -> Unit) {
    companion object {
        fun enabled(ctx: Context) = ctx.getSharedPreferences("shef", Context.MODE_PRIVATE).getBoolean("bubble", false)
        fun setEnabled(ctx: Context, on: Boolean) = ctx.getSharedPreferences("shef", Context.MODE_PRIVATE).edit().putBoolean("bubble", on).apply()
        fun canShow(ctx: Context) = Settings.canDrawOverlays(ctx)
    }

    private val wm = ctx.getSystemService(Context.WINDOW_SERVICE) as WindowManager
    private val prefs = ctx.getSharedPreferences("shef", Context.MODE_PRIVATE)
    private val dp = ctx.resources.displayMetrics.density
    private val size = (68 * dp).toInt()
    private var orb: OrbView? = null
    private var trash: TrashView? = null
    private var lp: WindowManager.LayoutParams? = null
    private var hiddenByApp = false
    val shown get() = orb != null

    private fun type() = if (Build.VERSION.SDK_INT >= 26) WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY else @Suppress("DEPRECATION") WindowManager.LayoutParams.TYPE_PHONE

    fun show() {
        if (orb != null || !canShow(ctx) || hiddenByApp) return
        val v = OrbView(ctx)
        val p = WindowManager.LayoutParams(size, size, type(),
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
            PixelFormat.TRANSLUCENT).apply {
            gravity = Gravity.TOP or Gravity.START
            val dm = ctx.resources.displayMetrics
            x = prefs.getInt("bx", dm.widthPixels - size - (6 * dp).toInt())
            y = prefs.getInt("by", (dm.heightPixels * 0.62).toInt())
        }
        try {
            wm.addView(v, p)
            orb = v
            lp = p
            v.touch()
        } catch (e: Exception) {
            Journal.add(ctx, "ошибка", "плавающая кнопка: ${e.message}")
        }
    }

    fun hide() {
        orb?.let { try { wm.removeView(it) } catch (_: Exception) {} }
        orb = null
        hideTrash()
    }

    /** Пока открыт сам Бурмалдец, кнопка не нужна. */
    fun appVisible(v: Boolean) {
        hiddenByApp = v
        if (v) hide() else if (enabled(ctx)) show()
    }

    fun listening(on: Boolean) {
        orb?.active = on
    }

    private fun showTrash() {
        if (trash != null) return
        val t = TrashView(ctx)
        val s = (64 * dp).toInt()
        val p = WindowManager.LayoutParams(s, s, type(),
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE,
            PixelFormat.TRANSLUCENT).apply {
            gravity = Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL
            y = (56 * dp).toInt()
        }
        try {
            wm.addView(t, p)
            trash = t
        } catch (_: Exception) {
        }
    }

    private fun hideTrash() {
        trash?.let { try { wm.removeView(it) } catch (_: Exception) {} }
        trash = null
    }

    /** Попал ли центр кнопки в зону ✕ внизу экрана. */
    private fun overTrash(): Boolean {
        val p = lp ?: return false
        val dm = ctx.resources.displayMetrics
        val cx = p.x + size / 2f
        val cy = p.y + size / 2f
        return hypot(cx - dm.widthPixels / 2f, cy - (dm.heightPixels - 88 * dp)) < 80 * dp
    }

    @SuppressLint("ViewConstructor")
    private inner class OrbView(c: Context) : View(c) {
        var active = false
        private var t0 = System.nanoTime()
        private val glow = Paint(Paint.ANTI_ALIAS_FLAG).apply { maskFilter = BlurMaskFilter(10 * dp, BlurMaskFilter.Blur.NORMAL) }
        private val core = Paint(Paint.ANTI_ALIAS_FLAG)
        private val ring = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeWidth = 2.6f * dp }
        private val eye = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE }
        private val smile = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeWidth = 2.2f * dp; strokeCap = Paint.Cap.ROUND; color = 0xFF3CE7FF.toInt() }
        private val cols = intArrayOf(0xFF3CE7FF.toInt(), 0xFF7D5CFF.toInt(), 0xFFFF4FD8.toInt(), 0xFF3CE7FF.toInt())
        private var downX = 0f
        private var downY = 0f
        private var startX = 0
        private var startY = 0
        private var moved = false
        private var alphaIdle = 1f

        init {
            setLayerType(LAYER_TYPE_SOFTWARE, null) // для размытого свечения
            contentDescription = "Бурмалдец — нажмите, чтобы говорить"
        }

        /** После нескольких секунд без дела кнопка становится полупрозрачной, чтобы не мешать. */
        fun touch() {
            alphaIdle = 1f
            removeCallbacks(dim)
            postDelayed(dim, 4000)
        }
        private val dim = Runnable { alphaIdle = 0.55f; invalidate() }

        override fun onDraw(cv: Canvas) {
            val t = (System.nanoTime() - t0) / 1e9f
            val w = width.toFloat()
            val cx = w / 2
            val cy = w / 2
            val breathe = 1f + (if (active) 0.07f else 0.03f) * sin(t * (if (active) 7f else 2.2f))
            val r = w * 0.31f * breathe
            alpha = if (active) 1f else alphaIdle
            glow.shader = RadialGradient(cx, cy, r * 1.5f, intArrayOf(0x887D5CFF.toInt(), 0x443CE7FF, 0x00000000), floatArrayOf(0f, 0.6f, 1f), Shader.TileMode.CLAMP)
            cv.drawCircle(cx, cy, r * 1.45f, glow)
            core.shader = RadialGradient(cx - r * 0.25f, cy - r * 0.3f, r * 1.2f, intArrayOf(0xFF2E3478.toInt(), 0xFF111433.toInt(), 0xFF06071A.toInt()), floatArrayOf(0f, 0.6f, 1f), Shader.TileMode.CLAMP)
            cv.drawCircle(cx, cy, r, core)
            cv.save()
            cv.rotate((t * (if (active) 240f else 60f)) % 360f, cx, cy)
            ring.shader = SweepGradient(cx, cy, cols, null)
            cv.drawCircle(cx, cy, r, ring)
            cv.restore()
            // глаза моргают раз в несколько секунд
            val blink = if ((t % 4.2f) < 0.12f) 0.15f else 1f
            val ew = r * 0.17f
            val eh = r * 0.27f * blink
            cv.drawOval(RectF(cx - r * 0.36f - ew, cy - r * 0.12f - eh, cx - r * 0.36f + ew, cy - r * 0.12f + eh), eye)
            cv.drawOval(RectF(cx + r * 0.36f - ew, cy - r * 0.12f - eh, cx + r * 0.36f + ew, cy - r * 0.12f + eh), eye)
            val sm = if (active) r * 0.18f * (0.6f + 0.4f * abs(sin(t * 9f))) else r * 0.1f
            cv.drawArc(RectF(cx - r * 0.3f, cy + r * 0.2f - sm, cx + r * 0.3f, cy + r * 0.2f + sm), 15f, 150f, false, smile)
            postInvalidateOnAnimation()
        }

        @SuppressLint("ClickableViewAccessibility")
        override fun onTouchEvent(e: MotionEvent): Boolean {
            val p = lp ?: return false
            when (e.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    touch()
                    downX = e.rawX
                    downY = e.rawY
                    startX = p.x
                    startY = p.y
                    moved = false
                }
                MotionEvent.ACTION_MOVE -> {
                    val dx = e.rawX - downX
                    val dy = e.rawY - downY
                    if (!moved && hypot(dx, dy) > 10 * dp) {
                        moved = true
                        showTrash()
                    }
                    if (moved) {
                        p.x = (startX + dx).toInt()
                        p.y = (startY + dy).toInt()
                        try { wm.updateViewLayout(this, p) } catch (_: Exception) {}
                        trash?.hot = overTrash()
                    }
                }
                MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                    if (!moved) {
                        if (e.actionMasked == MotionEvent.ACTION_UP) {
                            performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY)
                            onTap()
                        }
                        return true
                    }
                    val drop = overTrash()
                    hideTrash()
                    if (drop) {
                        setEnabled(ctx, false)
                        hide()
                        Toast.makeText(ctx, "Кнопка спрятана. Вернуть: Настройки → Активация", Toast.LENGTH_LONG).show()
                        return true
                    }
                    snap()
                }
            }
            return true
        }

        /** Прилипнуть к ближайшему краю экрана. */
        private fun snap() {
            val p = lp ?: return
            val dm = ctx.resources.displayMetrics
            val toX = if (p.x + size / 2 < dm.widthPixels / 2) (-6 * dp).toInt() else dm.widthPixels - size + (6 * dp).toInt()
            val y = p.y.coerceIn((40 * dp).toInt(), dm.heightPixels - size - (60 * dp).toInt())
            ValueAnimator.ofInt(p.x, toX).apply {
                duration = 320
                interpolator = OvershootInterpolator(1.1f)
                addUpdateListener {
                    p.x = it.animatedValue as Int
                    p.y = y
                    try { wm.updateViewLayout(this@OrbView, p) } catch (_: Exception) {}
                }
                start()
            }
            prefs.edit().putInt("bx", toX).putInt("by", y).apply()
        }
    }

    @SuppressLint("ViewConstructor")
    private inner class TrashView(c: Context) : View(c) {
        var hot = false
            set(v) {
                if (field != v) {
                    field = v
                    if (v) performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY)
                    invalidate()
                }
            }
        private val bg = Paint(Paint.ANTI_ALIAS_FLAG)
        private val x = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE; strokeWidth = 2.4f * dp; strokeCap = Paint.Cap.ROUND }

        override fun onDraw(cv: Canvas) {
            val w = width / 2f
            bg.color = if (hot) 0xDDFF4F7A.toInt() else 0xAA10142A.toInt()
            cv.drawCircle(w, w, w * (if (hot) 0.98f else 0.8f), bg)
            val k = w * 0.28f
            cv.drawLine(w - k, w - k, w + k, w + k, x)
            cv.drawLine(w + k, w - k, w - k, w + k, x)
        }
    }
}
