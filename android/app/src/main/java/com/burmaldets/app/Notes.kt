package com.burmaldets.app

import org.json.JSONArray
import org.json.JSONObject

/** Последние уведомления (только в памяти, не на диске): для «что мне пришло?». */
object Notes {
    private val list = ArrayDeque<JSONObject>()

    @Synchronized
    fun add(n: JSONObject) {
        // то же уведомление часто приходит повторно (обновление) — заменяем
        list.removeAll { it.optString("package") == n.optString("package") && it.optString("title") == n.optString("title") && it.optString("text") == n.optString("text") }
        list.addLast(n)
        while (list.size > 40) list.removeFirst()
    }

    @Synchronized
    fun recent(sinceMs: Long, app: String?): JSONArray {
        val out = JSONArray()
        for (n in list.reversed()) {
            if (n.optLong("time") < sinceMs) continue
            if (!app.isNullOrBlank() && !n.optString("app").contains(app, true) && !n.optString("package").contains(app, true)) continue
            out.put(n)
            if (out.length() >= 15) break
        }
        return out
    }

    @Synchronized
    fun clear() = list.clear()
}
