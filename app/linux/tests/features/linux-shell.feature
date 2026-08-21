Feature: Open DeskOS Linux 外壳(CM5 Electron 切片)

  CM5(RK3588S)上的 Electron 外壳,目标面板分辨率 568×1232 竖屏触摸。
  本切片只覆盖外壳骨架:状态栏、分页主屏、App 进入/返回。

  Scenario: 以 568×1232 窗口启动并可通过环境变量覆盖
    Given 未设置任何 ODESK_SHELL_ 环境变量
    When 以 smoke 模式启动外壳
    Then 窗口内容尺寸为 568×1232 且进程以 0 退出

  Scenario: 环境变量覆盖分辨率
    Given 设置 ODESK_SHELL_WIDTH=480 与 ODESK_SHELL_HEIGHT=854
    When 以 smoke 模式启动外壳
    Then 窗口内容尺寸为 480×854 且进程以 0 退出

  Scenario: 状态栏显示当前时间与日期
    Given 外壳已启动
    When 渲染完成
    Then 状态栏包含 HH:MM 格式的当前时间
    And 状态栏包含 M/D 格式的当前日期

  Scenario: 横向滑动切换页面并同步页点
    Given 主屏有至少两个页面
    When 在页面上向左滑动超过阈值
    Then 页面容器平移到下一页且第二个页点变为激活态

  Scenario: 点按磁贴进入 App 全屏视图且返回可用
    Given 主屏存在可点按的 App 磁贴
    When 点按任一磁贴
    Then 进入该 App 的全屏视图且返回按钮可见
    When 点按返回按钮
    Then 回到主屏且原页面保持当前页
