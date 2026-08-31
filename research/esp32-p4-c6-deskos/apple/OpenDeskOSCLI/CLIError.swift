import Foundation

enum CLIError: LocalizedError {
    case invalidArguments(String)
    case invalidURL(String)
    case invalidPort(String)
    case invalidInterval
    case invalidTimeout
    case executableNotFound(String)
    case sidecarUnavailable(String)
    case launchAgent(String)

    var errorDescription: String? {
        switch self {
        case .invalidArguments(let message):
            return message
        case .invalidURL(let value):
            return "Invalid health endpoint URL: \(value)"
        case .invalidPort(let value):
            return "FLOW_API_PORT must be between 1 and 65,535, not \(value)."
        case .invalidInterval:
            return "Interval must be between 60 and 86,400 seconds."
        case .invalidTimeout:
            return "Timeout must be between 1 and 60 seconds."
        case .executableNotFound(let invocation):
            return "Could not resolve executable '\(invocation)' to an executable file."
        case .sidecarUnavailable(let message):
            return message
        case .launchAgent(let message):
            return message
        }
    }
}
