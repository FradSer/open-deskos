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

    private val VOICE_FAILURES = setOf("microphone", "timeout", "unavailable", "protocol", "invalid_audio", "cleanup")
    private val TEXT_FIELDS = listOf("transcript", "message", "proposalError")
    private val OBJECT_FIELDS = listOf("briefing", "agents", "remote")

    fun unavailable(message: String): JSONObject = JSONObject().put("state", "unavailable").put("message", message)

    fun project(status: JSONObject?): JSONObject {
        if (status == null || !STATES.contains(status.optString("state"))) return unavailable("Personal Agent state unavailable")
        val frame = JSONObject().put("state", status.optString("state")).put("voiceInput", false)
        val voiceFailure = status.opt("voiceFailure")
        if (status.optString("state") == "error" && voiceFailure is String && voiceFailure in VOICE_FAILURES) {
            frame.put("voiceFailure", voiceFailure)
        }
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
        if (status.has("proposals") || status.has("proposalCapabilities")) {
            val proposals = readableProposals(status.optJSONArray("proposals") ?: JSONArray())
            val readable = proposals != null && (!status.has("proposalCapabilities") || status.optJSONObject("proposalCapabilities")?.opt("read") == true)
            frame.put("proposalCapabilities", JSONObject().put("read", readable).put("respond", false).put("acknowledge", false))
            frame.put("proposals", if (readable) proposals else JSONArray())
            frame.put("proposalPopup", readable && status.opt("proposalPopup") == true)
            frame.put("proposalInteraction", readable && status.opt("proposalInteraction") == true)
            frame.put("proposalRecovery", readable && status.opt("proposalRecovery") == true)
            val omitted = status.opt("proposalHiddenCount")
            frame.put("proposalHiddenCount", if (omitted is Number && omitted.toDouble().isFinite() && omitted.toDouble() >= 0 && omitted.toDouble() <= 9007199254740991.0 && omitted.toDouble() % 1.0 == 0.0) omitted else 0)
        }
        if (frame.toString().toByteArray(Charsets.UTF_8).size > MAX_BYTES) {
            return unavailable("Personal Agent state exceeded its bound")
        }
        return frame
    }
    private fun readableProposals(value: JSONArray): JSONArray? {
        if (value.length() > 64) return null
        val kept = JSONArray()
        for (index in 0 until value.length()) {
            val p = value.optJSONObject(index) ?: return null
            val id = p.opt("id")
            if (id !is String || !Regex("[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}").matches(id) ||
                !validText(p.opt("advice"), 1000) || p.optString("status") !in setOf("pending", "ignored", "expired", "executing", "completed", "unknown")) return null
            val row = JSONObject().put("id", id).put("status", p.getString("status")).put("advice", p.getString("advice"))
                .put("action", JSONObject.NULL).put("confirmation", "").put("offered", p.opt("offered") == true).put("presented", p.opt("presented") == true)
            if (p.has("nextStep")) {
                val nextStep = p.opt("nextStep")
                if (nextStep !is String || nextStep.isBlank() || !validText(nextStep, 240) ||
                    Regex("[\\x00-\\x1f\\x7f]").containsMatchIn(nextStep)) return null
                row.put("nextStep", nextStep)
            }
            for ((key, limit) in mapOf("ruleId" to 128, "createdAt" to 40, "completedAt" to 40)) {
                val text = p.opt(key)
                if (text is String && text.length <= limit) row.put(key, text)
            }
            val feedback = p.opt("feedback")
            if (feedback is String && feedback in setOf("done", "snooze", "useful", "irrelevant", "incorrect")) row.put("feedback", feedback)
            if (p.has("feedbackLearning")) {
                val learning = p.optJSONObject("feedbackLearning") ?: return null
                val revision = learning.opt("revision")
                val decision = learning.opt("decision")
                val status = learning.opt("status")
                if (revision !is Number || !revision.toDouble().isFinite() || revision.toDouble() < 1 ||
                    revision.toDouble() > 9007199254740991.0 || revision.toDouble() % 1.0 != 0.0 ||
                    decision !is String || decision !in setOf("done", "snooze", "useful", "irrelevant", "incorrect", "ignore", "mute") ||
                    status !is String || status !in setOf("queued", "running", "applied", "failed", "unavailable", "stale")) return null
                row.put("feedbackLearning", JSONObject().put("revision", revision)
                    .put("decision", decision).put("status", status))
            }
            val snoozed = p.opt("snoozedUntil")
            if (snoozed is Number && snoozed.toDouble().isFinite() && snoozed.toDouble() >= 0) row.put("snoozedUntil", snoozed)
            val evidence = p.optJSONArray("evidence") ?: return null
            if (evidence.length() > 8) return null
            val readings = JSONArray()
            for (eindex in 0 until evidence.length()) {
                val e = evidence.optJSONObject(eindex) ?: return null
                val data = e.opt("value")
                if ((data !is String && data !is Number && data !is Boolean) || (data is Number && !data.toDouble().isFinite()) ||
                    (data is String && data.length > 256) || !listOf("readingId", "field", "state", "measuredAt").all { validText(e.opt(it), 256) }) return null
                val reading = JSONObject()
                for (key in listOf("readingId", "field", "value", "state", "measuredAt")) reading.put(key, e.get(key))
                val rule = e.opt("ruleId")
                if (rule is String && rule.length <= 128) reading.put("ruleId", rule)
                readings.put(reading)
            }
            row.put("evidence", readings)
            kept.put(row)
        }
        return kept
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
