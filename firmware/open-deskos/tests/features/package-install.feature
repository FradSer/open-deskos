Feature: 内容包原子安装与持久化(本切片:本地 staged 源;商店下载属 NT-8 不在内)

  Scenario: staged 包全链校验通过后原子安装并写 provenance
    Given ".staging/gen_weather_01/" 含合法 manifest.json 与 2 个文件
    And 每个文件的实际 SHA-256 与 manifest 声明一致
    And consent 端口返回同意
    When 安装器执行 installer_install_staged(origin=GENERATED)
    Then ".staging/gen_weather_01/" 被 rename() 到 "<pkg_root>/gen_weather_01/"
    And "<pkg_root>/gen_weather_01/.install/provenance.json" 记录 origin "generated"
    And 已装索引文件新增 "gen_weather_01" 条目
    And 期间不存在"部分文件已在正式目录"的中间态

  Scenario: 校验失败清理暂存且不触碰既有安装
    Given "<pkg_root>/gen_weather_01/" 已装 1.0.0 版本
    And ".staging/gen_weather_01/" 中一个文件的 SHA-256 与 manifest 不符
    When 安装器执行 installer_install_staged
    Then 返回 checksum 不匹配错误
    And ".staging/gen_weather_01/" 被整体删除
    And 既有 "<pkg_root>/gen_weather_01/" 逐字节未变

  Scenario: Insufficient SD space rejects the download before it starts
    Given the manifest for "openai_voice_client_01" declares files totaling 2458112 bytes
    And the SD card reports 900000 bytes free
    When the user selects "openai_voice_client_01" for install
    Then no download connection is opened
    And the screen shows an "insufficient storage" notice
    And "/sdcard/packages/openai_voice_client_01/" is not created

  Scenario: Install prompts the user to grant declared capabilities
    Given the manifest for "openai_voice_client_01" declares capabilities ["audio_capture", "network:api.openai.com", "hid:text_inject", "storage:own"]
    When the user selects "openai_voice_client_01" for install
    Then the screen shows "This package requests: microphone, access to api.openai.com, text injection, private storage"
    And the install does not proceed until the user confirms

  Scenario: User declines capabilities and the install is aborted
    Given the manifest for "openai_voice_client_01" declares capabilities ["audio_capture"]
    When the user is shown the capability prompt and selects "Deny"
    Then no download is started
    And "/sdcard/packages/openai_voice_client_01/" is not created

  Scenario: Package with an unsatisfiable dependency is rejected before download
    Given the manifest for "fancy_widget_02" declares a dependency on "lua_gui_lib" with constraint ">=2.0.0"
    And "lua_gui_lib" is not installed and not in the catalog
    When the user selects "fancy_widget_02" for install
    Then no download connection is opened
    And the screen shows "missing dependency: lua_gui_lib >=2.0.0"

  Scenario: Package already installed offers re-download, not silent overwrite
    Given "/sdcard/packages/openai_voice_client_01/manifest.json" already declares version "1.0.0"
    And the catalog lists "openai_voice_client_01" at version "1.0.0"
    When the user selects "openai_voice_client_01" for install
    Then the screen shows "already installed" instead of starting a download
    And the user is offered a "re-download" action

  Scenario: esp_https_ota is never invoked for package download
    When any package install flow runs
    Then the OTA partitions are never written
    And no call to esp_https_ota or app_update APIs occurs in the installer or package management layers
