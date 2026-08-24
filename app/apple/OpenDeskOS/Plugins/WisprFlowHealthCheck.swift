import Foundation

struct OpenDeskOSCompanionStatus: Codable, Equatable {
    let service: String
    let ready: Bool
    let sidecar: String
}

struct WisprFlowHealthReport: Equatable {
    let statusCode: Int
    let responseMilliseconds: Int
    let checkedAt: Date
}

enum WisprFlowHealthState: Equatable {
    case notChecked
    case checking
    case healthy(WisprFlowHealthReport)
    case unavailable(checkedAt: Date, message: String)
}

enum WisprFlowHealthCheck {
    static let defaultPort = 8_787

    static func endpoint(
        environment: [String: String] = ProcessInfo.processInfo.environment
    ) throws -> URL {
        let value = environment["FLOW_API_PORT"] ?? String(defaultPort)
        guard let port = Int(value), (1...65_535).contains(port),
              let url = URL(string: "http://127.0.0.1:\(port)/health") else {
            throw WisprFlowHealthError.invalidPort(value)
        }
        return url
    }

    static func check(
        endpoint: URL,
        timeout: TimeInterval = 5,
        bearerToken: String? = ProcessInfo.processInfo.environment["FLOW_API_TOKEN"]
    ) async throws -> WisprFlowHealthReport {
        var request = URLRequest(url: endpoint)
        request.timeoutInterval = timeout
        request.cachePolicy = .reloadIgnoringLocalCacheData
        if let bearerToken, !bearerToken.isEmpty {
            request.setValue("Bearer \(bearerToken)", forHTTPHeaderField: "Authorization")
        }

        let startedAt = Date()
        do {
            let (_, response) = try await URLSession.shared.data(for: request)
            guard let response = response as? HTTPURLResponse else {
                throw WisprFlowHealthError.unavailable("Wispr Flow returned a non-HTTP response.")
            }
            guard (200..<300).contains(response.statusCode) else {
                throw WisprFlowHealthError.unavailable(
                    "Wispr Flow returned HTTP \(response.statusCode)."
                )
            }
            return WisprFlowHealthReport(
                statusCode: response.statusCode,
                responseMilliseconds: Int(Date().timeIntervalSince(startedAt) * 1_000),
                checkedAt: Date()
            )
        } catch let error as WisprFlowHealthError {
            throw error
        } catch {
            throw WisprFlowHealthError.unavailable(error.localizedDescription)
        }
    }
}

enum WisprFlowHealthError: LocalizedError {
    case invalidPort(String)
    case unavailable(String)

    var errorDescription: String? {
        switch self {
        case .invalidPort(let value):
            "FLOW_API_PORT must be between 1 and 65,535, not \(value)."
        case .unavailable(let message):
            "Wispr Flow is unavailable: \(message)"
        }
    }
}
