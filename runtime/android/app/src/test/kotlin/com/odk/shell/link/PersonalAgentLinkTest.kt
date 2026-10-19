package com.odk.shell.link

import com.odk.shell.fixtureJson
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The phone's own refusal, which no desk can be asked about: a phone without the
 * control credential never presents a turn, and it says so instead of claiming a
 * delivery nobody confirmed.
 */
class PersonalAgentLinkTest {
    private val fixture = fixtureJson("personal-agent-v1.json")

    private fun link(config: LinkConfig): PersonalAgentLink = PersonalAgentLink(
        config,
        fixture.getJSONObject("read").getJSONObject("hello").getString("machine"),
        fixture.getJSONObject("read").getJSONObject("hello").getString("sessionId"),
        { _, _ -> },
        { },
    )

    @Test
    fun aPhoneWithoutAControlCredentialRefusesItsOwnTurn() {
        val link = link(LinkConfig(host = "127.0.0.1", port = 9, reportToken = "report-token", controlCredential = null))
        try {
            val outcome = link.submit("Summarise the desk")
            assertFalse(outcome.accepted)
            assertTrue(outcome.reason!!.contains("control credential"))
        } finally {
            link.stop()
        }
    }

    @Test
    fun aPhoneWithoutALinkReportsUnavailableRatherThanADelivery() {
        val link = link(LinkConfig(host = "127.0.0.1", port = 9, reportToken = "report-token", controlCredential = "control-secret"))
        try {
            val frame = link.currentFrame()
            assertTrue(frame.getString("state") == "unavailable")
            assertTrue(frame.getString("message").isNotEmpty())
        } finally {
            link.stop()
        }
    }
    @Test
    fun aRefusedHandshakeKeepsItsReasonWithoutAPendingOwnerTurn() {
        val server = java.net.ServerSocket(0, 1, java.net.InetAddress.getByName("127.0.0.1"))
        server.soTimeout = 2000
        val thread = Thread {
            server.accept().use { socket ->
                socket.soTimeout = 2000
                socket.getInputStream().bufferedReader(Charsets.UTF_8).readLine()
                socket.getOutputStream().write("{\"v\":1,\"type\":\"error\",\"reason\":\"token refused\"}\n".toByteArray(Charsets.UTF_8))
                socket.getOutputStream().flush()
            }
        }.apply { isDaemon = true; start() }
        val dropped = java.util.concurrent.ArrayBlockingQueue<String>(1)
        val link = PersonalAgentLink(LinkConfig("127.0.0.1", server.localPort, "wrong-report-token", null), "phone", "read-session", { _, _ -> }, { state ->
            if (state is LinkState.Dropped) dropped.offer(state.reason)
        })
        try {
            link.start()
            org.junit.Assert.assertEquals("token refused", dropped.poll(2, java.util.concurrent.TimeUnit.SECONDS))
        } finally { link.stop(); server.close(); thread.join(2000) }
    }

    @Test
    fun lateNamedErrorsDoNotDropAHealthyReadConnection() {
        withDesk({ socket ->
            val reader = socket.getInputStream().bufferedReader(Charsets.UTF_8)
            reader.readLine()
            val writer = socket.getOutputStream().bufferedWriter(Charsets.UTF_8)
            writer.write("{\"v\":1,\"type\":\"error\",\"requestId\":\"old-turn\",\"reason\":\"old refusal\"}\n")
            writer.write("{\"v\":1,\"type\":\"personal-agent\",\"frame\":{\"state\":\"idle\",\"message\":\"still live\"}}\n")
            writer.flush()
            while (reader.readLine() != null) { }
        }) { port ->
            val live = java.util.concurrent.CountDownLatch(1)
            val dropped = java.util.concurrent.atomic.AtomicBoolean(false)
            val link = PersonalAgentLink(LinkConfig("127.0.0.1", port, "report", null), "phone", "session", { frame, _ ->
                if (frame.optString("message") == "still live") live.countDown()
            }, { if (it is LinkState.Dropped) dropped.set(true) })
            try { link.start(); assertTrue(live.await(2, java.util.concurrent.TimeUnit.SECONDS)); assertFalse(dropped.get()) }
            finally { link.stop() }
        }
    }

    @Test
    fun anActiveMatchingErrorRefusesOnlyItsPendingOwnerTurn() {
        val credential = fixture.getJSONObject("control").getString("credential")
        withDesk({ socket ->
            val reader = socket.getInputStream().bufferedReader(Charsets.UTF_8)
            reader.readLine()
            val writer = socket.getOutputStream().bufferedWriter(Charsets.UTF_8)
            writer.write("{\"v\":1,\"type\":\"personal-agent\",\"frame\":{\"state\":\"idle\",\"message\":\"ready\"}}\n"); writer.flush()
            val raw = reader.readLine()
            val first = org.json.JSONObject(raw)
            val digest = PersonalAgentProtocol.frameDigest(raw.toByteArray(Charsets.UTF_8))
            val nonce = "a".repeat(64)
            val challenge = org.json.JSONObject().put("v", 2).put("type", "challenge").put("requestId", first.getString("requestId"))
                .put("domain", PersonalAgentProtocol.CONTROL_DOMAIN).put("algorithm", "hmac-sha256").put("nonce", nonce).put("firstFrameSHA256", digest)
            writer.write(challenge.toString() + "\n"); writer.flush()
            val submit = org.json.JSONObject(reader.readLine())
            assertTrue(PersonalAgentProtocol.proofMatches(credential, PersonalAgentProtocol.transcript(nonce, digest), submit.getString("proof")))
            val refusal = org.json.JSONObject().put("v", 1).put("type", "error").put("requestId", first.getString("requestId")).put("reason", "control refused\n\u0000")
            writer.write(refusal.toString() + "\n"); writer.flush()
            while (reader.readLine() != null) { }
        }) { port ->
            val ready = java.util.concurrent.CountDownLatch(1)
            val dropped = java.util.concurrent.atomic.AtomicBoolean(false)
            val link = PersonalAgentLink(LinkConfig("127.0.0.1", port, "report", credential), "phone", "session", { _, _ -> ready.countDown() }, { if (it is LinkState.Dropped) dropped.set(true) })
            try {
                link.start(); assertTrue(ready.await(2, java.util.concurrent.TimeUnit.SECONDS))
                val outcome = link.submit("one original owner turn")
                assertFalse(outcome.accepted)
                org.junit.Assert.assertEquals("control refused", outcome.reason)
                assertFalse(dropped.get())
            } finally { link.stop() }
        }
    }

    private fun withDesk(script: (java.net.Socket) -> Unit, check: (Int) -> Unit) {
        val server = java.net.ServerSocket(0, 1, java.net.InetAddress.getByName("127.0.0.1"))
        server.soTimeout = 2000
        val failure = java.util.concurrent.atomic.AtomicReference<Throwable?>(null)
        val worker = Thread {
            try { server.accept().use { socket -> socket.soTimeout = 3000; script(socket) } }
            catch (error: Throwable) { failure.set(error) }
        }.apply { isDaemon = true; start() }
        try { check(server.localPort) }
        finally { server.close(); worker.join(3500) }
        failure.get()?.let { throw AssertionError("The isolated test desk failed", it) }
        assertFalse(worker.isAlive)
    }

}