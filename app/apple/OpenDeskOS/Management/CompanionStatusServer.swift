#if os(macOS)
import Foundation
import Network

final class CompanionStatusServer {
    static let defaultPort: UInt16 = 8_788

    private let listener: NWListener
    private let queue = DispatchQueue(label: "dev.fradser.open-deskos.companion-status")
    private let lock = NSLock()
    private var status: OpenDeskOSCompanionStatus
    private var isListening = false

    init(port: UInt16 = CompanionStatusServer.defaultPort) throws {
        guard let endpointPort = NWEndpoint.Port(rawValue: port) else {
            throw CompanionStatusServerError.invalidPort(port)
        }
        listener = try NWListener(using: .tcp, on: endpointPort)
        status = OpenDeskOSCompanionStatus(
            service: "OpenDeskOS companion",
            ready: false,
            sidecar: "Starting"
        )
    }

    func start() {
        listener.stateUpdateHandler = { [weak self] state in
            switch state {
            case .ready:
                self?.setListening(true)
            case .failed(let error):
                self?.setListening(false)
                NSLog("OpenDeskOS companion status server failed: \(error.localizedDescription)")
            default:
                self?.setListening(false)
            }
        }
        listener.newConnectionHandler = { [weak self] connection in
            self?.handle(connection)
        }
        listener.start(queue: queue)
    }

    func stop() {
        listener.cancel()
    }

    func update(sidecar: String) {
        lock.lock()
        status = OpenDeskOSCompanionStatus(
            service: status.service,
            ready: isListening,
            sidecar: sidecar
        )
        lock.unlock()
    }

    private func setListening(_ listening: Bool) {
        lock.lock()
        isListening = listening
        status = OpenDeskOSCompanionStatus(
            service: status.service,
            ready: listening,
            sidecar: status.sidecar
        )
        lock.unlock()
    }

    private func handle(_ connection: NWConnection) {
        connection.stateUpdateHandler = { state in
            if case .failed = state {
                connection.cancel()
            }
        }
        connection.start(queue: queue)
        connection.receive(minimumIncompleteLength: 1, maximumLength: 8_192) { [weak self] data, _, _, _ in
            guard let self else {
                connection.cancel()
                return
            }
            let request = data.flatMap { String(data: $0, encoding: .utf8) } ?? ""
            let response = self.response(for: request)
            connection.send(content: Data(response.utf8), completion: .contentProcessed { _ in
                connection.cancel()
            })
        }
    }

    private func response(for request: String) -> String {
        let firstLine = request.components(separatedBy: "\r\n").first ?? ""
        guard firstLine.hasPrefix("GET /health ") else {
            return httpResponse(status: "404 Not Found", body: "{\"error\":\"not_found\"}")
        }

        lock.lock()
        let current = status
        lock.unlock()
        let encoder = JSONEncoder()
        let body = (try? encoder.encode(current)).flatMap { String(data: $0, encoding: .utf8) }
            ?? "{\"error\":\"encoding_failed\"}"
        return httpResponse(status: "200 OK", body: body)
    }

    private func httpResponse(status: String, body: String) -> String {
        "HTTP/1.1 \(status)\r\nContent-Type: application/json\r\nContent-Length: \(body.utf8.count)\r\nConnection: close\r\n\r\n\(body)"
    }
}

enum CompanionStatusServerError: LocalizedError {
    case invalidPort(UInt16)

    var errorDescription: String? {
        switch self {
        case .invalidPort(let port):
            "Invalid companion status port: \(port)."
        }
    }
}
#endif
