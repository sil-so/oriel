import Foundation

private struct BrowserActivity: Codable {
    let type: String
    let browser: String
    let title: String
    let url: String
    let active: Bool
    let audible: Bool?
    let timestamp: Int64

    func validate() throws {
        guard type == "browserActivity",
              ["Google Chrome", "Brave Browser"].contains(browser),
              !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              title.count <= 1_000,
              url.count <= 8_192,
              URL(string: url)?.scheme?.lowercased().hasPrefix("http") == true else {
            throw BridgeError.invalidMessage
        }
    }
}

private enum BridgeError: Error {
    case invalidLength
    case invalidMessage
}

private let maximumMessageBytes = 64 * 1024
private let input = FileHandle.standardInput
private let output = FileHandle.standardOutput

private func inboxURL() throws -> URL {
    let support = try FileManager.default.url(
        for: .applicationSupportDirectory,
        in: .userDomainMask,
        appropriateFor: nil,
        create: true
    ).appendingPathComponent("Oriel", isDirectory: true)
    try FileManager.default.createDirectory(
        at: support,
        withIntermediateDirectories: true,
        attributes: [.posixPermissions: 0o700]
    )
    return support.appendingPathComponent("BrowserEvents.jsonl")
}

private func appIsListening() throws -> Bool {
    let readyURL = try inboxURL().deletingLastPathComponent().appendingPathComponent("BrowserReceiver.ready")
    guard let attributes = try? FileManager.default.attributesOfItem(atPath: readyURL.path),
          let modificationDate = attributes[.modificationDate] as? Date else {
        return false
    }
    return Date().timeIntervalSince(modificationDate) < 4
}

private func append(_ event: BrowserActivity) throws {
    guard try appIsListening() else {
        throw BridgeError.invalidMessage
    }
    let destination = try inboxURL()
    let encoded = try JSONEncoder().encode(event) + Data([0x0a])
    if !FileManager.default.fileExists(atPath: destination.path) {
        try encoded.write(to: destination, options: .atomic)
    } else {
        let handle = try FileHandle(forWritingTo: destination)
        try handle.seekToEnd()
        try handle.write(contentsOf: encoded)
        try handle.close()
    }
    try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: destination.path)
}

private func readMessage() throws -> Data? {
    let lengthData = try input.read(upToCount: 4) ?? Data()
    if lengthData.isEmpty { return nil }
    guard lengthData.count == 4 else { throw BridgeError.invalidLength }
    let length = lengthData.withUnsafeBytes { $0.loadUnaligned(as: UInt32.self).littleEndian }
    guard length > 0, length <= maximumMessageBytes,
          let message = try input.read(upToCount: Int(length)),
          message.count == Int(length) else {
        throw BridgeError.invalidLength
    }
    return message
}

private func reply(_ value: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: value) else { return }
    var length = UInt32(data.count).littleEndian
    let lengthData = Data(bytes: &length, count: MemoryLayout<UInt32>.size)
    try? output.write(contentsOf: lengthData + data)
}

while true {
    do {
        guard let data = try readMessage() else { break }
        let event = try JSONDecoder().decode(BrowserActivity.self, from: data)
        try event.validate()
        try append(event)
        reply(["ok": true])
    } catch {
        reply(["ok": false, "error": "Invalid browser activity message"])
    }
}
