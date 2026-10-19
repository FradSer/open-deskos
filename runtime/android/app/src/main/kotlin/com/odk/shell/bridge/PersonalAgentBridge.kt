package com.odk.shell.bridge

import com.odk.shell.link.PersonalAgentFrame
import com.odk.shell.link.PersonalAgentLink
import org.json.JSONObject
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/** The activity admits only messages from the trusted main document. */
class PersonalAgentBridge(private val link: PersonalAgentLink?) {
    private val worker = Executors.newSingleThreadExecutor()
    private val pending = AtomicBoolean(false)
    @Volatile private var closed = false

    fun receive(payload: String, respond: (String) -> Unit) {
        if (closed || payload.toByteArray(Charsets.UTF_8).size > 128 * 1024) return
        val request = try { JSONObject(payload) } catch (_: Exception) { return }
        if (request.length() != 3 || !listOf("id", "method", "args").all { request.has(it) }) return
        val id = request.opt("id")
        val method = request.opt("method")
        val args = request.optJSONArray("args") ?: return
        if (id !is String || !Regex("request-[0-9]+").matches(id) || id.length > 64 || method !is String) return
        fun reply(value: JSONObject) = respond(JSONObject().put("id", id).put("result", value).toString())
        fun refusal(reason: String) = reply(JSONObject().put("accepted", false).put("reason", reason))
        when (method) {
            "status" -> if (args.length() == 0) reply(link?.currentFrame() ?: PersonalAgentFrame.unavailable(NO_LINK))
            "sendText" -> {
                if (args.length() !in 1..2 || args.opt(0) !is String || (args.length() == 2 && args.opt(1) !is JSONObject)) return
                val text = args.getString(0)
                val ref = if (args.length() == 2) args.getJSONObject(1) else null
                if (!pending.compareAndSet(false, true)) { refusal("An owner turn is already pending"); return }
                worker.execute {
                    try {
                        val outcome = link?.submit(text, ref)
                        reply(JSONObject().put("accepted", outcome?.accepted == true).put("reason", outcome?.reason ?: if (outcome == null) NO_LINK else JSONObject.NULL))
                    } catch (_: Exception) { refusal("The desk did not confirm the turn") }
                    finally { pending.set(false) }
                }
            }
            "toggle" -> refusal("Microphone unavailable on Android")
            "proposalCommand" -> refusal("Suggestion actions unavailable on Android")
        }
    }

    fun close() { closed = true; worker.shutdownNow() }
    companion object {
        private const val NO_LINK = "Personal Bot link unavailable"
        fun permitsDocument(isCurrentView: Boolean, isMainFrame: Boolean, origin: String, document: String?): Boolean =
            isCurrentView && isMainFrame && origin == "https://appassets.androidplatform.net" &&
                document == "https://appassets.androidplatform.net/assets/web/renderer/index.html"
    }
}
