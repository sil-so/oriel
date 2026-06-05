import AppKit
import Foundation
import WebKit

final class IconSchemeHandler: NSObject, WKURLSchemeHandler {
    private let store: SQLiteStore
    private let logoDevKeyStore: LogoDevAPIKeyStore
    private let appCacheDirectory: URL
    private let brandCacheDirectory: URL

    init(store: SQLiteStore, logoDevKeyStore: LogoDevAPIKeyStore = KeychainStore()) {
        self.store = store
        self.logoDevKeyStore = logoDevKeyStore
        let cacheRoot = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Oriel", isDirectory: true)
        self.appCacheDirectory = cacheRoot.appendingPathComponent("AppIcons", isDirectory: true)
        self.brandCacheDirectory = cacheRoot.appendingPathComponent("BrandIcons", isDirectory: true)
        super.init()
        try? FileManager.default.createDirectory(at: appCacheDirectory, withIntermediateDirectories: true)
        try? FileManager.default.createDirectory(at: brandCacheDirectory, withIntermediateDirectories: true)
    }

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let url = urlSchemeTask.request.url,
              let components = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
            fail(urlSchemeTask)
            return
        }
        let query: [String: String] = Dictionary(uniqueKeysWithValues: (components.queryItems ?? []).compactMap {
            guard let value = $0.value else { return nil }
            return ($0.name, value)
        })
        switch url.host {
        case "app":
            serveApplicationIcon(query: query, task: urlSchemeTask)
        case "website":
            serveWebsiteIcon(query: query, task: urlSchemeTask)
        default:
            fail(urlSchemeTask)
        }
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {}

    func clearBrandCache() {
        try? FileManager.default.removeItem(at: brandCacheDirectory)
        try? FileManager.default.createDirectory(at: brandCacheDirectory, withIntermediateDirectories: true)
    }

    func clearAllCaches() {
        try? FileManager.default.removeItem(at: appCacheDirectory)
        try? FileManager.default.createDirectory(at: appCacheDirectory, withIntermediateDirectories: true)
        clearBrandCache()
    }

    private func serveApplicationIcon(query: [String: String], task: WKURLSchemeTask) {
        guard let appPath = resolvedApplicationPath(query: query) else {
            fail(task)
            return
        }
        let key = safeFilename([
            query["v"] ?? "native-icons",
            query["bundleId"] ?? query["appName"] ?? appPath
        ].joined(separator: "-"))
        let cached = appCacheDirectory.appendingPathComponent("\(key).png")
        if let data = try? Data(contentsOf: cached) {
            respond(data: data, task: task)
            return
        }
        let icon = NSWorkspace.shared.icon(forFile: appPath)
        guard let tiff = icon.tiffRepresentation,
              let representation = NSBitmapImageRep(data: tiff),
              let data = representation.representation(using: .png, properties: [:]) else {
            fail(task)
            return
        }
        try? data.write(to: cached, options: .atomic)
        respond(data: data, task: task)
    }

    private func resolvedApplicationPath(query: [String: String]) -> String? {
        if let appPath = query["appPath"], FileManager.default.fileExists(atPath: appPath) {
            return appPath
        }

        if isOrielApplication(query: query) {
            return Bundle.main.bundleURL.path
        }

        let candidates = [query["appName"], query["bundleId"]].compactMap { $0 }
        let roots = [
            "/Applications",
            "/System/Applications",
            FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Applications").path
        ]

        for value in candidates {
            let appName = value.hasSuffix(".app") ? value : "\(value).app"
            for root in roots {
                let path = URL(fileURLWithPath: root).appendingPathComponent(appName).path
                if FileManager.default.fileExists(atPath: path) {
                    return path
                }
            }
        }

        for bundleID in query["bundleId"].map({ [$0] }) ?? [] {
            if let appURL = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleID) {
                return appURL.path
            }
        }

        return nil
    }

    private func isOrielApplication(query: [String: String]) -> Bool {
        let values = [query["appName"], query["bundleId"]]
            .compactMap { $0?.lowercased() }
        return values.contains("so.sil.oriel")
            || values.contains("oriel")
            || values.contains("orielapp")
    }

    private func serveWebsiteIcon(query: [String: String], task: WKURLSchemeTask) {
        guard brandIconsEnabled(),
              let logoDevAPIKey = try? logoDevKeyStore.logoDevAPIKey(),
              !logoDevAPIKey.isEmpty,
              let rawDomain = query["domain"]?.lowercased(),
              rawDomain.count <= 253,
              rawDomain.range(of: #"^[a-z0-9.-]+$"#, options: .regularExpression) != nil else {
            fail(task)
            return
        }
        let cached = brandCacheDirectory.appendingPathComponent("\(safeFilename(rawDomain)).png")
        if let data = try? Data(contentsOf: cached) {
            respond(data: data, task: task)
            return
        }
        var components = URLComponents()
        components.scheme = "https"
        components.host = "img.logo.dev"
        components.path = "/\(rawDomain)"
        components.queryItems = [
            URLQueryItem(name: "token", value: logoDevAPIKey),
            URLQueryItem(name: "format", value: "png"),
            URLQueryItem(name: "size", value: "64"),
            URLQueryItem(name: "retina", value: "true"),
            URLQueryItem(name: "fallback", value: "404")
        ]
        guard let logoURL = components.url else {
            fail(task)
            return
        }
        URLSession.shared.dataTask(with: logoURL) { [weak self] data, response, _ in
            guard let self,
                  let response = response as? HTTPURLResponse,
                  response.statusCode == 200,
                  let data, !data.isEmpty else {
                self?.fail(task)
                return
            }
            try? data.write(to: cached, options: .atomic)
            self.respond(data: data, task: task)
        }.resume()
    }

    private func brandIconsEnabled() -> Bool {
        guard let settings = try? store.request(operation: "settings.get", payload: [:]) as? [String: Any] else {
            return false
        }
        return (settings["logoDevIconsEnabled"] as? NSNumber)?.boolValue
            ?? (settings["logoDevIconsEnabled"] as? Bool)
            ?? false
    }

    private func safeFilename(_ value: String) -> String {
        value.lowercased()
            .replacingOccurrences(of: #"[^a-z0-9.-]"#, with: "_", options: .regularExpression)
    }

    private func respond(data: Data, task: WKURLSchemeTask) {
        guard let url = task.request.url else {
            fail(task)
            return
        }
        task.didReceive(URLResponse(
            url: url,
            mimeType: "image/png",
            expectedContentLength: data.count,
            textEncodingName: nil
        ))
        task.didReceive(data)
        task.didFinish()
    }

    private func fail(_ task: WKURLSchemeTask) {
        task.didFailWithError(NSError(domain: NSURLErrorDomain, code: NSURLErrorFileDoesNotExist))
    }
}
