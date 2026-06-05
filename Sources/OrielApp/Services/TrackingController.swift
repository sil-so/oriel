import AppKit
import ApplicationServices
import Foundation

final class TrackingController {
    private enum InteractionState: String {
        case handsOn
        case handsOff
    }

    private struct ActiveSegment {
        let start: Int64
        let app: String
        let title: String
        let url: String?
        let bundleIdentifier: String?
        let appPath: String?
        let interactionState: InteractionState

        func matches(_ other: ActiveSegment) -> Bool {
            sameActivity(as: other) && interactionState == other.interactionState
        }

        func sameActivity(as other: ActiveSegment) -> Bool {
            app == other.app && title == other.title && url == other.url
                && bundleIdentifier == other.bundleIdentifier && appPath == other.appPath
        }

        func withStart(_ start: Int64) -> ActiveSegment {
            ActiveSegment(
                start: start,
                app: app,
                title: title,
                url: url,
                bundleIdentifier: bundleIdentifier,
                appPath: appPath,
                interactionState: interactionState
            )
        }

        func withInteractionState(_ interactionState: InteractionState, start: Int64) -> ActiveSegment {
            ActiveSegment(
                start: start,
                app: app,
                title: title,
                url: url,
                bundleIdentifier: bundleIdentifier,
                appPath: appPath,
                interactionState: interactionState
            )
        }
    }

    private let store: SQLiteStore
    private let idleThresholdSeconds: TimeInterval = 30
    private var observers: [NSObjectProtocol] = []
    private var timer: Timer?
    private var currentSegment: ActiveSegment?
    private var isAway = false
    private(set) var isPaused = false

    init(store: SQLiteStore) {
        self.store = store
    }

    deinit {
        stop()
    }

    func start() {
        guard observers.isEmpty else { return }
        requestAccessibilityIfNeeded()
        let workspaceCenter = NSWorkspace.shared.notificationCenter
        observers.append(workspaceCenter.addObserver(
            forName: NSWorkspace.didActivateApplicationNotification,
            object: nil,
            queue: .main
        ) { [weak self] notification in
            guard let application = notification.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication else {
                return
            }
            self?.capture(application: application)
        })
        observers.append(workspaceCenter.addObserver(
            forName: NSWorkspace.screensDidSleepNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.enterAway()
        })
        observers.append(workspaceCenter.addObserver(
            forName: NSWorkspace.willSleepNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.enterAway()
        })
        observers.append(workspaceCenter.addObserver(
            forName: NSWorkspace.sessionDidResignActiveNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.enterAway()
        })
        observers.append(workspaceCenter.addObserver(
            forName: NSWorkspace.screensDidWakeNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.resumeFromAway()
        })
        observers.append(workspaceCenter.addObserver(
            forName: NSWorkspace.didWakeNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.resumeFromAway()
        })
        observers.append(workspaceCenter.addObserver(
            forName: NSWorkspace.sessionDidBecomeActiveNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.resumeFromAway()
        })
        timer = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in
            self?.pollForegroundState()
        }
        pollForegroundState()
    }

    private func requestAccessibilityIfNeeded() {
        guard !AXIsProcessTrusted() else { return }
        let options = [
            kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true
        ] as CFDictionary
        _ = AXIsProcessTrustedWithOptions(options)
    }

    func togglePaused() {
        if isPaused {
            isPaused = false
            isAway = false
            pollForegroundState()
        } else {
            flush()
            isPaused = true
        }
    }

    func stop() {
        flush()
        timer?.invalidate()
        timer = nil
        let workspaceCenter = NSWorkspace.shared.notificationCenter
        observers.forEach { workspaceCenter.removeObserver($0) }
        observers.removeAll()
    }

    func status() -> [String: Any] {
        let trusted = AXIsProcessTrusted()
        if isPaused {
            return statusPayload(
                nativeStatus: "degraded",
                nativeMessage: "Tracking paused",
                trackingEnabled: false,
                trusted: trusted
            )
        }
        if isAway {
            return statusPayload(
                nativeStatus: "active",
                nativeMessage: "Tracking active; user is away",
                trackingEnabled: true,
                trusted: trusted
            )
        }
        return statusPayload(
            nativeStatus: trusted ? "active" : "degraded",
            nativeMessage: trusted
                ? "Native application, window, and activity mix capture is active"
                : "App tracking is active. Window titles need Accessibility for this Oriel build.",
            trackingEnabled: true,
            trusted: trusted
        )
    }

    func resolvePassiveReview(_ payload: [String: Any]) throws -> [String: Any] {
        [
            "resolved": false,
            "action": payload["action"] as? String ?? "",
            "durationMs": 0
        ]
    }

    private func statusPayload(
        nativeStatus: String,
        nativeMessage: String,
        trackingEnabled: Bool,
        trusted: Bool
    ) -> [String: Any] {
        [
            "nativeStatus": nativeStatus,
            "nativeMessage": nativeMessage,
            "trackingEnabled": trackingEnabled,
            "accessibilityGranted": trusted
        ]
    }

    func acceptBrowserEvent(_ event: BrowserActivityEvent) {
        guard !isPaused, !isAway else { return }
        guard event.active,
              let application = NSWorkspace.shared.frontmostApplication,
              application.localizedName == event.browser else { return }
        let now = Date()
        transition(to: ActiveSegment(
            start: Int64(now.timeIntervalSince1970 * 1000),
            app: event.browser,
            title: event.title,
            url: event.url,
            bundleIdentifier: application.bundleIdentifier,
            appPath: application.bundleURL?.path,
            interactionState: interactionState(now: now)
        ))
    }

    func rolloverForCapturePolicyChange() {
        guard !isPaused, !isAway else { return }
        flush()
        pollForegroundState()
    }

    func currentActivity(for payload: [String: Any]) -> [String: Any]? {
        guard !isPaused, !isAway, let segment = currentSegment, isRecordable(segment) else {
            return nil
        }
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        let today = formatter.string(from: Date())
        if let date = payload["date"] as? String, date != today {
            return nil
        }
        if let startDate = payload["startDate"] as? String,
           let endDate = payload["endDate"] as? String,
           !(startDate...endDate).contains(today) {
            return nil
        }
        return [
            "start": segment.start,
            "end": Int64(Date().timeIntervalSince1970 * 1000),
            "app": segment.app,
            "title": segment.title,
            "url": segment.url ?? "",
            "bundleId": segment.bundleIdentifier ?? "",
            "appPath": segment.appPath ?? "",
            "interactionState": segment.interactionState.rawValue
        ]
    }

    private func pollForegroundState() {
        guard !isPaused, !isAway else { return }
        let idleSeconds = secondsSinceUserInput()
        let now = Date()
        let nowMs = Int64(now.timeIntervalSince1970 * 1000)
        let targetState: InteractionState = idleSeconds >= idleThresholdSeconds ? .handsOff : .handsOn
        let segmentStart: Int64

        if targetState == .handsOff {
            let cutoff = Int64((now.timeIntervalSince1970 - (idleSeconds - idleThresholdSeconds)) * 1000)
            if currentSegment?.interactionState == .handsOn {
                transitionCurrentSegmentToHandsOff(at: cutoff)
                segmentStart = cutoff
            } else {
                segmentStart = nowMs
            }
        } else if currentSegment?.interactionState == .handsOff {
            let inputReturn = Int64((now.timeIntervalSince1970 - idleSeconds) * 1000)
            flush(at: max(inputReturn, currentSegment?.start ?? inputReturn))
            segmentStart = inputReturn
        } else {
            segmentStart = nowMs
        }

        if let application = NSWorkspace.shared.frontmostApplication {
            capture(application: application, interactionState: targetState, start: segmentStart)
        }
    }

    private func transitionCurrentSegmentToHandsOff(at cutoff: Int64) {
        guard let segment = currentSegment, segment.interactionState == .handsOn else { return }
        currentSegment = nil
        do {
            try persistActivity(segment: segment, start: segment.start, end: cutoff)
        } catch {
            NSLog("Oriel could not persist recorded hands-on activity: %@", error.localizedDescription)
        }
        currentSegment = segment.withInteractionState(.handsOff, start: max(cutoff, segment.start))
    }

    private func enterAway() {
        flush()
        currentSegment = nil
        isAway = true
    }

    private func resumeFromAway() {
        guard !isPaused else { return }
        currentSegment = nil
        isAway = false
        pollForegroundState()
    }

    private func isRecordable(_ segment: ActiveSegment) -> Bool {
        (try? !store.isCaptureExcluded(app: segment.app, title: segment.title, url: segment.url)) == true
    }

    private func capture(application: NSRunningApplication) {
        guard !isPaused, !isAway else { return }
        let now = Date()
        capture(
            application: application,
            interactionState: interactionState(now: now),
            start: Int64(now.timeIntervalSince1970 * 1000)
        )
    }

    private func capture(application: NSRunningApplication, interactionState: InteractionState, start: Int64) {
        guard !isPaused, !isAway else { return }
        transition(to: snapshot(for: application, interactionState: interactionState, start: start))
    }

    private func transition(to snapshot: ActiveSegment) {
        if let currentSegment, currentSegment.matches(snapshot) {
            return
        }
        flush()
        self.currentSegment = snapshot
    }

    private func snapshot(
        for application: NSRunningApplication,
        interactionState: InteractionState,
        start: Int64
    ) -> ActiveSegment {
        let appName = application.localizedName ?? "Unknown Application"
        var title = appName
        var url: String?
        if AXIsProcessTrusted() {
            let appElement = AXUIElementCreateApplication(application.processIdentifier)
            if let windowValue = attribute(kAXFocusedWindowAttribute as CFString, from: appElement) {
                let window = windowValue as! AXUIElement
                title = attribute(kAXTitleAttribute as CFString, from: window) as? String ?? appName
                if let document = attribute(kAXDocumentAttribute as CFString, from: window) {
                    url = (document as? URL)?.absoluteString ?? document as? String
                }
                if url == nil, let pageURL = attribute(kAXURLAttribute as CFString, from: window) {
                    url = (pageURL as? URL)?.absoluteString ?? pageURL as? String
                }
            }
        }
        return ActiveSegment(
            start: start,
            app: appName,
            title: title,
            url: url,
            bundleIdentifier: application.bundleIdentifier,
            appPath: application.bundleURL?.path,
            interactionState: interactionState
        )
    }

    private func attribute(_ name: CFString, from element: AXUIElement) -> Any? {
        var result: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, name, &result) == .success else { return nil }
        return result
    }

    private func interactionState(now: Date) -> InteractionState {
        secondsSinceUserInput() >= idleThresholdSeconds ? .handsOff : .handsOn
    }

    private func secondsSinceUserInput() -> TimeInterval {
        [
            CGEventSource.secondsSinceLastEventType(.combinedSessionState, eventType: .keyDown),
            CGEventSource.secondsSinceLastEventType(.combinedSessionState, eventType: .mouseMoved),
            CGEventSource.secondsSinceLastEventType(.combinedSessionState, eventType: .leftMouseDown),
            CGEventSource.secondsSinceLastEventType(.combinedSessionState, eventType: .scrollWheel)
        ].min() ?? 0
    }

    private func flush(at end: Int64 = Int64(Date().timeIntervalSince1970 * 1000)) {
        guard let segment = currentSegment else { return }
        currentSegment = nil
        guard end > segment.start else { return }
        do {
            try persistActivity(segment: segment, start: segment.start, end: end)
        } catch {
            NSLog("Oriel could not persist recorded activity: %@", error.localizedDescription)
        }
    }

    private func persistActivity(segment: ActiveSegment, start: Int64, end: Int64) throws {
        guard end > start else { return }
        guard try !store.isCaptureExcluded(app: segment.app, title: segment.title, url: segment.url) else {
            return
        }
        try store.recordActivity(
            start: start,
            end: end,
            app: segment.app,
            title: segment.title,
            url: segment.url,
            bundleIdentifier: segment.bundleIdentifier,
            appPath: segment.appPath,
            interactionState: segment.interactionState.rawValue
        )
    }
}
