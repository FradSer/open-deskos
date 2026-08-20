import SwiftUI

#if os(macOS)
import AppKit
#endif

@main
struct OpenDeskOSApp: App {
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var host = PluginHost()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(host)
                .task { host.load() }
                .onChange(of: scenePhase) { _, phase in
                    switch phase {
                    case .active:
                        host.startAll()
                    case .background:
                        host.stopAll()
                    case .inactive:
                        break
                    @unknown default:
                        break
                    }
                }
        }
    }
}

struct ContentView: View {
    @EnvironmentObject private var host: PluginHost
#if os(macOS)
    @StateObject private var backgroundHealth = BackgroundHealthAgentManager()
#endif

    var body: some View {
#if os(macOS)
        MacManagementConsole(host: host, backgroundHealth: backgroundHealth)
#else
        PluginListView(host: host)
#endif
    }
}

private struct PluginListView: View {
    let host: PluginHost

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Label {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Companion client")
                            Text(platformDescription)
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                        }
                    } icon: {
                        Image(systemName: "desktopcomputer")
                    }
                    .accessibilityElement(children: .combine)
                } header: {
                    Text("Client")
                }

                Section {
                    if host.plugins.isEmpty {
                        ContentUnavailableView {
                            Label("No plugins available", systemImage: "puzzlepiece.extension")
                        } description: {
                            Text(emptyPluginDescription)
                        }
                    } else {
                        ForEach(host.plugins, id: \.id) { plugin in
                            PluginRow(plugin: plugin, retry: host.startAll)
                        }
                    }
                } header: {
                    Text("Plugins")
                }
            }
            .navigationTitle("OpenDeskOS")
#if os(iOS) || os(visionOS)
            .listStyle(.insetGrouped)
#else
            .listStyle(.inset)
#endif
        }
    }

    private var platformDescription: LocalizedStringKey {
#if os(macOS)
        "Local plugins run in this Mac app."
#else
        "Local plugins run in the Mac companion; this app does not execute them on this device."
#endif
    }

    private var emptyPluginDescription: LocalizedStringKey {
#if os(macOS)
        "Bundled plugins will appear here when they are installed."
#else
        "Use the Mac companion to run and manage local plugins."
#endif
    }
}

private struct PluginRow: View {
    let plugin: any Plugin
    let retry: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Label(plugin.displayName, systemImage: "puzzlepiece.extension")
                Spacer()
                PluginStatusLabel(status: plugin.status)
            }

            if plugin.status == .failed {
                HStack {
                    Text("Could not start this plugin.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    Spacer()
                    Button("Retry", action: retry)
                        .buttonStyle(.bordered)
                }
            }
        }
        .padding(.vertical, 4)
    }
}

private struct PluginStatusLabel: View {
    let status: PluginStatus

    var body: some View {
        Label(status.displayName, systemImage: symbol)
            .foregroundStyle(tint)
            .accessibilityLabel("Status")
            .accessibilityValue(status.displayName)
    }

    private var symbol: String {
        switch status {
        case .stopped:
            "pause.circle"
        case .starting:
            "arrow.triangle.2.circlepath"
        case .running:
            "checkmark.circle"
        case .failed:
            "exclamationmark.triangle"
        }
    }

    private var tint: Color {
        switch status {
        case .stopped:
            .secondary
        case .starting:
            .accentColor
        case .running:
            .green
        case .failed:
            .red
        }
    }
}

#if os(macOS)
private enum MacManagementSection: String, CaseIterable, Identifiable {
    case overview
    case wisprFlow
    case automation

    var id: String { rawValue }

    var title: String {
        switch self {
        case .overview:
            "Overview"
        case .wisprFlow:
            "Wispr Flow"
        case .automation:
            "Automation"
        }
    }

    var symbol: String {
        switch self {
        case .overview:
            "rectangle.3.group"
        case .wisprFlow:
            "waveform"
        case .automation:
            "clock.arrow.circlepath"
        }
    }
}

private struct MacManagementConsole: View {
    @ObservedObject var host: PluginHost
    @ObservedObject var backgroundHealth: BackgroundHealthAgentManager
    @State private var selection: MacManagementSection = .overview

    var body: some View {
        NavigationSplitView {
            List(MacManagementSection.allCases, selection: $selection) { section in
                Label(section.title, systemImage: section.symbol)
                    .tag(section)
            }
            .navigationTitle("OpenDeskOS")
            .listStyle(.sidebar)
        } detail: {
            Group {
                switch selection {
                case .overview:
                    ManagementOverviewView(host: host, backgroundHealth: backgroundHealth)
                case .wisprFlow:
                    WisprFlowManagementView(host: host)
                case .automation:
                    BackgroundHealthManagementView(manager: backgroundHealth)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
        .frame(minWidth: 840, minHeight: 600)
    }
}

private struct ManagementOverviewView: View {
    @ObservedObject var host: PluginHost
    @ObservedObject var backgroundHealth: BackgroundHealthAgentManager

    var body: some View {
        Form {
            Section("At a glance") {
                LabeledContent("Wispr Flow") {
                    PluginStatusLabel(status: host.wisprFlowStatus)
                }
                LabeledContent("Session") {
                    Text(host.wisprFlowSessionName ?? "Not configured")
                        .foregroundStyle(host.isWisprFlowSessionConfigured ? .primary : .secondary)
                }
                LabeledContent("Background checks") {
                    BackgroundHealthStatusLabel(state: backgroundHealth.state)
                }
            }

            Section("Next step") {
                nextStep
            }

            if let error = host.lastError {
                AttentionSection(message: error, dismiss: host.dismissError)
            }
        }
        .formStyle(.grouped)
        .navigationTitle("Overview")
        .onAppear { backgroundHealth.refresh() }
    }

    @ViewBuilder
    private var nextStep: some View {
        if !host.isWisprFlowSessionConfigured {
            Text("Choose your Wispr Flow session before starting transcription.")
            Button("Choose session…", action: host.chooseSessionFile)
        } else if host.wisprFlowStatus == .running {
            Text("Wispr Flow is ready on this Mac.")
            Button("Run health check", action: host.checkWisprFlowHealth)
        } else {
            Text("The session is configured. Start the local sidecar when you are ready.")
            Button("Start sidecar", action: host.startWisprFlow)
        }
    }
}

private struct WisprFlowManagementView: View {
    @ObservedObject var host: PluginHost

    var body: some View {
        Form {
            Section("Connection") {
                LabeledContent("Endpoint") {
                    Text(host.wisprFlowEndpoint)
                        .textSelection(.enabled)
                }
                LabeledContent("Sidecar") {
                    PluginStatusLabel(status: host.wisprFlowStatus)
                }
            }

            Section("Session") {
                LabeledContent("Wispr Flow session") {
                    Text(host.wisprFlowSessionName ?? "Not configured")
                        .foregroundStyle(host.isWisprFlowSessionConfigured ? .primary : .secondary)
                }
                Button(
                    host.isWisprFlowSessionConfigured ? "Change session…" : "Choose session…",
                    action: host.chooseSessionFile
                )
                Text("OpenDeskOS keeps a protected copy for the bundled sidecar and preserves access with a security-scoped bookmark.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }

            Section("Sidecar controls") {
                HStack {
                    Button("Start", action: host.startWisprFlow)
                        .disabled(host.wisprFlowStatus == .running || host.wisprFlowStatus == .starting)
                    Button("Restart", action: host.restartWisprFlow)
                        .disabled(host.wisprFlowStatus == .starting)
                    Button("Stop", action: host.stopWisprFlow)
                        .disabled(host.wisprFlowStatus == .stopped)
                }
            }

            Section("Health check") {
                HealthCheckResultView(state: host.healthCheckState)
                Button("Run health check", action: host.checkWisprFlowHealth)
                    .disabled(host.healthCheckState == .checking)
            }

            if let error = host.lastError {
                AttentionSection(message: error, dismiss: host.dismissError)
            }
        }
        .formStyle(.grouped)
        .navigationTitle("Wispr Flow")
    }
}

private struct BackgroundHealthManagementView: View {
    @ObservedObject var manager: BackgroundHealthAgentManager

    var body: some View {
        Form {
            Section("Background health checks") {
                Picker("Run health check", selection: $manager.selectedSchedule) {
                    ForEach(BackgroundHealthSchedule.allCases) { schedule in
                        Text(schedule.displayName).tag(schedule)
                    }
                }
                LabeledContent("Status") {
                    BackgroundHealthStatusLabel(state: manager.state)
                }
                Text("macOS runs the bundled OpenDeskOS as a short-lived LaunchAgent. It checks the local health endpoint and does not start Bun or keep the sidecar alive.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)

                if let message = manager.endpointConfigurationMessage {
                    Text(message)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }

                if manager.state == .unavailable {
                    Text("Background checks need a signed, installed copy of OpenDeskOS with its bundled helper.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }

            Section("Controls") {
                HStack {
                    Button(
                        manager.state.isActive ? "Apply schedule" : "Enable background checks",
                        action: manager.enable
                    )
                    .disabled(
                        manager.isUpdating
                            || manager.state == .unavailable
                            || !manager.canManageConfiguredEndpoint
                    )

                    Button("Disable", action: manager.disable)
                        .disabled(manager.isUpdating || !manager.state.isActive)

                    Button("Refresh", action: manager.refresh)
                        .disabled(manager.isUpdating)
                }

                if case .requiresApproval = manager.state {
                    Button("Open Login Items", action: manager.openLoginItems)
                    Text("Approve OpenDeskOS in System Settings before background checks can run.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }

            Section("Command line") {
                Text("Use the standalone CLI for a headless or custom schedule. Do not enable both the app-managed agent and a OpenDeskOS daemon at the same time.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                HStack {
                    Text(manager.standaloneInstallCommand)
                        .font(.system(.body, design: .monospaced))
                        .textSelection(.enabled)
                    Spacer()
                    Button("Copy") {
                        copyCommand()
                    }
                }
            }

            if let error = manager.lastError {
                AttentionSection(message: error, dismiss: nil)
            }
        }
        .formStyle(.grouped)
        .navigationTitle("Automation")
        .onAppear { manager.refresh() }
    }

    private func copyCommand() {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(
            manager.standaloneInstallCommand,
            forType: .string
        )
    }
}

private struct BackgroundHealthStatusLabel: View {
    let state: BackgroundHealthAgentState

    var body: some View {
        Label(state.statusText, systemImage: symbol)
            .foregroundStyle(tint)
            .accessibilityLabel("Background health checks")
            .accessibilityValue(state.statusText)
    }

    private var symbol: String {
        switch state {
        case .inactive:
            "pause.circle"
        case .enabled:
            "checkmark.circle"
        case .requiresApproval:
            "exclamationmark.triangle"
        case .unavailable:
            "xmark.circle"
        }
    }

    private var tint: Color {
        switch state {
        case .inactive:
            .secondary
        case .enabled:
            .green
        case .requiresApproval:
            .orange
        case .unavailable:
            .red
        }
    }
}

private struct HealthCheckResultView: View {
    let state: WisprFlowHealthState

    var body: some View {
        switch state {
        case .notChecked:
            Label("Not checked", systemImage: "questionmark.circle")
                .foregroundStyle(.secondary)
        case .checking:
            HStack(spacing: 8) {
                ProgressView()
                    .controlSize(.small)
                Text("Checking 127.0.0.1…")
            }
        case .healthy(let report):
            VStack(alignment: .leading, spacing: 4) {
                Label(
                    "Healthy · HTTP \(report.statusCode) · \(report.responseMilliseconds) ms",
                    systemImage: "checkmark.circle"
                )
                .foregroundStyle(.green)
                Text("Checked \(report.checkedAt.formatted(date: .abbreviated, time: .shortened))")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        case .unavailable(let checkedAt, let message):
            VStack(alignment: .leading, spacing: 4) {
                Label("Unavailable", systemImage: "exclamationmark.triangle")
                    .foregroundStyle(.red)
                Text(message)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                Text("Checked \(checkedAt.formatted(date: .abbreviated, time: .shortened))")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
    }
}

private struct AttentionSection: View {
    let message: String
    let dismiss: (() -> Void)?

    var body: some View {
        Section("Attention") {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Label(message, systemImage: "exclamationmark.triangle")
                    .foregroundStyle(.red)
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 8)
                if let dismiss {
                    Button("Dismiss", action: dismiss)
                        .buttonStyle(.borderless)
                }
            }
        }
    }
}
#endif

#Preview {
    ContentView().environmentObject(PluginHost())
}
