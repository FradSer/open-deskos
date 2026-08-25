Feature: Open DeskOS Linux 外壳(CM5 Electron 切片)

  CM5(RK3588S)上的 Electron 外壳,目标面板分辨率 568×1232 竖屏触摸。
  交互结构与 ESP32-P4 launcher 对齐:顶部状态栏(左网络指示/中页名与页点/右时钟),
  中部 3×N widget 网格(桌面布局按列行声明),底部内缩 peek 条显示真实连接状态。
  外壳只陈述真实状态:未连接即显示未连接,不伪造任何活动、订阅或健康数据。

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
    Then 状态栏位于顶部且包含左侧网络指示、居中页名/页点容器与右侧 HH:MM 时钟
    And 主区 widget 网格为 3 列 × 5 行且左右贴合屏幕边缘(无侧向间距)
    And 主区内容从状态栏正下方开始排布,网格与卡片顶部对齐而不悬浮居中
    And 磁贴按声明跨列跨行(clock 与 pomodoro 跨 2 列,pomodoro 另跨 2 行,year 跨 2 行铺满最后两行)
    And 3 列 × 5 行网格被磁贴完全铺满,无空洞行列
    And 不存在指向同一 App 的重复磁贴
    And 底部 peek 条显示 Mac 桥接状态与网络状态,而不是空白占位
    And peek 条带尾随箭头提示可点按
    And 番茄钟磁贴使用 Open DeskOS 红色进度环,空闲时呈完整圆环
    And 年度进度磁贴显示实时百分比数值与绿色进度条
    And 年度进度条填充为方头尾边(仅前缘圆角),对齐 P4 meter 规范
    And 设置磁贴静止态使用常规描边,浅色 Focus Ring 仅出现在选中或键盘焦点
    And 图标类磁贴的图标尺寸不小于磁贴单元宽度的 44%,对齐 P4 图标比例
    And "连接 Mac" 主操作在概览与用量两页使用同一白色主按钮样式

  Scenario: 状态栏显示当前时间与日期
    Given 外壳已启动
    When 渲染完成
    Then 状态栏时钟为 HH:MM 格式的当前时间

  Scenario: Dashboard 只陈述真实状态
    Given 外壳已启动
    Then 首页头部为左侧大写英文星期缩写、右侧月日与年份两行右对齐,不使用装饰性色点
    And 叙述流使用中文说明正在等待 Mac 连接,不含会议/任务/习惯计数,也不含步数或睡眠数值
    And 叙述流正文中不出现任何数字
    And 叙述流从头部正下方开始排布,不把内容压到底部留出中段空档
    And Dashboard 底部没有统计行
    And Dashboard 提供唯一的连接 Mac 主操作
    And 连接 Mac 主操作的辅助文字说明连接后会显示真实日程与用量

  Scenario: 首次使用从 Dashboard 可以开始连接
    Given Dashboard 显示 Mac 尚未连接
    When 点按连接 Mac
    Then 打开 Mac companion 的网络连接说明
    And 说明页提供三步连接指引与重新检查状态入口
    When 点按返回按钮
    Then 回到概览页面

  Scenario: Mac companion 进程启动后显示已连接
    Given Mac companion health endpoint 可用
    When 外壳启动并完成 Mac 状态检查
    Then Dashboard 显示 Mac 已连接
    And quota 页面显示 Mac 已连接
    And peek 条显示 Mac 已连接
    And 概览叙述与 peek 主行的"已连接"文字使用 Open DeskOS 绿色状态语态
    When Mac companion health endpoint 不可用并重新检查
    Then Dashboard 显示 Mac 尚未连接
    And 页面显示本次检查时间

  Scenario: 只有 OpenDeskOS companion 身份才算已连接
    Given 本机 2xx 服务返回的不是 OpenDeskOS companion 身份
    When 外壳完成 Mac 状态检查
    Then 所有界面仍显示 Mac 尚未连接

  Scenario: CM5 通过网络访问 Mac companion
    Given macOS companion 在 Mac 的网络地址提供 8788 health endpoint
    And CM5 配置 ODK_COMPANION_HOST 指向 Mac
    When Linux 外壳完成 Mac 状态检查
    Then Dashboard、quota 与 peek 都显示 Mac 已连接
    And 检查请求不依赖 127.0.0.1

  Scenario: 连接状态区分网络与 Mac 桥接
    Given 外壳已启动
    Then 左侧闪电 aria 标签只描述网络在线状态
    And quota 页面明确显示 Mac 尚未连接而不是网络已连接
    And quota 页面提供连接 Mac 主操作
    And peek 条同时显示 Mac 尚未连接与网络状态
    And 网络变化会通过辅助技术状态播报
    And quota 页面提供重新检查状态的入口
    And quota 页面提供操作说明入口
    When 点按操作说明
    Then 全屏视图说明滑动、页点、键盘、Back/Escape 与 peek 状态
    When 点按返回按钮
    Then 回到 quota 页面
    When 点按重新检查状态
    Then 网络与 Mac 尚未连接状态文字重新读取且不伪造已同步
    And 页面显示本次检查时间
    When 触发 offline 事件
    Then 网络指示变灰且状态文字更新为网络未连接
    When 触发 online 事件
    Then 网络指示变亮且状态文字更新为网络已连接

  Scenario: 横向滑动切换页面并同步状态栏页点
    Given 主屏有至少两个页面
    When 在页面上向左滑动超过阈值
    Then 页面容器平移到下一页且第二个页点变为激活态
    When 在磁贴上拖动但位移小于换页阈值
    Then 页面保持原页且不进入 App 全屏视图
    When 拖动被系统中断(pointercancel)
    Then 抑制不会驻留,后续点按照常打开 App

  Scenario: 页点是带名称的按钮并可直接跳转
    Given 主屏有至少两个页面
    Then 当前页名与页数以"名称 · N/3"形式可见
    And 页名与页点位于同一居中行,页名不再压在状态栏顶缘
    And 每个页点都是 button 且携带"第 N 页,名称"形式的 aria 标签
    When 点按第三个页点
    Then 页面容器平移到第三页且第三个页点变为激活态
    And 当前页名更新为"用量 · 3/3"
    When 按下 ArrowLeft
    Then 页面回到"应用 · 2/3"
    When 按下 End
    Then 页面跳到"用量 · 3/3"
    When 按下 Home
    Then 页面回到"概览 · 1/3"

  Scenario: 磁贴明确显示实时、未启动或待接入状态
    Given 外壳已启动
    Then 每个 widget 磁贴都显示可理解的状态文字
    And 番茄钟显示未启动而不是暗示正在运行
    And 时钟磁贴显示可查看而不是待接入
    And 日历磁贴显示实时日期并标注可查看,而不是待接入
    And 磁贴状态文案使用中文或明确的产品专有名词
    And 待接入 App 磁贴显示待接入状态
    And 待接入磁贴的全屏说明提供具体的接入状态而不是只提示返回

  Scenario: 字体与 Open DeskOS 状态文字在 CM5 上确定可用
    Given 外壳已启动
    When 渲染完成
    Then Noto Sans SC 与 Montserrat 字体均已加载
    And 状态文字使用高对比度 Open DeskOS token

  Scenario: Open DeskOS 样式由 UnoCSS CLI 生成
    Given renderer 使用 Open DeskOS 的 utility classes 与设计 token
    When 运行 UnoCSS CLI 样式构建
    Then 生成的样式表存在并由 renderer 加载
    And firmware/linux 内只使用 Open DeskOS 的产品命名

  Scenario: 点按磁贴进入 App 全屏视图且返回可用
    Given 网格页存在可点按的 widget 磁贴
    When 点按任一磁贴
    Then 进入该 App 的全屏视图且返回按钮可见
    And 全屏视图具有 dialog 语义并将焦点移到返回按钮
    And 全屏视图打开时后台页面不可聚焦且对辅助技术隐藏
    And Tab 与 Shift+Tab 焦点循环保持在全屏视图内
    And 正文提示该 App 尚未在此平台实现且包含磁贴名称
    And 正文提供返回桌面的下一步
    When 关闭全屏视图
    Then 焦点回到原磁贴
    When 按下 Escape
    Then 回到主屏且原页面保持当前页

  Scenario: 连接说明页面提供明确恢复路径
    Given quota 页面显示 Mac 桥接未配置
    When 点按网络连接说明
    Then 全屏视图说明通过网络访问 Mac companion
    And 全屏视图列出三步连接与同步指引
    And 全屏视图提供无法同步时的三项排查
    And 全屏视图说明当前 CM5 切片使用配置的 companion endpoint
    And 全屏视图说明当前切片不含 Mac companion 安装器
    When 点按返回按钮
    Then 回到 quota 页面

  Scenario: 窗口尺寸偏离目标比例时网格重算且不裁切
    Given 外壳以 636×1087 启动(宽高比异于 568×1232)
    When 几何重算完成
    Then 所有 widget 磁贴完整落在主区视口内且不与 peek 重叠

  Scenario: 图标统一使用 Tabler 集合
    Given 外壳已启动
    Then 全部 Tabler 图标元素携带 data-tabler 标识且覆盖所需集合(bolt/message/settings/chevron-left)
    And Chatbot 磁贴使用对话气泡图标而非邮件图标

  Scenario: 外壳元素以插件方式组织
    Given 外壳已启动
    Then 页面与磁贴均由 odkPlugins 注册的插件构建,index.html 只是空骨架不含任何页面/磁贴内容
    And 重复注册同一插件 id 或缺失依赖时立即抛错而不是静默降级
    And 页面构成与磁贴摆放全部来自 config/desktop_layout.js 的声明式配置
    And 外壳核心(shell.js 与 core/)不引用任何具体页面或磁贴的专有名词
    When 新增一个插件文件并在配置中声明位置
    Then 无需修改外壳核心即可出现在对应页面

  Scenario: 状态栏与 peek 由内置插件提供
    Given 外壳已启动
    Then 状态栏左槽为连接指示插件、右槽为时钟插件,骨架只留空槽位
    And peek 内容与网络连接说明文案由 peek 插件提供,核心不含其文案
    And quota 页的网络说明入口经服务委托到同一 peek 插件,文案单一来源
    When 新增一个 status 插件并声明槽位
    Then 无需修改核心即可出现在状态栏

  Scenario: 磁贴可声明全屏 App 插件面
    Given clock 磁贴声明了 app 挂载面
    When 点按 clock 磁贴
    Then 全屏视图挂载该 App 的实时内容(大号 HH:MM 与英文日期)而非静态对话框
    When 返回桌面
    Then App 内容被卸载且其 tick 订阅被释放

  Scenario: 日历磁贴声明全屏月历 App 面
    Given almanac 磁贴声明了 app 挂载面
    When 点按 almanac 磁贴
    Then 全屏视图挂载当月真实月历,标题为"YYYY 年 M 月"
    And 月历以周日为首列,表头"日"使用 Open DeskOS 红色强调
    And 今日日期以反白圆形标记,其余日期为常规数字,不伪造任何日程数据
    When 返回桌面
    Then 月历内容被卸载且其 tick 订阅被释放

  Scenario: Wayland 会话自动选择 ozone 后端
    Given WAYLAND_DISPLAY 已设置且用户参数未包含 --ozone-platform-hint
    When 通过 run.sh 启动外壳
    Then Electron 参数被自动追加 --ozone-platform-hint=auto
    Given 用户参数已显式携带 --ozone-platform-hint
    When 通过 run.sh 启动外壳
    Then 不重复追加该参数
    Given WAYLAND_DISPLAY 未设置
    When 通过 run.sh 启动外壳
    Then 启动参数保持原样,不追加任何 ozone 参数

  Scenario: root 会话自动附加 no-sandbox
    Given 以 root 身份运行 run.sh
    When 启动外壳
    Then Electron 参数自动附加 --no-sandbox
    Given 用户参数已显式携带 --no-sandbox
    When 通过 run.sh 启动外壳
    Then 不重复追加该参数

  Scenario: kiosk 自启动经独立包装器运行并在崩溃后自动重启
    Given 安装器已注册 open-deskos-shell.desktop 自启项
    Then Exec 直接指向 scripts/start-kiosk.sh 而不是内联 shell 命令
    And 包装器导出 ODESK_SHELL_KIOSK=1 并以 --kiosk 运行外壳
    When 外壳进程退出(含崩溃)
    Then 包装器在 3 秒后自动重启外壳并把全部输出追加到 launcher.log

  Scenario: 设备安装器支持非 root 执行并锁定依赖版本
    Given 非 root 且具备 sudo 的 CM5 用户执行安装器
    Then apt 依赖安装经由 sudo 提权执行
    And 无 root 且无 sudo 时安装器立即失败并给出明确提示
    When 使用 pnpm 安装 node 模块
    Then 以 --frozen-lockfile 安装,保证与仓库锁文件一致
    And 安装完成时打印 Electron 版本与当前架构

  Scenario: 主进程拒绝导航、弹窗与权限请求
    Given 外壳已加载本地页面
    When 页面尝试导航到任意 URL 或打开新窗口
    Then 主进程阻止该行为
    When 页面请求任何 Web 权限(摄像头/通知等)
    Then 主进程一律拒绝
    When 渲染进程意外退出
    Then 主进程记录原因并以非零码退出,交由 start-kiosk.sh 重启

  Scenario: CM5 验收脚本输出结构化 JSON 报告
    Given 在 CM5 会话中执行 scripts/cm5-acceptance.sh
    Then 输出单个 JSON 文档,包含 arch/os/session/display/touch/gpu/electron/smoke/autostart/memory 检查项
    And 包含 Electron 共享库完整性检查(ldd 无 not found)
    And 任一关键检查未通过时进程以非零码退出

  Scenario: 网格摆放由声明式配置驱动
    Given 外壳已启动
    Then index.html 不含任何内联样式,磁贴改用 data-widget 标识
    And shell.js 从 config/desktop_layout.js 读声明，磁贴跨列跨行对齐 P4 惯例(clock 跨 2 列、pomodoro 跨 2×2)，year 因 3 列 × 5 行网格跨 2 行铺满最后两行
    And 每个 data-widget 配置项都有对应磁贴,缺失时启动立即失败
    And 计算后的 gridColumn/gridRow 与物理几何检查(clock 宽等于 2 列加 gutter,pomodoro 等)保持一致

  Scenario: 页点触摸目标不小于 44px 且以圆点与胶囊组合呈现
    Given 外壳已启动
    Then 页点未激活时呈现为等宽等高真圆点，激活时展开为高亮胶囊
    And 点击热区经不可见扩展达到至少 44×44
    And 在页点中心上方 16px 处做命中测试仍返回该页点按钮
    And 状态栏内页点容器矩形不变,bolt 在左、时钟在右的关系保持
    And 页点按钮本身未被 transform 扭曲，保持正圆与正胶囊边缘

  Scenario: 可信键盘输入可激活磁贴并返回
    Given 焦点位于任一磁贴
    When 通过可信输入发送 Enter 按下与抬起
    Then 该 App 全屏视图打开
    When 通过可信输入发送 Escape
    Then 全屏视图关闭回到主屏
    When 焦点位于另一磁贴并发送 Space 按下与抬起
    Then 全屏视图打开

  Scenario: 系统 prefers-reduced-motion 生效
    Given 模拟 prefers-reduced-motion 为 reduce
    Then pages-track 的过渡时长为 0s
    When 恢复为 no-preference
    Then 过渡时长恢复为非零
