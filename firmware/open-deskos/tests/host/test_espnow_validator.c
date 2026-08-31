#include <string.h>

#include "unity.h"
#include "odk_espnow_validator.h"
#include "fake_espnow_custom_data.h"

static const uint8_t MAC_A[ODK_ESPNOW_MAC_LEN] = {0xAA, 0xBB, 0xCC, 0x00, 0x00, 0x01};
static const uint8_t MAC_B[ODK_ESPNOW_MAC_LEN] = {0xAA, 0xBB, 0xCC, 0x00, 0x00, 0x02};

void setUp(void) {}
void tearDown(void) {}

static odk_espnow_fleet_message_t valid_frame(uint8_t type, uint8_t node)
{
    odk_espnow_fleet_message_t frame = {0};
    frame.version = ODK_ESPNOW_PROTOCOL_VERSION;
    frame.type = type;
    frame.node_id = node;
    frame.temp_c = 23.5f;
    frame.humidity = 51.0f;
    frame.pressure_pa = 101325.0f;
    frame.lux = 400.0f;
    frame.vpd_kpa = 1.2f;
    frame.hour = 12;
    frame.minute = 34;
    frame.month = 8;
    frame.soil_raw = 123;
    frame.soil_percent = 42.0f;
    frame.soil_valid = 1;
    return frame;
}

static odk_espnow_validator_t *make_validator(fake_espnow_custom_data_t *fake)
{
    fake_espnow_custom_data_reset(fake);
    odk_espnow_transport_t transport = {
        .send_custom_data = fake_espnow_custom_data_send,
        .ctx = fake,
    };
    return odk_espnow_validator_create(&transport);
}

void test_espnow_env_and_two_status_nodes(void)
{
    fake_espnow_custom_data_t fake;
    odk_espnow_validator_t *validator = make_validator(&fake);
    odk_espnow_fleet_message_t env = valid_frame(ODK_ESPNOW_TYPE_ENV, 0);
    odk_espnow_fleet_message_t node1 = valid_frame(ODK_ESPNOW_TYPE_STATUS, 1);
    odk_espnow_fleet_message_t node2 = valid_frame(ODK_ESPNOW_TYPE_STATUS, 2);
    node1.mac[5] = 1;
    node2.mac[5] = 2;

    TEST_ASSERT_TRUE(odk_espnow_validator_enqueue(validator, MAC_A, (uint8_t *)&env, sizeof(env)));
    TEST_ASSERT_TRUE(odk_espnow_validator_enqueue(validator, MAC_A, (uint8_t *)&node1, sizeof(node1)));
    TEST_ASSERT_TRUE(odk_espnow_validator_enqueue(validator, MAC_B, (uint8_t *)&node2, sizeof(node2)));
    TEST_ASSERT_TRUE(odk_espnow_validator_process_one(validator, NULL));
    TEST_ASSERT_TRUE(odk_espnow_validator_process_one(validator, NULL));
    TEST_ASSERT_TRUE(odk_espnow_validator_process_one(validator, NULL));

    odk_espnow_stats_t stats;
    odk_espnow_validator_get_stats(validator, &stats);
    TEST_ASSERT_EQUAL_UINT32(3, stats.frames);
    TEST_ASSERT_EQUAL_UINT32(1, stats.environment_frames);
    TEST_ASSERT_EQUAL_UINT32(1, stats.node1_frames);
    TEST_ASSERT_EQUAL_UINT32(1, stats.node2_frames);
    TEST_ASSERT_EQUAL_MEMORY(&env, stats.last_payload[0], sizeof(env));
    TEST_ASSERT_EQUAL_MEMORY(&node1, stats.last_payload[1], sizeof(node1));
    TEST_ASSERT_EQUAL_MEMORY(&node2, stats.last_payload[2], sizeof(node2));
    odk_espnow_validator_delete(validator);
}

void test_espnow_rejects_short_old_and_unknown(void)
{
    fake_espnow_custom_data_t fake;
    odk_espnow_validator_t *validator = make_validator(&fake);
    uint8_t short_frame[3] = {ODK_ESPNOW_PROTOCOL_VERSION, ODK_ESPNOW_TYPE_ENV, 0};
    odk_espnow_fleet_message_t old = valid_frame(ODK_ESPNOW_TYPE_ENV, 0);
    odk_espnow_fleet_message_t unknown = valid_frame(99, 0);
    old.version = ODK_ESPNOW_PROTOCOL_VERSION - 1;
    TEST_ASSERT_TRUE(odk_espnow_validator_enqueue(validator, MAC_A, short_frame, sizeof(short_frame)));
    TEST_ASSERT_TRUE(odk_espnow_validator_enqueue(validator, MAC_A, (uint8_t *)&old, sizeof(old)));
    TEST_ASSERT_TRUE(odk_espnow_validator_enqueue(validator, MAC_A, (uint8_t *)&unknown, sizeof(unknown)));
    odk_espnow_validator_process_one(validator, NULL);
    odk_espnow_validator_process_one(validator, NULL);
    odk_espnow_validator_process_one(validator, NULL);
    odk_espnow_stats_t stats;
    odk_espnow_validator_get_stats(validator, &stats);
    TEST_ASSERT_EQUAL_UINT32(2, stats.malformed);
    TEST_ASSERT_EQUAL_UINT32(1, stats.unknown_types);
    TEST_ASSERT_EQUAL_UINT32(0, stats.frames);
    odk_espnow_validator_delete(validator);
}

void test_espnow_control_and_queue_overflow(void)
{
    fake_espnow_custom_data_t fake;
    odk_espnow_validator_t *validator = make_validator(&fake);
    TEST_ASSERT_EQUAL_INT(ODK_OK, odk_espnow_validator_send_control(
        validator, ODK_C6_CONTROL_SET_CHANNEL, 6, 0));
    TEST_ASSERT_EQUAL_INT(ODK_C6_MSG_ID_ESPNOW_CONTROL, fake.last_msg_id);
    TEST_ASSERT_EQUAL_UINT(6, ((odk_c6_control_t *)fake.last_data)->channel);
    TEST_ASSERT_EQUAL_INT(ODK_ERR_INVALID_ARG, odk_espnow_validator_send_control(
        validator, ODK_C6_CONTROL_SET_CHANNEL, 0, 0));
    odk_espnow_fleet_message_t frame = valid_frame(ODK_ESPNOW_TYPE_ENV, 0);
    unsigned accepted = 0;
    for (unsigned i = 0; i < ODK_ESPNOW_VALIDATOR_QUEUE_CAPACITY + 2; ++i) {
        accepted += odk_espnow_validator_enqueue(validator, MAC_A, (uint8_t *)&frame, sizeof(frame));
    }
    odk_espnow_stats_t stats;
    odk_espnow_validator_get_stats(validator, &stats);
    TEST_ASSERT_EQUAL_UINT(ODK_ESPNOW_VALIDATOR_QUEUE_CAPACITY - 1, accepted);
    TEST_ASSERT_EQUAL_UINT32(3, stats.dropped);
    odk_espnow_validator_delete(validator);
}

void test_espnow_rx_event_carries_src_mac(void)
{
    fake_espnow_custom_data_t fake;
    odk_espnow_validator_t *validator = make_validator(&fake);
    odk_espnow_fleet_message_t frame = valid_frame(ODK_ESPNOW_TYPE_STATUS, 1);

    TEST_ASSERT_TRUE(odk_espnow_validator_enqueue(validator, MAC_B, (uint8_t *)&frame, sizeof(frame)));
    odk_espnow_frame_event_t event;
    TEST_ASSERT_TRUE(odk_espnow_validator_process_one(validator, &event));
    TEST_ASSERT_EQUAL_UINT8_ARRAY(MAC_B, event.src_mac, ODK_ESPNOW_MAC_LEN);
    TEST_ASSERT_EQUAL_UINT8(ODK_ESPNOW_TYPE_STATUS, event.message.type);
    odk_espnow_validator_delete(validator);
}

void test_espnow_send_builds_tx_frame(void)
{
    fake_espnow_custom_data_t fake;
    odk_espnow_validator_t *validator = make_validator(&fake);
    const char payload[] = "{\"v\":1,\"type\":\"navigate\"}";

    TEST_ASSERT_EQUAL_INT(ODK_OK, odk_espnow_validator_send(
        validator, MAC_A, (const uint8_t *)payload, sizeof(payload) - 1));
    TEST_ASSERT_EQUAL_UINT32(ODK_C6_MSG_ID_ESPNOW_TX, fake.last_msg_id);
    TEST_ASSERT_EQUAL_UINT(ODK_ESPNOW_MAC_LEN + sizeof(payload) - 1, fake.last_len);
    TEST_ASSERT_EQUAL_UINT8_ARRAY(MAC_A, fake.last_data, ODK_ESPNOW_MAC_LEN);
    TEST_ASSERT_EQUAL_MEMORY(payload, fake.last_data + ODK_ESPNOW_MAC_LEN, sizeof(payload) - 1);
    odk_espnow_validator_delete(validator);
}

void test_espnow_send_rejects_bad_args(void)
{
    fake_espnow_custom_data_t fake;
    odk_espnow_validator_t *validator = make_validator(&fake);
    uint8_t oversized[ODK_ESPNOW_MAX_PAYLOAD + 1] = {0};

    TEST_ASSERT_EQUAL_INT(ODK_ERR_INVALID_ARG,
                          odk_espnow_validator_send(validator, MAC_A, oversized, 0));
    TEST_ASSERT_EQUAL_INT(ODK_ERR_INVALID_ARG,
                          odk_espnow_validator_send(validator, MAC_A, oversized, sizeof(oversized)));
    TEST_ASSERT_EQUAL_INT(ODK_ERR_INVALID_ARG,
                          odk_espnow_validator_send(validator, NULL, oversized, 1));
    TEST_ASSERT_EQUAL_INT(0, fake.send_calls);
    odk_espnow_validator_delete(validator);
}

void test_espnow_tx_results_counted(void)
{
    fake_espnow_custom_data_t fake;
    odk_espnow_validator_t *validator = make_validator(&fake);

    odk_espnow_validator_note_tx_result(validator, MAC_A, ODK_ESPNOW_TX_STATUS_OK);
    odk_espnow_validator_note_tx_result(validator, MAC_A, ODK_ESPNOW_TX_STATUS_OK);
    odk_espnow_validator_note_tx_result(validator, MAC_B, 1);

    odk_espnow_stats_t stats;
    odk_espnow_validator_get_stats(validator, &stats);
    TEST_ASSERT_EQUAL_UINT32(2, stats.tx_ok);
    TEST_ASSERT_EQUAL_UINT32(1, stats.tx_failed);
    odk_espnow_validator_delete(validator);
}

void test_espnow_peer_add_and_del_frames(void)
{
    fake_espnow_custom_data_t fake;
    odk_espnow_validator_t *validator = make_validator(&fake);
    const uint8_t lmk[ODK_ESPNOW_LMK_LEN] = {1, 2, 3, 4, 5, 6, 7, 8,
                                              9, 10, 11, 12, 13, 14, 15, 16};

    TEST_ASSERT_EQUAL_INT(ODK_OK, odk_espnow_validator_add_peer(validator, MAC_A, lmk, true));
    TEST_ASSERT_EQUAL_UINT32(ODK_C6_MSG_ID_ESPNOW_PEER, fake.last_msg_id);
    TEST_ASSERT_EQUAL_UINT(sizeof(odk_c6_peer_frame_t), fake.last_len);
    const odk_c6_peer_frame_t *peer = (const odk_c6_peer_frame_t *)fake.last_data;
    TEST_ASSERT_EQUAL_UINT8(ODK_C6_PEER_OP_ADD, peer->op);
    TEST_ASSERT_EQUAL_UINT8_ARRAY(MAC_A, peer->mac, ODK_ESPNOW_MAC_LEN);
    TEST_ASSERT_TRUE(peer->flags & ODK_C6_PEER_FLAG_ENCRYPT);
    TEST_ASSERT_EQUAL_UINT8_ARRAY(lmk, peer->lmk, ODK_ESPNOW_LMK_LEN);

    TEST_ASSERT_EQUAL_INT(ODK_OK, odk_espnow_validator_del_peer(validator, MAC_A));
    const odk_c6_peer_frame_t *del = (const odk_c6_peer_frame_t *)fake.last_data;
    TEST_ASSERT_EQUAL_UINT8(ODK_C6_PEER_OP_DEL, del->op);
    TEST_ASSERT_EQUAL_UINT8_ARRAY(MAC_A, del->mac, ODK_ESPNOW_MAC_LEN);

    TEST_ASSERT_EQUAL_INT(ODK_ERR_INVALID_ARG,
                          odk_espnow_validator_add_peer(validator, MAC_A, NULL, true));
    odk_espnow_validator_delete(validator);
}

int main(void)
{
    UNITY_BEGIN();
    RUN_TEST(test_espnow_env_and_two_status_nodes);
    RUN_TEST(test_espnow_rejects_short_old_and_unknown);
    RUN_TEST(test_espnow_control_and_queue_overflow);
    RUN_TEST(test_espnow_rx_event_carries_src_mac);
    RUN_TEST(test_espnow_send_builds_tx_frame);
    RUN_TEST(test_espnow_send_rejects_bad_args);
    RUN_TEST(test_espnow_tx_results_counted);
    RUN_TEST(test_espnow_peer_add_and_del_frames);
    return UNITY_END();
}
