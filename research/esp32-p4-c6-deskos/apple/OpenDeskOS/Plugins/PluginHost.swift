import Foundation
import Combine
#if os(macOS)
import AppKit
import UniformTypeIdentifiers
#endif

/// Owns built-in plugins and manages their lifecycle (start on launch, stop
/// when the scene leaves the foreground). Each plugin runs its own sidecar on
/// a distinct port; manifest discovery can replace the built-in list later.
@MainActor
final class PluginHost: ObservableObject {
    @Published private(set) var plugins: [any Plugin] = []
    @Published private(set) var lastError: String?
    private var didLoad = false
#if os(macOS)
    @Published private(set) var sessionURL: URL?
    @Published private(set) var healthCheckState: WisprFlowHealthState = .notChecked
    private static let sessionBookmarkKey = "wispr-flow.session-bookmark"
    private var sessionCopyURL: URL?
    private var healthCheckTask: Task<Void, Never>?
    private var healthCheckGeneration = 0

    init() {
        restoreSessionAccess()
    }
#endif

    /// Load built-in plugins once. A future version can replace this list with
    /// manifest discovery without changing the lifecycle contract.
    func load() {
        guard !didLoad else { return }
        didLoad = true

        #if os(macOS)
        let wispr = WisprFlowPlugin()
        plugins.append(wispr)
        #endif

        startAll()
    }

    /// Start stopped or failed plugins. This is safe to call when a scene
    /// becomes active again because each plugin owns its own running guard.
    func startAll() {
        for plugin in plugins {
            start(plugin)
        }
    }

    /// Stop all plugins when the scene leaves the foreground.
    func stopAll() {
        for plugin in plugins {
            plugin.stop()
        }
#if os(macOS)
        invalidateWisprFlowHealthCheck()
#endif
    }

    /// Forward plugin-owned state changes through the host so SwiftUI redraws
    /// rows whose state is published by an existential plugin value.
    func pluginStatusDidChange() {
        objectWillChange.send()
    }

    func pluginDidFail(_ message: String) {
#if os(macOS)
        invalidateWisprFlowHealthCheck()
#endif
        recordError(message)
    }

#if os(macOS)
    /// Path granted by the user for the Wispr Flow session file. The security
    /// scoped bookmark keeps access across launches without a host-specific
    /// entitlement.
    var sessionPath: String? {
        sessionCopyURL?.path
    }

    var wisprFlowStatus: PluginStatus {
        plugin(withID: "wispr-flow")?.status ?? .stopped
    }

    var isWisprFlowSessionConfigured: Bool {
        sessionCopyURL != nil
    }

    var wisprFlowSessionName: String? {
        sessionURL?.lastPathComponent
    }

    var wisprFlowEndpoint: String {
        (try? WisprFlowHealthCheck.endpoint().absoluteString) ?? "http://127.0.0.1:8787/health"
    }

    func startWisprFlow() {
        invalidateWisprFlowHealthCheck()
        guard let plugin = plugin(withID: "wispr-flow") else { return }
        start(plugin)
    }

    func stopWisprFlow() {
        guard let plugin = plugin(withID: "wispr-flow") else { return }
        plugin.stop()
        invalidateWisprFlowHealthCheck()
        lastError = nil
    }

    func restartWisprFlow() {
        guard let plugin = plugin(withID: "wispr-flow") else { return }
        plugin.stop()
        invalidateWisprFlowHealthCheck()
        start(plugin)
    }

    func checkWisprFlowHealth() {
        guard healthCheckState != .checking else { return }
        healthCheckGeneration &+= 1
        let generation = healthCheckGeneration
        healthCheckState = .checking

        healthCheckTask = Task { [weak self] in
            guard let self else { return }
            do {
                let endpoint = try WisprFlowHealthCheck.endpoint()
                let report = try await WisprFlowHealthCheck.check(endpoint: endpoint)
                guard !Task.isCancelled, generation == self.healthCheckGeneration else { return }
                self.healthCheckState = .healthy(report)
            } catch {
                guard !Task.isCancelled, generation == self.healthCheckGeneration else { return }
                self.healthCheckState = .unavailable(
                    checkedAt: Date(),
                    message: error.localizedDescription
                )
            }
            self.healthCheckTask = nil
        }
    }

    func dismissError() {
        lastError = nil
    }

    /// Ask the user to grant read access to Wispr Flow's session file.
    func chooseSessionFile() {
        let panel = NSOpenPanel()
        panel.title = "Choose Wispr Flow session"
        panel.message = "Choose session.json from Wispr Flow to enable transcription."
        panel.allowedContentTypes = [.json]
        panel.allowsMultipleSelection = false
        panel.canChooseDirectories = false

        guard panel.runModal() == .OK, let selectedURL = panel.url else { return }
        sessionURL?.stopAccessingSecurityScopedResource()
        guard selectedURL.startAccessingSecurityScopedResource() else {
            recordError("OpenDeskOS could not access the selected Wispr Flow session.")
            sessionURL = nil
            sessionCopyURL = nil
            return
        }

        do {
            let bookmark = try selectedURL.bookmarkData(options: [.withSecurityScope])
            UserDefaults.standard.set(bookmark, forKey: Self.sessionBookmarkKey)
            guard stageSessionFile(from: selectedURL) else {
                selectedURL.stopAccessingSecurityScopedResource()
                sessionURL = nil
                sessionCopyURL = nil
                return
            }
            sessionURL = selectedURL
            lastError = nil
            startWisprFlowAfterSessionChange()
        } catch {
            selectedURL.stopAccessingSecurityScopedResource()
            sessionURL = nil
            sessionCopyURL = nil
            recordError("OpenDeskOS could not save Wispr Flow session access: \(error.localizedDescription)")
        }
    }

    private func restoreSessionAccess() {
        guard let bookmark = UserDefaults.standard.data(forKey: Self.sessionBookmarkKey) else { return }
        var isStale = false

        do {
            let url = try URL(
                resolvingBookmarkData: bookmark,
                options: [.withSecurityScope],
                relativeTo: nil,
                bookmarkDataIsStale: &isStale
            )
            guard url.startAccessingSecurityScopedResource() else { return }
            guard stageSessionFile(from: url) else {
                url.stopAccessingSecurityScopedResource()
                return
            }
            sessionURL = url
            if isStale {
                let refreshedBookmark = try url.bookmarkData(options: [.withSecurityScope])
                UserDefaults.standard.set(refreshedBookmark, forKey: Self.sessionBookmarkKey)
            }
        } catch {
            UserDefaults.standard.removeObject(forKey: Self.sessionBookmarkKey)
            recordError("OpenDeskOS could not restore the Wispr Flow session: \(error.localizedDescription)")
        }
    }

    private func startWisprFlowAfterSessionChange() {
        switch wisprFlowStatus {
        case .running, .starting:
            restartWisprFlow()
        case .stopped, .failed:
            startWisprFlow()
        }
    }

    private func invalidateWisprFlowHealthCheck() {
        healthCheckGeneration &+= 1
        healthCheckTask?.cancel()
        healthCheckTask = nil
        healthCheckState = .notChecked
    }

    private func stageSessionFile(from sourceURL: URL) -> Bool {
        do {
            let supportDirectory = try FileManager.default.url(
                for: .applicationSupportDirectory,
                in: .userDomainMask,
                appropriateFor: nil,
                create: true
            )
                .appendingPathComponent("OpenDeskOS", isDirectory: true)
                .appendingPathComponent("Wispr Flow", isDirectory: true)
            try FileManager.default.createDirectory(at: supportDirectory, withIntermediateDirectories: true)

            let destinationURL = supportDirectory.appendingPathComponent("session.json")
            let data = try Data(contentsOf: sourceURL)
            try data.write(to: destinationURL, options: [.atomic])
            try FileManager.default.setAttributes(
                [.posixPermissions: NSNumber(value: Int16(0o600))],
                ofItemAtPath: destinationURL.path
            )
            sessionCopyURL = destinationURL
            return true
        } catch {
            recordError("OpenDeskOS could not prepare the Wispr Flow session: \(error.localizedDescription)")
            return false
        }
    }
#endif

    private func start(_ plugin: any Plugin) {
        guard plugin.status != .running, plugin.status != .starting else { return }

        do {
            try plugin.start(host: self)
            lastError = nil
        } catch {
            recordError(error.localizedDescription)
        }
    }

    private func plugin(withID id: String) -> (any Plugin)? {
        plugins.first { $0.id == id }
    }

    private func recordError(_ message: String) {
        lastError = message
        print(message)
    }
}
