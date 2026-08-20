import Foundation
import Combine

/// The Wispr Flow transcription plugin. Spawns the bundled Bun runtime running
/// the wispr-flow-client HTTP/WebSocket server (src/composition-root/server.js)
/// from Resources/plugins/wispr/, on a configurable port (default 8787).
///
/// macOS-only: iOS/visionOS cannot spawn subprocesses.
#if os(macOS)
@MainActor
final class WisprFlowPlugin: Plugin, ObservableObject {
    let id = "wispr-flow"
    let displayName = String(localized: "Wispr Flow", comment: "Plugin display name")
    @Published private(set) var status: PluginStatus = .stopped
    private var sidecar: SidecarProcess?
    private weak var host: PluginHost?
    private var healthTask: Task<Void, Never>?
    private var isStopping = false
    private var restartAfterStop = false

    /// Resources/ — the synchronized group flattens the plugin files (bun,
    /// server.bundle.js, flow_api.proto.txt) to the bundle's Resources root.
    /// We run bun there so cwd-relative proto resolution finds flow_api.proto.txt.
    private var resourceDir: URL? {
        Bundle.main.resourceURL
    }

    func start(host: PluginHost) throws {
        self.host = host
        if isStopping {
            restartAfterStop = true
            return
        }
        guard sidecar?.isRunning != true else { return }
        healthTask?.cancel()
        healthTask = nil

        guard let dir = resourceDir,
              FileManager.default.fileExists(atPath: dir.appendingPathComponent("bun").path),
              FileManager.default.fileExists(atPath: dir.appendingPathComponent("server.bundle.js").path) else {
            updateStatus(.failed)
            throw NSError(domain: "WisprFlowPlugin", code: 1, userInfo: [NSLocalizedDescriptionKey: "wispr sidecar (bun/server.bundle.js) not found in bundle Resources"])
        }
        guard let sessionPath = host.sessionPath ?? ProcessInfo.processInfo.environment["FLOW_SESSION_PATH"] else {
            updateStatus(.failed)
            throw NSError(domain: "WisprFlowPlugin", code: 4, userInfo: [NSLocalizedDescriptionKey: "choose Wispr Flow's session.json before starting the plugin"])
        }
        let bunURL = dir.appendingPathComponent("bun")
        let scriptURL = dir.appendingPathComponent("server.bundle.js")
        guard FileManager.default.isExecutableFile(atPath: bunURL.path) else {
            updateStatus(.failed)
            throw NSError(domain: "WisprFlowPlugin", code: 2, userInfo: [NSLocalizedDescriptionKey: "bundled bun not executable"])
        }
        let portString = ProcessInfo.processInfo.environment["FLOW_API_PORT"] ?? "8787"
        guard let port = Int(portString), (1...65_535).contains(port) else {
            updateStatus(.failed)
            throw NSError(domain: "WisprFlowPlugin", code: 3, userInfo: [NSLocalizedDescriptionKey: "FLOW_API_PORT must be between 1 and 65535"])
        }
        let apiToken = ProcessInfo.processInfo.environment["FLOW_API_TOKEN"]
        let env: [String: String] = [
            "FLOW_API_PORT": String(port),
            "FLOW_AUDIO_CONTROL": "duck",
            "FLOW_EDITING_STRENGTH": "MEDIUM",
            "FLOW_ALWAYS_WAIT_SCRIBE": "true",
            "FLOW_SESSION_PATH": sessionPath,
        ]
        let proc = SidecarProcess(executable: bunURL, arguments: [scriptURL.path], environment: env, workingDirectory: dir)
        updateStatus(.starting)
        sidecar = proc
        do {
            try proc.start { [weak self] code in
                guard let self else { return }
                let shouldRestart = self.restartAfterStop
                self.restartAfterStop = false
                self.isStopping = false
                self.sidecar = nil
                if shouldRestart {
                    guard let host = self.host else {
                        self.updateStatus(.failed)
                        return
                    }
                    do {
                        try self.start(host: host)
                    } catch {
                        self.updateStatus(.failed)
                        host.pluginDidFail("Wispr Flow could not restart: \(error.localizedDescription)")
                    }
                    return
                }
                guard self.status != .stopped, self.status != .failed else { return }
                if code == 0 {
                    self.updateStatus(.stopped)
                } else {
                    self.updateStatus(.failed)
                    self.host?.pluginDidFail("Wispr Flow stopped unexpectedly (exit code \(code)).")
                }
            }
        } catch {
            sidecar = nil
            updateStatus(.failed)
            throw error
        }
        guard let healthURL = URL(string: "http://127.0.0.1:\(port)/health") else {
            updateStatus(.failed)
            sidecar?.stop()
            return
        }
        healthTask = Task { @MainActor [weak self] in
            let isHealthy = await Self.waitForHealth(at: healthURL, bearerToken: apiToken)
            guard let self, !Task.isCancelled else { return }
            if isHealthy {
                self.updateStatus(.running)
                print("wispr-flow plugin started on :\(port)")
            } else {
                self.updateStatus(.failed)
                self.sidecar?.stop()
                self.host?.pluginDidFail("Wispr Flow did not pass its health check on port \(port).")
            }
        }
    }

    func stop() {
        healthTask?.cancel()
        healthTask = nil
        restartAfterStop = false
        if let sidecar, sidecar.isRunning {
            isStopping = true
            sidecar.stop()
        } else {
            isStopping = false
            self.sidecar = nil
        }
        updateStatus(.stopped)
    }

    private func updateStatus(_ newStatus: PluginStatus) {
        status = newStatus
        host?.pluginStatusDidChange()
    }

    private static func waitForHealth(at url: URL, bearerToken: String?) async -> Bool {
        for _ in 0..<20 {
            guard !Task.isCancelled else { return false }

            var request = URLRequest(url: url)
            request.timeoutInterval = 1
            if let bearerToken {
                request.setValue("Bearer \(bearerToken)", forHTTPHeaderField: "Authorization")
            }
            do {
                let (_, response) = try await URLSession.shared.data(for: request)
                if let response = response as? HTTPURLResponse,
                   (200..<300).contains(response.statusCode) {
                    return true
                }
            } catch {
                // The sidecar may need a few attempts to bind its local port.
            }

            try? await Task.sleep(nanoseconds: 250_000_000)
        }
        return false
    }
}
#endif
