package com.odk.shell.link

import com.odk.shell.assertJsonEquals
import com.odk.shell.fixtureJson
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PersonalAgentFrameTest {
    private val fixture = fixtureJson("personal-agent-v1.json")
    private val states = fixture.getJSONObject("states")

    @Test
    fun everySharedFixtureStateSurvivesTheLinkUnchanged() {
        for (name in states.keys()) {
            assertJsonEquals(name + " must reach the phone unchanged", states.getJSONObject(name), PersonalAgentFrame.project(states.getJSONObject(name)))
        }
    }

    @Test
    fun invalidOrInactiveVoiceFailuresNeverCross() {
        for (cause in listOf("unknown", JSONObject().put("code", "microphone"), JSONObject.NULL)) {
            assertFalse(PersonalAgentFrame.project(JSONObject().put("state", "error").put("voiceFailure", cause)).has("voiceFailure"))
        }
        assertFalse(PersonalAgentFrame.project(JSONObject().put("state", "idle").put("voiceFailure", "microphone")).has("voiceFailure"))
    }

    @Test
    fun aFieldTheRendererDoesNotReadNeverCrosses() {
        val projected = PersonalAgentFrame.project(JSONObject("{\"state\":\"idle\",\"message\":\"\",\"privateNote\":\"do not send me\"}"))
        assertFalse("an unread field must be dropped", projected.has("privateNote"))
    }

    @Test
    fun anUnknownStateDegradesToAnExplicitUnavailableFrame() {
        val projected = PersonalAgentFrame.project(JSONObject("{\"state\":\"nonsense\",\"message\":\"x\"}"))
        assertEquals("unavailable", projected.getString("state"))
        assertTrue(projected.getString("message").isNotEmpty())
    }

    @Test
    fun aMissingStatusDegradesInsteadOfInventingOne() {
        assertEquals("unavailable", PersonalAgentFrame.project(null).getString("state"))
    }

    @Test
    fun anOversizedFrameDegradesInsteadOfTruncating() {
        val huge = JSONObject().put("state", "idle").put("message", "x".repeat(PersonalAgentFrame.MAX_BYTES + 1))
        val projected = PersonalAgentFrame.project(huge)
        assertEquals("unavailable", projected.getString("state"))
        assertTrue(projected.getString("message").contains("bound"))
    }

    @Test
    fun notificationsKeepOnlyTheFieldsTheRendererReads() {
        val projected = PersonalAgentFrame.project(
            JSONObject("{\"state\":\"idle\",\"notifications\":[{\"id\":\"a\",\"message\":\"one\",\"secret\":\"drop\"},{\"id\":7},{\"message\":\"no id\"},null]}")
        )
        val notifications = projected.getJSONArray("notifications")
        assertEquals(1, notifications.length())
        assertEquals("a", notifications.getJSONObject(0).getString("id"))
        assertFalse(notifications.getJSONObject(0).has("secret"))
    }
    @Test fun centralHistoryIdentityAndUnavailableVoiceStayPublic() {
        val id = "12345678-1234-1234-1234-123456789abc"
        val ref = JSONObject().put("messageId", "a".repeat(64)).put("sourceKey", "original").put("sourceRevision", "b".repeat(64))
        val turn = JSONObject().put("id", id).put("at", 1).put("transcript", "hello").put("message", "answer").put("state", "idle").put("replyTo", ref).put("threadId", "c".repeat(64))
        val conversation = JSONObject().put("revision", 4).put("turns", org.json.JSONArray().put(turn)).put("omittedCount", 0)
        val status = JSONObject().put("state", "idle").put("ownerTurnId", id).put("conversation", conversation).put("replyTo", ref).put("threadId", "c".repeat(64)).put("textInput", true).put("replyInput", true)
        val frame = PersonalAgentFrame.project(status)
        assertJsonEquals("central history", conversation, frame.getJSONObject("conversation"))
        assertEquals(id, frame.getString("ownerTurnId"))
        assertJsonEquals("reply", ref, frame.getJSONObject("replyTo"))
        assertFalse(frame.getBoolean("voiceInput"))
        assertTrue(frame.getBoolean("replyInput"))
    }

}