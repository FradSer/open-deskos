Feature: Open DeskOS Linux 外壳(CM5 Electron 切片)

  CM5(RK3588S)上的 Electron 外壳,目标面板分辨率 568×1232 竖屏触摸。
  交互结构与 ESP32-P4 launcher 对齐:顶部状态栏(左连接指示/中页点/右时钟),
  中部 3×N widget 网格(桌面布局按列行声明),底部内缩 peek 条(当前为空,
  预留灵动岛式扩展)。

  Scenario: 以 568×1232 窗口启动并可通过环境变量覆盖
    Given 未设置任何 ODESK_SHELL_ 环境变量
    When 以 smoke 模式启动外壳
    Then 窗口内容尺寸为 568×1232 且进程以 0 退出

  Scenario: 环境变量覆盖分辨率
    Given 设置 ODESK_SHELL_WIDTH=480 与 ODESK_SHELL_HEIGHT=854
    When 以 smoke 模式启动外壳
    Then 窗口内容尺寸为 480×854 且进程以 0 退出

  Scenario: 三段式布局与状态栏构成对齐 P4
    Given 外壳已启动
    Then 状态栏位于顶部且包含左侧连接指示、居中页点容器与右侧 HH:MM 时钟
    And 主区 widget 网格为 3 列且左右贴合屏幕边缘(无侧向间距)
    And 磁贴按声明跨列跨行(clock 与 year 为 2 列宽,pomodoro 为 2×2)
    And 底部存在左右内缩的 peek 条,当前内容为空

  Scenario: 状态栏显示当前时间与日期
    Given 外壳已启动
    When 渲染完成
    Then 状态栏时钟为 HH:MM 格式的当前时间

  Scenario: 横向滑动切换页面并同步状态栏页点
    Given 主屏有至少两个页面
    When 在页面上向左滑动超过阈值
    Then 页面容器平移到下一页且第二个页点变为激活态

  Scenario: 点按磁贴进入 App 全屏视图且返回可用
    Given 网格页存在可点按的 widget 磁贴
    When 点按任一磁贴
    Then 进入该 App 的全屏视图且返回按钮可见
    When 点按返回按钮
    Then 回到主屏且原页面保持当前页

  Scenario: 窗口尺寸偏离目标比例时网格重算且不裁切
    Given 外壳以 636×1087 启动(宽高比异于 568×1232)
    When 几何重算完成
    Then 所有 widget 磁贴完整落在主区视口内且不与 peek 重叠
