# Open DeskOS OS 无屏端到端(prompt→app→持久化,M3 切片)。
# 这四条场景是真机 HIL(L3 手动)验收,判据与结果固化在
# tests/target/e2e_prompt_app.md;与宿主机可测的 console.feature(odk_console
# 调度逻辑)互补:console.feature 证明调度正确,本 feature 证明调度接上真实
# 外设/服务后真机端到端可用。Spec:Open DeskOS-OS §6.2/§6.3/§11.2 M3。

Feature: Open DeskOS OS 无屏端到端:一条 prompt 创建 app 并持久化

  Scenario: 固件无屏启动并挂载 packages 分区
    Given open-deskos_p4_headless 固件已烧录
    When 设备上电
    Then 串口 banner 列出 sandbox/installer/runtime/manager/svc_llm/gen 四个平台服务已注册
    And "/packages" 分区挂载成功
    And 无 panic、无 DSI 初始化尝试

  Scenario: 串口一条 prompt 生成并安装 app(真机,手动)
    Given Wi-Fi 已配网且 NVS 已配置 LLM 端点与 key
    When 用户在控制台执行 cerb gen "做一个每次 tick 打印北京时间的应用"
    Then 控制台呈现该包请求的 capabilities 并等待 y/n
    And 用户输入 y 后包被原子安装到 /packages
    And 控制台回显 app_id、token 用量与剩余配额

  Scenario: 重启后已安装 App 仍在并可打开(持久化)
    Given 上一场景的包已安装
    When 设备断电重启后执行 cerb apps
    Then 该 app_id 出现在已装列表且 origin 为 "generated"
    And cerb open <app_id> 后 App Manager 驱动 on_tick(ctx)
    And cerb close <app_id> 后 runtime 被释放且系统无 panic

  Scenario: 配额与失败路径在真机不留残留(真机,手动)
    Given 日配额被临时设为 0
    When 用户执行 cerb gen "任意 prompt"
    Then 控制台提示配额耗尽且未发起网络请求
    And /packages/.staging 下无残留目录
