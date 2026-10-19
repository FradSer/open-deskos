package com.odk.shell.link

import org.junit.Assert.assertEquals
import org.junit.Test

class LinkBackoffTest {
    @Test
    fun aDroppedLinkWaitsLongerEachTimeAndStopsGrowing() {
        assertEquals(1000L, LinkBackoff.delayMs(0))
        assertEquals(2000L, LinkBackoff.delayMs(1))
        assertEquals(4000L, LinkBackoff.delayMs(2))
        assertEquals(8000L, LinkBackoff.delayMs(3))
        assertEquals(16000L, LinkBackoff.delayMs(4))
        assertEquals(30000L, LinkBackoff.delayMs(5))
        assertEquals(30000L, LinkBackoff.delayMs(9))
        assertEquals(1000L, LinkBackoff.delayMs(-1))
    }
}