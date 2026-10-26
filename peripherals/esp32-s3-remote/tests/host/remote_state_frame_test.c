#include <assert.h>
#include <stdio.h>
#include <string.h>

#include "remote_state_frame.h"

static void make_frame(char *frame, size_t size, const char *id, const char *label)
{
    const int length = snprintf(frame, size,
        "{\"v\":1,\"type\":\"state\",\"page\":1,\"pages\":3,\"name\":\"Home\","
        "\"canPrev\":false,\"canNext\":true,\"link\":\"wired\","
        "\"actions\":[{\"id\":\"%s\",\"label\":\"%s\"}]}", id, label);
    assert(length > 0 && (size_t)length < size);
}

static void test_action_buffer_boundaries(void)
{
    char frame[512];
    char id[ACTION_ID_MAX_BYTES + 2];
    char label[ACTION_LABEL_MAX_BYTES + 2];
    memset(id, 'i', sizeof(id) - 1);
    id[sizeof(id) - 1] = '\0';
    memset(label, 'L', sizeof(label) - 1);
    label[sizeof(label) - 1] = '\0';
    remote_state_t state = {0};
    make_frame(frame, sizeof(frame), "refresh", "SYNC");
    assert(remote_state_frame_parse(frame, &state));
    assert(state.received && state.action_count == 1);
    assert(strcmp(state.actions[0].id, "refresh") == 0);
    const remote_state_t previous = state;

    // A rejected action must not erase the last usable action or page state.
    make_frame(frame, sizeof(frame), id, "SYNC");
    assert(!remote_state_frame_parse(frame, &state));
    assert(memcmp(&state, &previous, sizeof(state)) == 0);
    make_frame(frame, sizeof(frame), "refresh", label);
    assert(!remote_state_frame_parse(frame, &state));
    assert(memcmp(&state, &previous, sizeof(state)) == 0);

    id[ACTION_ID_MAX_BYTES] = '\0';
    label[ACTION_LABEL_MAX_BYTES] = '\0';
    make_frame(frame, sizeof(frame), id, label);
    assert(remote_state_frame_parse(frame, &state));
    assert(strcmp(state.actions[0].id, id) == 0);
    assert(strcmp(state.actions[0].label, label) == 0);
}

static void test_invalid_frames_preserve_state(void)
{
    char frame[512];
    remote_state_t state = {0};
    make_frame(frame, sizeof(frame), "refresh", "SYNC");
    assert(remote_state_frame_parse(frame, &state));
    const remote_state_t previous = state;
    const char *invalid[] = {
        "not JSON",
        "[]",
        "{\"v\":1,\"type\":\"state\",\"page\":1,\"pages\":3,\"name\":\"Home\","
        "\"canPrev\":false,\"canNext\":true,\"link\":\"wired\"} trailing-data",
        "{\"v\":1,\"type\":\"state\",\"page\":3,\"pages\":3,\"name\":\"Home\","
        "\"canPrev\":false,\"canNext\":true,\"link\":\"wired\"}",
        "{\"v\":1,\"type\":\"state\",\"page\":1,\"pages\":3,\"name\":\"Home\","
        "\"canPrev\":false,\"canNext\":true,\"link\":\"unknown\"}",
        "{\"v\":1,\"type\":\"state\",\"page\":1,\"pages\":3,\"name\":\"Home\","
        "\"canPrev\":false,\"canNext\":true,\"link\":\"wired\",\"actions\":{}}",
    };
    for (size_t i = 0; i < sizeof(invalid) / sizeof(invalid[0]); ++i) {
        assert(!remote_state_frame_parse(invalid[i], &state));
        assert(memcmp(&state, &previous, sizeof(state)) == 0);
    }
    make_frame(frame, sizeof(frame), "", "SYNC");
    assert(!remote_state_frame_parse(frame, &state));
    assert(memcmp(&state, &previous, sizeof(state)) == 0);
    make_frame(frame, sizeof(frame), "refresh", "");
    assert(!remote_state_frame_parse(frame, &state));
    assert(memcmp(&state, &previous, sizeof(state)) == 0);
}


static void test_decoded_nul_aliases_preserve_state(void)
{
    char frame[512];
    remote_state_t state = {0};
    make_frame(frame, sizeof(frame), "refresh", "SYNC");
    assert(remote_state_frame_parse(frame, &state));
    const remote_state_t previous = state;
    make_frame(frame, sizeof(frame), "refresh\\u0000hidden", "SYNC");
    assert(!remote_state_frame_parse(frame, &state));
    assert(memcmp(&state, &previous, sizeof(state)) == 0);
    make_frame(frame, sizeof(frame), "refresh", "SYNC\\u0000hidden");
    assert(!remote_state_frame_parse(frame, &state));
    assert(memcmp(&state, &previous, sizeof(state)) == 0);
    const char *invalid[] = {
        "{\"v\":1,\"type\":\"state\\u0000unknown\",\"page\":1,\"pages\":3,\"name\":\"Home\",\"canPrev\":false,\"canNext\":true,\"link\":\"wireless\"}",
        "{\"v\":1,\"page\":1,\"pages\":3,\"name\":\"Home\",\"canPrev\":false,\"canNext\":true,\"link\":\"wireless\",\"type\\u0000alias\":\"state\"}",
        "{\"v\":1,\"type\":\"state\",\"page\":1,\"pages\":3,\"name\":\"Home\",\"canPrev\":false,\"canNext\":true,\"link\":\"wireless\",\"type\\u0000alias\":\"unknown\"}",
    };
    for (size_t i = 0; i < sizeof(invalid) / sizeof(invalid[0]); ++i) {
        assert(!remote_state_frame_parse(invalid[i], &state));
        assert(memcmp(&state, &previous, sizeof(state)) == 0);
    }
    make_frame(frame, sizeof(frame), "refresh\\\\u0000", "\\u0053YNC");
    assert(remote_state_frame_parse(frame, &state));
    assert(strcmp(state.actions[0].id, "refresh\\u0000") == 0);
    assert(strcmp(state.actions[0].label, "SYNC") == 0);
    make_frame(frame, sizeof(frame), "refresh", "SYNC");
    assert(remote_state_frame_parse(frame, &state));
    assert(memcmp(&state, &previous, sizeof(state)) == 0);
    // Odd escape runs decode NUL; even runs retain literal backslashes.
    for (size_t slashes = 1; slashes <= 6; ++slashes) {
        char id[24] = "x";
        for (size_t i = 0; i < slashes; ++i) id[i + 1] = '\\';
        memcpy(id + slashes + 1, "u0000", 6);
        make_frame(frame, sizeof(frame), "refresh", "SYNC");
        assert(remote_state_frame_parse(frame, &state));
        const remote_state_t prior = state;
        make_frame(frame, sizeof(frame), id, "SYNC");
        assert(remote_state_frame_parse(frame, &state) == (slashes % 2 == 0));
        if (slashes % 2 != 0) assert(memcmp(&state, &prior, sizeof(state)) == 0);
    }

}

int main(void)
{
    test_action_buffer_boundaries();
    test_invalid_frames_preserve_state();
    test_decoded_nul_aliases_preserve_state();
    return 0;
}
