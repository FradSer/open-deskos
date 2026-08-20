import Darwin
import Foundation

@main
struct OpenDeskOSCLI {
    static func main() async {
        do {
            try await run(Array(CommandLine.arguments.dropFirst()))
        } catch {
            FileHandle.standardError.write(Data("error: \(error.localizedDescription)\n".utf8))
            exit(1)
        }
    }

    private static func run(_ arguments: [String]) async throws {
        guard let command = arguments.first else {
            print(Self.usage)
            return
        }

        switch command {
        case "--help", "-h", "help":
            print(Self.usage)
        case "--version", "version":
            print("OpenDeskOS 0.1.0")
        case "plugin":
            try await PluginCommand.run(Array(arguments.dropFirst()))
        case "daemon":
            try DaemonCommand.run(Array(arguments.dropFirst()))
        case "sub":
            try await SubCommand.run(Array(arguments.dropFirst()))
        case "time":
            try await TimeCommand.run(Array(arguments.dropFirst()))
        default:
            throw CLIError.invalidArguments(
                "Unknown command '\(command)'. Run 'OpenDeskOS --help' for usage."
            )
        }
    }

    private static let usage = """
    OpenDeskOS — manage the OpenDeskOS macOS sidecar

    USAGE:
      OpenDeskOS plugin health [--url <endpoint>] [--timeout <seconds>]
      OpenDeskOS daemon install [--interval <seconds>] [--sub-pull-interval <seconds>] [--url <endpoint>]
      OpenDeskOS daemon uninstall
      OpenDeskOS daemon status
      OpenDeskOS sub push [--serial <device>] [--dry-run]
      OpenDeskOS sub pull [--serial <device>]
      OpenDeskOS time set [--serial <device>] [--dry-run]

    COMMANDS:
      plugin health     Check the Wispr Flow sidecar health endpoint.
      daemon install    Install and start a per-user launchd health agent and
                        the OpenCode Go subscription refresher.
      daemon uninstall  Stop and remove both agents.
      daemon status     Show agent state and the last health-check result.
      sub push          Fetch live OpenCode Go usage and push it to the OPEN_DESKOS
                        device over USB serial ("cerb sub push k=v ...").
      sub pull          Same as push (alias; loop mode is device-refresh-driven).
      time set          Push the Mac wall clock to the device ("cerb settime").

    The daemon runs 'OpenDeskOS plugin health --daemon --url <endpoint>' and exits after one
    check, so launchd owns scheduling and no resident CLI process is needed. The subscription
    refresher runs 'OpenDeskOS sub pull' on a short interval so Homepage #2's usage refreshes
    in near-real-time when the device asks.
    """
}

private enum PluginCommand {
    static func run(_ arguments: [String]) async throws {
        guard let command = arguments.first else {
            throw CLIError.invalidArguments("Missing plugin command. Use 'plugin health'.")
        }

        switch command {
        case "health":
            try await health(Array(arguments.dropFirst()))
        case "--help", "-h", "help":
            print("OpenDeskOS plugin health [--url <endpoint>] [--timeout <seconds>]")
        default:
            throw CLIError.invalidArguments(
                "Unknown plugin command '\(command)'. Use 'OpenDeskOS plugin health'."
            )
        }
    }

    private static func health(_ arguments: [String]) async throws {
        var endpoint: URL?
        var timeout: TimeInterval = 5
        var daemonRun = false
        var index = 0

        while index < arguments.count {
            switch arguments[index] {
            case "--url":
                index += 1
                guard index < arguments.count else {
                    throw CLIError.invalidArguments("--url requires a value.")
                }
                endpoint = try PluginHealth.endpoint(from: arguments[index])
            case "--timeout":
                index += 1
                guard index < arguments.count, let seconds = Int(arguments[index]),
                      (1...60).contains(seconds) else {
                    throw CLIError.invalidTimeout
                }
                timeout = TimeInterval(seconds)
            case "--daemon":
                daemonRun = true
            case "--help", "-h":
                print("OpenDeskOS plugin health [--url <endpoint>] [--timeout <seconds>]")
                return
            default:
                throw CLIError.invalidArguments("Unknown health option '\(arguments[index])'.")
            }
            index += 1
        }

        do {
            let result = try await PluginHealth.check(
                endpoint: try endpoint ?? PluginHealth.endpoint(),
                timeout: timeout,
                bearerToken: ProcessInfo.processInfo.environment["FLOW_API_TOKEN"]
            )
            print("Wispr Flow: healthy (HTTP \(result.statusCode), \(result.elapsedMilliseconds) ms)")
            if daemonRun {
                recordLastRunBestEffort(succeeded: true, error: nil)
            }
        } catch {
            let message = error.localizedDescription
            if daemonRun {
                recordLastRunBestEffort(succeeded: false, error: message)
            }
            throw error
        }
    }

    private static func recordLastRun(succeeded: Bool, error: String?) throws {
        try CLIStateStore.saveLastRun(
            PluginHealthLastRun(finishedAt: Date(), succeeded: succeeded, error: error)
        )
    }

    private static func recordLastRunBestEffort(succeeded: Bool, error: String?) {
        do {
            try recordLastRun(succeeded: succeeded, error: error)
        } catch {
            FileHandle.standardError.write(
                Data("warning: could not save last-run state: \(error.localizedDescription)\n".utf8)
            )
        }
    }
}

private enum DaemonCommand {
    static func run(_ arguments: [String]) throws {
        guard let command = arguments.first else {
            print("OpenDeskOS daemon install|uninstall|status")
            return
        }

        switch command {
        case "install":
            try install(Array(arguments.dropFirst()))
        case "uninstall":
            try uninstall(Array(arguments.dropFirst()))
        case "status":
            try status(Array(arguments.dropFirst()))
        case "--help", "-h", "help":
            print("OpenDeskOS daemon install [--interval <seconds>] [--sub-pull-interval <seconds>] [--url <endpoint>] | uninstall | status")
        default:
            throw CLIError.invalidArguments(
                "Unknown daemon command '\(command)'. Use 'OpenDeskOS daemon --help'."
            )
        }
    }

    private static func install(_ arguments: [String]) throws {
        var interval = 1_800
        var subPullInterval = 60
        var endpoint: URL?
        var index = 0

        while index < arguments.count {
            switch arguments[index] {
            case "--interval":
                index += 1
                guard index < arguments.count, let value = Int(arguments[index]),
                      (60...86_400).contains(value) else {
                    throw CLIError.invalidInterval
                }
                interval = value
            case "--sub-pull-interval":
                index += 1
                guard index < arguments.count, let value = Int(arguments[index]),
                      (10...86_400).contains(value) else {
                    throw CLIError.invalidArguments("--sub-pull-interval requires 10-86400 seconds.")
                }
                subPullInterval = value
            case "--url":
                index += 1
                guard index < arguments.count else {
                    throw CLIError.invalidArguments("--url requires a value.")
                }
                endpoint = try PluginHealth.endpoint(from: arguments[index])
            default:
                throw CLIError.invalidArguments("Unknown install option '\(arguments[index])'.")
            }
            index += 1
        }

        let configuration = try DaemonInstallConfiguration(
            executableInvocation: CommandLine.arguments[0],
            healthEndpoint: try endpoint ?? PluginHealth.endpoint()
        )
        let manager = LaunchAgentManager()

        // Wispr Flow health check agent.
        let spec = configuration.launchAgentSpec(interval: interval)
        try manager.install(spec)
        print("Daemon installed and started: health checks every \(interval) seconds.")

        // OpenCode Go subscription refresher agent (polls `OpenDeskOS sub pull`).
        let subPullSpec = SubPullDaemon.spec(
            executablePath: configuration.executablePath,
            interval: subPullInterval,
            environment: configuration.environment
        )
        try manager.install(subPullSpec)
        print("Subscription refresher installed: `OpenDeskOS sub pull` every \(subPullInterval) seconds.")

        print("LaunchAgents:")
        print("  \(manager.plistURL(for: spec.label).path)")
        print("  \(manager.plistURL(for: subPullSpec.label).path)")
        print("Logs:")
        print("  \(spec.logPath)")
        print("  \(subPullSpec.logPath)")
    }

    private static func uninstall(_ arguments: [String]) throws {
        guard arguments.isEmpty else {
            throw CLIError.invalidArguments("daemon uninstall does not accept options.")
        }
        let manager = LaunchAgentManager()
        try manager.uninstall(label: PluginHealth.daemonLabel)
        try manager.uninstall(label: SubPullDaemon.label)
        print("Daemon uninstalled (LaunchAgents \(PluginHealth.daemonLabel) and \(SubPullDaemon.label) removed).")
    }

    private static func status(_ arguments: [String]) throws {
        guard arguments.isEmpty else {
            throw CLIError.invalidArguments("daemon status does not accept options.")
        }

        let manager = LaunchAgentManager()
        let status = manager.status(label: PluginHealth.daemonLabel)
        switch status.state {
        case .notLoaded:
            print("Daemon: not installed (run 'OpenDeskOS daemon install')")
        case .running:
            print("Daemon: running now")
        case .waiting:
            print("Daemon: installed (waiting for next interval)")
        case .unknown:
            print("Daemon: installed (state unknown)")
        }
        if let exitCode = status.lastExitCode {
            print("Last exit code: \(exitCode)")
        }

        let subStatus = manager.status(label: SubPullDaemon.label)
        let subState = switch subStatus.state {
        case .notLoaded: "not installed"
        case .running: "running now"
        case .waiting: "installed (waiting for next interval)"
        case .unknown: "installed (state unknown)"
        }
        print("Subscription refresher: \(subState)")
        if let exitCode = subStatus.lastExitCode {
            print("Subscription refresher last exit code: \(exitCode)")
        }

        do {
            guard let lastRun = try CLIStateStore.loadLastRun() else {
                print("Last check: never")
                return
            }
            let formatter = ISO8601DateFormatter()
            let outcome = lastRun.succeeded ? "ok" : "FAILED"
            print("Last check: \(formatter.string(from: lastRun.finishedAt)) (\(outcome))")
            if let error = lastRun.error {
                print("  Error: \(error)")
            }
        } catch {
            print("Last check: unavailable (\(error.localizedDescription))")
        }
    }
}
