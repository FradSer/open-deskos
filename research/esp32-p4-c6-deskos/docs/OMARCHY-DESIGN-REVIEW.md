# Omarchy 对 Open DeskOS Linux 外壳的设计借鉴评审

> 评审日期：2026-08-26  
> 评审对象：`runtime/linux/` 以及 Open DeskOS 的 Widget、App Manager、安装器设计
> 外部参考：[omarchy.org](https://omarchy.org/)

## 1. 结论

Open DeskOS 应该学习 Omarchy 的三类设计原则：

1. **状态控件必须有明确的下一步动作**，而不是只显示状态。
2. **应用和系统能力应通过统一、可搜索的入口管理**，不要把所有入口都堆在主屏上。
3. **插件需要清晰的发现、启用、禁用、更新、移除和校验闭环**。

Open DeskOS 不应直接复制 Omarchy 的 Linux 桌面形态。Hyprland 的平铺窗口、workspace、键盘中心操作和通用 Linux package 管理，服务的是笔记本桌面；Open DeskOS 的 `runtime/linux/` 是 568×1232 的桌面 companion 面板，核心体验仍然是状态速览、横向 pager、peek 和可靠的 Back/Escape 返回。

建议采用的产品方向是：

> **Glance → Action → App**
>
> Widget 先回答“现在是什么状态”，用户需要继续操作时，再进入与该状态直接相关的 Action 或 App。

这意味着不是所有 Widget 都必须可点击，也不是所有点击都必须打开 App。

## 2. Omarchy 中值得学习的设计

### 2.1 状态 Widget 是操作入口

Omarchy 的 Top Bar 不是被动的状态栏。官方手册列出了一套明确的交互语义：

- 网络 Widget 点击后打开网络面板。
- 音频 Widget 点击后打开音频面板，右键静音，滚轮调节音量。
- Bluetooth Widget 点击后打开设备面板，右键切换无线电。
- 时钟 Widget 点击后打开日历，右键切换格式，中键打开时区选择。
- 电源、显示、Agent 等 Widget 也分别进入对应的操作面板。
- 面板支持滑块、列表、键盘导航和 Escape 关闭，而不是只作为 tooltip 展示信息。

参考：[The Top Bar](https://omarchy.org/manual/the-top-bar/)

对 Open DeskOS 的启发是：

- 网络状态可以进入网络配置或连接说明。
- 用量 Widget 可以进入用量详情。
- 番茄钟 Widget 可以进入计时器。
- 日历 Widget 可以进入今日安排。
- 设备状态 Widget 可以进入设备控制。
- 纯展示数据仍可以保持不可交互，但必须用“可查看”“待接入”等文案明确其状态。

触摸屏不需要照搬 Omarchy 的左键、右键、中键模型。Open DeskOS 可以将其压缩为：

- 短按：进入主要 Action 或 App。
- 长按：进入 Widget 管理或布局编辑。
- Back/Escape：返回原页面和原上下文。

### 2.2 统一入口优于桌面图标堆积

Omarchy 明确放弃 dock 和桌面图标，主要通过以下方式启动应用：

- `Super + Space` 打开可搜索的 Omarchy 菜单。
- `Super + Alt + Space` 打开应用菜单。
- 高频应用使用直接快捷键。
- `Super + K` 查看快捷键列表。

参考：[Coming From Mac or Windows](https://omarchy.org/manual/coming-from-mac-or-windows/)、[Navigation](https://omarchy.org/manual/navigation/)

Open DeskOS 不需要复制快捷键，但可以借鉴它的入口原则：

- 设置入口可以打开系统设置和 App 管理。
- 状态栏或 peek 可以打开状态相关的操作面板。
- 未来可以提供一个轻量、可搜索的 App/功能菜单。
- 高频 App 可以绑定物理键、键盘快捷键或固定入口。
- 主屏网格只放最有价值的 glanceable Widget，不承担完整的 App 目录职责。

### 2.3 插件管理具有完整的生命周期

Omarchy 把 Shell、bar、panel、overlay、menu 和 service 都纳入插件模型。插件可以：

- 列出和查看元数据。
- 启用或禁用。
- 从 Git 添加。
- 克隆内置插件进行修改。
- 校验 manifest。
- 更新并在失败时回滚。
- 移除并保留必要的恢复路径。

参考：[Shell Plugins](https://omarchy.org/manual/shell-plugins/)

这与 Open DeskOS 当前的插件化方向高度相似。Open DeskOS 已经有：

- `runtime/linux/src/renderer/core/registry.js`
- `runtime/linux/src/renderer/core/composer.js`
- `runtime/linux/src/renderer/config/desktop_layout.js`
- `runtime/linux/src/renderer/plugins/`

因此可以直接借鉴 Omarchy 的管理体验，但继续遵守 Open DeskOS 的安全边界：

- App 使用 v2 manifest。
- 安装经过 staging、校验、授权和 atomic rename。
- App 在独立 Lua sandbox 中运行。
- UI App 与 Service App 分离。
- App Manager 负责生命周期，而不是 Widget 或 Shell UI 自己管理 runtime。

### 2.4 用户配置和系统默认值分离

Omarchy 建议不要直接修改系统安装目录，而是通过用户配置覆盖默认值。Shell 配置集中在 `~/.config/omarchy/shell.json`，菜单也可以通过扩展文件添加条目。用户修改后仍可恢复默认配置。

参考：[Dotfiles](https://omarchy.org/manual/dotfiles/)

Open DeskOS 可以把这一原则转化为：

- 系统内置插件与用户安装 App 分开保存。
- 用户的桌面布局单独保存，不修改固件默认布局。
- 用户禁用的 Widget 不因系统更新自动恢复。
- 更新失败可以回到上一个可用版本。
- 布局配置、App 安装状态和 App 运行状态不要混为一个数据结构。

## 3. 当前 `runtime/linux/` 的实际状态（2026-08-27 更新）

### 3.1 Linux App Manager 验证端（已落地）

Linux 切片现已升格为 App Manager 验证端：Widget 先陈述真实状态，再通过声明式 `open-app` 意图延续到 App。`core/app-platform.js` 以 Installer → App Manager → App Runtime 的顺序记录并执行入口与动作；`peek-bridge.js` 承担网络、Mac 与当前 App 的持续状态；状态栏只有统一的 App Manager 入口。

`runtime/linux/src/renderer/config/desktop_layout.js` 仍是 Widget 位置唯一事实源；没有对应 App 的 Widget 保持 `display-only`，不会伪装成入口。主屏不使用 dock 或桌面图标堆积，应用发现与生命周期验证集中在 App Manager 页面。

`runtime/linux/tests/features/linux-shell.feature` 已固定以下新契约：

- Widget 先显示网络未连接、Mac 尚未连接、番茄钟未启动等真实状态。
- `open-app` Widget 保留来源 `app_id` 与 route，并进入统一 App frame。
- 大部分持续状态进入 peek，而不是 tooltip-only 控件。
- UI 只发出 intent；平台层负责安装确认、生命周期与动作执行。
- Back/Escape 停止前台 App 并恢复原页面上下文。

### 3.2 仓库内的 Widget → App 产品权威

产品权威 `research/esp32-p4-c6-deskos/docs/OPEN-DESKOS.md` 的 §5.2–§6.2 现在与 Linux 验证端方向一致：Widget 可进入 App，App Manager 管理前台生命周期，Installer 负责 manifest、capabilities、checksum、consent 与 atomic install。

Linux 当前使用浏览器端验证适配器；真实固件实现仍由以下模块负责：

- `research/esp32-p4-c6-deskos/firmware/components/odk_app_manager/`
- `research/esp32-p4-c6-deskos/firmware/components/odk_app_runtime/`
- `research/esp32-p4-c6-deskos/firmware/components/odk_installer/`
- `research/esp32-p4-c6-deskos/firmware/tests/features/app-lifecycle.feature`
- `research/esp32-p4-c6-deskos/firmware/tests/features/package-install.feature`
- `research/esp32-p4-c6-deskos/firmware/tests/features/manifest-domain.feature`

## 4. 应该学习什么，不应该学习什么

### 4.1 应该学习

#### A. Actionable status

让状态和下一步动作建立直接关系。用户看到“网络未连接”时，应能进入连接说明；看到番茄钟状态时，应能进入计时器；看到用量摘要时，应能进入详情。

#### B. 统一的 App/功能入口

主屏负责 glance，统一菜单负责查找和管理。未来可以通过设置、状态栏或物理键进入，而不是继续增加网格页数量。

#### C. 插件的可管理性

至少应该有以下概念：

- 已注册。
- 已安装。
- 已启用。
- 已禁用。
- 正在运行。
- 已暂停。
- 已停止。
- 出错。
- 可更新。

这些概念应由 App Manager、Installer 和 Shell 分别负责，不能只靠 Widget 上的文字模拟。

#### D. 可恢复的更新和配置

安装、更新、禁用和移除都要提供明确反馈。失败时保留旧版本或旧布局，不让 Shell 因一个 App 的错误而崩溃。

#### E. 面向用户的发现能力

插件或 App 需要可读的名称、版本、来源、类型、能力和当前状态。Omarchy 的 `plugin list` 和 `plugin validate` 是值得借鉴的最小信息集合。

### 4.2 不应该学习

#### A. 通用 Linux 窗口管理器语义

不要把 Hyprland 的 tiling、workspace、窗口分组、scratchpad 或多窗口焦点模型带进 CM5 companion 面板。Open DeskOS 的目标是单一前台 App 和明确的返回路径，不是管理一组重叠窗口。

#### B. 任意未沙盒化插件

Omarchy 的文档明确提醒第三方插件会以任意代码运行在长期存活的 Shell 进程中。Open DeskOS 面对的是设备控制、网络和 HID 注入能力，不能采用同样的信任模型。

#### C. AUR/package manager 作为产品 App 管理模型

Omarchy 的 `Install > Package` 和 AUR 适合 Arch 工作站。Open DeskOS 应使用自己的 v2 App package、manifest、capabilities、checksum、consent 和 atomic install 流程。

参考：[Other Packages](https://omarchy.org/manual/other-packages/)

#### D. 所有 Widget 都必须可点击

如果 Widget 没有对应的 App 或 Action，强行做成可点击会制造错误预期。当前的“可查看”“待接入”“未启动”状态文案仍然有价值。

#### E. 将管理动作放进普通 Widget 点击

安装、更新、移除、授予高危权限等动作不能由一次普通 tile tap 直接触发。它们需要专门的管理页面和确认步骤。

## 5. 推荐的交互契约

### 5.1 Widget metadata

在不破坏现有插件架构的前提下，可以把 Widget metadata 扩展为可选字段：

```js
{
  id: 'clock',
  app: '时钟',
  state: '可查看',
  interaction: 'open-app',
  appId: 'clock',
  route: 'today'
}
```

建议支持三类交互：

```text
display-only
open-app
action
```

含义如下：

- `display-only`：只展示状态，没有可用的 App 或 Action。
- `open-app`：进入已安装的 UI App，可带 route 参数。
- `action`：执行 Shell action，例如刷新状态或打开连接说明。

默认值应保持 `display-only`，以便现有 Widget 可以逐个迁移，而不是一次性改变所有磁贴的可访问性和触摸语义。

### 5.2 App frame 和返回语义

App frame 应由 Shell 统一拥有，App 本身不创建独立的全局 chrome。进入 App 时需要保存：

- 来源页面。
- 来源 Widget。
- 来源 Widget 的 route 或上下文。
- 打开前的页面位置。

按下 Back 或 Escape 时：

- 停止或暂停当前 UI App。
- 释放 App screen/runtime，或按 App Manager 契约转入后台。
- 返回原来的页面和上下文。
- 保留 State Store namespace。

这与 `odk_app_manager` 的单一 foreground UI 和 State Store 生命周期设计保持一致。

### 5.3 App 管理入口

不要恢复一个无边界的“App Center”主屏页。建议采用系统级管理 overlay 或 Settings 子页面，提供：

- 已安装 App 列表。
- UI App 与 Service App 类型。
- 名称、`app_id`、版本和来源。
- 已启用、已禁用、运行中和错误状态。
- capabilities 和权限确认。
- 更新、回滚和移除。
- 最近错误和恢复操作。

UI 只负责展示和发起意图；实际动作必须调用：

- `odk_installer`。
- `odk_app_manager`。
- `odk_app_runtime`。

### 5.4 长按和布局编辑

Omarchy 的可配置 bar 说明了“用户可以管理自己的工作区”这一原则。Open DeskOS 可以在后续阶段加入：

- 长按 Widget 或空白区域进入编辑模式。
- 拖动排序。
- 删除 Widget 实例。
- 通过 Widget 库添加已安装 App 提供的 Widget。
- 恢复默认布局。

这属于布局管理，不应与 App 安装、App 生命周期和权限管理混在一起。

## 6. 已完成的第一阶段与后续边界

### Phase A：统一契约（已完成）

Linux 切片已确定为 App Manager 验证端，并同步更新 `runtime/linux/PRODUCT.md`、`README.md`、`tests/features/linux-shell.feature` 与 `research/esp32-p4-c6-deskos/firmware/tests/features/app-transition.feature`。旧的 Widget-only 语义不再是当前契约。

### Phase B：声明式交互 metadata（已完成首个垂直切片）

`almanac`、`clock`、`pomodoro`、`year` 使用 `interaction: 'open-app'` 与 `appId`；Chat 和 Settings 仍以真实的 `display-only`/待接入状态呈现。布局可选 `route`，Widget 点击只发出平台 intent。

### Phase C：统一 App frame 与 peek（已完成验证端切片）

`core/app-platform.js` 提供统一 App host、来源 Widget/route 上下文、前台 App 状态和资源清理；peek 接收当前 App live 状态。Back/Escape 释放 Runtime 并回到来源页面。

### Phase D：真实 Installer / App Manager / App Runtime 接入（后续）

当前 Linux 端使用同名平台 seam 的验证适配器；下一步把 `odk_installer`、`odk_app_manager` 与 `odk_app_runtime` 的真实实现接入 Linux bridge，继续保持 manifest、capability、checksum、consent 和 atomic install 规则。

### Phase E：管理能力增强（后续）

- 安装、更新、回滚、移除和错误恢复操作。
- Widget 库与用户布局覆盖。
- 语音唤起统一入口；触摸仍是主要操作路径。

App Manager 的首版验证端已经提供可搜索列表；真实安装、更新、回滚、移除和 capability/consent 仍由固件平台待接入。

## 7. 建议先补充的 BDD 场景

在任何实现之前，建议在 `runtime/linux/tests/features/linux-shell.feature` 增加以下场景：

### 可操作 Widget

- Given 一个 metadata 为 `open-app` 的 Widget。
- When 用户点按该 Widget。
- Then 进入指定 App，并保留来源页面和 route。

### Display-only Widget

- Given 一个 metadata 为 `display-only` 的 Widget。
- When 用户点按该 Widget。
- Then 页面保持不变，不打开 App。

### App 未安装

- Given Widget 声明了 `appId`，但对应 App 未安装。
- When 用户点按 Widget。
- Then 打开明确的安装或接入提示，不显示空白 App 页面。

### Back 上下文

- Given 用户从某个 Widget 进入 App。
- When 用户按 Back 或 Escape。
- Then 回到原页面、原分页位置和原上下文。

### App 管理

- Given 管理页面显示一个已安装 App。
- Then 页面显示名称、版本、来源、kind、capabilities 和当前状态。
- When 用户选择移除或更新。
- Then 显示确认，失败时保留原安装，不影响 Shell。

### Service App 隔离

- Given Service App 在后台运行。
- When 它执行后台操作。
- Then 不得直接写入前台 LVGL UI。

## 8. 验证记录

本轮实现对当前 Linux 切片执行了（验证适配器范围）：

```sh
cd runtime/linux
pnpm run e2e
bash tests/smoke.sh
```

当前检查全部通过，包含：

- Widget 真实状态与 `open-app` continuation。
- Installer → App Manager → App Runtime intent trace。
- 完整插件 lifecycle 字段与 Runtime 资源清理。
- 统一 App Manager 入口，且无 dock/桌面图标堆积。
- Peek 的网络、Mac 与当前 App 状态。
- 三页 pager、Back/Escape、连接状态、多尺寸几何和 reduced-motion。
- Open DeskOS token、UnoCSS 与布局契约。

这证明 Linux 验证端内部契约已统一；它不替代真实 CM5 触摸/GPU 验收，也不声称验证适配器已经替代固件中的真实 Installer、App Manager 和 App Runtime。

## 9. 最终建议

Open DeskOS 应该从 Omarchy 学习：

- 状态即入口。
- 统一、可搜索的功能菜单。
- 插件的启用、禁用、校验、更新和移除闭环。
- 用户配置与系统默认值分离。
- 失败时可恢复。

Open DeskOS 应该坚持自己的：

- AIODI 视觉系统。
- 触摸优先的 portrait companion 布局。
- 单一 foreground UI App。
- Back/Escape 永远可用。
- v2 manifest 和 capabilities consent。
- App Manager、Lua sandbox 和 atomic installer。

**当前裁决已完成：`runtime/linux/` 是 App Manager 验证端。**下一步不是复制 Omarchy 的 UI，而是把验证适配器逐步替换为真实的 Installer、App Manager、App Runtime IPC，同时保持 Widget → App、Peek、触摸与语音 intent 的统一契约。

## 参考资料

### Omarchy

- [Coming From Mac or Windows](https://omarchy.org/manual/coming-from-mac-or-windows/)
- [Navigation](https://omarchy.org/manual/navigation/)
- [The Top Bar](https://omarchy.org/manual/the-top-bar/)
- [Shell Plugins](https://omarchy.org/manual/shell-plugins/)
- [Other Packages](https://omarchy.org/manual/other-packages/)
- [Updates](https://omarchy.org/manual/updates/)
- [Dotfiles](https://omarchy.org/manual/dotfiles/)

### Open DeskOS

- `runtime/linux/PRODUCT.md`
- `runtime/linux/src/renderer/core/composer.js`
- `runtime/linux/src/renderer/core/registry.js`
- `runtime/linux/src/renderer/config/desktop_layout.js`
- `runtime/linux/src/renderer/shell.js`
- `runtime/linux/tests/features/linux-shell.feature`
- `research/esp32-p4-c6-deskos/docs/OPEN-DESKOS.md`
- `research/esp32-p4-c6-deskos/docs/PLUGINS_AND_WIDGETS_ARCHITECTURE.md`
- `research/esp32-p4-c6-deskos/docs/WIDGET_SPEC_AND_AI_GUIDE.md`
- `research/esp32-p4-c6-deskos/firmware/components/odk_app_manager/include/odk_app_manager.h`
- `research/esp32-p4-c6-deskos/firmware/components/odk_installer/include/odk_installer.h`
- `research/esp32-p4-c6-deskos/firmware/tests/features/app-lifecycle.feature`
- `research/esp32-p4-c6-deskos/firmware/tests/features/app-transition.feature`
- `research/esp32-p4-c6-deskos/firmware/tests/features/package-install.feature`
