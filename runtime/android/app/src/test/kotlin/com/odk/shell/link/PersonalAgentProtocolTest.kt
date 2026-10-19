package com.odk.shell.link

import com.odk.shell.assertJsonEquals
import com.odk.shell.fixtureJson
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The desk and the phone answer to one fixture. These checks fail on the phone
 * the moment the desk contract moves under it.
 */
class PersonalAgentProtocolTest {
    private val fixture = fixtureJson("personal-agent-v1.json")
    private val control = fixture.getJSONObject("control")
    private val controlHello = control.getJSONObject("hello")
    private val machine = controlHello.getString("machine")
    private val sessionId = controlHello.getString("sessionId")
    private val credential = control.getString("credential")

    @Test
    fun challengeTranscriptMatchesTheSharedFixture() {
        val challenge = control.getJSONObject("challenge")
        val nonce = challenge.getString("nonce")
        assertEquals(control.getString("transcript"), PersonalAgentProtocol.transcript(nonce, control.getString("firstFrameSHA256")))
        assertEquals(challenge.getString("domain"), PersonalAgentProtocol.CONTROL_DOMAIN)
        assertEquals(fixture.getString("domain"), PersonalAgentProtocol.CONTROL_DOMAIN)
        assertEquals(fixture.getInt("protocol"), PersonalAgentProtocol.PROTOCOL)
    }

    @Test
    fun fixtureProofIsTheProofThisCredentialProduces() {
        val transcript = control.getString("transcript")
        assertEquals(control.getString("proof"), PersonalAgentProtocol.proof(credential, transcript))
        assertTrue(PersonalAgentProtocol.proofMatches(credential, transcript, control.getString("proof")))
        assertFalse(PersonalAgentProtocol.proofMatches(credential, transcript, "f".repeat(64)))
    }

    @Test
    fun readHelloMatchesTheSharedFixture() {
        val token = fixture.getJSONObject("read").getJSONObject("hello").getString("token")
        assertJsonEquals("read hello", fixture.getJSONObject("read").getJSONObject("hello"), JSONObject(PersonalAgentProtocol.hello(machine, sessionId, token)))
    }

    @Test
    fun controlHelloMatchesTheSharedFixture() {
        assertJsonEquals("control hello", controlHello, JSONObject(PersonalAgentProtocol.controlHello(machine, sessionId, controlHello.getString("requestId"), controlHello.getString("text"))))
    }

    @Test
    fun submitMatchesTheSharedFixture() {
        assertJsonEquals("submit", control.getJSONObject("submit"), JSONObject(PersonalAgentProtocol.submit("request-submit", control.getString("proof"))))
    }

    @Test
    fun receiptAndRefusalAreReadFromTheirOwnRecords() {
        assertEquals(true, PersonalAgentProtocol.acceptedOf(control.getJSONObject("receipt")))
        assertNull(PersonalAgentProtocol.refusalReason(control.getJSONObject("receipt")))
        val refusal = JSONObject("{\"type\":\"error\",\"reason\":\"control proof refused\"}")
        assertEquals("control proof refused", PersonalAgentProtocol.refusalReason(refusal))
        assertNull(PersonalAgentProtocol.acceptedOf(refusal))
        assertEquals(false, PersonalAgentProtocol.acceptedOf(JSONObject("{\"type\":\"personal-agent-receipt\",\"accepted\":false}")))
    }

    @Test
    fun aProofFromAnotherDomainIsRefused() {
        // A Hosted Pi proof carries the same shape and the other transcript.
        val hostedPi = "odk-control-v2\n2\nnonce-fixture\ndesk-mac\nconsole-session"
        val hostedProof = PersonalAgentProtocol.proof(credential, hostedPi)
        assertFalse(PersonalAgentProtocol.proofMatches(credential, PersonalAgentProtocol.transcript("nonce-fixture", control.getString("firstFrameSHA256")), hostedProof))
    }

    @Test
    fun anEmptyCredentialCannotProduceAProof() {
        assertFalse(PersonalAgentProtocol.proofMatches("", control.getString("transcript"), control.getString("proof")))
    }

    @Test
    fun aRecordFromAnotherProtocolVersionIsRefusedByName() {
        assertNull(PersonalAgentProtocol.versionRefusal(JSONObject("{\"v\":1,\"type\":\"personal-agent\"}")))
        assertEquals("the desk answered protocol version 2", PersonalAgentProtocol.versionRefusal(JSONObject("{\"v\":2,\"type\":\"personal-agent\"}")))
        assertNotNull(PersonalAgentProtocol.versionRefusal(JSONObject("{\"type\":\"personal-agent\"}")))
    }
    @Test
    fun rawBytesBindWhitespaceUnicodeAndTheExactReplyReference() {
        val raw = control.getString("rawFirstFrame").toByteArray(Charsets.UTF_8)
        assertEquals(control.getString("firstFrameSHA256"), PersonalAgentProtocol.frameDigest(raw))
        assertFalse(PersonalAgentProtocol.frameDigest(raw) == PersonalAgentProtocol.frameDigest(raw + byteArrayOf(32)))
        val ref = JSONObject().put("messageId", "a".repeat(64)).put("sourceKey", "original").put("sourceRevision", "b".repeat(64))
        val first = JSONObject(PersonalAgentProtocol.controlHello(machine, sessionId, "once", "原文", ref))
        assertJsonEquals("original reference", ref, first.getJSONObject("replyTo"))
        assertTrue(PersonalAgentProtocol.validReplyTo(ref))
        assertFalse(PersonalAgentProtocol.validReplyTo(JSONObject(ref.toString()).put("target", "other")))
        assertNull(PersonalAgentProtocol.versionRefusal(JSONObject().put("v", 2).put("type", "challenge")))
        assertNotNull(PersonalAgentProtocol.versionRefusal(JSONObject().put("v", 1).put("type", "challenge")))
    }

}