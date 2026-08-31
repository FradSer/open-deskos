import Foundation

/// Spawns and supervises a bundled binary (e.g. the Bun runtime) as a sidecar
/// process. Pipes stdout/stderr, sends SIGTERM on stop, and reports exit.
///
/// macOS-only: iOS/visionOS sandboxes forbid spawning subprocesses, so plugins
/// that need a sidecar must be gated behind `#if os(macOS)`.
#if os(macOS)
@MainActor
final class SidecarProcess {
    private let executableURL: URL
    private let arguments: [String]
    private let environment: [String: String]
    private let workingDirectory: URL?
    private var process: Process?
    private var stdoutPipe: Pipe?
    private var stderrPipe: Pipe?
    private(set) var isRunning = false

    init(executable: URL, arguments: [String], environment: [String: String] = [:], workingDirectory: URL? = nil) {
        self.executableURL = executable
        self.arguments = arguments
        self.environment = environment
        self.workingDirectory = workingDirectory
    }

    /// Start the sidecar. Returns immediately after launch; stdout/stderr are
    /// forwarded to the host process so logs land in Console. Throws on spawn failure.
    func start(onExit: @escaping @MainActor (Int) -> Void) throws {
        let proc = Process()
        proc.executableURL = executableURL
        proc.arguments = arguments
        if !environment.isEmpty {
            var inheritedEnvironment = ProcessInfo.processInfo.environment
            inheritedEnvironment.merge(environment) { _, newValue in newValue }
            proc.environment = inheritedEnvironment
        }
        if let cwd = workingDirectory {
            proc.currentDirectoryURL = cwd
        }
        // Forward sidecar stdout/stderr to the host's streams so they show in Console.
        let out = Pipe()
        let err = Pipe()
        proc.standardOutput = out
        proc.standardError = err
        out.fileHandleForReading.readabilityHandler = { handle in
            let data = handle.availableData
            if !data.isEmpty { FileHandle.standardOutput.write(data) }
        }
        err.fileHandleForReading.readabilityHandler = { handle in
            let data = handle.availableData
            if !data.isEmpty { FileHandle.standardError.write(data) }
        }
        proc.terminationHandler = { [weak self, onExit] p in
            let exitCode = Int(p.terminationStatus)
            Task { @MainActor [weak self, onExit] in
                self?.isRunning = false
                onExit(exitCode)
            }
        }
        try proc.run()
        self.process = proc
        self.stdoutPipe = out
        self.stderrPipe = err
        self.isRunning = true
    }

    /// Graceful stop: SIGTERM. The Process is released; the terminationHandler
    /// fires the onExit callback passed to start().
    func stop() {
        guard let proc = process, proc.isRunning else { return }
        proc.terminate()
    }
}
#endif
