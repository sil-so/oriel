import Foundation

struct BrowserActivityEvent: Codable {
    let type: String
    let browser: String
    let title: String
    let url: String
    let active: Bool
    let audible: Bool?
    let timestamp: Int64
}

enum BrowserCompanionError: LocalizedError {
    case invalidExtensionIdentifier
    case bridgeNotBundled

    var errorDescription: String? {
        switch self {
        case .invalidExtensionIdentifier:
            return "Enter the 32-character unpacked Chrome or Brave extension identifier before installing browser tracking."
        case .bridgeNotBundled:
            return "OrielBrowserBridge is not present in this application bundle."
        }
    }
}

final class BrowserCompanionService {
    private let eventURL: URL
    private let heartbeatURL: URL
    private let onEvent: (BrowserActivityEvent) -> Void
    private var timer: Timer?
    private(set) var lastSeenAt: Date?

    init(onEvent: @escaping (BrowserActivityEvent) -> Void) throws {
        let directory = try FileManager.default.url(
            for: .applicationSupportDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        ).appendingPathComponent("Oriel", isDirectory: true)
        try FileManager.default.createDirectory(
            at: directory,
            withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700]
        )
        self.eventURL = directory.appendingPathComponent("BrowserEvents.jsonl")
        self.heartbeatURL = directory.appendingPathComponent("BrowserReceiver.ready")
        self.onEvent = onEvent
    }

    func start() {
        publishHeartbeat()
        timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            self?.publishHeartbeat()
            self?.consumePendingEvents()
        }
    }

    func stop() {
        timer?.invalidate()
        timer = nil
        try? FileManager.default.removeItem(at: heartbeatURL)
    }

    func installManifests(extensionIdentifier: String, appBundleURL: URL = Bundle.main.bundleURL) throws -> [URL] {
        let normalized = extensionIdentifier.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard normalized.range(of: #"^[a-p]{32}$"#, options: .regularExpression) != nil else {
            throw BrowserCompanionError.invalidExtensionIdentifier
        }
        let executable = appBundleURL.appendingPathComponent("Contents/MacOS/OrielBrowserBridge")
        guard FileManager.default.isExecutableFile(atPath: executable.path) else {
            throw BrowserCompanionError.bridgeNotBundled
        }
        let manifest: [String: Any] = [
            "name": "so.sil.oriel.browser",
            "description": "Oriel Browser Companion",
            "path": executable.path,
            "type": "stdio",
            "allowed_origins": ["chrome-extension://\(normalized)/"]
        ]
        let data = try JSONSerialization.data(withJSONObject: manifest, options: [.prettyPrinted, .sortedKeys])
        let applicationSupport = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        let targets = [
            applicationSupport.appendingPathComponent("Google/Chrome/NativeMessagingHosts", isDirectory: true),
            applicationSupport.appendingPathComponent("BraveSoftware/Brave-Browser/NativeMessagingHosts", isDirectory: true)
        ]
        return try targets.map { directory in
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let destination = directory.appendingPathComponent("so.sil.oriel.browser.json")
            try data.write(to: destination, options: .atomic)
            return destination
        }
    }

    func statusDescription(isConfigured: Bool) -> String {
        guard isConfigured else { return "Not configured" }
        if let lastSeenAt {
            return "Connected - last seen \(lastSeenAt.formatted(date: .omitted, time: .shortened))"
        }
        return "Configured - awaiting browser activity"
    }

    private func publishHeartbeat() {
        try? Data("ready".utf8).write(to: heartbeatURL, options: .atomic)
        try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: heartbeatURL.path)
    }

    private func consumePendingEvents() {
        guard let data = try? Data(contentsOf: eventURL), !data.isEmpty else { return }
        try? Data().write(to: eventURL, options: .atomic)
        try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: eventURL.path)
        let decoder = JSONDecoder()
        for line in data.split(separator: 0x0a) {
            guard let event = try? decoder.decode(BrowserActivityEvent.self, from: Data(line)),
                  event.type == "browserActivity",
                  ["Google Chrome", "Brave Browser"].contains(event.browser) else { continue }
            lastSeenAt = Date()
            onEvent(event)
        }
    }
}
