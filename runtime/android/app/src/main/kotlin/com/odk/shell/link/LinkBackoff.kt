package com.odk.shell.link

/** A dropped link waits longer each time and stops growing, as the desk documents. */
object LinkBackoff {
    const val INITIAL_MS = 1000L
    const val MAX_MS = 30000L

    fun delayMs(attempt: Int): Long {
        if (attempt <= 0) return INITIAL_MS
        val factor = 1L shl attempt.coerceAtMost(30)
        return (INITIAL_MS * factor).coerceAtMost(MAX_MS)
    }
}