# Omarchy 对 Open DeskOS Linux 外壳的设计借鉴评审

> 评审日期：2026-08-26  
> 评审对象：`firmware/linux/` 以及 Open DeskOS 的 Widget、App Manager、安装器设计  
> 外部参考：[omarchy.org](https://omarchy.org/)

## 1. 结论

Open DeskOS 应该学习 Omarchy 的三类设计原则：

1. **状态控件必须有明确的下一步动作**，而不是只显示状态。
2. **应用和系统能力应通过统一、可搜索的入口管理**，不要把所有入口都堆在主屏上。
3. **插件需要清晰的发现、启用、禁用、更新、移除和校验闭环**。

Open DeskOS 不应直接复制 Omarchy 的 Linux 桌面形态。Hyprland 的平铺窗口、workspace、键盘中心操作和通用 Linux package 管理，服务的是笔记本桌面；Open DeskOS 的 `firmware/linux/` 是 568×1232 的桌面 companion 面板，核心体验仍然是状态速览、横向 pager、peek 和可靠的 Back/Escape 返回。

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

- `firmware/linux/src/renderer/core/registry.js`
- `firmware/linux/src/renderer/core/composer.js`
- `firmware/linux/src/renderer/config/desktop_layout.js`
- `firmware/linux/src/renderer/plugins/`

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

## 3. 当前 `firmware/linux/` 的实际状态

### 3.1 当前 Linux 切片是 display-only

`firmware/linux/src/renderer/core/composer.js` 的 `buildTile()` 创建普通 `<div>`，并明确写有：

> Display-only surface, P4 parity: tiles never open views on tap.

`firmware/linux/src/renderer/config/desktop_layout.js` 只声明页面、Widget 位置以及跨列跨行布局，没有 `appId`、路由或 Action 描述。

`firmware/linux/src/renderer/plugins/settings.js` 的设置磁贴状态仍然是“待接入”。

`firmware/linux/src/renderer/shell.js` 中的 fullscreen view 当前主要承载：

- 连接 Mac 说明。
- 操作说明。
- 重新检查连接状态。
- Back/Escape 返回。

它还不是通用 App runtime 的承载层。

`firmware/linux/tests/features/linux-shell.feature` 也把以下行为固定为契约：

- 点按 Widget 不打开全屏视图。
- Widget 不是 button，也不在 Tab 序列中。
- Enter 和 Space 不触发 Widget 视图。
- 全屏视图只服务于 peek 说明、连接入口和操作说明等 Shell-level 入口。

因此，当前 Linux 切片更准确的定位是：

> Open DeskOS 的视觉、分页、状态和连接体验迁移验证壳，而不是完整的 App 平台实现。

### 3.2 仓库内已经存在另一套 Widget → App 设计

产品权威文档 `docs/open-deskos/OPEN-DESKOS.md` 写下了不同的方向：

- §5.2：点按 Widget 打开所属 App。
- §5.3：Widget 通过 Shell 的 App open seam 进入全屏 App，并可以使用 Hero 转场。
- §5.4：App Manager 管理前台 App 生命周期。
- §6.1：App 使用 v2 package contract。
- §6.2：生成 App 必须经过安装管线和权限确认。

代码和测试也已经存在对应基础：

- `firmware/open-deskos/components/odk_app_manager/`
- `firmware/open-deskos/components/odk_app_runtime/`
- `firmware/open-deskos/components/odk_installer/`
- `firmware/open-deskos/tests/features/app-lifecycle.feature`
- `firmware/open-deskos/tests/features/package-install.feature`
- `firmware/open-deskos/tests/features/manifest-domain.feature`

但是以下测试和文档仍保留了相反的旧语义：

- `firmware/open-deskos/tests/features/app-transition.feature` 的标题仍是 `Widget-only interaction (no App layer)`。
- 该文件仍写着没有 fullscreen App 和 hero navigator。
- `docs/open-deskos/PLUGINS_AND_WIDGETS_ARCHITECTURE.md` 和 `docs/open-deskos/WIDGET_SPEC_AND_AI_GUIDE.md` 仍包含 Widget 点击进入 App 的设计描述。

这是 Open DeskOS 内部的产品契约冲突，不能靠引入 Omarchy 的设计来掩盖。实施前必须先决定 Linux 切片是否开始兑现产品权威文档中的 Widget → App 语义。

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

## 6. 推荐实施顺序

### Phase A：先统一契约

先裁决 Linux 切片的目标：

- 如果它只是 P4 parity 迁移验证，继续保持 display-only，并只借鉴 actionable status 和插件管理信息架构。
- 如果它要成为 Open DeskOS App 平台的 Linux 验证端，就更新 `firmware/linux/PRODUCT.md`、`firmware/linux/tests/features/linux-shell.feature` 和冲突的 `app-transition.feature`。

不应在契约未裁决前直接修改 `composer.js` 让所有 tile 变成 button。

### Phase B：加入声明式交互 metadata

先增加可选的 `interaction`、`appId` 和 `route`，默认不改变已有 Widget 行为。优先选择有明确产品语义的 Widget：

1. calendar
2. pomodoro
3. quota
4. network/connection

不要从 settings、chat 等仍然“待接入”的磁贴开始。

### Phase C：复用共享 App frame

将当前连接说明用的 fullscreen frame 扩展为真正的 App host：

- 统一 Back/Escape。
- 保留来源上下文。
- 支持 App loading、error 和 stopped 状态。
- 让 App 内容不因来源 tile 的尺寸被压缩。

### Phase D：接入 App Manager 和 Installer

先实现已安装 App 的列表、状态和生命周期，再实现商店、侧载和动态安装。安装和更新必须继续经过 manifest、capability、checksum、consent 和 atomic install 流程。

### Phase E：实现管理 overlay 和布局编辑

最后加入：

- App 管理。
- Widget 库。
- 布局编辑。
- 搜索入口。
- 更新和恢复反馈。

## 7. 建议先补充的 BDD 场景

在任何实现之前，建议在 `firmware/linux/tests/features/linux-shell.feature` 增加以下场景：

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

本评审期间对当前 Linux 切片执行了：

```sh
cd firmware/linux
pnpm run e2e
```

当前 e2e 检查全部通过，包含：

- 三页 pager 和页点导航。
- Widget display-only 语义。
- Back/Escape 和 dialog focus trap。
- 网络与 Mac companion 状态区分。
- 多尺寸几何重算。
- reduced-motion。
- 插件注册与声明式布局校验。

这证明当前实现内部是一致的；它不证明 display-only 方向与根产品文档的 Widget → App 方向已经统一。

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

**最关键的下一步不是复制 Omarchy 的 UI，而是解决 Open DeskOS 内部的 Widget → App 契约冲突。**只有在这个决策完成后，`firmware/linux/` 才能明确判断自己是 P4 display-only 迁移切片，还是 App Manager 的 Linux 验证端。

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

- `firmware/linux/PRODUCT.md`
- `firmware/linux/src/renderer/core/composer.js`
- `firmware/linux/src/renderer/core/registry.js`
- `firmware/linux/src/renderer/config/desktop_layout.js`
- `firmware/linux/src/renderer/shell.js`
- `firmware/linux/tests/features/linux-shell.feature`
- `docs/open-deskos/OPEN-DESKOS.md`
- `docs/open-deskos/PLUGINS_AND_WIDGETS_ARCHITECTURE.md`
- `docs/open-deskos/WIDGET_SPEC_AND_AI_GUIDE.md`
- `firmware/open-deskos/components/odk_app_manager/include/odk_app_manager.h`
- `firmware/open-deskos/components/odk_installer/include/odk_installer.h`
- `firmware/open-deskos/tests/features/app-lifecycle.feature`
- `firmware/open-deskos/tests/features/app-transition.feature`
- `firmware/open-deskos/tests/features/package-install.feature`
