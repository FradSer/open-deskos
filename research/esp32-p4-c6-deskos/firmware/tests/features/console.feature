Feature: 控制台命令面调度(组合根的宿主机可测切片)

  Scenario: gen 命令串起生成与安装并回显成本
    Given 注入的 gen 与 installer fakes 均返回成功
    When 执行 odk_console_exec 处理 gen "做一个每次 tick 打印北京时间的应用"
    Then gen_create_app 先于 installer_install_staged 被调用
    And installer 收到的 origin 为 GENERATED
    And 输出含 app_id、今日 token 用量与剩余配额

  Scenario: gen 失败时不触达安装器
    Given 注入的 gen fake 返回配额耗尽错误
    When 执行 gen 子命令
    Then 输出含配额耗尽提示
    And installer fake 未被调用

  Scenario: apps 列出已安装 App 与来源
    Given installer fake 报告 2 个已安装 App(origin 分别为 generated 与 sideload)
    When 执行 apps 子命令
    Then 输出逐行含 app_id、version、kind 与 origin

  Scenario: open 与 close 路由到 canonical App Manager
    Given "gen_clock_01" 已注册
    When 依次执行 open gen_clock_01 与 close gen_clock_01
    Then App Manager 的 start 与 stop 依次被调用且参数为 "gen_clock_01"

  Scenario: uninstall 路由到 installer_remove
    When 执行 uninstall gen_clock_01
    Then installer_remove 被调用且参数为 "gen_clock_01"

  Scenario: 未知子命令输出用法且不触任何端口
    When 执行未知子命令 "frobnicate"
    Then 输出含用法说明
    And 所有注入 fakes 均未被调用
