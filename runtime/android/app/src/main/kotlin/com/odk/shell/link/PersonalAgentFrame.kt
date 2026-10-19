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
        val frame = JSONObject().put("state", status.optString("state")).put("voiceInput", false)
        for (key in TEXT_FIELDS) {
            val value = status.opt(key)
            if (value is String) frame.put(key, value)
        }
        for (key in listOf("ownerTurnId", "threadId")) {
            val value = status.opt(key)
            val pattern = if (key == "threadId") Regex("[a-f0-9]{64}") else Regex("[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}")
            if (value is String && pattern.matches(value)) frame.put(key, value)
        }
        status.optJSONObject("replyTo")?.let { if (PersonalAgentProtocol.validReplyTo(it)) frame.put("replyTo", it) }
        status.optJSONObject("conversation")?.let { conversation(it)?.let { value -> frame.put("conversation", value) } }
        for (key in listOf("textInput", "replyInput")) if (status.opt(key) is Boolean) frame.put(key, status.getBoolean(key))
        status.optJSONObject("judgment")?.let { judgment ->
            val kept = JSONObject()
            for (key in listOf("status", "provider", "model")) {
                val value = judgment.opt(key)
                if (value is String && value.length <= 256) kept.put(key, value)
            }
            frame.put("judgment", kept)
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
    private fun conversation(value: JSONObject): JSONObject? {
        val revision = value.opt("revision")
        val turns = value.optJSONArray("turns") ?: return null
        val omitted = value.opt("omittedCount") ?: 0
        fun integer(n: Any?): Boolean = n is Number && n.toDouble().isFinite() && n.toDouble() >= 0 && n.toDouble() <= 9007199254740991.0 && n.toDouble() % 1.0 == 0.0
        if (!integer(revision) || !integer(omitted) || turns.length() > 8 || value.toString().toByteArray(Charsets.UTF_8).size > 61440) return null
        val ids = mutableSetOf<String>()
        val kept = JSONArray()
        for (index in 0 until turns.length()) {
            val item = turns.optJSONObject(index) ?: return null
            val id = item.opt("id")
            val at = item.opt("at")
            if (id !is String || !Regex("[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}").matches(id) || !ids.add(id) ||
                at !is Number || !at.toDouble().isFinite() || at.toDouble() < 0 ||
                !validText(item.opt("transcript"), 4096) || !validText(item.opt("message"), 16384) ||
                item.optString("state") !in setOf("idle", "error", "thinking", "transcribing", "unconfirmed")) return null
            val row = JSONObject().put("id", id).put("at", at).put("transcript", item.getString("transcript"))
                .put("message", item.getString("message")).put("state", item.getString("state"))
            if (item.has("replyTo")) {
                val ref = item.optJSONObject("replyTo") ?: return null
                if (!PersonalAgentProtocol.validReplyTo(ref)) return null
                row.put("replyTo", ref)
            }
            if (item.has("threadId")) {
                val thread = item.opt("threadId")
                if (thread !is String || !Regex("[a-f0-9]{64}").matches(thread)) return null
                row.put("threadId", thread)
            }
            kept.put(row)
        }
        return JSONObject().put("revision", revision).put("turns", kept).put("omittedCount", omitted)
    }

    private fun validText(value: Any?, limit: Int): Boolean = value is String && value.length <= limit &&
        !Regex("[\\x00-\\x08\\x0b\\x0c\\x0e-\\x1f]").containsMatchIn(value)

}