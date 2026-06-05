import AppKit
import Foundation
import ApplicationServices

final class AppTracker {
    private var lastAppIdentity: String?
    private var reportedActive = false

    private var activeObserver: AXObserver?
    private var activeObservedPid: pid_t?

    init() {
        NSWorkspace.shared.notificationCenter.addObserver(
            self,
            selector: #selector(appChanged),
            name: NSWorkspace.didActivateApplicationNotification,
            object: nil
        )

        reportStatus("active", "Real-time app activation observer registered")
        reportCurrentApplication()
    }

    @objc private func appChanged(notification: Notification) {
        reportCurrentApplication()
    }

    private func reportCurrentApplication() {
        guard let app = activeApplication() else {
            return
        }

        if !reportedActive {
            reportedActive = true
            reportStatus("active", "Native app tracker active")
        }

        setupObserver(for: app)
        report(app: app)
    }

    private func activeApplication() -> NSRunningApplication? {
        if let frontmostApp = NSWorkspace.shared.frontmostApplication {
            return frontmostApp
        }
        return NSWorkspace.shared.runningApplications.first { $0.isActive }
    }

    private func setupObserver(for app: NSRunningApplication) {
        let pid = app.processIdentifier
        if pid == activeObservedPid {
            return // Already observing this app
        }

        stopObservingCurrentApp()

        var observer: AXObserver?

        let status = AXObserverCreate(pid, { (observer, element, notification, refcon) in
            guard let refcon = refcon else { return }
            let tracker = Unmanaged<AppTracker>.fromOpaque(refcon).takeUnretainedValue()
            tracker.handleNotification()
        }, &observer)

        guard status == .success, let obs = observer else {
            return
        }

        let runLoopSource = AXObserverGetRunLoopSource(obs)
        CFRunLoopAddSource(CFRunLoopGetCurrent(), runLoopSource, .defaultMode)

        let appElement = AXUIElementCreateApplication(pid)
        let selfPointer = Unmanaged.passUnretained(self).toOpaque()

        // Add notifications for window focus and title changes
        AXObserverAddNotification(obs, appElement, kAXFocusedWindowChangedNotification as CFString, selfPointer)
        AXObserverAddNotification(obs, appElement, kAXTitleChangedNotification as CFString, selfPointer)

        self.activeObserver = obs
        self.activeObservedPid = pid
    }

    private func stopObservingCurrentApp() {
        guard let observer = activeObserver, let pid = activeObservedPid else { return }

        let appElement = AXUIElementCreateApplication(pid)
        AXObserverRemoveNotification(observer, appElement, kAXFocusedWindowChangedNotification as CFString)
        AXObserverRemoveNotification(observer, appElement, kAXTitleChangedNotification as CFString)

        let runLoopSource = AXObserverGetRunLoopSource(observer)
        CFRunLoopRemoveSource(CFRunLoopGetCurrent(), runLoopSource, .defaultMode)

        self.activeObserver = nil
        self.activeObservedPid = nil
    }

    private func handleNotification() {
        // When any window title or focus changes, re-report the frontmost app's info
        guard let app = activeApplication() else { return }
        report(app: app)
    }

    private func report(app: NSRunningApplication) {
        let appName = app.localizedName ?? "Unknown"
        let pid = app.processIdentifier
        let bundleId = app.bundleIdentifier ?? appName

        // Get window title and document URL natively
        let (windowTitle, documentUrl) = getActiveWindowInfo(pid: pid)

        let identity = "\(bundleId):\(pid):\(windowTitle):\(documentUrl)"
        if identity == lastAppIdentity {
            return // Skip duplicate events to prevent segment fragmentation
        }
        lastAppIdentity = identity

        let timestamp = Int64(Date().timeIntervalSince1970 * 1000)
        let payload: [String: Any] = [
            "timestamp": timestamp,
            "appName": appName,
            "pid": pid,
            "bundleId": app.bundleIdentifier ?? "",
            "appPath": app.bundleURL?.path ?? "",
            "windowTitle": windowTitle,
            "documentUrl": documentUrl
        ]

        if let data = try? JSONSerialization.data(withJSONObject: payload),
           let json = String(data: data, encoding: .utf8) {
            print("EVENT:APP_CHANGE_JSON:\(json)")
            fflush(stdout)
        } else {
            print("EVENT:APP_CHANGE:\(timestamp):\(appName):\(pid)")
            fflush(stdout)
        }
    }

    private func getActiveWindowInfo(pid: pid_t) -> (title: String, documentURL: String) {
        let appRef = AXUIElementCreateApplication(pid)
        var focusedWindowVal: AnyObject?
        let status = AXUIElementCopyAttributeValue(appRef, kAXFocusedWindowAttribute as CFString, &focusedWindowVal)

        guard status == .success, let focusedWindow = focusedWindowVal as! AXUIElement? else {
            return ("", "")
        }

        var title = ""
        var titleVal: AnyObject?
        if AXUIElementCopyAttributeValue(focusedWindow, kAXTitleAttribute as CFString, &titleVal) == .success,
           let t = titleVal as? String {
            title = t
        }

        var docURL = ""
        var docVal: AnyObject?
        if AXUIElementCopyAttributeValue(focusedWindow, kAXDocumentAttribute as CFString, &docVal) == .success,
           let d = docVal as? String {
            docURL = d
        } else if AXUIElementCopyAttributeValue(focusedWindow, kAXURLAttribute as CFString, &docVal) == .success,
                  let u = docVal as? String {
            docURL = u
        }

        return (title, docURL)
    }

    private func reportStatus(_ status: String, _ message: String) {
        print("EVENT:TRACKER_STATUS:\(status):\(message)")
        fflush(stdout)
    }

    deinit {
        stopObservingCurrentApp()
    }
}

let tracker = AppTracker()
RunLoop.main.run()
