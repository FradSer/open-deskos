package com.odk.shell.link

import org.json.JSONArray
import org.json.JSONObject

/**
 * The frame the phone renders.
 *
 * The desk generates every briefing and reply, so this host keeps only the
 * fields the Shell renderer reads. An unknown or oversized status degrades to an
 * explicit unavailable state: showing a truncated one would misrepresent the
 * desk.
 */
object PersonalAgentFrame {
    const val MAX_BYTES = 128 * 1024
    val STATES = setOf("idle", "recording", "starting", "sending", "transcribing", "thinking", "unavailable", "error")

    private val TEXT_FIELDS = listOf("transcript", "message", "proposalError")
    private val OBJECT_FIELDS = listOf("briefing", "agents", "remote")

    fun unavailable(message: String): JSONObject = JSONObject().put("state", "unavailable").put("message", message)

    fun project(status: JSONObject?): JSONObject {
        if (status == null || !STATES.contains(status.optString("state"))) return unavailable("Personal Agent state unavailable")
        val frame = JSONObject().put("state", status.optString("state"))
        for (key in TEXT_FIELDS) {
            val value = status.opt(key)
            if (value is String) frame.put(key, value)
        }
        val notifications = status.opt("notifications")
        if (notifications is JSONArray) {
            val kept = JSONArray()
            for (index in 0 until notifications.length()) {
                val notification = notifications.optJSONObject(index) ?: continue
                val id = notification.opt("id")
                val message = notification.opt("message")
                if (id is String && message is String) kept.put(JSONObject().put("id", id).put("message", message))
            }
            frame.put("notifications", kept)
        }
        for (key in OBJECT_FIELDS) {
            val value = status.opt(key)
            if (value is JSONObject) frame.put(key, value)
        }
        if (frame.toString().toByteArray(Charsets.UTF_8).size > MAX_BYTES) {
            return unavailable("Personal Agent state exceeded its bound")
        }
        return frame
    }
}