import AppKit
import WebKit

final class OrielWebViewController: NSViewController, WKNavigationDelegate {
    private let bridge: OrielBridge
    private let resourceHandler: ResourceSchemeHandler
    private let iconHandler: IconSchemeHandler
    private(set) var webView: WKWebView!

    init(bridge: OrielBridge, webRoot: URL, iconHandler: IconSchemeHandler) {
        self.bridge = bridge
        self.resourceHandler = ResourceSchemeHandler(webRoot: webRoot)
        self.iconHandler = iconHandler
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func loadView() {
        let configuration = WKWebViewConfiguration()
        configuration.userContentController.addScriptMessageHandler(
            bridge,
            contentWorld: .page,
            name: "oriel"
        )
        configuration.setURLSchemeHandler(resourceHandler, forURLScheme: "oriel-resource")
        configuration.setURLSchemeHandler(iconHandler, forURLScheme: "oriel-icon")
        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self
        view = webView
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        webView.load(URLRequest(url: URL(string: "oriel-resource://app/index.html")!))
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        guard navigationAction.navigationType == .linkActivated,
              let url = navigationAction.request.url,
              ["http", "https"].contains(url.scheme?.lowercased() ?? "") else {
            decisionHandler(.allow)
            return
        }
        NSWorkspace.shared.open(url)
        decisionHandler(.cancel)
    }
}
