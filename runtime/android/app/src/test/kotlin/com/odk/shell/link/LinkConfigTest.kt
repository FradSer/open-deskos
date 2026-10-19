package com.odk.shell.link

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class LinkConfigTest {
    @Test
    fun aProvisionedLinkKeepsItsOwnCredentialForControl() {
        val config = LinkConfigReader.read(
            "{\"host\":\"10.10.0.126\",\"port\":8765,\"reportToken\":\"report-token\",\"controlCredential\":\"control-secret\"}"
        )
        assertEquals("10.10.0.126", config?.host)
        assertEquals(8765, config?.port)
        assertEquals("report-token", config?.reportToken)
        assertEquals("control-secret", config?.controlCredential)
    }

    @Test
    fun aLinkWithoutAReportTokenIsRefused() {
        assertNull(LinkConfigReader.read("{\"host\":\"10.10.0.126\",\"port\":8765}"))
        assertNull(LinkConfigReader.read("{\"host\":\"10.10.0.126\",\"port\":8765,\"reportToken\":\"\"}"))
        assertNull(LinkConfigReader.read("not json"))
    }

    @Test
    fun aLinkWithoutAControlCredentialStillReadsTheDesk() {
        val config = LinkConfigReader.read("{\"host\":\"desk\",\"port\":8765,\"reportToken\":\"report-token\"}")
        assertEquals("desk", config?.host)
        assertNull(config?.controlCredential)
        assertEquals(8765, LinkConfigReader.read("{\"host\":\"desk\",\"reportToken\":\"report-token\"}")?.port)
    }
}