package com.odk.shell.link

import java.io.BufferedInputStream
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction

/** Refuse oversized bytes and malformed UTF-8 before creating a JSON string. */
class BoundedLineReader(input: InputStream, private val maxBytes: Int = PersonalAgentFrame.MAX_BYTES + 4096) {
    private val input = BufferedInputStream(input)
    fun readLine(): String? {
        val bytes = ByteArrayOutputStream()
        while (true) {
            val next = input.read()
            if (next == -1) {
                if (bytes.size() == 0) return null
                throw IllegalArgumentException("Truncated link record")
            }
            if (next == 10) break
            if (bytes.size() >= maxBytes) throw IllegalArgumentException("Link record exceeded its byte bound")
            bytes.write(next)
        }
        return Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
            .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes.toByteArray())).toString()
    }
}
