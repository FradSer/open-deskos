import Foundation

/// A plugin loaded by the host. Sidecar-based plugins implement this to manage
/// a bundled process (e.g. a Bun runtime script) via a SidecarProcess.
@MainActor
protocol Plugin: AnyObject {
    var id: String { get }
    var displayName: String { get }
    var status: PluginStatus { get }
    func start(host: PluginHost) throws
    func stop()
}

enum PluginStatus: String {
    case stopped, starting, running, failed

    var displayName: String {
        switch self {
        case .stopped:
            String(localized: "Stopped", comment: "Plugin status")
        case .starting:
            String(localized: "Starting", comment: "Plugin status")
        case .running:
            String(localized: "Running", comment: "Plugin status")
        case .failed:
            String(localized: "Failed", comment: "Plugin status")
        }
    }
}

/// Static manifest describing a discoverable plugin (future: read from a
/// per-plugin plugin.json in Resources/plugins/<id>/).
struct PluginManifest: Decodable {
    let id: String
    let name: String
    let version: String
}
