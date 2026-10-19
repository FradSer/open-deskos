package com.odk.shell.bridge

import android.webkit.JavascriptInterface
import com.odk.shell.link.PersonalAgentFrame
import com.odk.shell.link.PersonalAgentLink
import com.odk.shell.link.SubmitOutcome
import org.json.JSONObject
import java.util.concurrent.Executors

/**
 * The preload equivalent for Android.
 *
 * The Shell renderer reads `window.odkPersonalBot` against the promise-returning
 * contract Electron's preload exposes. A WebView JavaScript interface can only
 * answer synchronously, so the host shim turns these methods into that contract.
 * The only content that crosses is a frame the desk produced: this host holds no
 * generator and no fixture.
 */
class PersonalAgentBridge(
    private val link: PersonalAgentLink?,
    private val deliver: (String) -> Unit,
) {
    private val worker = Executors.newSingleThreadExecutor()

    /**
     * Every method takes the request payload, because a JavaScript interface
     * resolves a method by name and arity. A frame the desk produced is the only
     * status this host can answer.
     */
    @JavascriptInterface
    fun status(payload: String): String = link?.currentFrame()?.toString() ?: PersonalAgentFrame.unavailable(NO_LINK).toString()

    @JavascriptInterface
    fun sendText(payload: String): String? {
        val request = parse(payload) ?: return null
        val text = request.args.optString(0)
        worker.execute {
            val outcome = link?.submit(text) ?: SubmitOutcome(false, NO_LINK)
            val receipt = JSONObject().put("accepted", outcome.accepted)
            if (outcome.reason != null) receipt.put("reason", outcome.reason)
            deliver("window.__odkBridge && window.__odkBridge.receipt(" + JSONObject.quote(request.id) + ", " + receipt.toString() + ")")
        }
        return null
    }

    /**
     * Android captures no audio in this work, so the answer states that outcome.
     * The renderer discards that value and draws no sentence for it.
     */
    @JavascriptInterface
    fun toggle(payload: String): String = JSONObject().put("accepted", false).toString()

    /**
     * The link carries no suggestion response. The answer states that outcome, and
     * the renderer owns the sentence it shows for it.
     */
    @JavascriptInterface
    fun proposalCommand(payload: String): String = JSONObject().put("accepted", false).toString()

    private class Request(val id: String, val args: org.json.JSONArray)

    private fun parse(payload: String): Request? {
        val record = try { JSONObject(payload) } catch (_: Exception) { return null }
        val id = record.optString("id")
        if (id.isEmpty()) return null
        return Request(id, record.optJSONArray("args") ?: org.json.JSONArray())
    }

    private companion object {
        const val NO_LINK = "Personal Bot link unavailable"
    }
}