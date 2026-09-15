/*
 * SPDX-FileCopyrightText: 2026 Open DeskOS
 * SPDX-License-Identifier: Apache-2.0
 */

#include "p4_usb_microphone.h"

#include "tusb.h"
#include "uac_descriptors.h"

#define USB_VID 0x303A
#define USB_PID 0x7002
#define USB_BCD_DEVICE 0x0200

#define EPNUM_CDC_NOTIF 0x81
#define EPNUM_CDC_OUT 0x02
#define EPNUM_CDC_IN 0x82
#define EPNUM_AUDIO_IN 0x83

enum {
    ITF_NUM_CDC = 0,
    ITF_NUM_CDC_DATA,
    ITF_NUM_AUDIO_CONTROL,
    ITF_NUM_AUDIO_STREAMING_MIC,
    ITF_NUM_TOTAL,
};

#define CONFIG_TOTAL_LEN (TUD_CONFIG_DESC_LEN + TUD_CDC_DESC_LEN + TUD_AUDIO_DEVICE_DESC_LEN)
#define P4_AUDIO_CTRL_NONE U32_TO_U8S_LE(AUDIO_CTRL_NONE)
#define P4_AUDIO_MIC_DESCRIPTOR(_itfnum, _stridx, _epin) \
    TUD_AUDIO_DESC_IAD(_itfnum, 2, 0), \
    TUD_AUDIO_DESC_STD_AC(_itfnum, 0, _stridx), \
    TUD_AUDIO_DESC_CS_AC(0x0200, AUDIO_FUNC_MICROPHONE, TUD_AUDIO_DESC_CS_AC_TOTAL_LEN, AUDIO_CS_AS_INTERFACE_CTRL_LATENCY_POS), \
    TUD_AUDIO_DESC_CLK_SRC(UAC2_ENTITY_CLOCK, 1, 1, UAC2_ENTITY_MIC_INPUT_TERMINAL, 0), \
    TUD_AUDIO_DESC_INPUT_TERM(UAC2_ENTITY_MIC_INPUT_TERMINAL, AUDIO_TERM_TYPE_IN_GENERIC_MIC, UAC2_ENTITY_MIC_OUTPUT_TERMINAL, \
                              UAC2_ENTITY_CLOCK, MIC_CHANNEL_NUM, AUDIO_CHANNEL_CONFIG_FRONT_CENTER, 0, \
                              AUDIO_CTRL_R << AUDIO_IN_TERM_CTRL_CONNECTOR_POS, 0), \
    TUD_AUDIO_DESC_OUTPUT_TERM(UAC2_ENTITY_MIC_OUTPUT_TERMINAL, AUDIO_TERM_TYPE_USB_STREAMING, UAC2_ENTITY_MIC_INPUT_TERMINAL, \
                               UAC2_ENTITY_MIC_FEATURE_TERMINAL, UAC2_ENTITY_CLOCK, 0, 0), \
    TUD_AUDIO_DESC_FEATURE_UNIT_N_CHANNEL(TUD_AUDIO_DESC_MIC_FEATURE_UNIT_N_CHANNEL_LEN, UAC2_ENTITY_MIC_FEATURE_TERMINAL, \
                                          UAC2_ENTITY_MIC_INPUT_TERMINAL, 0, P4_AUDIO_CTRL_NONE, P4_AUDIO_CTRL_NONE), \
    TUD_AUDIO_DESC_STD_AS_INT((_itfnum) + 1, 0, 0, (_stridx) + 1), \
    TUD_AUDIO_DESC_STD_AS_INT((_itfnum) + 1, 1, 1, (_stridx) + 1), \
    TUD_AUDIO_DESC_CS_AS_INT(UAC2_ENTITY_MIC_OUTPUT_TERMINAL, AUDIO_CTRL_NONE, AUDIO_FORMAT_TYPE_I, \
                             AUDIO_DATA_FORMAT_TYPE_I_PCM, MIC_CHANNEL_NUM, AUDIO_CHANNEL_CONFIG_FRONT_CENTER, 0), \
    TUD_AUDIO_DESC_TYPE_I_FORMAT(CFG_TUD_AUDIO_FUNC_1_FORMAT_1_N_BYTES_PER_SAMPLE_TX, \
                                 CFG_TUD_AUDIO_FUNC_1_FORMAT_1_RESOLUTION_TX), \
    TUD_AUDIO_DESC_STD_AS_ISO_EP(_epin, TUSB_XFER_ISOCHRONOUS | TUSB_ISO_EP_ATT_ASYNCHRONOUS | TUSB_ISO_EP_ATT_DATA, \
                                 CFG_TUD_AUDIO_FUNC_1_FORMAT_1_EP_SZ_IN, 1), \
    TUD_AUDIO_DESC_CS_AS_ISO_EP(AUDIO_CS_AS_ISO_DATA_EP_ATT_NON_MAX_PACKETS_OK, AUDIO_CTRL_NONE, \
                                AUDIO_CS_AS_ISO_DATA_EP_LOCK_DELAY_UNIT_UNDEFINED, 0)

static const tusb_desc_device_t s_device_descriptor = {
    .bLength = sizeof(tusb_desc_device_t),
    .bDescriptorType = TUSB_DESC_DEVICE,
    .bcdUSB = 0x0200,
    .bDeviceClass = TUSB_CLASS_MISC,
    .bDeviceSubClass = MISC_SUBCLASS_COMMON,
    .bDeviceProtocol = MISC_PROTOCOL_IAD,
    .bMaxPacketSize0 = CFG_TUD_ENDPOINT0_SIZE,
    .idVendor = USB_VID,
    .idProduct = USB_PID,
    .bcdDevice = USB_BCD_DEVICE,
    .iManufacturer = 1,
    .iProduct = 2,
    .iSerialNumber = 3,
    .bNumConfigurations = 1,
};

static const tusb_desc_device_qualifier_t s_device_qualifier = {
    .bLength = sizeof(tusb_desc_device_qualifier_t),
    .bDescriptorType = TUSB_DESC_DEVICE_QUALIFIER,
    .bcdUSB = 0x0200,
    .bDeviceClass = TUSB_CLASS_MISC,
    .bDeviceSubClass = MISC_SUBCLASS_COMMON,
    .bDeviceProtocol = MISC_PROTOCOL_IAD,
    .bMaxPacketSize0 = CFG_TUD_ENDPOINT0_SIZE,
    .bNumConfigurations = 1,
};

static const uint8_t s_full_speed_configuration[] = {
    TUD_CONFIG_DESCRIPTOR(1, ITF_NUM_TOTAL, 0, CONFIG_TOTAL_LEN, 0, 100),
    TUD_CDC_DESCRIPTOR(ITF_NUM_CDC, 4, EPNUM_CDC_NOTIF, 8, EPNUM_CDC_OUT, EPNUM_CDC_IN, 64),
    P4_AUDIO_MIC_DESCRIPTOR(ITF_NUM_AUDIO_CONTROL, 5, EPNUM_AUDIO_IN),
};

static const uint8_t s_high_speed_configuration[] = {
    TUD_CONFIG_DESCRIPTOR(1, ITF_NUM_TOTAL, 0, CONFIG_TOTAL_LEN, 0, 100),
    TUD_CDC_DESCRIPTOR(ITF_NUM_CDC, 4, EPNUM_CDC_NOTIF, 8, EPNUM_CDC_OUT, EPNUM_CDC_IN, 512),
    P4_AUDIO_MIC_DESCRIPTOR(ITF_NUM_AUDIO_CONTROL, 5, EPNUM_AUDIO_IN),
};

static const char *s_strings[] = {
    (const char[]){0x09, 0x04},
    "Open DeskOS",
    "P4 Camera and Microphone",
    "P4CAMMIC001",
    "Camera metadata",
    "Microphone control",
    "Microphone",
};

const tinyusb_desc_config_t *p4_usb_composite_descriptors(void)
{
    static const tinyusb_desc_config_t descriptors = {
        .device = &s_device_descriptor,
        .qualifier = &s_device_qualifier,
        .string = s_strings,
        .string_count = sizeof(s_strings) / sizeof(s_strings[0]),
        .full_speed_config = s_full_speed_configuration,
        .high_speed_config = s_high_speed_configuration,
    };
    return &descriptors;
}
