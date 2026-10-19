package com.odk.shell.link

import java.io.ByteArrayInputStream
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Test

class BoundedLineReaderTest {
    @Test fun boundsBytesBeforeDecodingAndKeepsExactUtf8() {
        val reader = BoundedLineReader(ByteArrayInputStream("原文\r\n".toByteArray(Charsets.UTF_8)), 7)
        assertEquals("原文\r", reader.readLine())
        assertNull(reader.readLine())
        assertThrows(IllegalArgumentException::class.java) { BoundedLineReader(ByteArrayInputStream("原文x\n".toByteArray(Charsets.UTF_8)), 6).readLine() }
    }
    @Test fun malformedAndUnterminatedRecordsAreRefused() {
        assertThrows(java.nio.charset.CharacterCodingException::class.java) { BoundedLineReader(ByteArrayInputStream(byteArrayOf(0xc3.toByte(), 10))).readLine() }
        assertThrows(IllegalArgumentException::class.java) { BoundedLineReader(ByteArrayInputStream("partial".toByteArray())).readLine() }
    }
}
