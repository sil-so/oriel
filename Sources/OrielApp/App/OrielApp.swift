import AppKit

@main
final class OrielApp: NSObject, NSApplicationDelegate, NSWindowDelegate {
    private var store: SQLiteStore!
    private var trackingController: TrackingController!
    private var browserCompanion: BrowserCompanionService?
    private var mainWindow: NSWindow!
    private var preferencesController: PreferencesWindowController!
    private var onboardingController: OnboardingWindowController?
    private var statusItem: NSStatusItem?
    private var trackingMenuItem: NSMenuItem?
    private var iconHandler: IconSchemeHandler!
    private let trafficLightLeading: CGFloat = 17.5
    private let trafficLightTopOffset: CGFloat = 19.5
    private let trafficLightSpacing: CGFloat = 20

    static func main() {
        let application = NSApplication.shared
        let delegate = OrielApp()
        application.delegate = delegate
        application.run()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        do {
            store = try SQLiteStore()
        } catch {
            presentFatalError(error)
            return
        }
        trackingController = TrackingController(store: store)
        trackingController.start()
        browserCompanion = try? BrowserCompanionService { [weak self] event in
            self?.trackingController.acceptBrowserEvent(event)
        }
        browserCompanion?.start()
        iconHandler = IconSchemeHandler(store: store)
        preferencesController = PreferencesWindowController(
            trackingController: trackingController,
            store: store,
            browserCompanion: browserCompanion
        )
        setupMainMenu()
        setupStatusItem()
        showMainWindow()
        if !UserDefaults.standard.bool(forKey: "didPresentOrielOnboarding") {
            onboardingController = OnboardingWindowController()
            onboardingController?.present()
        }
    }

    func applicationWillTerminate(_ notification: Notification) {
        trackingController?.stop()
        browserCompanion?.stop()
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag {
            showMainWindow()
        }
        return true
    }

    @objc private func showMainWindow() {
        if mainWindow == nil {
            let aiService = AIService()
            let bridge = OrielBridge(
                store: store,
                aiService: aiService,
                statusProvider: { [weak self] in
                    self?.trackingController.status() ?? [
                        "nativeStatus": "unavailable",
                        "nativeMessage": "Tracking has not started"
                    ]
                },
                currentActivityProvider: { [weak self] payload in
                    self?.trackingController.currentActivity(for: payload)
                },
                passiveReviewResolver: { [weak self] payload in
                    try self?.trackingController.resolvePassiveReview(payload) ?? ["resolved": false]
                },
                beforeMutationHandler: { [weak self] _ in
                    self?.trackingController.rolloverForCapturePolicyChange()
                },
                privacyMutationHandler: { [weak self] operation, payload in
                    if operation == "data.purge" {
                        self?.iconHandler.clearAllCaches()
                    } else if operation == "settings.update" && payload["logoDevIconsEnabled"] as? Bool == false {
                        self?.iconHandler.clearBrandCache()
                    }
                }
            )
            let webRoot = Bundle.main.resourceURL?.appendingPathComponent("Web", isDirectory: true)
                ?? URL(fileURLWithPath: FileManager.default.currentDirectoryPath, isDirectory: true)
            let controller = OrielWebViewController(bridge: bridge, webRoot: webRoot, iconHandler: iconHandler)
            mainWindow = NSWindow(
                contentRect: NSScreen.main?.frame ?? NSRect(x: 0, y: 0, width: 1360, height: 870),
                styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
                backing: .buffered,
                defer: false
            )
            mainWindow.title = "Oriel"
            mainWindow.titleVisibility = .hidden
            mainWindow.titlebarAppearsTransparent = true
            mainWindow.isMovableByWindowBackground = true
            mainWindow.contentViewController = controller
            mainWindow.isReleasedWhenClosed = false
            mainWindow.delegate = self
            mainWindow.minSize = NSSize(width: 960, height: 640)
            repositionMainWindowChrome()
        }
        fitMainWindowToScreenEdges()
        mainWindow.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        repositionMainWindowChrome()
        DispatchQueue.main.async { [weak self] in
            self?.repositionMainWindowChrome()
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { [weak self] in
            self?.repositionMainWindowChrome()
        }
    }

    func windowDidResize(_ notification: Notification) {
        repositionMainWindowChrome()
    }

    func windowDidBecomeKey(_ notification: Notification) {
        repositionMainWindowChrome()
    }

    func windowDidUpdate(_ notification: Notification) {
        repositionMainWindowChrome()
    }

    private func repositionMainWindowChrome() {
        guard let mainWindow else { return }
        mainWindow.contentView?.layoutSubtreeIfNeeded()
        positionTrafficLightButtons(in: mainWindow)
    }

    private func positionTrafficLightButtons(in window: NSWindow) {
        guard let contentView = window.contentView else { return }
        let buttonTypes: [NSWindow.ButtonType] = [.closeButton, .miniaturizeButton, .zoomButton]

        for (index, buttonType) in buttonTypes.enumerated() {
            guard let button = window.standardWindowButton(buttonType) else { continue }
            if button.superview !== contentView {
                button.removeFromSuperview()
                contentView.addSubview(button, positioned: .above, relativeTo: nil)
            }
            button.setFrameOrigin(NSPoint(
                x: trafficLightLeading + CGFloat(index) * trafficLightSpacing,
                y: trafficLightButtonY(in: contentView, buttonHeight: button.frame.height)
            ))
        }
    }

    private func trafficLightButtonY(in contentView: NSView, buttonHeight: CGFloat) -> CGFloat {
        if contentView.isFlipped {
            return trafficLightTopOffset
        }
        return max(0, contentView.bounds.height - trafficLightTopOffset - buttonHeight)
    }

    private func fitMainWindowToScreenEdges() {
        guard let mainWindow else { return }
        let screenFrame = screenFrameForMainWindow()
        guard mainWindow.frame != screenFrame else { return }
        mainWindow.setFrame(screenFrame, display: true)
    }

    private func screenFrameForMainWindow() -> NSRect {
        mainWindow?.screen?.frame
            ?? NSScreen.main?.frame
            ?? NSRect(x: 0, y: 0, width: 1360, height: 870)
    }

    @objc private func showPreferences() {
        preferencesController.present()
    }

    @objc private func toggleTracking() {
        trackingController.togglePaused()
        trackingMenuItem?.title = trackingController.isPaused ? "Resume Tracking" : "Pause Tracking"
    }

    @objc private func terminate() {
        NSApp.terminate(nil)
    }

    private func setupStatusItem() {
        let statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        statusItem.button?.title = ""
        statusItem.button?.image = statusItemImage()
        statusItem.button?.imagePosition = .imageOnly
        let menu = NSMenu()
        menu.addItem(NSMenuItem(title: "Open Oriel", action: #selector(showMainWindow), keyEquivalent: ""))
        let trackingItem = NSMenuItem(title: "Pause Tracking", action: #selector(toggleTracking), keyEquivalent: "")
        menu.addItem(trackingItem)
        menu.addItem(NSMenuItem.separator())
        menu.addItem(NSMenuItem(title: "Preferences...", action: #selector(showPreferences), keyEquivalent: ","))
        menu.addItem(NSMenuItem.separator())
        menu.addItem(NSMenuItem(title: "Quit", action: #selector(terminate), keyEquivalent: "q"))
        for item in menu.items where item.action != nil {
            item.target = self
        }
        statusItem.menu = menu
        self.statusItem = statusItem
        self.trackingMenuItem = trackingItem
    }

    private func statusItemImage() -> NSImage? {
        guard let url = Bundle.main.url(forResource: "OrielStatusIcon", withExtension: "png"),
              let image = NSImage(contentsOf: url) else {
            return NSImage(systemSymbolName: "clock", accessibilityDescription: "Oriel")
        }
        image.isTemplate = true
        image.size = NSSize(width: 15, height: 15)
        image.accessibilityDescription = "Oriel"
        return image
    }

    private func setupMainMenu() {
        let mainMenu = NSMenu()
        let appMenuItem = NSMenuItem()
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "Preferences...", action: #selector(showPreferences), keyEquivalent: ",").target = self
        appMenu.addItem(NSMenuItem.separator())
        appMenu.addItem(withTitle: "Quit Oriel", action: #selector(terminate), keyEquivalent: "q").target = self
        appMenuItem.submenu = appMenu
        mainMenu.addItem(appMenuItem)
        NSApp.mainMenu = mainMenu
    }

    private func presentFatalError(_ error: Error) {
        let alert = NSAlert()
        alert.messageText = "Oriel could not open local storage."
        alert.informativeText = error.localizedDescription
        alert.runModal()
        NSApp.terminate(nil)
    }
}
