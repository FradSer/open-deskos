package com.odk.shell.link

import org.json.JSONObject

/**
 * Where the phone reaches its desk, and with which credential.
 *
 * Provisioning is out of band, as ADR-0006 requires. The report token reads the
 * Personal Agent. The control credential is separate and optional: without it the
 * phone reads the desk and refuses to submit, rather than claiming a delivery it
 * was never given.
 */
data class LinkConfig(val host: String, val port: Int, val reportToken: String, val controlCredential: String?)

object LinkConfigReader {
    const val DEFAULT_PORT = 8765

    fun read(text: String): LinkConfig? {
        val record = try { JSONObject(text) } catch (_: Exception) { return null }
        val host = record.optString("host").trim()
        val reportToken = record.optString("reportToken").trim()
        if (host.isEmpty() || reportToken.isEmpty()) return null
        val port = record.optInt("port", DEFAULT_PORT).takeIf { it in 1..65535 } ?: DEFAULT_PORT
        return LinkConfig(
            host = host,
            port = port,
            reportToken = reportToken,
            controlCredential = record.optString("controlCredential").trim().ifEmpty { null },
        )
    }
}