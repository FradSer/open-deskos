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
}