set(ODK_ESPNOW_VALIDATOR_SRCS
    "src/odk_espnow_validator.c"
)

if(ESP_PLATFORM)
    list(APPEND ODK_ESPNOW_VALIDATOR_SRCS
        "src/port_idf/odk_espnow_validator_idf.c"
    )
endif()

if(ESP_PLATFORM)
    idf_component_register(
        SRCS ${ODK_ESPNOW_VALIDATOR_SRCS}
        INCLUDE_DIRS
            "include"
        REQUIRES
            odk_domain
            espressif__esp_hosted
    )
else()
    add_library(odk_espnow_validator STATIC ${ODK_ESPNOW_VALIDATOR_SRCS})
    target_include_directories(odk_espnow_validator PUBLIC "include")
endif()

if(ESP_PLATFORM)
    idf_component_get_property(ESP_HOSTED_COMPONENT espressif__esp_hosted COMPONENT_LIB)
    target_link_libraries(${COMPONENT_LIB} PRIVATE ${ESP_HOSTED_COMPONENT})
endif()
