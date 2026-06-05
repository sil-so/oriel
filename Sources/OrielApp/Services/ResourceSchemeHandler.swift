import Foundation
import UniformTypeIdentifiers
import WebKit

final class ResourceSchemeHandler: NSObject, WKURLSchemeHandler {
    private let webRoot: URL

    init(webRoot: URL) {
        self.webRoot = webRoot.standardizedFileURL
    }

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let url = urlSchemeTask.request.url else {
            fail(urlSchemeTask)
            return
        }
        let requestedPath = url.path == "/" || url.path.isEmpty ? "/index.html" : url.path
        let fileURL = webRoot.appendingPathComponent(String(requestedPath.dropFirst())).standardizedFileURL
        guard fileURL.path.hasPrefix(webRoot.path),
              let data = try? Data(contentsOf: fileURL) else {
            fail(urlSchemeTask)
            return
        }
        let mimeType = UTType(filenameExtension: fileURL.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
        let response = URLResponse(
            url: url,
            mimeType: mimeType,
            expectedContentLength: data.count,
            textEncodingName: mimeType.hasPrefix("text/") || mimeType.contains("javascript") ? "utf-8" : nil
        )
        urlSchemeTask.didReceive(response)
        urlSchemeTask.didReceive(data)
        urlSchemeTask.didFinish()
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {}

    private func fail(_ task: WKURLSchemeTask) {
        task.didFailWithError(NSError(domain: NSURLErrorDomain, code: NSURLErrorFileDoesNotExist))
    }
}
