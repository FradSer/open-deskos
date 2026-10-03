---
description: Futu 持仓在两个 Shell Host 上同时不刷新的三层叠加根因：runtime 目录 0755 被 prepareDirectory 拒绝 → 绑定失败却已记入 registry 从此永不重试 → hello 与首帧合并成一读被 512 字节握手上限误判为 handshake-too-large
type: project
---

2026-10-01 实测事故 ✓。症状是 **CM5 与 64-bit Windows 掌机的 Futu 持仓都不更新** ✓ ✓，但**没有任何一行日志说"数据没到"** —— 这是它难查的原因 ✓ ✓。三层根因**互相掩盖**，修一层才露出下一层 ✓ ✓。

**第一层：runtime 目录权限** ✓。`/run/user/1000/open-deskos` 是 0755 ✓（旧代码建的 ✓）✓，而 `local-channel.js` 的 `prepareDirectory()` **按设计拒绝 group/world 可访问的父目录** ✓ ✓ —— 那个目录本身就是 Unix socket 的认证依据 ✓（ADR-0025 ✓），所以拒绝是**正确的** ✓。它同时**不会去 chmod 别人的目录** ✓，于是一个历史遗留的 0755 目录让监听**永久**起不来 ✓。修法是 `chmod 700` ✓，不是改代码 ✓。

**第二层：绑定失败被记成已监听** ✓。旧 `futu-source.js` 先 `servers.set(id, server)` **再** `await server.start()` ✓，绑定抛错后 registry 仍然标记着它 ✓，于是 60 秒定时刷新每次都 `servers.has(id) → continue` ✓ —— **永不重试，也永不打印第二条日志** ✓ ✓。这解释了为什么 launcher.log 里那条 `futu services unavailable` 只出现一次就沉默 ✓。现在**只有绑定成功才登记** ✓，失败则逐服务上报 `onRefuse` ✓ 并留待下次刷新 ✓（ADR-0009：死掉的 service 不得阻塞 shell 启动 ✓ ✓）。

**第三层：握手上限用错了单位** ✓。`gate()` **先对整个首块判 512 字节上限，再找换行符** ✓，所以任何首帧超过 512 字节的对端——**哪怕帧是完整合法的**——都被拒为 `handshake-too-large` ✓ ✓。Service Plugin 的 `hello` 与第一份快照是背靠背写的 ✓，真实账户快照是**数 KB** ✓，两者一旦被内核合并成一个读就必然触发 ✓；合不合并取决于调度，所以它**时好时坏** ✓ ✓（第一次重启后正常、第二次又断 ✓）。上限现在**只在尚未出现换行符时生效** ✓，即只约束"永远不发完整行"的对端 ✓ ✓。

**掉线不等于陈旧** ✓：连接关闭时 Shell 知道 ✓，但 `onSnapshot` 之前从不读那个 `dropped` 标记 ✓，于是**已停更的数字继续以 live 画满一个新鲜度窗口** ✓ ✓。现在掉线即 `unavailable` + 保留最后一份测量供 tile 画暗态 ✓，且**只有真正收到数据才恢复 live** —— 重开 socket 不是一次测量 ✓ ✓。

**Why:** 同一症状叠三层、且最外层把内层的日志也吞掉时，纯代码推断会稳定地得出错误结论；本次前两层都是靠**读设备日志**才定位的，第三层是读日志后仍复现不了才回到代码里量出来的。

**How to apply:** 排"数据不刷新"先读设备日志（位置见 `open-deskos-cm5-ssh-access.md` ✓ 与 `open-deskos-windows-handheld-access.md` ✓），再怀疑代码；改这个接缝时，**绑定成功才登记状态** ✓、**逐服务失败隔离** ✓、**fan-out 里一项失败不得中断其余** ✓（`LinkSet.send` 旧版一个 desk 读失败会抛 AttributeError 打断后面所有 desk ✓ ✓）、**没有拿到确认的读取不算投递** ✓（旧 poller 把断链的读取算成功并清零失败计数 ✓，常驻死 desk 因此永远不告警 ✓ ✓）。
