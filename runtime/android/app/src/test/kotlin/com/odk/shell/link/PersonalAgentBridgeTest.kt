package com.odk.shell.link

import com.odk.shell.bridge.PersonalAgentBridge
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PersonalAgentBridgeTest {
    @Test fun onlyTheActualTrustedMainDocumentCanUseTheBridge() {
        val origin = "https://appassets.androidplatform.net"
        val document = "$origin/assets/web/renderer/index.html"
        assertTrue(PersonalAgentBridge.permitsDocument(true, true, origin, document))
        assertFalse(PersonalAgentBridge.permitsDocument(true, false, origin, document))
        assertFalse(PersonalAgentBridge.permitsDocument(false, true, origin, document))
        assertFalse(PersonalAgentBridge.permitsDocument(true, true, "https://foreign.example", document))
        assertFalse(PersonalAgentBridge.permitsDocument(true, true, origin, "https://foreign.example"))
        assertFalse(PersonalAgentBridge.permitsDocument(true, true, origin, null))
    }
}
