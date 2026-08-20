Feature: 一条 prompt 生成 canonical Lua App 并经安装管线持久化(Open DeskOS-OS §6.2/§6.3)

  Scenario: 一条 prompt 从内置模板生成合法 staged 包
    Given 内置 app 模板与 prompt "做一个每次 tick 打印北京时间的应用"
    And 注入的 LLM 返回符合 slot schema 的 JSON
    When 调用 gen_create_app
    Then staging 下产出 manifest.json 与 app/main.lua
    And manifest 的 app_id 合规且 version 为 "0.1.0"
    And manifest.entry 为 "app/main.lua" 且 kind 为 "ui"
    And app/main.lua 返回包含 on_start(ctx) 的 App 模块
    And 生成的 Lua 通过 mode="t" 编译检查

  Scenario: LLM 输出不符合 slot schema 时整体拒绝
    Given 注入的 LLM 返回含未知键 "extra_files" 的 JSON
    When 调用 gen_create_app
    Then 返回模板违规错误
    And staging 下没有任何残留目录

  Scenario: 生成的 Lua 无法以文本模式编译时拒绝产包
    Given 注入的 LLM 在 tick 逻辑 slot 中返回语法错误的 Lua 片段
    When 调用 gen_create_app
    Then 返回沙盒编译检查错误
    And staging 下没有任何残留目录

  Scenario: 生成物经安装管线且 consent 拒绝时零持久化(§6.2 约束 1)
    Given gen_create_app 已产出合法 staged 包
    And consent 端口返回拒绝
    When 调用 installer_install_staged(staged_dir, GENERATED)
    Then 安装被中止且返回拒绝错误
    And 正式包目录与已装索引均无该包
    And staging 被清理

  Scenario: 配额耗尽时生成在调用 LLM 前被拒绝(§6.2 约束 3)
    Given 日配额已耗尽
    When 调用 gen_create_app
    Then 返回配额耗尽错误
    And 注入的 HTTP 端口未被调用
    And staging 下没有任何残留目录

  Scenario: 生成安装的包 provenance 记录 origin generated
    Given gen_create_app 产出合法 staged 包且 consent 同意
    When 安装完成
    Then "<app_root>/<app_id>/.install/provenance.json" 的 origin 为 "generated"
    And 已装索引含该包
