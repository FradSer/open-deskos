#include <assert.h>
#include <string.h>
#include "gateway_line.h"
int main(void) {
  gateway_line_t line = {0};
  for (int i = 0; i < 600; i++) assert(!gateway_line_push(&line, 'x'));
  assert(!gateway_line_push(&line, '\n'));
  assert(!gateway_line_push(&line, '{'));
  assert(!gateway_line_push(&line, '}'));
  assert(gateway_line_push(&line, '\n'));
  assert(strcmp(line.bytes, "{}") == 0);
  assert(!gateway_line_push(&line, 0));
  assert(!gateway_line_push(&line, '\n'));
  assert(gateway_utf8_valid((const uint8_t *)"hello", 5));
  assert(gateway_utf8_valid((const uint8_t *)"\xe4\xb8\xad", 3));
  assert(!gateway_utf8_valid((const uint8_t *)"\xc0\x80", 2));
  assert(!gateway_utf8_valid((const uint8_t *)"\xed\xa0\x80", 3));
  assert(!gateway_utf8_valid((const uint8_t *)"\xf4\x90\x80\x80", 4));
  const uint8_t raw_nul[] = {'"', '\\', 0, '"'};
  assert(!gateway_command_encoding_valid(raw_nul, sizeof(raw_nul)));
  const char *invalid_commands[] = {
    "{\"v\":1,\"type\":\"configure\\u0000unknown\",\"id\":\"bad-type\"}",
    "{\"v\":1,\"type\\u0000alias\":\"configure\",\"id\":\"bad-key\"}",
    "{\"v\":1,\"type\":\"peer\",\"id\":\"bad-id\\u0000suffix\"}",
    "{\"v\":1,\"type\":\"configure\",\"id\":\"bad-pmk\",\"pmk\":\"0123456789abcdef0123456789abcdef\\u0000bad\"}",
    "{\"v\":1,\"type\":\"peer\",\"id\":\"bad-lmk\",\"lmk\":\"0123456789abcdef0123456789abcdef\\u0000bad\"}",
    "{\"v\":1,\"type\":\"status\",\"type\\u0000alias\":\"configure\",\"id\":\"bad-duplicate-alias\"}",
  };
  for (size_t i = 0; i < sizeof(invalid_commands) / sizeof(invalid_commands[0]); i++) {
    assert(!gateway_command_encoding_valid((const uint8_t *)invalid_commands[i], strlen(invalid_commands[i])));
  }
  const char *valid_commands[] = {
    "{\"v\":1,\"type\":\"status\",\"id\":\"valid\"}",
    "{\"note\":\"\\\\u0000\"}",
    "{\"note\":\"\\\\\\\\u0000\"}",
    "{\"note\":\"\\u4e2d\\u6587\"}",
    "{\"note\":\"escaped quote: \\\" and slash: \\\\\"}",
  };
  for (size_t i = 0; i < sizeof(valid_commands) / sizeof(valid_commands[0]); i++) {
    assert(gateway_command_encoding_valid((const uint8_t *)valid_commands[i], strlen(valid_commands[i])));
  }
  const char *recovery[] = {invalid_commands[0], valid_commands[0]};
  size_t accepted_commands = 0;
  for (size_t record = 0; record < 2; record++) {
    for (const char *byte = recovery[record]; *byte; byte++) assert(!gateway_line_push(&line, (uint8_t)*byte));
    assert(gateway_line_push(&line, '\n'));
    if (gateway_command_encoding_valid((const uint8_t *)line.bytes, strlen(line.bytes))) accepted_commands++;
    assert(accepted_commands == record);
  }
  return 0;
}
