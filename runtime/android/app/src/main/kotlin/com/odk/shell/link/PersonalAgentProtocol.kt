package com.odk.shell.link

import org.json.JSONObject
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/**
 * The record shapes the desk documents in `runtime/shell/docs/ODK_LINK.md`.
 *
 * The credential never crosses the wire: the phone answers a one-time nonce with
 * an HMAC over the documented transcript, and the domain keeps a Hosted Pi proof
 * and a Personal Agent proof from standing in for one another.
 */
object PersonalAgentProtocol {
    const val PROTOCOL = 1
    const val CONTROL_PROTOCOL = 2
    const val CONTROL_DOMAIN = "odk-personal-agent-control-v2"
    const val HELLO = "personal-agent-hello"
    const val READY = "personal-agent-ready"
    const val FRAME = "personal-agent"
    const val CONTROL = "personal-agent-control"
    const val SUBMIT = "personal-agent-submit"
    const val RECEIPT = "personal-agent-receipt"
    const val CHALLENGE = "challenge"
    const val ERROR = "error"

    fun hello(machine: String, sessionId: String, token: String): String = JSONObject()
        .put("v", PROTOCOL)
        .put("type", HELLO)
        .put("machine", machine)
        .put("sessionId", sessionId)
        .put("token", token)
        .toString()

    fun controlHello(machine: String, sessionId: String, requestId: String, text: String, replyTo: JSONObject? = null): String {
        val frame = JSONObject().put("v", CONTROL_PROTOCOL).put("type", CONTROL)
            .put("machine", machine).put("sessionId", sessionId).put("requestId", requestId).put("text", text)
        if (replyTo != null) frame.put("replyTo", replyTo)
        return frame.toString()
    }

    fun submit(requestId: String, proof: String): String = JSONObject()
        .put("v", CONTROL_PROTOCOL).put("type", SUBMIT).put("requestId", requestId).put("proof", proof).toString()

    fun frameDigest(raw: ByteArray): String = java.security.MessageDigest.getInstance("SHA-256")
        .digest(raw).joinToString("") { byte -> "%02x".format(byte) }

    /** Sign the original UTF-8 control frame bytes, excluding its LF delimiter. */
    fun transcript(nonce: String, firstFrameSHA256: String): String =
        CONTROL_DOMAIN + "\n" + CONTROL_PROTOCOL + "\n" + nonce + "\n" + firstFrameSHA256

    fun validReplyTo(value: JSONObject): Boolean {
        if (value.length() != 3 || !listOf("messageId", "sourceKey", "sourceRevision").all { value.has(it) }) return false
        val key = value.opt("sourceKey")
        return value.opt("messageId") is String && value.opt("sourceRevision") is String &&
            Regex("[a-f0-9]{64}").matches(value.getString("messageId")) &&
            Regex("[a-f0-9]{64}").matches(value.getString("sourceRevision")) &&
            key is String && key.trim().isNotEmpty() && key.length <= 256 && !Regex("[\\x00-\\x1f\\x7f]").containsMatchIn(key)
    }

    fun proof(credential: String, transcript: String): String {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(credential.toByteArray(Charsets.UTF_8), "HmacSHA256"))
        return mac.doFinal(transcript.toByteArray(Charsets.UTF_8)).joinToString("") { byte -> "%02x".format(byte) }
    }

    fun proofMatches(credential: String, transcript: String, proof: String): Boolean {
        if (credential.isEmpty() || proof.isEmpty()) return false
        return constantTimeEquals(proof(credential, transcript), proof)
    }

    private fun constantTimeEquals(one: String, other: String): Boolean {
        if (one.length != other.length) return false
        var difference = 0
        for (index in one.indices) difference = difference or (one[index].code xor other[index].code)
        return difference == 0
    }

    fun acceptedOf(record: JSONObject): Boolean? =
        if (record.optString("type") == RECEIPT) record.optBoolean("accepted", false) else null

    fun refusalReason(record: JSONObject): String? {
        if (record.optString("type") != ERROR) return null
        val reason = record.opt("reason") as? String ?: return "the desk refused the request"
        return reason.replace(Regex("[\\x00-\\x1f\\x7f]"), " ").trim().take(200).ifEmpty { "the desk refused the request" }
    }

    /**
     * A record from another protocol version is refused by name. Reading it as if
     * it were this version would guess at fields that may have moved.
     */
    fun versionRefusal(record: JSONObject): String? {
        val version = record.optInt("v", 0)
        val expected = if (record.optString("type") == CHALLENGE) CONTROL_PROTOCOL else PROTOCOL
        return if (version == expected) null else "the desk answered protocol version " + version
    }
}