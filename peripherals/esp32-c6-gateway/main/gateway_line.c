#include "gateway_line.h"

bool gateway_line_push(gateway_line_t *line, uint8_t byte) {
  if (byte == '\n') {
    bool ready = !line->discarded && line->length > 0;
    line->bytes[line->length] = '\0';
    line->length = 0;
    line->discarded = false;
    return ready;
  }
  if (!line->discarded) {
    if (line->length >= sizeof(line->bytes) - 1) {
      line->length = 0;
      line->discarded = true;
    } else if (byte == 0) {
      line->discarded = true;
    } else {
      line->bytes[line->length++] = (char)byte;
    }
  }
  return false;
}

bool gateway_utf8_valid(const uint8_t *bytes, size_t length) {
  size_t i = 0;
  while (i < length) {
    uint32_t code = bytes[i++];
    if (code < 0x80) continue;
    size_t trailing;
    uint32_t minimum;
    if (code >= 0xc2 && code <= 0xdf) { trailing = 1; minimum = 0x80; code &= 0x1f; }
    else if (code >= 0xe0 && code <= 0xef) { trailing = 2; minimum = 0x800; code &= 0x0f; }
    else if (code >= 0xf0 && code <= 0xf4) { trailing = 3; minimum = 0x10000; code &= 0x07; }
    else return false;
    if (length - i < trailing) return false;
    while (trailing--) {
      if ((bytes[i] & 0xc0) != 0x80) return false;
      code = (code << 6) | (bytes[i++] & 0x3f);
    }
    if (code < minimum || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return false;
  }
  return true;
}

/* cJSON strings are zero-terminated. Reject decoded NUL before it parses keys or values. */
bool gateway_command_encoding_valid(const uint8_t *bytes, size_t length) {
  if (!gateway_utf8_valid(bytes, length)) return false;
  bool quoted = false;
  for (size_t i = 0; i < length; i++) {
    if (bytes[i] == 0) return false;
    if (!quoted) {
      if (bytes[i] == '"') quoted = true;
      continue;
    }
    if (bytes[i] == '"') { quoted = false; continue; }
    if (bytes[i] != '\\' || i + 1 >= length) continue;
    const uint8_t escaped = bytes[++i];
    if (escaped == 0) return false;
    if (escaped == 'u' && length - i >= 5 && bytes[i + 1] == '0' && bytes[i + 2] == '0'
        && bytes[i + 3] == '0' && bytes[i + 4] == '0') return false;
  }
  return true;
}
