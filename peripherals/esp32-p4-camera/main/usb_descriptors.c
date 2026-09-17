/*
 * SPDX-FileCopyrightText: 2026 Open DeskOS
 * SPDX-License-Identifier: Apache-2.0
 *
 * App-owned TinyUSB composite descriptors: one UVC MJPEG camera function
 * plus one UAC microphone function on a single high-speed device. The video
 * layout mirrors TinyUSB's video_capture reference; the audio layout keeps
 * the existing ES8311 microphone function unchanged.
 */

#include "p4_usb_microphone.h"

#include <string.h>

#include "tusb.h"
#include "uac_descriptors.h"
#include "p4_uvc_stream.h"

#define USB_VID 0x303A
#define USB_PID 0x7002
#define USB_BCD_DEVICE 0x0200

#define EPNUM_VIDEO_IN 0x81
#define EPNUM_AUDIO_IN 0x83

enum {
    ITF_NUM_VIDEO_CONTROL = 0,
    ITF_NUM_VIDEO_STREAMING,
    ITF_NUM_AUDIO_CONTROL,
    ITF_NUM_AUDIO_STREAMING_MIC,
    ITF_NUM_TOTAL,
};

#define P4_UVC_CLOCK_FREQUENCY 27000000
#define P4_UVC_INTERVAL_30FPS (10000000 / P4_UVC_FPS)
#define P4_UVC_MAX_FRAME_BYTES (P4_UVC_WIDTH * P4_UVC_HEIGHT)

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

typedef struct TU_ATTR_PACKED {
    tusb_desc_interface_t itf;
    tusb_desc_video_control_header_1itf_t header;
    tusb_desc_video_control_camera_terminal_t camera_terminal;
    tusb_desc_video_control_output_terminal_t output_terminal;
} p4_uvc_control_desc_t;

typedef struct TU_ATTR_PACKED {
    tusb_desc_interface_t itf;
    tusb_desc_video_streaming_input_header_1byte_t header;
    tusb_desc_video_format_mjpeg_t format;
    tusb_desc_video_frame_mjpeg_continuous_t frame;
    tusb_desc_video_streaming_color_matching_t color;
    tusb_desc_interface_t itf_alt;
    tusb_desc_endpoint_t ep;
} p4_uvc_streaming_desc_t;

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

static const char *s_strings[] = {
    (const char[]){0x09, 0x04},
    "Open DeskOS",
    "P4 Camera and Microphone",
    "P4CAMMIC001",
    "UVC Control",
    "UVC Streaming",
    "Microphone control",
    "Microphone",
};

enum {
    STRID_UVC_CONTROL = 4,
    STRID_UVC_STREAMING = 5,
    STRID_MIC_CONTROL = 6,
    STRID_MIC_STREAMING = 7,
};

static const uint8_t s_audio_part[] = {
    P4_AUDIO_MIC_DESCRIPTOR(ITF_NUM_AUDIO_CONTROL, STRID_MIC_CONTROL, EPNUM_AUDIO_IN),
};

#define P4_CONFIG_BUFSIZE 1024
static uint8_t s_fs_configuration[P4_CONFIG_BUFSIZE];
static uint8_t s_hs_configuration[P4_CONFIG_BUFSIZE];
static uint16_t s_fs_config_len;
static uint16_t s_hs_config_len;
static bool s_configs_built;

static uint16_t build_uvc_control(uint8_t *dst)
{
    p4_uvc_control_desc_t vc = {
        .itf = {
            .bLength = sizeof(tusb_desc_interface_t),
            .bDescriptorType = TUSB_DESC_INTERFACE,
            .bInterfaceNumber = ITF_NUM_VIDEO_CONTROL,
            .bAlternateSetting = 0,
            .bNumEndpoints = 0,
            .bInterfaceClass = TUSB_CLASS_VIDEO,
            .bInterfaceSubClass = VIDEO_SUBCLASS_CONTROL,
            .bInterfaceProtocol = VIDEO_ITF_PROTOCOL_15,
            .iInterface = STRID_UVC_CONTROL,
        },
        .header = {
            .bLength = sizeof(tusb_desc_video_control_header_1itf_t),
            .bDescriptorType = TUSB_DESC_CS_INTERFACE,
            .bDescriptorSubType = VIDEO_CS_ITF_VC_HEADER,
            .bcdUVC = VIDEO_BCD_1_50,
            .wTotalLength = sizeof(p4_uvc_control_desc_t) - sizeof(tusb_desc_interface_t),
            .dwClockFrequency = P4_UVC_CLOCK_FREQUENCY,
            .bInCollection = 1,
            .baInterfaceNr = { ITF_NUM_VIDEO_STREAMING },
        },
        .camera_terminal = {
            .bLength = sizeof(tusb_desc_video_control_camera_terminal_t),
            .bDescriptorType = TUSB_DESC_CS_INTERFACE,
            .bDescriptorSubType = VIDEO_CS_ITF_VC_INPUT_TERMINAL,
            .bTerminalID = 1,
            .wTerminalType = VIDEO_ITT_CAMERA,
            .bAssocTerminal = 0,
            .iTerminal = 0,
            .wObjectiveFocalLengthMin = 0,
            .wObjectiveFocalLengthMax = 0,
            .wOcularFocalLength = 0,
            .bControlSize = 3,
            .bmControls = { 0, 0, 0 },
        },
        .output_terminal = {
            .bLength = sizeof(tusb_desc_video_control_output_terminal_t),
            .bDescriptorType = TUSB_DESC_CS_INTERFACE,
            .bDescriptorSubType = VIDEO_CS_ITF_VC_OUTPUT_TERMINAL,
            .bTerminalID = 2,
            .wTerminalType = VIDEO_TT_STREAMING,
            .bAssocTerminal = 0,
            .bSourceID = 1,
            .iTerminal = 0,
        },
    };
    memcpy(dst, &vc, sizeof(vc));
    return sizeof(vc);
}

static uint16_t build_uvc_streaming(uint8_t *dst, uint16_t ep_max_packet)
{
    p4_uvc_streaming_desc_t vs = {
        .itf = {
            .bLength = sizeof(tusb_desc_interface_t),
            .bDescriptorType = TUSB_DESC_INTERFACE,
            .bInterfaceNumber = ITF_NUM_VIDEO_STREAMING,
            .bAlternateSetting = 0,
            .bNumEndpoints = 0,
            .bInterfaceClass = TUSB_CLASS_VIDEO,
            .bInterfaceSubClass = VIDEO_SUBCLASS_STREAMING,
            .bInterfaceProtocol = VIDEO_ITF_PROTOCOL_15,
            .iInterface = STRID_UVC_STREAMING,
        },
        .header = {
            .bLength = sizeof(tusb_desc_video_streaming_input_header_1byte_t),
            .bDescriptorType = TUSB_DESC_CS_INTERFACE,
            .bDescriptorSubType = VIDEO_CS_ITF_VS_INPUT_HEADER,
            .bNumFormats = 1,
            .wTotalLength = sizeof(p4_uvc_streaming_desc_t)
                - sizeof(tusb_desc_interface_t) - sizeof(tusb_desc_endpoint_t)
                - sizeof(tusb_desc_interface_t),
            .bEndpointAddress = EPNUM_VIDEO_IN,
            .bmInfo = 0,
            .bTerminalLink = 2,
            .bStillCaptureMethod = 0,
            .bTriggerSupport = 0,
            .bTriggerUsage = 0,
            .bControlSize = 1,
            .bmaControls = { 0 },
        },
        .format = {
            .bLength = sizeof(tusb_desc_video_format_mjpeg_t),
            .bDescriptorType = TUSB_DESC_CS_INTERFACE,
            .bDescriptorSubType = VIDEO_CS_ITF_VS_FORMAT_MJPEG,
            .bFormatIndex = 1,
            .bNumFrameDescriptors = 1,
            .bmFlags = 0,
            .bDefaultFrameIndex = 1,
            .bAspectRatioX = 0,
            .bAspectRatioY = 0,
            .bmInterlaceFlags = 0,
            .bCopyProtect = 0,
        },
        .frame = {
            .bLength = sizeof(tusb_desc_video_frame_mjpeg_continuous_t),
            .bDescriptorType = TUSB_DESC_CS_INTERFACE,
            .bDescriptorSubType = VIDEO_CS_ITF_VS_FRAME_MJPEG,
            .bFrameIndex = 1,
            .bmCapabilities = 0,
            .wWidth = P4_UVC_WIDTH,
            .wHeight = P4_UVC_HEIGHT,
            .dwMinBitRate = P4_UVC_WIDTH * P4_UVC_HEIGHT * 16,
            .dwMaxBitRate = P4_UVC_WIDTH * P4_UVC_HEIGHT * 16 * P4_UVC_FPS,
            .dwMaxVideoFrameBufferSize = P4_UVC_MAX_FRAME_BYTES,
            .dwDefaultFrameInterval = P4_UVC_INTERVAL_30FPS,
            .bFrameIntervalType = 0,
            .dwFrameInterval = { P4_UVC_INTERVAL_30FPS, 10000000, P4_UVC_INTERVAL_30FPS },
        },
        .color = {
            .bLength = sizeof(tusb_desc_video_streaming_color_matching_t),
            .bDescriptorType = TUSB_DESC_CS_INTERFACE,
            .bDescriptorSubType = VIDEO_CS_ITF_VS_COLORFORMAT,
            .bColorPrimaries = VIDEO_COLOR_PRIMARIES_BT709,
            .bTransferCharacteristics = VIDEO_COLOR_XFER_CH_BT709,
            .bMatrixCoefficients = VIDEO_COLOR_COEF_SMPTE170M,
        },
        .itf_alt = {
            .bLength = sizeof(tusb_desc_interface_t),
            .bDescriptorType = TUSB_DESC_INTERFACE,
            .bInterfaceNumber = ITF_NUM_VIDEO_STREAMING,
            .bAlternateSetting = 1,
            .bNumEndpoints = 1,
            .bInterfaceClass = TUSB_CLASS_VIDEO,
            .bInterfaceSubClass = VIDEO_SUBCLASS_STREAMING,
            .bInterfaceProtocol = VIDEO_ITF_PROTOCOL_15,
            .iInterface = STRID_UVC_STREAMING,
        },
        .ep = {
            .bLength = sizeof(tusb_desc_endpoint_t),
            .bDescriptorType = TUSB_DESC_ENDPOINT,
            .bEndpointAddress = EPNUM_VIDEO_IN,
            .bmAttributes = { .xfer = TUSB_XFER_ISOCHRONOUS, .sync = 1 },
            .wMaxPacketSize = ep_max_packet,
            .bInterval = 1,
        },
    };
    memcpy(dst, &vs, sizeof(vs));
    return sizeof(vs);
}

static uint16_t build_configuration(uint8_t *dst, uint16_t ep_max_packet)
{
    tusb_desc_configuration_t config = {
        .bLength = sizeof(tusb_desc_configuration_t),
        .bDescriptorType = TUSB_DESC_CONFIGURATION,
        .wTotalLength = 0,
        .bNumInterfaces = ITF_NUM_TOTAL,
        .bConfigurationValue = 1,
        .iConfiguration = 0,
        .bmAttributes = TU_BIT(7),
        .bMaxPower = 100 / 2,
    };
    tusb_desc_interface_assoc_t video_iad = {
        .bLength = sizeof(tusb_desc_interface_assoc_t),
        .bDescriptorType = TUSB_DESC_INTERFACE_ASSOCIATION,
        .bFirstInterface = ITF_NUM_VIDEO_CONTROL,
        .bInterfaceCount = 2,
        .bFunctionClass = TUSB_CLASS_VIDEO,
        .bFunctionSubClass = VIDEO_SUBCLASS_INTERFACE_COLLECTION,
        .bFunctionProtocol = VIDEO_ITF_PROTOCOL_UNDEFINED,
        .iFunction = 0,
    };
    uint16_t offset = 0;
    memcpy(dst + offset, &config, sizeof(config));
    offset += sizeof(config);
    memcpy(dst + offset, &video_iad, sizeof(video_iad));
    offset += sizeof(video_iad);
    offset += build_uvc_control(dst + offset);
    offset += build_uvc_streaming(dst + offset, ep_max_packet);
    memcpy(dst + offset, s_audio_part, sizeof(s_audio_part));
    offset += sizeof(s_audio_part);

    tusb_desc_configuration_t *header = (tusb_desc_configuration_t *)dst;
    header->wTotalLength = offset;
    return offset;
}

static void build_configurations(void)
{
    if (s_configs_built) {
        return;
    }
    s_fs_config_len = build_configuration(s_fs_configuration, 512);
    s_hs_config_len = build_configuration(s_hs_configuration, 1024);
    s_configs_built = true;
}

const tinyusb_desc_config_t *p4_usb_composite_descriptors(void)
{
    build_configurations();
    static tinyusb_desc_config_t descriptors;
    descriptors.device = &s_device_descriptor;
    descriptors.qualifier = &s_device_qualifier;
    descriptors.string = s_strings;
    descriptors.string_count = sizeof(s_strings) / sizeof(s_strings[0]);
    descriptors.full_speed_config = s_fs_configuration;
    descriptors.high_speed_config = s_hs_configuration;
    return &descriptors;
}

uint16_t p4_usb_full_speed_config_len(void)
{
    build_configurations();
    return s_fs_config_len;
}

uint16_t p4_usb_high_speed_config_len(void)
{
    build_configurations();
    return s_hs_config_len;
}
