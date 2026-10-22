package com.odk.shell.link

import org.json.JSONObject
import java.io.OutputStream
import java.net.InetSocketAddress
import java.net.Socket
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

sealed class LinkState {
    data object Connecting : LinkState()
    data class Live(val development: Boolean) : LinkState()
    data class Dropped(val reason: String) : LinkState()
}

data class SubmitOutcome(val accepted: Boolean, val reason: String?)

/**
 * The one outbound link the phone holds to its desk.
 *
 * The desk generates the content; this client only carries the frames, and it
 * reports an honest unavailable state the moment the link drops. A dropped link
 * reconnects with a growing wait and cannot lose the newest frame it already has.
 */
class PersonalAgentLink(
    private val config: LinkConfig,
    private val machine: String,
    private val sessionId: String,
    private val onFrame: (JSONObject, Boolean) -> Unit,
    private val onState: (LinkState) -> Unit,
) {
    private class PendingSubmit(val requestId: String, val firstFrameSHA256: String) {
        val challenge = CountDownLatch(1)
        val receipt = CountDownLatch(1)
        @Volatile var nonce: String? = null
        @Volatile var accepted: Boolean? = null
        @Volatile var reason: String? = null
    }

    private val running = AtomicBoolean(false)
    private var worker: Thread? = null
    @Volatile private var socket: Socket? = null
    @Volatile private var output: OutputStream? = null
    @Volatile private var attempt = 0
    @Volatile private var frame: JSONObject = PersonalAgentFrame.unavailable(NO_LINK)
    @Volatile private var development = false
    @Volatile private var pendingSubmit: PendingSubmit? = null
    private val submitLock = Any()

    fun currentFrame(): JSONObject = frame

    fun isDevelopment(): Boolean = development

    fun start() {
        if (!running.compareAndSet(false, true)) return
        worker = Thread({ loop() }, "odk-personal-agent-link").apply {
            isDaemon = true
            start()
        }
    }

    fun stop() {
        running.set(false)
        closeSocket()
        failPending("The link was closed")
    }

    /** One owner turn at a time, answered by the desk's own generator. */
    fun submit(text: String, replyTo: JSONObject? = null): SubmitOutcome {
        if (text.trim().isEmpty() || text.toByteArray(Charsets.UTF_8).size > 16 * 1024 || Regex("[\\x00-\\x08\\x0b\\x0c\\x0e-\\x1f]").containsMatchIn(text)) return SubmitOutcome(false, "Invalid owner text")
        if (replyTo != null && !PersonalAgentProtocol.validReplyTo(replyTo)) return SubmitOutcome(false, "Invalid reply reference")
        val credential = config.controlCredential ?: return SubmitOutcome(false, NO_CONTROL)
        val requestId = "request-" + java.util.UUID.randomUUID().toString()
        val firstFrame = PersonalAgentProtocol.controlHello(machine, sessionId, requestId, text, replyTo)
        val request = PendingSubmit(requestId, PersonalAgentProtocol.frameDigest(firstFrame.toByteArray(Charsets.UTF_8)))
        synchronized(submitLock) {
            if (pendingSubmit != null) return SubmitOutcome(false, "A turn is already in flight")
            pendingSubmit = request
        }
        try {
            if (!writeLine(firstFrame)) return SubmitOutcome(false, NO_LINK)
            if (!request.challenge.await(CHALLENGE_TIMEOUT_MS, TimeUnit.MILLISECONDS)) {
                return SubmitOutcome(false, request.reason ?: "The desk did not open a challenge")
            }
            val nonce = request.nonce ?: return SubmitOutcome(false, request.reason ?: "The desk did not open a challenge")
            val proof = PersonalAgentProtocol.proof(credential, PersonalAgentProtocol.transcript(nonce, request.firstFrameSHA256))
            if (!writeLine(PersonalAgentProtocol.submit(request.requestId, proof))) return SubmitOutcome(false, NO_LINK)
            if (!request.receipt.await(RECEIPT_TIMEOUT_MS, TimeUnit.MILLISECONDS)) {
                return SubmitOutcome(false, "The desk did not confirm the turn")
            }
            return SubmitOutcome(request.accepted == true, request.reason)
        } catch (_: InterruptedException) {
            return SubmitOutcome(false, "The turn was cancelled")
        } finally {
            synchronized(submitLock) { pendingSubmit = null }
        }
    }

    private fun loop() {
        while (running.get()) {
            try {
                onState(LinkState.Connecting)
                val connection = Socket()
                connection.connect(InetSocketAddress(config.host, config.port), CONNECT_TIMEOUT_MS)
                socket = connection
                output = connection.outputStream
                writeLine(PersonalAgentProtocol.hello(machine, sessionId, config.reportToken))
                attempt = 0
                run {
                    val reader = BoundedLineReader(connection.inputStream)
                    while (running.get()) {
                        val line = reader.readLine() ?: break
                        if (line.isNotBlank()) handle(line)
                    }
                }
                if (running.get()) throw IllegalStateException("The desk closed the link")
            } catch (error: Exception) {
                if (!running.get()) return
                development = false
                frame = PersonalAgentFrame.unavailable(NO_LINK)
                onFrame(frame, false)
                onState(LinkState.Dropped(error.message ?: "The link failed"))
                failPending("The link dropped before the desk answered")
                val wait = LinkBackoff.delayMs(attempt)
                attempt += 1
                try {
                    Thread.sleep(wait)
                } catch (_: InterruptedException) {
                    return
                }
            } finally {
                closeSocket()
            }
        }
    }

    private fun handle(line: String) {
        val record = try { JSONObject(line) } catch (_: Exception) { return }
        // Another protocol version is refused through the drop path, so the phone
        // states the reason and reconnects with its growing wait.
        PersonalAgentProtocol.versionRefusal(record)?.let { reason -> throw IllegalStateException(reason) }
        when (record.optString("type")) {
            PersonalAgentProtocol.READY -> Unit
            PersonalAgentProtocol.FRAME -> {
                development = record.optBoolean("development", false)
                frame = PersonalAgentFrame.project(record.optJSONObject("frame"))
                onFrame(frame, development)
                onState(LinkState.Live(development))
            }
            PersonalAgentProtocol.CHALLENGE -> {
                pendingSubmit?.let { request ->
                    if (record.optString("requestId") != request.requestId) return@let
                    if (record.optString("firstFrameSHA256") != request.firstFrameSHA256 ||
                        record.optString("domain") != PersonalAgentProtocol.CONTROL_DOMAIN ||
                        record.optString("algorithm") != "hmac-sha256" ||
                        !Regex("[a-f0-9]{64}").matches(record.optString("nonce"))) {
                        request.reason = "The desk challenge did not match the original command"
                    } else request.nonce = record.getString("nonce")
                    request.challenge.countDown()
                }
            }
            PersonalAgentProtocol.RECEIPT -> {
                pendingSubmit?.let { request ->
                    if (record.optString("requestId") == request.requestId) {
                        request.accepted = PersonalAgentProtocol.acceptedOf(record) == true
                        request.receipt.countDown()
                    }
                }
            }
            PersonalAgentProtocol.ERROR -> {
                val named = record.optString("requestId")
                val reason = PersonalAgentProtocol.refusalReason(record) ?: "The desk refused the turn"
                val request = pendingSubmit
                if (request == null) {
                    if (named.isNotEmpty()) return // A late result belongs only to its old request.
                    throw IllegalStateException(reason)
                }
                if (named.isNotEmpty() && named != request.requestId) return
                request.reason = reason
                request.challenge.countDown()
                request.receipt.countDown()
            }
        }
    }

    private fun failPending(reason: String) {
        val request = pendingSubmit ?: return
        if (request.reason == null) request.reason = reason
        request.challenge.countDown()
        request.receipt.countDown()
    }

    private fun writeLine(record: String): Boolean {
        val stream = output ?: return false
        return try {
            synchronized(this) { stream.write((record + "\n").toByteArray(Charsets.UTF_8)); stream.flush() }
            true
        } catch (_: Exception) {
            closeSocket()
            false
        }
    }

    private fun closeSocket() {
        try { socket?.close() } catch (_: Exception) { }
        socket = null
        output = null
    }

    private companion object {
        const val CONNECT_TIMEOUT_MS = 5000
        const val CHALLENGE_TIMEOUT_MS = 5000L
        const val RECEIPT_TIMEOUT_MS = 15000L
        const val NO_LINK = "Personal Agent link unavailable"
        const val NO_CONTROL = "This phone holds no control credential"
    }
}