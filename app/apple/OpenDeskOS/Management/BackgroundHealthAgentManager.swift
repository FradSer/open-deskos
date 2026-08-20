#if os(macOS)
import Combine
import Foundation
import ServiceManagement

enum BackgroundHealthSchedule: String, CaseIterable, Identifiable, Equatable {
    case everyFiveMinutes
    case everyFifteenMinutes
    case everyThirtyMinutes
    case everyHour

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .everyFiveMinutes:
            "Every 5 minutes"
        case .everyFifteenMinutes:
            "Every 15 minutes"
        case .everyThirtyMinutes:
            "Every 30 minutes"
        case .everyHour:
            "Every hour"
        }
    }

    var interval: Int {
        switch self {
        case .everyFiveMinutes:
            300
        case .everyFifteenMinutes:
            900
        case .everyThirtyMinutes:
            1_800
        case .everyHour:
            3_600
        }
    }

    var agentPlistName: String {
        "dev.fradser.open-deskos.wispr-health.app.\(suffix).plist"
    }

    private var suffix: String {
        switch self {
        case .everyFiveMinutes:
            "5m"
        case .everyFifteenMinutes:
            "15m"
        case .everyThirtyMinutes:
            "30m"
        case .everyHour:
            "60m"
        }
    }
}

enum BackgroundHealthAgentState: Equatable {
    case inactive
    case enabled(BackgroundHealthSchedule)
    case requiresApproval(BackgroundHealthSchedule)
    case unavailable

    var isActive: Bool {
        switch self {
        case .enabled, .requiresApproval:
            true
        case .inactive, .unavailable:
            false
        }
    }

    var statusText: String {
        switch self {
        case .inactive:
            "Not enabled"
        case .enabled(let schedule):
            "Enabled · \(schedule.displayName)"
        case .requiresApproval(let schedule):
            "Approval required · \(schedule.displayName)"
        case .unavailable:
            "Helper unavailable"
        }
    }
}

@MainActor
final class BackgroundHealthAgentManager: ObservableObject {
    @Published var selectedSchedule: BackgroundHealthSchedule = .everyThirtyMinutes
    @Published private(set) var state: BackgroundHealthAgentState = .inactive
    @Published private(set) var lastError: String?
    @Published private(set) var isUpdating = false

    var canManageConfiguredEndpoint: Bool {
        configuredEndpoint?.port == WisprFlowHealthCheck.defaultPort
    }

    var endpointConfigurationMessage: String? {
        do {
            let endpoint = try WisprFlowHealthCheck.endpoint()
            guard endpoint.port != WisprFlowHealthCheck.defaultPort else { return nil }
            return "App-managed checks use 127.0.0.1:\(WisprFlowHealthCheck.defaultPort). The current sidecar is \(endpoint.absoluteString); use the standalone CLI command below for this endpoint."
        } catch {
            return "App-managed checks need a valid FLOW_API_PORT: \(error.localizedDescription)"
        }
    }

    var standaloneInstallCommand: String {
        let endpoint = configuredEndpoint?.absoluteString
            ?? "http://127.0.0.1:\(WisprFlowHealthCheck.defaultPort)/health"
        return "OpenDeskOS daemon install --interval \(selectedSchedule.interval) --url \(endpoint)"
    }

    init() {
        refresh()
    }

    func refresh() {
        guard !isUpdating else { return }
        if !canManageConfiguredEndpoint, deactivateManagedChecksForIncompatibleEndpoint() {
            return
        }

        var approvalSchedule: BackgroundHealthSchedule?
        var hasUsableHelper = false

        for schedule in BackgroundHealthSchedule.allCases {
            switch service(for: schedule).status {
            case .enabled:
                selectedSchedule = schedule
                state = .enabled(schedule)
                return
            case .requiresApproval:
                approvalSchedule = approvalSchedule ?? schedule
                hasUsableHelper = true
            case .notRegistered:
                hasUsableHelper = true
            case .notFound:
                break
            @unknown default:
                hasUsableHelper = true
            }
        }

        if let approvalSchedule {
            selectedSchedule = approvalSchedule
            state = .requiresApproval(approvalSchedule)
        } else if hasUsableHelper {
            state = .inactive
        } else {
            state = .unavailable
        }
    }

    private func deactivateManagedChecksForIncompatibleEndpoint() -> Bool {
        let hasActiveCheck = BackgroundHealthSchedule.allCases.contains { schedule in
            let status = service(for: schedule).status
            return status == .enabled || status == .requiresApproval
        }
        guard hasActiveCheck else { return false }

        isUpdating = true
        lastError = nil
        Task { [weak self] in
            guard let self else { return }

            do {
                try await self.unregisterSchedules(except: nil)
            } catch {
                self.lastError = "Could not disable background checks for the configured endpoint: \(error.localizedDescription)"
            }

            self.isUpdating = false
            self.refresh()
        }
        return true
    }

    func enable() {
        guard state != .unavailable else {
            lastError = "The background helper is missing from this app build. Rebuild or reinstall OpenDeskOS."
            return
        }
        guard canManageConfiguredEndpoint else {
            lastError = endpointConfigurationMessage
                ?? "App-managed checks require the default Wispr Flow endpoint."
            return
        }

        isUpdating = true
        lastError = nil
        let schedule = selectedSchedule

        Task { [weak self] in
            guard let self else { return }

            do {
                // Registration retains the bundled helper path, so refresh the selected
                // service too when this app version supplies a new helper or plist.
                try await self.unregisterSchedules(except: nil)
                try self.service(for: schedule).register()
            } catch {
                self.lastError = "Could not enable background checks: \(error.localizedDescription)"
            }

            self.isUpdating = false
            self.refresh()
        }
    }

    func disable() {
        isUpdating = true
        lastError = nil

        Task { [weak self] in
            guard let self else { return }

            do {
                try await self.unregisterSchedules(except: nil)
            } catch {
                self.lastError = "Could not disable background checks: \(error.localizedDescription)"
            }

            self.isUpdating = false
            self.refresh()
        }
    }

    func openLoginItems() {
        SMAppService.openSystemSettingsLoginItems()
    }

    private func service(for schedule: BackgroundHealthSchedule) -> SMAppService {
        SMAppService.agent(plistName: schedule.agentPlistName)
    }

    private var configuredEndpoint: URL? {
        try? WisprFlowHealthCheck.endpoint()
    }

    private func unregisterSchedules(except retainedSchedule: BackgroundHealthSchedule?) async throws {
        for schedule in BackgroundHealthSchedule.allCases where schedule != retainedSchedule {
            let backgroundService = service(for: schedule)
            if backgroundService.status == .enabled || backgroundService.status == .requiresApproval {
                try await unregister(backgroundService)
            }
        }
    }

    private func unregister(_ service: SMAppService) async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            service.unregister { error in
                if let error {
                    continuation.resume(throwing: error)
                } else {
                    continuation.resume()
                }
            }
        }
    }
}
#endif
