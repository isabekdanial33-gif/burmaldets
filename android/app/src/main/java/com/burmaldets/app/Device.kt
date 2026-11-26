package com.burmaldets.app

import android.app.SearchManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.media.AudioManager
import android.net.Uri
import android.provider.AlarmClock
import android.provider.CallLog.Calls as C
import android.provider.ContactsContract.CommonDataKinds.Event as E
import android.provider.ContactsContract.Data as D
import android.provider.MediaStore
import android.view.KeyEvent
import org.json.JSONArray
import org.json.JSONObject

/** Что Гудвин умеет делать с телефоном. Всё возвращает JSON: ok + что произошло — Gemini пересказывает это человеку. */
class Device(private val act: Context) {
    private fun go(i: Intent) = act.startActivity(i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    private val pm: PackageManager = act.packageManager

    private data class MusicApp(val pkg: String, val name: String, val aliases: List<String>, val link: (String) -> String?)

    private val music = listOf(
        MusicApp("ru.yandex.music", "Яндекс Музыка", listOf("яндекс", "yandex")) { "https://music.yandex.ru/search?text=${Uri.encode(it)}" },
        MusicApp("com.spotify.music", "Spotify", listOf("spotify", "спотифай")) { "spotify:search:${Uri.encode(it)}" },
        MusicApp("com.google.android.apps.youtube.music", "YouTube Music", listOf("youtube music", "ютуб музык")) { "https://music.youtube.com/search?q=${Uri.encode(it)}" },
        MusicApp("com.zvooq.openplay", "Звук", listOf("звук", "zvuk", "сберзвук")) { null },
        MusicApp("com.uma.musicvk", "VK Музыка", listOf("vk", "вк", "вконтакте")) { null },
        MusicApp("com.vkontakte.android", "ВКонтакте", listOf("vk", "вк", "вконтакте")) { "https://vk.com/audio?q=${Uri.encode(it)}" },
        MusicApp("com.apple.android.music", "Apple Music", listOf("apple", "эпл")) { null },
        MusicApp("deezer.android.app", "Deezer", listOf("deezer", "дизер")) { null },
        MusicApp("com.soundcloud.android", "SoundCloud", listOf("soundcloud", "саундклауд")) { null },
        MusicApp("com.google.android.youtube", "YouTube", listOf("youtube", "ютуб")) { "https://www.youtube.com/results?search_query=${Uri.encode(it)}" },
    )

    private fun installed(pkg: String) = try {
        pm.getPackageInfo(pkg, 0)
        true
    } catch (_: Exception) {
        false
    }

    /** Ищет музыкальные приложения на телефоне и включает запрос в первом подходящем. */
    fun playMusic(query: String, prefer: String, kind: String = "", title: String = "", artist: String = ""): JSONObject {
        val have = music.filter { installed(it.pkg) }
        val names = JSONArray(have.map { it.name }.distinct())
        if (have.isEmpty()) {
            return JSONObject().put("ok", false).put("installed", names)
                .put("note", "На телефоне не найдено ни одного музыкального приложения (Яндекс Музыка, Spotify, YouTube Music, VK Музыка, Звук, YouTube).")
                .put("solution", "Установить бесплатную Яндекс Музыку или YouTube Music из Google Play; или могу открыть музыку в браузере (скажите «открой в браузере»).")
        }
        val p = prefer.lowercase()
        val order = if (p.isNotBlank()) have.sortedByDescending { a -> a.aliases.any { p.contains(it) } || p.contains(a.name.lowercase()) } else have
        if (p.isNotBlank() && order.none { a -> a.aliases.any { p.contains(it) } }) {
            // просили конкретный сервис, а его нет — честно скажем и включим в другом
        }
        for (app in order) {
            // 1) «играй по запросу» — Spotify и YouTube Music сразу запускают воспроизведение
            // конкретная песня/артист — говорим приложению именно это, чтобы оно не включало «похожее»
            val play = Intent(MediaStore.INTENT_ACTION_MEDIA_PLAY_FROM_SEARCH)
                .setPackage(app.pkg)
                .putExtra(SearchManager.QUERY, query)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            when (kind) {
                "song" -> {
                    play.putExtra(MediaStore.EXTRA_MEDIA_FOCUS, MediaStore.Audio.Media.ENTRY_CONTENT_TYPE)
                    if (title.isNotBlank()) play.putExtra(MediaStore.EXTRA_MEDIA_TITLE, title)
                    if (artist.isNotBlank()) play.putExtra(MediaStore.EXTRA_MEDIA_ARTIST, artist)
                }
                "artist" -> {
                    play.putExtra(MediaStore.EXTRA_MEDIA_FOCUS, MediaStore.Audio.Artists.ENTRY_CONTENT_TYPE)
                    play.putExtra(MediaStore.EXTRA_MEDIA_ARTIST, artist.ifBlank { query })
                }
                "album" -> {
                    play.putExtra(MediaStore.EXTRA_MEDIA_FOCUS, MediaStore.Audio.Albums.ENTRY_CONTENT_TYPE)
                    play.putExtra(MediaStore.EXTRA_MEDIA_ALBUM, title.ifBlank { query })
                    if (artist.isNotBlank()) play.putExtra(MediaStore.EXTRA_MEDIA_ARTIST, artist)
                }
                "playlist" -> {
                    play.putExtra(MediaStore.EXTRA_MEDIA_FOCUS, MediaStore.Audio.Playlists.ENTRY_CONTENT_TYPE)
                    play.putExtra("android.intent.extra.playlist", query)
                }
                else -> play.putExtra(MediaStore.EXTRA_MEDIA_FOCUS, "vnd.android.cursor.item/*")
            }
            if (play.resolveActivity(pm) != null) {
                try {
                    go(play)
                    return JSONObject().put("ok", true).put("app", app.name).put("mode", "play").put("query", query).put("installed", names)
                        .put("prefer_missing", p.isNotBlank() && app.aliases.none { p.contains(it) })
                } catch (_: Exception) {
                }
            }
            // 2) открыть поиск в приложении
            val link = app.link(query) ?: continue
            val open = Intent(Intent.ACTION_VIEW, Uri.parse(link)).setPackage(app.pkg).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            if (open.resolveActivity(pm) != null) {
                try {
                    go(open)
                    return JSONObject().put("ok", true).put("app", app.name).put("mode", "search").put("query", query).put("installed", names)
                        .put("note", "Открыт поиск в приложении — возможно, нужно нажать на первый плейлист.")
                } catch (_: Exception) {
                }
            }
        }
        return JSONObject().put("ok", false).put("installed", names)
            .put("note", "Музыкальные приложения есть (${have.joinToString { it.name }}), но не принимают запрос от других приложений.")
            .put("solution", "Открыть приложение вручную или включить музыку в браузере.")
    }

    // ---------- контакты и звонки ----------
    /** Все контакты с номерами (имя, номер, избранный). Данные остаются на телефоне — сравнение имён делает приложение. */
    fun contacts(): JSONObject {
        val arr = JSONArray()
        val seen = HashSet<String>()
        try {
            act.contentResolver.query(
                android.provider.ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
                arrayOf(
                    android.provider.ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME,
                    android.provider.ContactsContract.CommonDataKinds.Phone.NUMBER,
                    android.provider.ContactsContract.CommonDataKinds.Phone.STARRED,
                    android.provider.ContactsContract.CommonDataKinds.Phone.TIMES_CONTACTED,
                ),
                null, null, null,
            )?.use { c ->
                while (c.moveToNext()) {
                    val name = c.getString(0) ?: continue
                    val num = c.getString(1) ?: continue
                    val key = name + "|" + num.filter { it.isDigit() }.takeLast(10)
                    if (!seen.add(key)) continue
                    arr.put(JSONObject().put("name", name).put("number", num).put("starred", c.getInt(2) == 1).put("times", c.getInt(3)))
                }
            }
        } catch (e: Exception) {
            return JSONObject().put("ok", false).put("error", e.message)
        }
        return JSONObject().put("ok", true).put("contacts", arr)
    }

    /** Звонок. Вызывается ТОЛЬКО после «да» пользователя (это проверяет Гудвин). Без разрешения на звонки — открываем номеронабиратель. */
    fun call(number: String, direct: Boolean): JSONObject {
        val n = number.filter { it.isDigit() || it == '+' || it == '*' || it == '#' }
        if (n.length < 2) return JSONObject().put("ok", false).put("error", "нет номера")
        return try {
            val i = Intent(if (direct) Intent.ACTION_CALL else Intent.ACTION_DIAL, Uri.parse("tel:" + Uri.encode(n))).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            go(i)
            JSONObject().put("ok", true).put("mode", if (direct) "call" else "dial")
        } catch (e: Exception) {
            JSONObject().put("ok", false).put("error", e.message)
        }
    }

    // ---------- приложения ----------
    private val syn = mapOf(
        "ютуб" to "youtube", "ватсап" to "whatsapp", "вотсап" to "whatsapp", "телеграм" to "telegram", "телега" to "telegram", "инстаграм" to "instagram", "инста" to "instagram",
        "тикток" to "tiktok", "каспи" to "kaspi", "гугл" to "google", "хром" to "chrome", "карты" to "maps", "камера" to "camera", "камеру" to "camera", "калькулятор" to "calculator",
        "часы" to "clock", "галерея" to "gallery", "галерею" to "gallery", "фото" to "photos", "настройки" to "settings", "почта" to "gmail", "яндекс" to "yandex", "вк" to "vk",
        "вконтакте" to "vk", "спотифай" to "spotify", "глово" to "glovo", "вольт" to "wolt", "яндекс еда" to "yandex eats", "магнум" to "magnum", "2гис" to "2gis", "дубль гис" to "2gis",
    )
    private val tr = mapOf('а' to "a", 'б' to "b", 'в' to "v", 'г' to "g", 'д' to "d", 'е' to "e", 'ё' to "e", 'ж' to "zh", 'з' to "z", 'и' to "i", 'й' to "y", 'к' to "k", 'л' to "l",
        'м' to "m", 'н' to "n", 'о' to "o", 'п' to "p", 'р' to "r", 'с' to "s", 'т' to "t", 'у' to "u", 'ф' to "f", 'х' to "h", 'ц' to "ts", 'ч' to "ch", 'ш' to "sh", 'щ' to "sch",
        'ъ' to "", 'ы' to "y", 'ь' to "", 'э' to "e", 'ю' to "yu", 'я' to "ya")
    private fun latin(s: String) = s.lowercase().map { tr[it] ?: it.toString() }.joinToString("")

    fun openApp(name: String): JSONObject {
        val q = name.lowercase().trim().removePrefix("приложение ").trim()
        val want = listOf(q, syn[q] ?: "", latin(q)).filter { it.isNotBlank() }
        val launch = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        val apps = pm.queryIntentActivities(launch, 0).map { it.loadLabel(pm).toString() to it.activityInfo.packageName }
        fun score(label: String, pkg: String): Int {
            val l = label.lowercase()
            val ll = latin(l)
            return want.maxOf { w ->
                when {
                    l == w || ll == w -> 100
                    l.startsWith(w) || ll.startsWith(w) -> 80
                    l.contains(w) || ll.contains(w) -> 60
                    pkg.contains(w.replace(" ", "")) -> 40
                    else -> 0
                }
            }
        }
        val best = apps.map { (l, p) -> Triple(l, p, score(l, p)) }.filter { it.third > 0 }.maxByOrNull { it.third }
            ?: return JSONObject().put("ok", false).put("note", "Приложение «$name» не найдено на телефоне.")
        val i = pm.getLaunchIntentForPackage(best.second)?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            ?: return JSONObject().put("ok", false).put("note", "Не получается открыть «${best.first}».")
        go(i)
        return JSONObject().put("ok", true).put("app", best.first)
    }

    fun setTimer(seconds: Int, label: String): JSONObject {
        val i = Intent(AlarmClock.ACTION_SET_TIMER)
            .putExtra(AlarmClock.EXTRA_LENGTH, seconds)
            .putExtra(AlarmClock.EXTRA_MESSAGE, label)
            .putExtra(AlarmClock.EXTRA_SKIP_UI, true)
        return if (i.resolveActivity(pm) != null) try {
            go(i)
            JSONObject().put("ok", true)
        } catch (e: Exception) {
            JSONObject().put("ok", false).put("error", e.message)
        } else JSONObject().put("ok", false).put("note", "Нет приложения часов")
    }

    fun setAlarm(hour: Int, minute: Int, label: String): JSONObject {
        if (hour !in 0..23 || minute !in 0..59) return JSONObject().put("ok", false).put("note", "Неверное время")
        val i = Intent(AlarmClock.ACTION_SET_ALARM)
            .putExtra(AlarmClock.EXTRA_HOUR, hour)
            .putExtra(AlarmClock.EXTRA_MINUTES, minute)
            .putExtra(AlarmClock.EXTRA_MESSAGE, label)
            .putExtra(AlarmClock.EXTRA_SKIP_UI, true)
        return if (i.resolveActivity(pm) != null) try {
            go(i)
            JSONObject().put("ok", true).put("time", "%02d:%02d".format(hour, minute))
        } catch (e: Exception) {
            JSONObject().put("ok", false).put("error", e.message)
        } else JSONObject().put("ok", false).put("note", "Нет приложения часов")
    }

    fun torch(on: Boolean): JSONObject = try {
        val cm = act.getSystemService(Context.CAMERA_SERVICE) as CameraManager
        val id = cm.cameraIdList.firstOrNull { cm.getCameraCharacteristics(it).get(CameraCharacteristics.FLASH_INFO_AVAILABLE) == true }
            ?: return JSONObject().put("ok", false).put("note", "На телефоне нет вспышки")
        cm.setTorchMode(id, on)
        JSONObject().put("ok", true).put("on", on)
    } catch (e: Exception) {
        JSONObject().put("ok", false).put("error", e.message)
    }

    fun volume(percent: Double, direction: String): JSONObject {
        val am = act.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        val max = am.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
        when {
            direction == "up" -> am.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_RAISE, 0)
            direction == "down" -> am.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_LOWER, 0)
            direction == "mute" -> am.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_MUTE, 0)
            !percent.isNaN() -> am.setStreamVolume(AudioManager.STREAM_MUSIC, (max * percent / 100).toInt().coerceIn(0, max), 0)
        }
        return JSONObject().put("ok", true).put("percent", am.getStreamVolume(AudioManager.STREAM_MUSIC) * 100 / max)
    }

    fun media(action: String): JSONObject {
        val am = act.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        val code = when (action) {
            "pause" -> KeyEvent.KEYCODE_MEDIA_PAUSE
            "play" -> KeyEvent.KEYCODE_MEDIA_PLAY
            "next" -> KeyEvent.KEYCODE_MEDIA_NEXT
            "previous" -> KeyEvent.KEYCODE_MEDIA_PREVIOUS
            else -> return JSONObject().put("ok", false)
        }
        am.dispatchMediaKeyEvent(KeyEvent(KeyEvent.ACTION_DOWN, code))
        am.dispatchMediaKeyEvent(KeyEvent(KeyEvent.ACTION_UP, code))
        return JSONObject().put("ok", true)
    }

    fun share(text: String): JSONObject {
        val i = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text)
        go(Intent.createChooser(i, "Поделиться").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        return JSONObject().put("ok", true)
    }

    fun openUrl(url: String): JSONObject = try {
        go(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        JSONObject().put("ok", true)
    } catch (e: Exception) {
        JSONObject().put("ok", false).put("error", e.message)
    }
    // ---------- сообщения ----------
    /** Открыть чат с готовым текстом. Отправку (нажатие «Отправить») делает ShefAccess — только после «да». */
    fun openMessage(app: String, number: String, text: String): JSONObject {
        val digits = number.filter { it.isDigit() || it == '+' }
        return try {
            when (app) {
                "whatsapp" -> {
                    val pkg = listOf("com.whatsapp", "com.whatsapp.w4b").firstOrNull { installed(it) }
                        ?: return JSONObject().put("ok", false).put("error", "WhatsApp не установлен")
                    val u = Uri.parse("https://api.whatsapp.com/send?phone=${digits.removePrefix("+")}&text=${Uri.encode(text)}")
                    go(Intent(Intent.ACTION_VIEW, u).setPackage(pkg).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                }
                "telegram" -> {
                    val pkg = listOf("org.telegram.messenger", "org.telegram.messenger.web").firstOrNull { installed(it) }
                        ?: return JSONObject().put("ok", false).put("error", "Telegram не установлен")
                    go(Intent(Intent.ACTION_VIEW, Uri.parse("tg://resolve?phone=${digits.removePrefix("+")}")).setPackage(pkg).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                    return JSONObject().put("ok", true).put("app", "Telegram").put("note", "Чат открыт (если номер есть в контактах Telegram). Текст вставь через screen_type в поле сообщения.")
                }
                else -> {
                    val i = Intent(Intent.ACTION_SENDTO, Uri.parse("smsto:$digits")).putExtra("sms_body", text).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    go(i)
                }
            }
            JSONObject().put("ok", true).put("app", app)
        } catch (e: Exception) {
            JSONObject().put("ok", false).put("error", e.message)
        }
    }

    // ---------- навигация ----------
    fun navigate(place: String, mode: String): JSONObject {
        val q = Uri.encode(place)
        val tries = ArrayList<Pair<String, Intent>>()
        if (installed("ru.dublgis.dgismobile")) tries += "2ГИС" to Intent(Intent.ACTION_VIEW, Uri.parse("dgis://2gis.ru/search/$q")).setPackage("ru.dublgis.dgismobile")
        if (installed("ru.yandex.yandexnavi")) tries += "Яндекс Навигатор" to Intent(Intent.ACTION_VIEW, Uri.parse("yandexnavi://map_search?text=$q")).setPackage("ru.yandex.yandexnavi")
        if (installed("ru.yandex.yandexmaps")) tries += "Яндекс Карты" to Intent(Intent.ACTION_VIEW, Uri.parse("yandexmaps://maps.yandex.ru/?text=$q")).setPackage("ru.yandex.yandexmaps")
        if (installed("com.google.android.apps.maps")) {
            val m = when (mode) { "walk" -> "w"; "transit" -> "r"; "bike" -> "b"; else -> "d" }
            tries += "Google Карты" to Intent(Intent.ACTION_VIEW, Uri.parse("google.navigation:q=$q&mode=$m")).setPackage("com.google.android.apps.maps")
        }
        tries += "карты" to Intent(Intent.ACTION_VIEW, Uri.parse("geo:0,0?q=$q"))
        for ((name, i) in tries) {
            try {
                go(i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                return JSONObject().put("ok", true).put("app", name)
            } catch (_: Exception) {
            }
        }
        return JSONObject().put("ok", false).put("error", "нет приложения карт")
    }

    // ---------- настройки ----------
    fun openSettings(what: String): JSONObject {
        val panel = android.os.Build.VERSION.SDK_INT >= 29
        val action = when (what) {
            "wifi" -> if (panel) android.provider.Settings.Panel.ACTION_WIFI else android.provider.Settings.ACTION_WIFI_SETTINGS
            "internet" -> if (panel) android.provider.Settings.Panel.ACTION_INTERNET_CONNECTIVITY else android.provider.Settings.ACTION_WIRELESS_SETTINGS
            "volume" -> if (panel) android.provider.Settings.Panel.ACTION_VOLUME else android.provider.Settings.ACTION_SOUND_SETTINGS
            "bluetooth" -> android.provider.Settings.ACTION_BLUETOOTH_SETTINGS
            "display", "brightness" -> android.provider.Settings.ACTION_DISPLAY_SETTINGS
            "sound" -> android.provider.Settings.ACTION_SOUND_SETTINGS
            "battery" -> Intent.ACTION_POWER_USAGE_SUMMARY
            "location" -> android.provider.Settings.ACTION_LOCATION_SOURCE_SETTINGS
            "airplane" -> android.provider.Settings.ACTION_AIRPLANE_MODE_SETTINGS
            "nfc" -> android.provider.Settings.ACTION_NFC_SETTINGS
            "accessibility" -> android.provider.Settings.ACTION_ACCESSIBILITY_SETTINGS
            "apps" -> android.provider.Settings.ACTION_APPLICATION_SETTINGS
            "date" -> android.provider.Settings.ACTION_DATE_SETTINGS
            "dnd" -> android.provider.Settings.ACTION_ZEN_MODE_PRIORITY_SETTINGS
            "storage" -> android.provider.Settings.ACTION_INTERNAL_STORAGE_SETTINGS
            "hotspot" -> "android.settings.TETHER_SETTINGS"
            else -> android.provider.Settings.ACTION_SETTINGS
        }
        return try {
            go(Intent(action).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            JSONObject().put("ok", true)
        } catch (_: Exception) {
            try {
                go(Intent(android.provider.Settings.ACTION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                JSONObject().put("ok", true).put("note", "открыл общие настройки")
            } catch (e: Exception) {
                JSONObject().put("ok", false).put("error", e.message)
            }
        }
    }

    // ---------- состояние телефона ----------
    fun status(): JSONObject {
        val bm = act.getSystemService(Context.BATTERY_SERVICE) as android.os.BatteryManager
        val cm = act.getSystemService(Context.CONNECTIVITY_SERVICE) as android.net.ConnectivityManager
        val caps = cm.getNetworkCapabilities(cm.activeNetwork)
        val net = when {
            caps == null -> "нет сети"
            caps.hasTransport(android.net.NetworkCapabilities.TRANSPORT_WIFI) -> "Wi-Fi"
            caps.hasTransport(android.net.NetworkCapabilities.TRANSPORT_CELLULAR) -> "мобильный интернет"
            else -> "есть сеть"
        }
        val st = android.os.StatFs(android.os.Environment.getDataDirectory().path)
        val am = act.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        return JSONObject()
            .put("battery_percent", bm.getIntProperty(android.os.BatteryManager.BATTERY_PROPERTY_CAPACITY))
            .put("charging", bm.isCharging)
            .put("network", net)
            .put("free_storage_gb", Math.round(st.availableBytes / 100_000_000.0) / 10.0)
            .put("ringer", when (am.ringerMode) { AudioManager.RINGER_MODE_SILENT -> "без звука"; AudioManager.RINGER_MODE_VIBRATE -> "вибрация"; else -> "со звуком" })
            .put("screen_control", ShefAccess.isOn(act))
            .put("model", android.os.Build.MANUFACTURER + " " + android.os.Build.MODEL)
            .put("android", android.os.Build.VERSION.RELEASE)
    }

    fun ringer(mode: String): JSONObject {
        val am = act.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        return try {
            am.ringerMode = when (mode) { "silent" -> AudioManager.RINGER_MODE_SILENT; "vibrate" -> AudioManager.RINGER_MODE_VIBRATE; else -> AudioManager.RINGER_MODE_NORMAL }
            JSONObject().put("ok", true)
        } catch (e: Exception) {
            JSONObject().put("ok", false).put("error", "нужен доступ к режиму «Не беспокоить»").put("solution", "open_settings dnd")
        }
    }

    fun addEvent(title: String, startMs: Long, minutes: Int): JSONObject = try {
        val i = Intent(Intent.ACTION_INSERT).setData(android.provider.CalendarContract.Events.CONTENT_URI)
            .putExtra(android.provider.CalendarContract.Events.TITLE, title)
            .putExtra(android.provider.CalendarContract.EXTRA_EVENT_BEGIN_TIME, startMs)
            .putExtra(android.provider.CalendarContract.EXTRA_EVENT_END_TIME, startMs + minutes * 60000L)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        go(i)
        JSONObject().put("ok", true).put("note", "Открыт календарь с событием — осталось сохранить")
    } catch (e: Exception) {
        JSONObject().put("ok", false).put("error", e.message)
    }
    /** Дни рождения из телефонной книги: имя и дата («--03-05» без года или «1990-03-05»). */
    fun birthdays(): JSONObject = try {
        val out = JSONArray()
        act.contentResolver.query(
            D.CONTENT_URI,
            arrayOf(D.DISPLAY_NAME, E.START_DATE),
            "${D.MIMETYPE} = ? AND ${E.TYPE} = ${E.TYPE_BIRTHDAY}",
            arrayOf(E.CONTENT_ITEM_TYPE),
            null,
        )?.use { c ->
            while (c.moveToNext() && out.length() < 500) out.put(JSONObject().put("name", c.getString(0) ?: "").put("date", c.getString(1) ?: ""))
        }
        JSONObject().put("ok", true).put("list", out)
    } catch (e: Exception) {
        JSONObject().put("ok", false).put("error", e.message)
    }

    /** Последние звонки: имя (или номер), тип, когда. Номер целиком не отдаём — только последние 4 цифры. */
    fun callLog(limit: Int, onlyMissed: Boolean): JSONObject = try {
        val out = JSONArray()
        val where = if (onlyMissed) "${C.TYPE} = ${C.MISSED_TYPE}" else null
        act.contentResolver.query(C.CONTENT_URI, arrayOf(C.CACHED_NAME, C.NUMBER, C.TYPE, C.DATE, C.DURATION), where, null, "${C.DATE} DESC")?.use { c ->
            while (c.moveToNext() && out.length() < limit.coerceIn(1, 30)) {
                val num = c.getString(1) ?: ""
                val type = when (c.getInt(2)) { C.INCOMING_TYPE -> "входящий"; C.OUTGOING_TYPE -> "исходящий"; C.MISSED_TYPE -> "пропущенный"; C.REJECTED_TYPE -> "отклонённый"; else -> "другой" }
                out.put(JSONObject().put("name", c.getString(0) ?: "").put("last4", num.filter { it.isDigit() }.takeLast(4)).put("type", type).put("time", c.getLong(3)).put("seconds", c.getLong(4)))
            }
        }
        JSONObject().put("ok", true).put("calls", out)
    } catch (e: Exception) {
        JSONObject().put("ok", false).put("error", e.message)
    }

    /** События календаря с этого момента на N дней (все календари телефона). */
    fun events(days: Int): JSONObject = try {
        val now = System.currentTimeMillis()
        val start = java.util.Calendar.getInstance().apply { set(java.util.Calendar.HOUR_OF_DAY, 0); set(java.util.Calendar.MINUTE, 0) }.timeInMillis
        val end = now + days.coerceIn(1, 31) * 86400000L
        val uri = android.provider.CalendarContract.Instances.CONTENT_URI.buildUpon().also {
            android.content.ContentUris.appendId(it, start)
            android.content.ContentUris.appendId(it, end)
        }.build()
        val I = android.provider.CalendarContract.Instances.BEGIN
        val cols = arrayOf(android.provider.CalendarContract.Instances.TITLE, I, android.provider.CalendarContract.Instances.END, android.provider.CalendarContract.Instances.ALL_DAY, android.provider.CalendarContract.Instances.EVENT_LOCATION)
        val out = JSONArray()
        act.contentResolver.query(uri, cols, null, null, "$I ASC")?.use { c ->
            while (c.moveToNext() && out.length() < 40) {
                val endMs = c.getLong(2)
                if (endMs < now) continue // уже прошло
                out.put(JSONObject().put("title", c.getString(0) ?: "").put("start", c.getLong(1)).put("end", endMs).put("all_day", c.getInt(3) == 1).put("place", c.getString(4) ?: ""))
            }
        }
        JSONObject().put("ok", true).put("events", out)
    } catch (e: Exception) {
        JSONObject().put("ok", false).put("error", e.message)
    }

    // ---------- обои ----------
    private fun wallFlags(target: String) = when (target) {
        "lock" -> android.app.WallpaperManager.FLAG_LOCK
        "home" -> android.app.WallpaperManager.FLAG_SYSTEM
        else -> android.app.WallpaperManager.FLAG_SYSTEM or android.app.WallpaperManager.FLAG_LOCK
    }

    fun setWallpaper(input: java.io.InputStream, target: String): JSONObject = try {
        input.use { android.app.WallpaperManager.getInstance(act).setStream(it, null, true, wallFlags(target)) }
        JSONObject().put("ok", true).put("target", target)
    } catch (e: Exception) {
        JSONObject().put("ok", false).put("error", e.message)
    }

    /** Однотонные или градиентные обои — рисуем сами под размер экрана. */
    fun setWallpaperColor(c1: String, c2: String, target: String): JSONObject = try {
        val m = act.resources.displayMetrics
        val w = maxOf(m.widthPixels, 720)
        val h = maxOf(m.heightPixels, 1280)
        val bmp = android.graphics.Bitmap.createBitmap(w, h, android.graphics.Bitmap.Config.ARGB_8888)
        val cv = android.graphics.Canvas(bmp)
        val a = android.graphics.Color.parseColor(c1)
        val b = if (c2.isNotBlank()) android.graphics.Color.parseColor(c2) else a
        val p = android.graphics.Paint().apply { shader = android.graphics.LinearGradient(0f, 0f, w * 0.3f, h.toFloat(), a, b, android.graphics.Shader.TileMode.CLAMP) }
        cv.drawRect(0f, 0f, w.toFloat(), h.toFloat(), p)
        android.app.WallpaperManager.getInstance(act).setBitmap(bmp, null, true, wallFlags(target))
        JSONObject().put("ok", true)
    } catch (e: Exception) {
        JSONObject().put("ok", false).put("error", e.message)
    }

    fun setWallpaperUrl(url: String, target: String): JSONObject = try {
        val c = java.net.URL(url).openConnection() as java.net.HttpURLConnection
        c.connectTimeout = 10000
        c.readTimeout = 20000
        c.instanceFollowRedirects = true
        if (c.responseCode !in 200..299) JSONObject().put("ok", false).put("error", "картинка не скачалась (${c.responseCode})")
        else if (c.contentType?.startsWith("image/") != true) JSONObject().put("ok", false).put("error", "по ссылке не картинка")
        else setWallpaper(c.inputStream, target)
    } catch (e: Exception) {
        JSONObject().put("ok", false).put("error", e.message)
    }

    // ---------- рингтоны ----------
    private fun rtType(type: String) = when (type) {
        "notification" -> android.media.RingtoneManager.TYPE_NOTIFICATION
        "alarm" -> android.media.RingtoneManager.TYPE_ALARM
        else -> android.media.RingtoneManager.TYPE_RINGTONE
    }

    fun ringtones(type: String): JSONObject {
        val arr = JSONArray()
        try {
            val rm = android.media.RingtoneManager(act).apply { setType(rtType(type)) }
            val c = rm.cursor
            while (c.moveToNext() && arr.length() < 200) arr.put(c.getString(android.media.RingtoneManager.TITLE_COLUMN_INDEX))
        } catch (_: Exception) {
        }
        val cur = try {
            android.media.RingtoneManager.getActualDefaultRingtoneUri(act, rtType(type))?.let { android.media.RingtoneManager.getRingtone(act, it)?.getTitle(act) }
        } catch (_: Exception) {
            null
        }
        return JSONObject().put("ok", true).put("current", cur ?: "").put("list", arr)
    }

    private fun needWrite() = JSONObject().put("ok", false).put("error", "need_write_settings")
        .put("tell_user", "Нужно разрешить Гудвину «Изменение системных настроек» — открываю этот экран, включите переключатель и повторите.")

    fun setRingtone(name: String, type: String): JSONObject {
        if (!android.provider.Settings.System.canWrite(act)) return needWrite()
        val rm = android.media.RingtoneManager(act).apply { setType(rtType(type)) }
        val c = rm.cursor
        val want = name.lowercase().trim()
        var best: android.net.Uri? = null
        var bestTitle = ""
        var bestScore = 0
        val titles = ArrayList<String>()
        while (c.moveToNext()) {
            val t = c.getString(android.media.RingtoneManager.TITLE_COLUMN_INDEX) ?: continue
            titles += t
            val l = t.lowercase()
            val score = when {
                l == want -> 100
                l.startsWith(want) -> 80
                l.contains(want) -> 60
                want.split(" ").all { l.contains(it) } -> 50
                else -> 0
            }
            if (score > bestScore) {
                bestScore = score
                bestTitle = t
                best = rm.getRingtoneUri(c.position)
            }
        }
        if (best == null) return JSONObject().put("ok", false).put("error", "нет такой мелодии").put("available", JSONArray(titles.take(40)))
        android.media.RingtoneManager.setActualDefaultRingtoneUri(act, rtType(type), best)
        return JSONObject().put("ok", true).put("set", bestTitle)
    }

    /** Свой файл (песня из «Загрузок» и т.п.) → копия в «Ringtones» → мелодия звонка. */
    fun setRingtoneFile(src: android.net.Uri, type: String): JSONObject {
        if (!android.provider.Settings.System.canWrite(act)) return needWrite()
        return try {
            var name = "Гудвин мелодия"
            act.contentResolver.query(src, arrayOf(android.provider.OpenableColumns.DISPLAY_NAME), null, null, null)?.use { if (it.moveToFirst()) name = it.getString(0) ?: name }
            val mime = act.contentResolver.getType(src) ?: "audio/mpeg"
            val v = android.content.ContentValues().apply {
                put(android.provider.MediaStore.Audio.Media.DISPLAY_NAME, name)
                put(android.provider.MediaStore.Audio.Media.TITLE, name.substringBeforeLast('.'))
                put(android.provider.MediaStore.Audio.Media.MIME_TYPE, mime)
                put(android.provider.MediaStore.Audio.Media.IS_RINGTONE, type == "ringtone")
                put(android.provider.MediaStore.Audio.Media.IS_NOTIFICATION, type == "notification")
                put(android.provider.MediaStore.Audio.Media.IS_ALARM, type == "alarm")
                if (android.os.Build.VERSION.SDK_INT >= 29) put(android.provider.MediaStore.Audio.Media.RELATIVE_PATH, if (type == "alarm") "Alarms/" else if (type == "notification") "Notifications/" else "Ringtones/")
            }
            val dst = act.contentResolver.insert(android.provider.MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, v) ?: return JSONObject().put("ok", false).put("error", "не удалось сохранить файл")
            act.contentResolver.openInputStream(src)!!.use { i -> act.contentResolver.openOutputStream(dst)!!.use { i.copyTo(it) } }
            android.media.RingtoneManager.setActualDefaultRingtoneUri(act, rtType(type), dst)
            JSONObject().put("ok", true).put("set", name.substringBeforeLast('.'))
        } catch (e: Exception) {
            JSONObject().put("ok", false).put("error", e.message)
        }
    }
}
