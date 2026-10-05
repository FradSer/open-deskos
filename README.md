# Open DeskOS

Open DeskOS is a desk companion. One Electron Shell runs on Linux, 64-bit Windows, and macOS.
The CM5/RK3588S Linux panel is the reference host.
Each host and peripheral has separate acceptance results. Direct input works when a link or service is unavailable.

## Start

```sh
cd runtime/shell
pnpm install
pnpm styles
pnpm test
./run.sh
```

## Documents

| Task | Owner |
| --- | --- |
| Product scope | [Product](PRODUCT.md) |
| Visual rules | [Design](DESIGN.md) |
| Development and writing rules | [Repository guidelines](AGENTS.md) |
| Shell development and CM5 operations | [Shell runbook](runtime/shell/README.md) |
| Windows operations | [Windows runbook](runtime/shell/docs/WINDOWS_HOST.md) |
| Runtime terms and boundaries | [Shell context](runtime/shell/CONTEXT.md) |
| Resident agent and its operations | [Personal Bot](integrations/personal-bot/README.md) |
| Remote transport | [Remote Bridge](integrations/remote-bridge/README.md) |
| Touch Remote Control | [S3 Remote](peripherals/esp32-s3-remote/README.md) |
| UVC camera and UAC microphone | [P4 camera](peripherals/esp32-p4-camera/README.md) |
| Speech and account sources | [STT bridge](integrations/local-stt-bridge/README.md), [Futu poller](integrations/futu-poller/README.md) |
| Widget/App development | [Widget skill](.agents/skills/open-deskos-widget/SKILL.md) |
| Optional gateway experiment | [C6/S31 gateway](experiments/cm5-s31-gateway/README.md) |
| Preserved firmware and Apple companion | [P4+C6 research](research/esp32-p4-c6-deskos/README.md) |

Each document owns one subject. Use Git history for past versions.
Historical results do not prove current acceptance.
