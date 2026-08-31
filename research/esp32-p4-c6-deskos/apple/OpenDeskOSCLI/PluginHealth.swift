import Foundation

struct PluginHealthResult {
    let statusCode: Int
    let elapsedMilliseconds: Int
}

enum PluginHealth {
    static let defaultPort = 8_787
    static let daemonLabel = "dev.fradser.open-deskos.wispr-health"

    static func endpoint(
        environment: [String: String] = ProcessInfo.processInfo.environment
    ) throws -> URL {
        let port = try configuredPort(environment: environment)
        return URL(string: "http://127.0.0.1:\(port)/health")!
    }

    static func endpoint(from value: String) throws -> URL {
        guard let url = URL(string: value),
              let scheme = url.scheme,
              ["http", "https"].contains(scheme),
              url.host != nil else {
            throw CLIError.invalidURL(value)
        }
        return url
    }

    static func configuredPort(environment: [String: String]) throws -> Int {
        let value = environment["FLOW_API_PORT"] ?? String(defaultPort)
        guard let port = Int(value), (1...65_535).contains(port) else {
            throw CLIError.invalidPort(value)
        }
        return port
    }

    static func check(
        endpoint: URL,
        timeout: TimeInterval,
        bearerToken: String? = nil
    ) async throws -> PluginHealthResult {
        var request = URLRequest(url: endpoint)
        request.timeoutInterval = timeout
        request.cachePolicy = .reloadIgnoringLocalCacheData
        if let bearerToken, !bearerToken.isEmpty {
            request.setValue("Bearer \(bearerToken)", forHTTPHeaderField: "Authorization")
        }

        let startedAt = Date()
        do {
            let (_, response) = try await URLSession.shared.data(for: request)
            guard let httpResponse = response as? HTTPURLResponse else {
                throw CLIError.sidecarUnavailable("Wispr Flow returned a non-HTTP response.")
            }

            let elapsed = Int(Date().timeIntervalSince(startedAt) * 1_000)
            guard (200..<300).contains(httpResponse.statusCode) else {
                throw CLIError.sidecarUnavailable(
                    "Wispr Flow is unavailable (HTTP \(httpResponse.statusCode))."
                )
            }
            return PluginHealthResult(
                statusCode: httpResponse.statusCode,
                elapsedMilliseconds: elapsed
            )
        } catch let error as CLIError {
            throw error
        } catch {
            throw CLIError.sidecarUnavailable(
                "Wispr Flow is unavailable (\(error.localizedDescription))."
            )
        }
    }
}

struct PluginHealthLastRun: Codable {
    let finishedAt: Date
    let succeeded: Bool
    let error: String?
}

enum CLIStateStore {
    static var baseDirectory: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("OpenDeskOS/CLI", isDirectory: true)
    }

    static var lastRunURL: URL {
        baseDirectory.appendingPathComponent("last-run.json")
    }

    static var logPath: String {
        baseDirectory.appendingPathComponent("logs/daemon.log", isDirectory: false).path
    }

    static func saveLastRun(_ lastRun: PluginHealthLastRun) throws {
        try FileManager.default.createDirectory(
            at: baseDirectory,
            withIntermediateDirectories: true
        )

        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        let data = try encoder.encode(lastRun)
        try data.write(to: lastRunURL, options: [.atomic])
        try FileManager.default.setAttributes(
            [.posixPermissions: NSNumber(value: Int16(0o600))],
            ofItemAtPath: lastRunURL.path
        )
    }

    static func loadLastRun() throws -> PluginHealthLastRun? {
        guard FileManager.default.fileExists(atPath: lastRunURL.path) else { return nil }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return try decoder.decode(PluginHealthLastRun.self, from: Data(contentsOf: lastRunURL))
    }
}
