//
//  SubBridge.swift
//  OpenDeskOSCLI
//
//  macOS → USB → ESP32-P4 subscription bridge + time sync.
//
//  Pushes the user's real OpenCode Go usage (the data CodexBar shows in the
//  menu bar) to the OPEN_DESKOS device over its USB serial console, so Homepage
//  #2 renders live data instead of a placeholder. Also pushes the Mac wall
//  clock (`cerb settime <epoch>`) so the launcher clock/date render real
//  values — the device has no battery-backed RTC and SNTP cannot reach
//  pool.ntp.org from the lab network.
//
//  Data path:
//    opencode.ai session cookie  (macOS Keychain, service
//    com.steipete.codexbar.cache / account "cookie.opencodego" — CodexBar's
//    JSON CookieHeaderCacheEntry wrapper, unwrapped to its cookieHeader)
//        → GET /_server (workspace id) → GET /workspace/<wrk>/go (regex-parsed
//          usagePercent windows) → GET /_server (Zen balance)
//        → { plan, primaryPct, primaryResetMin, weekPct, monthPct, zen }
//        → flat "k=v k=v ..." snapshot
//        → "cerb sub push <k=v ...>" over /dev/tty.usbmodem* (ESP USB-Serial/JTAG)
//
//  The device stores the snapshot in odk_sub (NVS) and repaints the launcher
//  tile. When Homepage #2 opens it sets a refresh flag the bridge polls via
//  "cerb sub status"; `--pull` (the launchd/loop mode) first pushes the wall
//  clock, then fetches only when the device asks, matching the "pull on screen
//  open" model.
//
//  SPDX-License-Identifier: Apache-2.0
//

import Darwin
import Foundation
import Security

// MARK: - Snapshot model

/// One flat key=value snapshot (mirrors odk_sub's token grammar).
struct SubSnapshot {
    let tokens: [(key: String, value: String)]

    var line: String {
        tokens.map { "\($0.key)=\($0.value)" }.joined(separator: " ")
    }

    init(_ tokens: [(String, String)]) {
        self.tokens = tokens
    }
}

// MARK: - Cookie (Keychain)

enum KeychainCookieError: Error, CustomStringConvertible, LocalizedError {
    case notFound
    case readFailed(OSStatus)

    var description: String {
        switch self {
        case .notFound:
            return "no opencode.ai session cookie in Keychain (account 'cookie.opencodego')"
        case .readFailed(let status):
            return "Keychain read failed: \(status)"
        }
    }

    var errorDescription: String? { description }
}

/// Reads the opencode.ai session cookie CodexBar caches under
/// com.steipete.codexbar.cache / account "cookie.opencodego".
///
/// CodexBar stores the value as a JSON `CookieHeaderCacheEntry`
/// {"sourceLabel":…, "cookieHeader":"auth=…", "storedAt":…} — not a raw cookie
/// string — so we unwrap the `cookieHeader` field. A plain header string (older
/// or manual entries) is returned unchanged.
enum KeychainCookie {
    private static let service = "com.steipete.codexbar.cache"
    private static let account = "cookie.opencodego"

    static func read() throws -> String {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        guard status == errSecSuccess else {
            if status == errSecItemNotFound { throw KeychainCookieError.notFound }
            throw KeychainCookieError.readFailed(status)
        }
        guard let data = item as? Data,
              let stored = String(data: data, encoding: .utf8) else {
            throw KeychainCookieError.readFailed(errSecDecode)
        }
        // JSON wrapper → return its cookieHeader field (single "name=value"
        // cookie). Non-JSON stored values are returned verbatim.
        if let object = try? JSONSerialization.jsonObject(with: data),
           let dict = object as? [String: Any],
           let header = dict["cookieHeader"] as? String,
           !header.isEmpty {
            return header
        }
        return stored
    }
}

// MARK: - opencode.ai fetch

enum OpenCodeError: Error, CustomStringConvertible, LocalizedError {
    case invalidCredentials
    case noWorkspace
    case badResponse(String)
    case http(Int, String)

    var description: String {
        switch self {
        case .invalidCredentials:
            return "opencode.ai session cookie is missing or expired — open CodexBar once to refresh it"
        case .noWorkspace:
            return "opencode.ai did not return a workspace"
        case .badResponse(let msg):
            return "unexpected opencode.ai response: \(msg)"
        case .http(let code, let body):
            return "opencode.ai HTTP \(code): \(body.prefix(200))"
        }
    }

    var errorDescription: String? { description }
}

/// Fetch of OpenCode Go usage windows, mirroring CodexBar's
/// OpenCodeGoUsageFetcher (`Sources/CodexBarCore/Providers/OpenCodeGo/`):
///
/// 1. GET  /_server?id=<workspacesServerID>            -> workspace id (wrk_...)
/// 2. GET  /workspace/<wrk>/go                         -> HTML page; the usage
///    windows are regex-parsed out of the embedded payload (rollingUsage /
///    weeklyUsage / monthlyUsage usagePercent + resetInSec)
/// 3. GET  /_server?id=<billingServerID>&args=["wrk"]  -> Zen balance (scaled
///    by 1e8)
///
/// The session cookie lives in the macOS Keychain (CodexBar's cache); only the
/// auth/__Host-auth cookies are sent, matching CodexBar's filter.
enum OpenCode {
    private static let baseURL = URL(string: "https://opencode.ai")!
    private static let serverURL = URL(string: "https://opencode.ai/_server")!
    private static let workspacesServerID = "def39973159c7f0483d8793a822b8dbb10d067e12c65455fcb4608459ba0234f"
    private static let billingServerID = "c83b78a614689c38ebee981f9b39a8b377716db85c1fd7dbab604adc02d3313d"
    private static let userAgent =
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36"
    private static let billingScale = 100_000_000.0

    /// Keep only the session cookies the server accepts (CodexBar's
    /// CookieHeaderNormalizer allows exactly auth/__Host-auth).
    private static func filteredCookie(_ raw: String) -> String {
        raw.split(separator: ";").compactMap { part in
            let kv = part.trimmingCharacters(in: .whitespaces)
            let name = kv.split(separator: "=", maxSplits: 1).first.map(String.init) ?? ""
            return (name == "auth" || name == "__Host-auth") ? kv : nil
        }.joined(separator: "; ")
    }

    /// GET a server function: /_server?id=<id>[&args=<args>] with the headers
    /// CodexBar sends. Returns the raw (server-fn serialized) response text.
    private static func serverGET(id: String, args: String?, referer: URL, cookie: String) async throws -> String {
        var components = URLComponents(url: serverURL, resolvingAgainstBaseURL: false)!
        var items = [URLQueryItem(name: "id", value: id)]
        if let args, !args.isEmpty {
            items.append(URLQueryItem(name: "args", value: args))
        }
        components.queryItems = items
        var request = URLRequest(url: components.url ?? serverURL)
        request.setValue(cookie, forHTTPHeaderField: "Cookie")
        request.setValue(id, forHTTPHeaderField: "X-Server-Id")
        request.setValue("server-fn:\(UUID().uuidString)", forHTTPHeaderField: "X-Server-Instance")
        request.setValue(userAgent, forHTTPHeaderField: "User-Agent")
        request.setValue(baseURL.absoluteString, forHTTPHeaderField: "Origin")
        request.setValue(referer.absoluteString, forHTTPHeaderField: "Referer")
        request.setValue("text/javascript, application/json;q=0.9, */*;q=0.8", forHTTPHeaderField: "Accept")
        request.timeoutInterval = 20

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw OpenCodeError.badResponse("no HTTP response")
        }
        let text = String(data: data, encoding: .utf8) ?? ""
        guard http.statusCode == 200 else {
            if http.statusCode == 401 || http.statusCode == 403 {
                throw OpenCodeError.invalidCredentials
            }
            throw OpenCodeError.http(http.statusCode, text)
        }
        return text
    }

    private static func firstMatch(_ pattern: String, in text: String, group: Int = 1) -> String? {
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return nil }
        let range = NSRange(text.startIndex..<text.endIndex, in: text)
        guard let match = regex.firstMatch(in: text, range: range),
              match.numberOfRanges > group,
              let r = Range(match.range(at: group), in: text) else { return nil }
        return String(text[r])
    }

    /// True when the pattern matches anywhere (group-less check — avoids the
    /// crash `firstMatch` would hit asking for a capture group that doesn't
    /// exist).
    private static func matches(_ pattern: String, in text: String) -> Bool {
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return false }
        let range = NSRange(text.startIndex..<text.endIndex, in: text)
        return regex.firstMatch(in: text, range: range) != nil
    }

    private static func workspaceID(cookie: String) async throws -> String {
        let text = try await serverGET(id: workspacesServerID, args: nil, referer: baseURL, cookie: cookie)
        // Server-fn text form: id:"wrk_..."; JSON form: walk for wrk_ strings.
        if let id = firstMatch(#"id\s*:\s*"(wrk_[^"]+)""#, in: text) {
            return id
        }
        if let data = text.data(using: .utf8),
           let object = try? JSONSerialization.jsonObject(with: data),
           let id = findWorkspaceID(in: object) {
            return id
        }
        throw OpenCodeError.noWorkspace
    }

    private static func findWorkspaceID(in object: Any) -> String? {
        if let dict = object as? [String: Any] {
            for value in dict.values {
                if let found = findWorkspaceID(in: value) { return found }
            }
        } else if let array = object as? [Any] {
            for value in array {
                if let found = findWorkspaceID(in: value) { return found }
            }
        } else if let string = object as? String, string.hasPrefix("wrk_") {
            return string
        }
        return nil
    }

    /// Fetch live usage and build the snapshot. Throws badResponse when the
    /// /go page yields no rolling-usage window (so `sub push` fails loudly
    /// instead of pushing a page of zeros).
    static func usage(cookie rawCookie: String) async throws -> SubSnapshot {
        let cookie = filteredCookie(rawCookie)
        guard !cookie.isEmpty else { throw OpenCodeError.invalidCredentials }

        let workspace = try await workspaceID(cookie: cookie)

        // Usage windows: the /go page embeds rollingUsage/weeklyUsage/monthlyUsage.
        let pageURL = URL(string: "https://opencode.ai/workspace/\(workspace)/go")!
        var pageRequest = URLRequest(url: pageURL)
        pageRequest.setValue(cookie, forHTTPHeaderField: "Cookie")
        pageRequest.setValue(userAgent, forHTTPHeaderField: "User-Agent")
        pageRequest.setValue("text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                             forHTTPHeaderField: "Accept")
        pageRequest.timeoutInterval = 20
        let (pageData, pageResponse) = try await URLSession.shared.data(for: pageRequest)
        guard let pageHTTP = pageResponse as? HTTPURLResponse else {
            throw OpenCodeError.badResponse("no HTTP response from /go page")
        }
        let page = String(data: pageData, encoding: .utf8) ?? ""
        guard pageHTTP.statusCode == 200 else {
            if pageHTTP.statusCode == 401 || pageHTTP.statusCode == 403 {
                throw OpenCodeError.invalidCredentials
            }
            throw OpenCodeError.http(pageHTTP.statusCode, page)
        }

        var tokens: [(String, String)] = [("plan", "opencode-go")]
        guard let rollingPct = firstMatch(#"rollingUsage[^}]*?usagePercent\s*:\s*([0-9]+(?:\.[0-9]+)?)"#, in: page)
        else {
            throw OpenCodeError.badResponse(
                "/go page has no rollingUsage window (page prefix: \(page.prefix(160)))")
        }
        tokens.append(("primaryPct", rollingPct))
        if let resetSec = firstMatch(#"rollingUsage[^}]*?resetInSec\s*:\s*([0-9]+)"#, in: page),
           let sec = Int(resetSec) {
            tokens.append(("primaryResetMin", "\(sec / 60)"))
        }
        if let weekPct = firstMatch(#"weeklyUsage[^}]*?usagePercent\s*:\s*([0-9]+(?:\.[0-9]+)?)"#, in: page) {
            tokens.append(("weekPct", weekPct))
        }
        if let monthPct = firstMatch(#"monthlyUsage[^}]*?usagePercent\s*:\s*([0-9]+(?:\.[0-9]+)?)"#, in: page) {
            tokens.append(("monthPct", monthPct))
        }

        // Zen balance (optional — a failure here must not lose the usage data).
        if let zen = try? await zenBalance(workspace: workspace, pageURL: pageURL, cookie: cookie) {
            tokens.append(("zen", String(format: "%.2f", zen)))
        }
        return SubSnapshot(tokens)
    }

    private static func zenBalance(workspace: String, pageURL: URL, cookie: String) async throws -> Double? {
        let args = "[\"\(workspace)\"]"
        let text = try await serverGET(id: billingServerID, args: args, referer: pageURL, cookie: cookie)
        // JSON form: find a "balance" number, scaled by 1e8.
        if let data = text.data(using: .utf8),
           let object = try? JSONSerialization.jsonObject(with: data),
           let raw = findBalance(in: object) {
            return raw / billingScale
        }
        // Server-fn text form: requires a customerID marker, then balance:N.
        guard matches(#"(?:\"customerID\"|customerID)\s*:"#, in: text),
              let rawText = firstMatch(#"(?:\"balance\"|balance)\s*:\s*(?:\$R\[\d+\]\s*=\s*)?(-?[0-9]+(?:\.[0-9]+)?)"#, in: text),
              let raw = Double(rawText) else {
            return nil
        }
        return raw / billingScale
    }

    private static func findBalance(in object: Any) -> Double? {
        if let dict = object as? [String: Any] {
            for (key, value) in dict {
                if key == "balance" {
                    if let number = value as? Double { return number }
                    if let string = value as? String, let number = Double(string) { return number }
                }
                if let found = findBalance(in: value) { return found }
            }
        } else if let array = object as? [Any] {
            for value in array {
                if let found = findBalance(in: value) { return found }
            }
        }
        return nil
    }
}

// MARK: - USB serial

enum SerialError: Error, CustomStringConvertible, LocalizedError {
    case noDevice
    case openFailed(String)
    case writeFailed(String)

    var description: String {
        switch self {
        case .noDevice:
            return "no OPEN_DESKOS device found at /dev/tty.usbmodem* (is it plugged in over USB?)"
        case .openFailed(let msg):
            return "could not open serial device: \(msg) (close any serial monitor / screen session on the port)"
        case .writeFailed(let msg):
            return "serial write failed: \(msg)"
        }
    }

    var errorDescription: String? { description }
}

/// A minimal POSIX serial writer over the ESP's USB Serial/JTAG console.
enum SerialPush {
    /// Discover the device's /dev/cu.usbmodem* nodes. The ESP32-P4 USB-Serial/
    /// JTAG is the console that owns the `cerb` command; a co-enumerated C6
    /// (esp-hosted WiFi slave) would open its own console instead. When more
    /// than one node exists, probe each and prefer the one that answers a
    /// `cerb sub status` round-trip (i.e. runs the OPEN_DESKOS console).
    static func devicePath() -> String? {
        let fm = FileManager.default
        guard let dir = try? fm.contentsOfDirectory(atPath: "/dev") else { return nil }
        // Prefer the `tty.` callout sibling over `cu.`: opening the cu.* node
        // asserts DTR, which the ESP32-P4 USB-Serial/JTAG CDC reads as a reset
        // into download mode — every poll would reboot the device and the
        // `cerb sub ...` line would be lost during boot. The tty.* node opens
        // without asserting DTR, so status polls and pushes are non-destructive.
        let ttyCandidates = dir
            .filter { $0.hasPrefix("tty.usbmodem") || $0.hasPrefix("tty.usbserial") }
            .map { "/dev/\($0)" }
            .sorted()
        let cuCandidates = dir
            .filter { $0.hasPrefix("cu.usbmodem") || $0.hasPrefix("cu.usbserial") }
            .map { "/dev/\($0)" }
            .sorted()
        let candidates = ttyCandidates.isEmpty ? cuCandidates : ttyCandidates
        if candidates.count <= 1 {
            return candidates.first
        }
        // Multiple consoles: prefer the one that answers `cerb sub status`.
        for path in candidates {
            if let status = try? SerialPush.command("cerb sub status", to: path, timeout: 2),
               status.contains("refresh=") || status.contains("data=") {
                return path
            }
        }
        return candidates.first
    }

    /// Write a command line (terminated with \n) to the device's serial console.
    /// Loops over partial writes (short count / EAGAIN) so a busy or booting
    /// device does not silently drop a truncated line.
    static func send(command: String, to path: String) throws {
        let fd = open(path, O_RDWR | O_NOCTTY | O_NONBLOCK)
        guard fd >= 0 else {
            throw SerialError.openFailed(String(cString: strerror(errno)))
        }
        defer { close(fd) }

        var tio = termios()
        tcgetattr(fd, &tio)
        // Raw-ish: 115200 8N1, no flow control (the USB console ignores baud but
        // sets sane parity/stop).
        tio.c_cflag = tcflag_t(CS8 | CLOCAL | CREAD)
        tio.c_iflag = 0
        tio.c_oflag = 0
        tio.c_lflag = 0
        withUnsafeMutablePointer(to: &tio.c_cc) { ptr in
            ptr.withMemoryRebound(to: cc_t.self, capacity: 20) { arr in
                arr[Int(VMIN)] = 1   // VMIN (Darwin: index 16)
                arr[Int(VTIME)] = 1  // VTIME (Darwin: index 17)
            }
        }
        tcsetattr(fd, TCSANOW, &tio)

        var cmd = command
        cmd.append("\n")
        let bytes = Array(cmd.utf8)
        var sent = 0
        var attempts = 0
        while sent < bytes.count && attempts < 100 {
            let n = bytes[sent...].withUnsafeBufferPointer { buf in
                write(fd, buf.baseAddress, buf.count)
            }
            if n > 0 {
                sent += n
                attempts = 0
            } else if n < 0 && errno == EAGAIN {
                attempts += 1
                usleep(20_000) // device buffer full — wait and retry
            } else if n < 0 {
                throw SerialError.writeFailed(String(cString: strerror(errno)))
            } else {
                attempts += 1
                usleep(20_000)
            }
        }
        guard sent == bytes.count else {
            throw SerialError.writeFailed("timed out writing to serial device")
        }
        usleep(200_000) // give the device a moment to consume the line
    }

    /// Send a command and read back one response line (blocks until a \n or
    /// the timeout). Used by the pull loop to read `cerb sub status`.
    static func command(_ command: String, to path: String, timeout: TimeInterval = 3) throws -> String {
        let fd = open(path, O_RDWR | O_NOCTTY | O_NONBLOCK)
        guard fd >= 0 else {
            throw SerialError.openFailed(String(cString: strerror(errno)))
        }
        defer { close(fd) }

        var tio = termios()
        tcgetattr(fd, &tio)
        tio.c_cflag = tcflag_t(CS8 | CLOCAL | CREAD)
        tio.c_iflag = 0
        tio.c_oflag = 0
        tio.c_lflag = 0
        withUnsafeMutablePointer(to: &tio.c_cc) { ptr in
            ptr.withMemoryRebound(to: cc_t.self, capacity: 20) { arr in
                arr[Int(VMIN)] = 1   // return as soon as bytes are available
                arr[Int(VTIME)] = 1  // 0.1s inter-byte timeout
            }
        }
        tcsetattr(fd, TCSANOW, &tio)

        // Write the command.
        var cmd = command
        cmd.append("\n")
        let bytes = Array(cmd.utf8)
        var sent = 0
        while sent < bytes.count {
            let n = bytes[sent...].withUnsafeBufferPointer { write(fd, $0.baseAddress, $0.count) }
            if n > 0 { sent += n }
            else if n < 0 && errno == EAGAIN { usleep(20_000) }
            else { break }
        }

        // Read until the console prompt "app>" (command echo + response line(s)
        // + prompt) or the timeout elapses. A single newline would only capture
        // the command echo, missing the actual response (e.g. "time set to
        // <epoch>" for `cerb settime`) when the device prints them as separate
        // lines.
        var line = Data()
        let deadline = Date().addingTimeInterval(timeout)
        let prompt = Data("app>".utf8)
        var buf = [UInt8](repeating: 0, count: 512)
        while Date() < deadline && line.range(of: prompt) == nil {
            let n = read(fd, &buf, buf.count)
            if n > 0 {
                line.append(contentsOf: buf[0..<n])
            } else if n < 0 && errno == EAGAIN {
                usleep(50_000)
            } else {
                break
            }
        }
        return String(data: line, encoding: .utf8) ?? ""
    }
}

// MARK: - Command

enum SubCommand {
    static func run(_ arguments: [String]) async throws {
        guard let command = arguments.first else {
            print("OpenDeskOS sub push|pull [--serial <device>] [--dry-run]")
            return
        }
        switch command {
        case "push":
            try await push(arguments: Array(arguments.dropFirst()))
        case "pull":
            try await pull(arguments: Array(arguments.dropFirst()))
        case "--help", "-h", "help":
            print("OpenDeskOS sub push|pull [--serial <device>] [--dry-run]")
        default:
            throw CLIError.invalidArguments(
                "Unknown sub command '\(command)'. Use 'OpenDeskOS sub push|pull'."
            )
        }
    }

    /// `OpenDeskOS sub push [--serial /dev/cu.usbmodem*] [--dry-run]`
    /// Fetch live OpenCode Go usage and push it to the device.
    static func push(arguments: [String]) async throws {
        var serial: String?
        var dryRun = false
        var index = 0
        while index < arguments.count {
            switch arguments[index] {
            case "--serial":
                index += 1
                guard index < arguments.count else {
                    throw CLIError.invalidArguments("--serial requires a device path.")
                }
                serial = arguments[index]
            case "--dry-run":
                dryRun = true
            case "--help", "-h":
                print("OpenDeskOS sub push [--serial /dev/cu.usbmodem*] [--dry-run]")
                return
            default:
                throw CLIError.invalidArguments("Unknown sub push option '\(arguments[index])'.")
            }
            index += 1
        }

        let cookie = try KeychainCookie.read()
        let snapshot = try await OpenCode.usage(cookie: cookie)
        print("fetched: \(snapshot.line)")

        guard !dryRun else {
            print("dry-run: not pushed to device")
            return
        }
        let device = try serial ?? {
            guard let p = SerialPush.devicePath() else { throw SerialError.noDevice }
            return p
        }()
        let command = "cerb sub push " + snapshot.line
        try SerialPush.send(command: command, to: device)
        print("pushed to \(device)")
    }

    /// `OpenDeskOS sub pull [--serial /dev/cu.usbmodem*]` — first push the Mac
    /// wall clock (`cerb settime`), then poll `cerb sub status`; when the
    /// device asks for a refresh (refresh=yes), fetch live OpenCode Go usage
    /// and push it. The launchd agent schedules this every N minutes; the
    /// device repaints the moment a push arrives.
    static func pull(arguments: [String]) async throws {
        var serial: String?
        var dryRun = false
        var index = 0
        while index < arguments.count {
            switch arguments[index] {
            case "--serial":
                index += 1
                guard index < arguments.count else {
                    throw CLIError.invalidArguments("--serial requires a device path.")
                }
                serial = arguments[index]
            case "--dry-run":
                dryRun = true
            case "--help", "-h":
                print("OpenDeskOS sub pull [--serial /dev/cu.usbmodem*] [--dry-run]")
                return
            default:
                throw CLIError.invalidArguments("Unknown sub pull option '\(arguments[index])'.")
            }
            index += 1
        }

        let device = try serial ?? {
            guard let p = SerialPush.devicePath() else { throw SerialError.noDevice }
            return p
        }()

        // Push the Mac wall clock so the launcher clock/date render real values.
        // The device RTC is not battery-backed; every boot starts at the 1970
        // epoch and SNTP (pool.ntp.org) cannot reach the internet from the lab
        // network. The same `cerb settime <epoch>` the manual `OpenDeskOS time
        // set` sends. Pushed before the status check so the device clock is
        // valid for any time-gated logic (e.g., cap_system's SNTP retry loop
        // checks `cap_system_is_time_valid` between retries and stops).
        if !dryRun {
            let epoch = Int(Date().timeIntervalSince1970)
            // command() (not send()) so we read the console echo back and can
            // confirm the device actually applied the wall clock ("time set
            // to <epoch>"). A silent send() could be dropped by a concurrent
            // reader or a booting console and leave the launcher on 1970.
            let reply = try SerialPush.command("cerb settime \(epoch)", to: device, timeout: 3)
            if !reply.contains("time set to") {
                print("warning: device did not acknowledge time set (reply: \(reply.trimmingCharacters(in: .whitespacesAndNewlines)))")
            }
        }

        // Ask the device whether it wants a fresh push. The console echoes the
        // command and prints "data=yes/no refresh=yes/no".
        let status = try SerialPush.command("cerb sub status", to: device, timeout: 4)
        let needsRefresh = status.contains("refresh=yes")

        if dryRun {
            print("status: \(status.trimmingCharacters(in: .whitespacesAndNewlines))")
            let epoch = Int(Date().timeIntervalSince1970)
            print("dry-run: would set device time to \(epoch) and \(needsRefresh ? "fetch + push" : "skip (no refresh pending)")")
            return
        }

        guard needsRefresh else {
            print("no refresh requested by device (\(status.trimmingCharacters(in: .whitespacesAndNewlines)))")
            return
        }

        let cookie = try KeychainCookie.read()
        let snapshot = try await OpenCode.usage(cookie: cookie)
        print("fetched: \(snapshot.line)")
        let command = "cerb sub push " + snapshot.line
        try SerialPush.send(command: command, to: device)
        print("pushed to \(device)")
    }
}

// MARK: - SubPullDaemon

/// LaunchAgent wiring for the background refresher: runs `OpenDeskOS sub pull`
/// on an interval, which keeps the device wall clock synced (cerb settime)
/// and pushes a fresh OpenCode Go snapshot when the device asks for one
/// (refresh=yes). Lives beside the Wispr health agent, installed together by
/// `OpenDeskOS daemon install`.
enum SubPullDaemon {
    static let label = "dev.fradser.open-deskos.sub-pull"

    static var logPath: String {
        URL(fileURLWithPath: CLIStateStore.logPath)
            .deletingLastPathComponent()
            .appendingPathComponent("sub-pull.log", isDirectory: false).path
    }

    static func spec(executablePath: String, interval: Int, environment: [String: String]) -> LaunchAgentSpec {
        LaunchAgentSpec(
            label: label,
            programArguments: [executablePath, "sub", "pull"],
            startInterval: interval,
            environment: environment,
            logPath: logPath
        )
    }
}

// MARK: - TimeCommand

/// `OpenDeskOS time set [--serial /dev/cu.usbmodem*] [--dry-run]`
/// Push the Mac's wall clock to the device over USB so the launcher clock/date
/// and any time-gated logic render real values. The device has no reliable
/// network here, so SNTP retries and times out (15×3s); a USB-injected epoch
/// via `cerb settime <epoch>` makes cap_system see a valid clock and stop.
enum TimeCommand {
    static func run(_ arguments: [String]) async throws {
        guard let sub = arguments.first else {
            print("OpenDeskOS time set [--serial <device>] [--dry-run]")
            return
        }
        guard sub == "set" else {
            throw CLIError.invalidArguments(
                "Unknown time command '\(sub)'. Use 'OpenDeskOS time set'."
            )
        }
        var serial: String?
        var dryRun = false
        var index = 1
        while index < arguments.count {
            switch arguments[index] {
            case "--serial":
                index += 1
                guard index < arguments.count else {
                    throw CLIError.invalidArguments("--serial requires a device path.")
                }
                serial = arguments[index]
            case "--dry-run":
                dryRun = true
            case "--help", "-h":
                print("OpenDeskOS time set [--serial /dev/cu.usbmodem*] [--dry-run]")
                return
            default:
                throw CLIError.invalidArguments("Unknown time set option '\(arguments[index])'.")
            }
            index += 1
        }

        let epoch = Int(Date().timeIntervalSince1970)
        let device = try serial ?? {
            guard let p = SerialPush.devicePath() else { throw SerialError.noDevice }
            return p
        }()

        guard !dryRun else {
            print("dry-run: would set device time to \(epoch) on \(device)")
            return
        }

        let reply = try SerialPush.command("cerb settime \(epoch)", to: device, timeout: 3)
        print("time pushed to \(device): \(reply.trimmingCharacters(in: .whitespacesAndNewlines))")
    }
}
