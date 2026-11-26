package com.burmaldets.app

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.speech.tts.Voice as TtsVoice
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.Locale

/** Голос и слух Гудвина на телефоне. */
class Voice(private val ctx: Context, private val emit: (String, String) -> Unit) : TextToSpeech.OnInitListener {
    private val main = Handler(Looper.getMainLooper())
    private val prefs = ctx.getSharedPreferences("shef", Context.MODE_PRIVATE)
    private var tts: TextToSpeech = TextToSpeech(ctx, this)
    private var ready = false
    private val queue = mutableListOf<Pair<String, (JSONObject) -> Unit>>()
    private val done = HashMap<String, (JSONObject) -> Unit>()
    private var seq = 0

    override fun onInit(status: Int) {
        if (status != TextToSpeech.SUCCESS) return
        tts.language = Locale("ru", "RU")
        pickVoice()
        tts.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
            override fun onStart(id: String) {}
            override fun onDone(id: String) = finish(id, "done")
            @Deprecated("old api")
            override fun onError(id: String) = finish(id, "error")
            override fun onStop(id: String, interrupted: Boolean) = finish(id, "stopped")
            override fun onRangeStart(id: String, start: Int, end: Int, frame: Int) {
                // рот желешки — в такт словам
                emit("tts-level", "0.8")
                main.postDelayed({ emit("tts-level", "0.15") }, 130)
            }
        })
        ready = true
        queue.forEach { (t, cb) -> speak(t, cb) }
        queue.clear()
    }

    private fun finish(id: String, how: String) {
        main.post {
            emit("tts-level", "0")
            done.remove(id)?.invoke(JSONObject().put("ok", how == "done").put("how", how))
        }
    }

    /** Лучший русский голос: выбранный в настройках → голос высокого качества без интернета → любой русский. */
    private fun pickVoice() {
        val vs = try {
            tts.voices?.filter { it.locale.language == "ru" } ?: emptyList()
        } catch (e: Exception) {
            emptyList()
        }
        val saved = prefs.getString("sysVoice", null)
        val v = vs.firstOrNull { it.name == saved }
            ?: vs.filter { !it.isNetworkConnectionRequired && "notinstalled" !in it.features }.maxByOrNull { it.quality }
            ?: vs.maxByOrNull { it.quality }
        if (v != null) tts.voice = v
        tts.setSpeechRate(1.0f)
        tts.setPitch(0.95f)
    }

    fun voices(): JSONArray {
        val arr = JSONArray()
        try {
            tts.voices?.filter { it.locale.language == "ru" }?.sortedByDescending { it.quality }?.forEach { v: TtsVoice ->
                arr.put(JSONObject().put("name", v.name).put("quality", v.quality).put("network", v.isNetworkConnectionRequired).put("current", v.name == tts.voice?.name))
            }
        } catch (_: Exception) {
        }
        return arr
    }

    fun setVoice(name: String) {
        prefs.edit().putString("sysVoice", name).apply()
        pickVoice()
    }

    fun speak(text: String, cb: (JSONObject) -> Unit, volume: Float = 1f, rate: Float = 1f) {
        if (!ready) {
            // пока голос телефона загружается, ждёт только последняя фраза — иначе потом всё скажется разом
            queue.forEach { (_, c) -> c(JSONObject().put("ok", false).put("how", "replaced")) }
            queue.clear()
            queue += text to cb
            return
        }
        val id = "u" + ++seq
        done[id] = cb
        tts.setSpeechRate(rate.coerceIn(0.6f, 1.6f))
        tts.speak(text, TextToSpeech.QUEUE_FLUSH, Bundle().apply { putFloat(TextToSpeech.Engine.KEY_PARAM_VOLUME, volume.coerceIn(0.1f, 1f)) }, id)
    }

    fun stop() {
        queue.clear()
        tts.stop()
        val all = done.toMap()
        done.clear()
        all.values.forEach { it(JSONObject().put("ok", false).put("how", "stopped")) }
        emit("tts-level", "0")
    }

    // ---------- слух ----------
    private var rec: SpeechRecognizer? = null
    private var listenSeq = 0

    /**
     * Одна фраза. Сначала распознавание Google (точнее); если оно ошиблось или его нет — Vosk прямо на телефоне.
     * cb(текст, как_услышали) — «как» пишется в журнал, чтобы понимать, почему Гудвин не расслышал.
     */
    fun listen(cb: (String, String) -> Unit) {
        val my = ++listenSeq
        WakeService.instance?.pause()
        val started = System.currentTimeMillis()
        var once = false
        val fin = { t: String, how: String ->
            if (!once && my == listenSeq) {
                once = true
                cb(t, how)
            }
        }
        val vosk = { why: String, ms: Int ->
            val svc = WakeService.instance
            if (svc == null) fin("", "$why, vosk нет")
            else svc.listenOnce(ms) { t -> fin(t, "$why → vosk") }
        }
        if (!SpeechRecognizer.isRecognitionAvailable(ctx)) {
            // микрофону нужно мгновение, чтобы освободиться после службы
            main.postDelayed({ vosk("нет распознавания google", 10000) }, 150)
            return
        }
        var tries = 0
        fun attempt() {
            if (my != listenSeq) return
            rec?.destroy()
            val r = SpeechRecognizer.createSpeechRecognizer(ctx)
            rec = r
            var lastPartial = ""
            var heardSpeech = false
            var closed = false
            val close = {
                if (!closed) {
                    closed = true
                    try { r.destroy() } catch (_: Exception) {}
                    if (rec === r) rec = null
                }
            }
            r.setRecognitionListener(object : RecognitionListener {
                override fun onReadyForSpeech(params: Bundle?) { emit("stt-ready", "1") }
                override fun onBeginningOfSpeech() { heardSpeech = true }
                override fun onRmsChanged(rmsdB: Float) { emit("stt-level", String.format(Locale.US, "%.2f", ((rmsdB + 2f) / 12f).coerceIn(0f, 1f))) }
                override fun onBufferReceived(buffer: ByteArray?) {}
                override fun onEndOfSpeech() {}
                override fun onEvent(eventType: Int, params: Bundle?) {}
                override fun onError(error: Int) {
                    if (closed) return
                    main.post {
                        close()
                        val el = System.currentTimeMillis() - started
                        when {
                            // что-то уже успели расслышать — отдаём это, а не тишину
                            lastPartial.isNotBlank() -> fin(lastPartial, "google err $error, взят черновик")
                            // распознаватель ещё занят прошлым разом — повторяем
                            error == SpeechRecognizer.ERROR_RECOGNIZER_BUSY && tries < 3 -> { tries++; main.postDelayed({ attempt() }, 350) }
                            // «не расслышал» мгновенно, человек ещё не начал говорить — слушаем дальше
                            (error == SpeechRecognizer.ERROR_NO_MATCH || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT) && el < 9000 && tries < 3 -> { tries++; main.postDelayed({ attempt() }, 120) }
                            error == SpeechRecognizer.ERROR_NO_MATCH || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> fin("", "google тишина $error")
                            // сеть, язык не скачан, нет доступа к микрофону и т.п. — слушаем сами
                            else -> vosk("google err $error", 9000)
                        }
                    }
                }
                override fun onResults(results: Bundle?) {
                    if (closed) return
                    val t = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()?.takeIf { it.isNotBlank() } ?: lastPartial
                    main.post {
                        close()
                        if (t.isBlank() && !heardSpeech && System.currentTimeMillis() - started < 9000 && tries < 3) { tries++; attempt() }
                        else fin(t, "google")
                    }
                }
                override fun onPartialResults(partial: Bundle?) {
                    val p = partial?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull() ?: return
                    if (p.isNotBlank()) lastPartial = p
                    emit("stt-partial", JSONObject.quote(p))
                }
            })
            val i = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
                .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                .putExtra(RecognizerIntent.EXTRA_LANGUAGE, "ru-RU")
                .putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, "ru-RU")
                .putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, ctx.packageName)
                .putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
                .putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
                .putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 1500)
                .putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, 1500)
            main.postDelayed({ if (!closed && my == listenSeq) r.stopListening() }, 15000)
            try {
                r.startListening(i)
            } catch (e: Exception) {
                close()
                vosk("google start ${e.message}", 9000)
            }
        }
        // микрофону нужно мгновение, чтобы освободиться после службы «Гудвин»
        main.postDelayed({ attempt() }, 150)
    }

    fun cancelListen() {
        listenSeq++
        rec?.cancel()
        rec?.destroy()
        rec = null
    }

    fun shutdown() {
        cancelListen()
        tts.shutdown()
    }
}

/** Журнал недоработок — обычный текстовый файл, его можно открыть или переслать. */
object Journal {
    fun file(ctx: Context) = File(ctx.getExternalFilesDir(null) ?: ctx.filesDir, "Гудвин-журнал.txt")
    fun add(ctx: Context, kind: String, text: String) = line(ctx, "${java.text.SimpleDateFormat("dd.MM.yyyy HH:mm", Locale("ru")).format(java.util.Date())} [$kind] $text")
    fun line(ctx: Context, line: String) {
        try {
            file(ctx).appendText(line + "\n")
        } catch (_: Exception) {
        }
    }
}
