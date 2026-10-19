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
    const val CONTROL_DOMAIN = "odk-personal-agent-control-v1"
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

    fun controlHello(machine: String, sessionId: String): String = JSONObject()
        .put("v", PROTOCOL)
        .put("type", CONTROL)
        .put("machine", machine)
        .put("sessionId", sessionId)
        .toString()

    fun submit(requestId: String, proof: String, text: String): String = JSONObject()
        .put("v", PROTOCOL)
        .put("type", SUBMIT)
        .put("requestId", requestId)
        .put("proof", proof)
        .put("text", text)
        .toString()

    /** The exact UTF-8 transcript both ends sign. */
    fun transcript(machine: String, sessionId: String, nonce: String): String =
        CONTROL_DOMAIN + "\n" + PROTOCOL + "\n" + nonce + "\n" + machine + "\n" + sessionId

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

    fun refusalReason(record: JSONObject): String? =
        if (record.optString("type") == ERROR) record.optString("reason").ifEmpty { "the desk refused the request" } else null

    /**
     * A record from another protocol version is refused by name. Reading it as if
     * it were this version would guess at fields that may have moved.
     */
    fun versionRefusal(record: JSONObject): String? {
        val version = record.optInt("v", 0)
        return if (version == PROTOCOL) null else "the desk answered protocol version " + version
    }
}