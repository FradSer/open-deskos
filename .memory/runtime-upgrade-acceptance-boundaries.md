---
description: "设备升级必须验证活动组件与真实进程；完整文件集、准备阶段私有 ACL、恢复基线和清理结果不能由版本号或状态标签替代"
type: project
---

## 类别：版本安装成功冒充活动运行时升级

全局 CLI、组件 SDK、部署源码和活动进程是四个事实。逐项读版本与哈希，核对启动 action/unit、PID/创建时间及实际源码目录；旧历史 release、回退安装和其他工作树不自动成为活动版本。不要为了统一版本覆盖操作者配置、凭据或中断活会话。

证据：Pi v1.0 迁移中 Windows 的 CLI 与旧 Voice SDK 分别检查；CM5 和 Windows 在只重启 agent 后验证实际新进程，Shell PID/start 保持不变。当前权威是 @integrations/voice-agent/docs/PI_V1_MIGRATION.md；宿主操作条件见 @runtime/linux/docs/WINDOWS_HOST.md 与 @runtime/linux/AGENTS.md。

## 类别：只校验清单内字节而遗漏产物文件集

既要逐文件哈希，也要比较完整文件集。跨平台打包可携带 AppleDouble 等额外元数据，清单中的所有文件都匹配仍不表示产物一致。处理仅限本任务创建的暂存产物，不能放宽检查或删除已有 release。

证据：Mac 打包产生的 37 个 `._` 兄弟文件被 CM5 完整文件集预检拒绝；确认原始源哈希、对应兄弟路径和 AppleDouble magic 后只清理本任务暂存元数据。重新打包关闭 copyfile/xattrs，两个设备各自核对同一 37 文件源指纹。

## 类别：准备与恢复状态记录早于事实

准备完成、已触碰服务、切换提交、回滚就绪和锁清理是不同事实。原生 PowerShell 绑定与 ACL 重载必须在真实环境的隔离夹具里验证；恢复输入需要在任何 live write 前校验完整 schema 与当前保护基线。事务完成后的锁清理失败不能擦掉已提交或已恢复的结果。身份与 endpoint 读数相互绑定，但仍不是原子准入屏障；没有准入锁时明确维持操作员 quiet window。

证据：Windows SID 字符串被错误解析为 NTAccount，journal ACL 准备失败，但实际旧 PID/action/idle 与空目录核对证实服务未动。改用 SecurityIdentifier 对象后临时目录 ACL/准备标记通过。CM5 损坏恢复 journal 的指针、服务树缺失及锁清理反例先 RED 后修复；原生服务升级记录与 reviewer 固定哈希报告保留在本次私有验收记录中。

适用条件：跨宿主升级、失败恢复和验收摘要时读取。这里只记录缺陷类别与证据，不授予部署、录音、provider 调用、服务重启或权限扩展；未来操作仍需本次用户授权与候选验证。
