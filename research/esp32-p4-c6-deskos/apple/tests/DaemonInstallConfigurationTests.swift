import Foundation

@main
struct DaemonInstallConfigurationTests {
    static func main() throws {
        let fileManager = FileManager.default
        let temporaryDirectory = fileManager.temporaryDirectory
            .appendingPathComponent("open-deskos-daemon-configuration-\(UUID().uuidString)", isDirectory: true)
        defer { try? fileManager.removeItem(at: temporaryDirectory) }

        let binaryDirectory = temporaryDirectory.appendingPathComponent("bin", isDirectory: true)
        let executable = binaryDirectory.appendingPathComponent("OpenDeskOS")
        try fileManager.createDirectory(at: binaryDirectory, withIntermediateDirectories: true)
        try Data("#!/bin/sh\nexit 0\n".utf8).write(to: executable)
        try fileManager.setAttributes(
            [.posixPermissions: NSNumber(value: Int16(0o755))],
            ofItemAtPath: executable.path
        )

        let configuration = try DaemonInstallConfiguration(
            executableInvocation: "OpenDeskOS",
            environment: [
                "PATH": binaryDirectory.path,
                "FLOW_API_PORT": "18787",
            ],
            currentDirectory: temporaryDirectory
        )

        try expect(
            configuration.executablePath == executable.resolvingSymlinksInPath().path,
            "the daemon must store the executable resolved through PATH"
        )
        try expect(
            configuration.healthEndpoint.absoluteString == "http://127.0.0.1:18787/health",
            "the daemon must preserve FLOW_API_PORT in its health endpoint"
        )

        let agent = configuration.launchAgentSpec(interval: 900)
        try expect(
            agent.programArguments == [
                executable.resolvingSymlinksInPath().path,
                "plugin",
                "health",
                "--daemon",
                "--url",
                "http://127.0.0.1:18787/health",
            ],
            "the LaunchAgent must run the resolved CLI against the configured endpoint"
        )

        let defaultConfiguration = try DaemonInstallConfiguration(
            executableInvocation: executable.path,
            environment: [:],
            currentDirectory: temporaryDirectory
        )
        try expect(
            defaultConfiguration.healthEndpoint.absoluteString == "http://127.0.0.1:8787/health",
            "the default health endpoint must remain loopback port 8787"
        )

        do {
            _ = try DaemonInstallConfiguration(
                executableInvocation: executable.path,
                environment: ["FLOW_API_PORT": "65536"],
                currentDirectory: temporaryDirectory
            )
            throw TestFailure("an out-of-range FLOW_API_PORT must be rejected")
        } catch let error as CLIError {
            try expect(
                error.errorDescription?.contains("FLOW_API_PORT") == true,
                "invalid port errors must explain the misconfiguration"
            )
        }
    }

    private static func expect(_ condition: Bool, _ message: String) throws {
        guard condition else { throw TestFailure(message) }
    }
}

private struct TestFailure: LocalizedError {
    let message: String

    init(_ message: String) {
        self.message = message
    }

    var errorDescription: String? { message }
}
