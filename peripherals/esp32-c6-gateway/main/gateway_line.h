#pragma once
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

typedef struct {
  char bytes[512];
  size_t length;
  bool discarded;
} gateway_line_t;

bool gateway_line_push(gateway_line_t *line, uint8_t byte);
bool gateway_utf8_valid(const uint8_t *bytes, size_t length);

/* Command input encoding: UTF-8 with no decoded NUL in JSON strings. */
bool gateway_command_encoding_valid(const uint8_t *bytes, size_t length);
