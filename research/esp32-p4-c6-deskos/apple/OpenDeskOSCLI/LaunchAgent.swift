import Darwin
import Foundation

struct LaunchAgentSpec {
    let label: String
    let programArguments: [String]
    let startInterval: Int
    let environment: [String: String]
    let logPath: String
}

struct DaemonInstallConfiguration {
    let executablePath: String
    let healthEndpoint: URL
    let environment: [String: String]

    init(
        executableInvocation: String,
        healthEndpoint: URL? = nil,
        environment: [String: String] = ProcessInfo.processInfo.environment,
        currentDirectory: URL = URL(fileURLWithPath: FileManager.default.currentDirectoryPath, isDirectory: true)
    ) throws {
        executablePath = try Self.resolveExecutable(
            executableInvocation,
            environment: environment,
            currentDirectory: currentDirectory
        ).path
        self.healthEndpoint = try healthEndpoint ?? PluginHealth.endpoint(environment: environment)

        var launchEnvironment = ["PATH": "/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin"]
        if let token = environment["FLOW_API_TOKEN"], !token.isEmpty {
            launchEnvironment["FLOW_API_TOKEN"] = token
        }
        self.environment = launchEnvironment
    }

    func launchAgentSpec(interval: Int) -> LaunchAgentSpec {
        LaunchAgentSpec(
            label: PluginHealth.daemonLabel,
            programArguments: [
                executablePath,
                "plugin",
                "health",
                "--daemon",
                "--url",
                healthEndpoint.absoluteString,
            ],
            startInterval: interval,
            environment: environment,
            logPath: CLIStateStore.logPath
        )
    }

    private static func resolveExecutable(
        _ invocation: String,
        environment: [String: String],
        currentDirectory: URL
    ) throws -> URL {
        if invocation.contains("/") {
            let candidate = invocation.hasPrefix("/")
                ? URL(fileURLWithPath: invocation)
                : currentDirectory.appendingPathComponent(invocation)
            return try verifiedExecutable(at: candidate, invocation: invocation)
        }

        let pathEntries = (environment["PATH"] ?? "")
            .split(separator: ":", omittingEmptySubsequences: false)
        for entry in pathEntries {
            let path = String(entry)
            let directory = path.isEmpty
                ? currentDirectory
                : path.hasPrefix("/")
                    ? URL(fileURLWithPath: path, isDirectory: true)
                    : currentDirectory.appendingPathComponent(path, isDirectory: true)
            let candidate = directory.appendingPathComponent(invocation)
            if let executable = try? verifiedExecutable(at: candidate, invocation: invocation) {
                return executable
            }
        }

        throw CLIError.executableNotFound(invocation)
    }

    private static func verifiedExecutable(at candidate: URL, invocation: String) throws -> URL {
        let resolved = candidate.standardizedFileURL.resolvingSymlinksInPath()
        var isDirectory = ObjCBool(false)
        guard FileManager.default.fileExists(atPath: resolved.path, isDirectory: &isDirectory),
              !isDirectory.boolValue,
              FileManager.default.isExecutableFile(atPath: resolved.path) else {
            throw CLIError.executableNotFound(invocation)
        }
        return resolved
    }
}

struct LaunchAgentStatus {
    enum State: String {
        case running
        case waiting
        case notLoaded
        case unknown
    }

    let state: State
    let lastExitCode: Int?
}

struct LaunchAgentManager {
    let launchAgentsDirectory: URL

    init(
        launchAgentsDirectory: URL = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/LaunchAgents", isDirectory: true)
    ) {
        self.launchAgentsDirectory = launchAgentsDirectory
    }

    func plistURL(for label: String) -> URL {
        launchAgentsDirectory.appendingPathComponent("\(label).plist")
    }

    func install(_ spec: LaunchAgentSpec) throws {
        let plistPath = plistURL(for: spec.label)
        try FileManager.default.createDirectory(
            at: URL(fileURLWithPath: spec.logPath).deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try writeAtomically(try plistData(for: spec), to: plistPath)

        let domain = "gui/\(getuid())"
        _ = try? Self.launchctl(["bootout", "\(domain)/\(spec.label)"])
        try Self.launchctl(["bootstrap", domain, plistPath.path])
        try Self.launchctl(["kickstart", "\(domain)/\(spec.label)"])
    }

    func uninstall(label: String) throws {
        let domain = "gui/\(getuid())"
        _ = try? Self.launchctl(["bootout", "\(domain)/\(label)"])
        let path = plistURL(for: label)
        if FileManager.default.fileExists(atPath: path.path) {
            try FileManager.default.removeItem(at: path)
        }
    }

    func status(label: String) -> LaunchAgentStatus {
        let domain = "gui/\(getuid())"
        guard let output = try? Self.launchctl(["print", "\(domain)/\(label)"]) else {
            return LaunchAgentStatus(state: .notLoaded, lastExitCode: nil)
        }
        return Self.parseStatus(output)
    }

    static func parseStatus(_ output: String) -> LaunchAgentStatus {
        var state: LaunchAgentStatus.State = .unknown
        var lastExitCode: Int?

        for line in output.split(separator: "\n") {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if trimmed.hasPrefix("state = ") {
                let value = String(trimmed.dropFirst("state = ".count))
                state = LaunchAgentStatus.State(rawValue: value) ?? .unknown
            } else if trimmed.hasPrefix("last exit code = ") {
                lastExitCode = Int(trimmed.dropFirst("last exit code = ".count))
            }
        }

        return LaunchAgentStatus(state: state, lastExitCode: lastExitCode)
    }

    private func plistData(for spec: LaunchAgentSpec) throws -> Data {
        let plist: [String: Any] = [
            "Label": spec.label,
            "ProgramArguments": spec.programArguments,
            "StartInterval": spec.startInterval,
            "RunAtLoad": true,
            "ProcessType": "Background",
            "LowPriorityIO": true,
            "EnvironmentVariables": spec.environment,
            "StandardOutPath": spec.logPath,
            "StandardErrorPath": spec.logPath,
        ]

        do {
            return try PropertyListSerialization.data(
                fromPropertyList: plist,
                format: .xml,
                options: 0
            )
        } catch {
            throw CLIError.launchAgent("Could not render LaunchAgent plist: \(error.localizedDescription)")
        }
    }

    private func writeAtomically(_ data: Data, to url: URL) throws {
        try FileManager.default.createDirectory(
            at: url.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try data.write(to: url, options: [.atomic])
        try FileManager.default.setAttributes(
            [.posixPermissions: NSNumber(value: Int16(0o600))],
            ofItemAtPath: url.path
        )
    }

    @discardableResult
    private static func launchctl(_ arguments: [String]) throws -> String {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/launchctl")
        process.arguments = arguments

        let stdout = Pipe()
        let stderr = Pipe()
        process.standardOutput = stdout
        process.standardError = stderr
        try process.run()
        process.waitUntilExit()

        let output = String(
            decoding: stdout.fileHandleForReading.readDataToEndOfFile(),
            as: UTF8.self
        )
        let errorOutput = String(
            decoding: stderr.fileHandleForReading.readDataToEndOfFile(),
            as: UTF8.self
        ).trimmingCharacters(in: .whitespacesAndNewlines)

        guard process.terminationStatus == 0 else {
            let detail = errorOutput.isEmpty ? "exit code \(process.terminationStatus)" : errorOutput
            throw CLIError.launchAgent(
                "launchctl \(arguments.joined(separator: " ")) failed: \(detail)"
            )
        }
        return output
    }
}
