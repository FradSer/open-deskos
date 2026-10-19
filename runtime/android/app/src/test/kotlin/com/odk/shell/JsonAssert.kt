package com.odk.shell

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue

/**
 * The contract fixture is read on both sides, so a comparison has to ignore key
 * order while still checking every field and every nested value.
 */
fun jsonKeys(value: JSONObject): List<String> {
    val keys = mutableListOf<String>()
    val iterator = value.keys()
    while (iterator.hasNext()) keys.add(iterator.next())
    return keys
}

fun assertJsonEquals(message: String, expected: Any?, actual: Any?) {
    when (expected) {
        is JSONObject -> {
            val other = actual as? JSONObject
            assertTrue(message + " must be an object, was " + actual, other != null)
            assertEquals(message + " keys", jsonKeys(expected).sorted(), jsonKeys(other!!).sorted())
            for (key in jsonKeys(expected)) assertJsonEquals(message + "." + key, expected.get(key), other.get(key))
        }
        is JSONArray -> {
            val other = actual as? JSONArray
            assertTrue(message + " must be an array, was " + actual, other != null)
            assertEquals(message + " length", expected.length(), other!!.length())
            for (index in 0 until expected.length()) assertJsonEquals(message + "[" + index + "]", expected.get(index), other.get(index))
        }
        else -> assertEquals(message, expected, actual)
    }
}

fun fixtureJson(name: String): JSONObject {
    val stream = checkNotNull(JsonAssertHelper::class.java.getResourceAsStream("/" + name)) { name + " is missing from the test classpath" }
    return JSONObject(stream.bufferedReader().use { it.readText() })
}

object JsonAssertHelper