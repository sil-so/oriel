import AppKit
import ApplicationServices
import Foundation

final class TrackingController {
    enum InteractionState: String {
        case handsOn
        case handsOff
    }

    struct ActiveSegment {
        let start: Int64
        let app: String
        let title: String
        let url: String?
        let bundleIdentifier: String?
        let appPath: String?
        let processIdentifier: pid_t?
        let focusedDisplayID: CGDirectDisplayID?
        let interactionState: InteractionState

        func matches(_ other: ActiveSegment) -> Bool {
            sameActivity(as: other) && interactionState == other.interactionState
        }

        func sameActivity(as other: ActiveSegment) -> Bool {
            app == other.app && title == other.title && url == other.url
                && bundleIdentifier == other.bundleIdentifier && appPath == other.appPath
                && focusedDisplayID == other.focusedDisplayID
        }

        func withStart(_ start: Int64) -> ActiveSegment {
            ActiveSegment(
                start: start,
                app: app,
                title: title,
                url: url,
                bundleIdentifier: bundleIdentifier,
                appPath: appPath,
                processIdentifier: processIdentifier,
                focusedDisplayID: focusedDisplayID,
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
                processIdentifier: processIdentifier,
                focusedDisplayID: focusedDisplayID,
                interactionState: interactionState
            )
        }
    }

    private let store: SQLiteStore
    private let keyStore: APIKeyStore
    private let activitySummaryClient: ActivitySummaryClient
    private let activitySummaryCoordinator: ActivitySummaryCoordinator
    private let screenshotCapture: ActivityScreenshotCapturing
    private let idleThresholdSeconds: TimeInterval = 30
    private var observers: [NSObjectProtocol] = []
    private var timer: Timer?
    private var currentSegment: ActiveSegment?
    private var isAway = false
    private(set) var isPaused = false

    init(
        store: SQLiteStore,
        keyStore: APIKeyStore = KeychainStore(),
        activitySummaryClient: ActivitySummaryClient? = nil,
        activitySummaryCoordinator: ActivitySummaryCoordinator = ActivitySummaryCoordinator(),
        screenshotCapture: ActivityScreenshotCapturing = ActivityScreenshotCapture()
    ) {
        self.store = store
        self.keyStore = keyStore
        self.activitySummaryClient = activitySummaryClient ?? ProviderActivitySummaryClient(keyStore: keyStore)
        self.activitySummaryCoordinator = activitySummaryCoordinator
        self.screenshotCapture = screenshotCapture
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
            processIdentifier: application.processIdentifier,
            focusedDisplayID: ActiveDisplayResolver.resolveDisplayID(
                for: application,
                focusedWindow: focusedWindow(for: application)
            ),
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
            "displayId": segment.focusedDisplayID.map(String.init) ?? "",
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
        let resolvedSnapshot = Self.resolvedSnapshot(current: currentSegment, incoming: snapshot)
        if let currentSegment, currentSegment.matches(resolvedSnapshot) {
            return
        }
        flush()
        self.currentSegment = resolvedSnapshot
    }

    static func resolvedSnapshot(current: ActiveSegment?, incoming: ActiveSegment) -> ActiveSegment {
        guard let current,
              current.app == incoming.app,
              isBrowserApp(incoming.app),
              hasBrowserURL(current),
              !hasBrowserURL(incoming),
              isGenericBrowserTitle(incoming.title, app: incoming.app) else {
            return incoming
        }

        return ActiveSegment(
            start: incoming.start,
            app: incoming.app,
            title: current.title,
            url: current.url,
            bundleIdentifier: incoming.bundleIdentifier ?? current.bundleIdentifier,
            appPath: incoming.appPath ?? current.appPath,
            processIdentifier: incoming.processIdentifier ?? current.processIdentifier,
            focusedDisplayID: incoming.focusedDisplayID,
            interactionState: incoming.interactionState
        )
    }

    private static func isBrowserApp(_ app: String) -> Bool {
        app == "Brave Browser" || app == "Google Chrome"
    }

    private static func hasBrowserURL(_ segment: ActiveSegment) -> Bool {
        guard let url = segment.url?.trimmingCharacters(in: .whitespacesAndNewlines) else {
            return false
        }
        return !url.isEmpty
    }

    private static func isGenericBrowserTitle(_ title: String, app: String) -> Bool {
        title.trimmingCharacters(in: .whitespacesAndNewlines) == app
    }

    private func snapshot(
        for application: NSRunningApplication,
        interactionState: InteractionState,
        start: Int64
    ) -> ActiveSegment {
        let appName = application.localizedName ?? "Unknown Application"
        var title = appName
        var url: String?
        var focusedWindowElement: AXUIElement?
        if AXIsProcessTrusted() {
            let appElement = AXUIElementCreateApplication(application.processIdentifier)
            if let window = focusedWindow(from: appElement) {
                focusedWindowElement = window
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
            processIdentifier: application.processIdentifier,
            focusedDisplayID: ActiveDisplayResolver.resolveDisplayID(
                for: application,
                focusedWindow: focusedWindowElement
            ),
            interactionState: interactionState
        )
    }

    private func focusedWindow(for application: NSRunningApplication) -> AXUIElement? {
        guard AXIsProcessTrusted() else { return nil }
        let appElement = AXUIElementCreateApplication(application.processIdentifier)
        return focusedWindow(from: appElement)
    }

    private func focusedWindow(from appElement: AXUIElement) -> AXUIElement? {
        var result: CFTypeRef?
        guard AXUIElementCopyAttributeValue(appElement, kAXFocusedWindowAttribute as CFString, &result) == .success,
              let value = result,
              CFGetTypeID(value) == AXUIElementGetTypeID() else {
            return nil
        }
        return (value as! AXUIElement)
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
        let activityID = "activity-\(UUID().uuidString.lowercased())"
        try store.recordActivity(
            id: activityID,
            start: start,
            end: end,
            app: segment.app,
            title: segment.title,
            url: segment.url,
            bundleIdentifier: segment.bundleIdentifier,
            appPath: segment.appPath,
            interactionState: segment.interactionState.rawValue
        )
        maybeEnqueueActivitySummary(activityID: activityID, segment: segment, start: start, end: end)
    }

    func maybeEnqueueActivitySummary(activityID: String, segment: ActiveSegment, start: Int64, end: Int64) {
        guard segment.interactionState == .handsOn else { return }

        let persistedSettings = (try? store.request(operation: "settings.get", payload: [:]) as? [String: Any]) ?? [:]
        guard !Self.isScreenshotSensitive(
            app: segment.app,
            title: segment.title,
            bundleIdentifier: segment.bundleIdentifier,
            appPath: segment.appPath,
            settings: persistedSettings
        ) else { return }
        let settings = activitySummarySettings(from: persistedSettings)
        guard settings.enabled else { return }
        let durationSeconds = max(0, Int((end - start) / 1000))
        guard durationSeconds >= settings.dwellSeconds else { return }
        guard let provider = Self.screenshotSummaryProvider(from: persistedSettings) else {
            storeActivityAISummaryFailure(
                activityID: activityID,
                provider: "",
                model: "",
                code: "missing_provider",
                message: "Choose an AI provider before enabling screenshot summaries."
            )
            return
        }
        let model = Self.screenshotSummaryModel(provider: provider, settings: persistedSettings)
        guard keyStore.hasKey(for: provider.rawValue) else {
            storeActivityAISummaryFailure(
                activityID: activityID,
                provider: provider.rawValue,
                model: model,
                code: "missing_api_key",
                message: "No API key is saved for the selected AI provider."
            )
            return
        }
        guard screenshotCapture.hasScreenRecordingPermission() else {
            storeActivityAISummaryFailure(
                activityID: activityID,
                provider: provider.rawValue,
                model: model,
                code: "screen_recording_permission_missing",
                message: "Screen Recording permission is required for screenshot summaries."
            )
            return
        }
        guard segment.focusedDisplayID != nil else {
            storeActivityAISummarySkipped(
                activityID: activityID,
                provider: provider.rawValue,
                model: model,
                code: "active_display_unavailable",
                message: ActivityScreenshotCaptureError.activeDisplayUnavailable.localizedDescription
            )
            return
        }

        let contextKey = activitySummaryContextKey(segment)
        let decision = activitySummaryCoordinator.decision(
            contextKey: contextKey,
            durationSeconds: durationSeconds,
            settings: settings
        )
        guard decision == .enqueue else {
            if decision == .queueFull {
                storeActivityAISummarySkipped(
                    activityID: activityID,
                    provider: provider.rawValue,
                    model: model,
                    code: "queue_full",
                    message: "The screenshot summary queue is full."
                )
            }
            return
        }

        activitySummaryCoordinator.enqueueReserved { [weak self] in
            await self?.captureAndSummarizeActivity(
                activityID: activityID,
                segment: segment,
                start: start,
                end: end,
                provider: provider,
                model: model,
                settings: settings,
                contextKey: contextKey
            )
        }
    }

    private func captureAndSummarizeActivity(
        activityID: String,
        segment: ActiveSegment,
        start: Int64,
        end: Int64,
        provider: AIProvider,
        model: String,
        settings: ActivitySummarySettings,
        contextKey: String
    ) async {
        do {
            guard let displayID = segment.focusedDisplayID else {
                throw ActivityScreenshotCaptureError.activeDisplayUnavailable
            }
            let screenshot = try screenshotCapture.captureDisplay(
                displayID: displayID,
                maxPixelWidth: 1280,
                jpegQuality: 0.62
            )
            let metadata = activitySummaryMetadata(
                activityID: activityID,
                segment: segment,
                start: start,
                end: end,
                screenshot: screenshot
            )
            let request = ActivitySummaryRequest(
                provider: provider.rawValue,
                model: model,
                metadata: metadata,
                jpegData: screenshot.jpegData,
                timeoutSeconds: settings.timeoutSeconds
            )
            let response = try await activitySummaryClient.summarize(request)
            storeActivityAISummary(
                [
                    "activityId": activityID,
                    "status": "succeeded",
                    "provider": provider.rawValue,
                    "model": model,
                    "summary": response.summary,
                    "imageWidth": screenshot.width,
                    "imageHeight": screenshot.height,
                    "compressedBytes": screenshot.jpegData.count,
                    "requestMetadata": [
                        "contextKey": contextKey,
                        "frequencyPreset": settings.frequencyPreset,
                        "timeoutSeconds": settings.timeoutSeconds,
                        "durationSeconds": max(0, Int((end - start) / 1000))
                    ]
                ]
            )
        } catch {
            let failure = activitySummaryFailure(for: error)
            storeActivityAISummaryFailure(
                activityID: activityID,
                provider: provider.rawValue,
                model: model,
                code: failure.code,
                message: failure.message
            )
        }
    }

    private func activitySummaryMetadata(
        activityID: String,
        segment: ActiveSegment,
        start: Int64,
        end: Int64,
        screenshot: CapturedActivityScreenshot
    ) -> ActivitySummaryMetadata {
        ActivitySummaryMetadata(
            activityID: activityID,
            captureTimestampISO: ISO8601DateFormatter().string(from: Date()),
            durationSeconds: max(0, Int((end - start) / 1000)),
            frontmostAppName: segment.app,
            bundleID: segment.bundleIdentifier ?? "",
            processID: segment.processIdentifier.map(Int.init),
            windowTitle: segment.title,
            browserURL: segment.url,
            browserDomain: browserDomain(from: segment.url),
            projectName: nil,
            inputState: segment.interactionState == .handsOn ? "hands_on" : "hands_off",
            screenshotWidth: screenshot.width,
            screenshotHeight: screenshot.height,
            displayID: screenshot.displayID
        )
    }

    private func activitySummarySettings(from settings: [String: Any]) -> ActivitySummarySettings {
        ActivitySummarySettings(
            enabled: boolValue(settings["aiScreenshotSummariesEnabled"]),
            frequencyPreset: ["low", "balanced", "high"].contains(stringValue(settings["aiScreenshotFrequencyPreset"]) ?? "")
                ? stringValue(settings["aiScreenshotFrequencyPreset"])!
                : "balanced",
            dailyCap: clampedInt(settings["aiScreenshotDailyCap"], defaultValue: 100, min: 1, max: 1000),
            timeoutSeconds: clampedInt(settings["aiScreenshotTimeoutSeconds"], defaultValue: 20, min: 5, max: 60)
        )
    }

    static func screenshotSummaryModel(provider: AIProvider, settings: [String: Any]) -> String {
        let key: String
        switch provider {
        case .openai:
            key = "aiScreenshotOpenAIModel"
        case .google:
            key = "aiScreenshotGoogleModel"
        case .anthropic:
            key = "aiScreenshotAnthropicModel"
        case .openrouter:
            key = "aiScreenshotOpenRouterModel"
        }
        return trimmedString(settings[key]) ?? provider.defaultModel
    }

    static func screenshotSummaryProvider(from settings: [String: Any]) -> AIProvider? {
        if let screenshotProvider = AIProvider.normalize(trimmedString(settings["aiScreenshotProvider"])) {
            return screenshotProvider
        }
        return AIProvider.normalize(trimmedString(settings["aiProvider"]))
    }

    private static func trimmedString(_ value: Any?) -> String? {
        guard let string = value as? String else { return nil }
        let trimmed = string.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    private func activitySummaryContextKey(_ segment: ActiveSegment) -> String {
        let appKey = (segment.bundleIdentifier?.isEmpty == false ? segment.bundleIdentifier : segment.app) ?? segment.app
        let detail = browserDomain(from: segment.url) ?? cleanedContextTitle(segment.title)
        return "\(appKey.lowercased())|\(detail)"
    }

    private func browserDomain(from urlString: String?) -> String? {
        guard let urlString, let host = URL(string: urlString)?.host?.lowercased(), !host.isEmpty else {
            return nil
        }
        return host
    }

    private func cleanedContextTitle(_ title: String) -> String {
        title
            .lowercased()
            .components(separatedBy: .whitespacesAndNewlines)
            .filter { !$0.isEmpty }
            .joined(separator: " ")
    }

    static func isScreenshotSensitive(
        app: String,
        title: String,
        bundleIdentifier: String?,
        appPath: String?,
        settings: [String: Any]
    ) -> Bool {
        let configured = settings["aiScreenshotSensitiveApps"] as? [String]
        let patterns = configured?.isEmpty == false ? configured! : [
            "1password",
            "bitwarden",
            "dashlane",
            "keychain access",
            "lastpass",
            "proton pass",
            "keeper password",
            "authenticator"
        ]
        let combined = [
            app,
            title,
            bundleIdentifier ?? "",
            appPath ?? ""
        ].joined(separator: " ").lowercased()
        return patterns
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }
            .filter { !$0.isEmpty }
            .contains { combined.contains($0) }
    }

    private func storeActivityAISummaryFailure(
        activityID: String,
        provider: String,
        model: String,
        code: String,
        message: String
    ) {
        storeActivityAISummary([
            "activityId": activityID,
            "status": "failed",
            "provider": provider,
            "model": model,
            "errorCode": code,
            "errorMessage": message
        ])
    }

    private func storeActivityAISummarySkipped(
        activityID: String,
        provider: String,
        model: String,
        code: String,
        message: String
    ) {
        storeActivityAISummary([
            "activityId": activityID,
            "status": "skipped",
            "provider": provider,
            "model": model,
            "errorCode": code,
            "errorMessage": message
        ])
    }

    private func storeActivityAISummary(_ payload: [String: Any]) {
        DispatchQueue.main.async { [weak self] in
            do {
                try self?.store.upsertActivityAISummary(payload)
            } catch {
                NSLog("Oriel could not persist AI activity summary state: %@", error.localizedDescription)
            }
        }
    }

    private func activitySummaryFailure(for error: Error) -> (code: String, message: String) {
        if case let ActivitySummaryClientError.providerError(statusCode, code, message) = error {
            return ("provider_\(statusCode)_\(code)", message)
        }
        if let error = error as? ActivitySummaryClientError {
            switch error {
            case .missingAPIKey:
                return ("missing_api_key", error.localizedDescription)
            case .unsupportedProvider:
                return ("unsupported_provider", error.localizedDescription)
            case .invalidProviderResponse:
                return ("invalid_provider_response", error.localizedDescription)
            case .providerError:
                break
            }
        }
        if let error = error as? ActivityScreenshotCaptureError {
            switch error {
            case .screenRecordingPermissionMissing:
                return ("screen_recording_permission_missing", error.localizedDescription)
            case .activeDisplayUnavailable:
                return ("active_display_unavailable", error.localizedDescription)
            case .captureFailed:
                return ("capture_failed", error.localizedDescription)
            case .encodingFailed:
                return ("encoding_failed", error.localizedDescription)
            }
        }
        return ("summary_failed", String(error.localizedDescription.prefix(300)))
    }

    private func stringValue(_ value: Any?) -> String? {
        switch value {
        case let value as String:
            let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
            return trimmed.isEmpty ? nil : trimmed
        default:
            return nil
        }
    }

    private func boolValue(_ value: Any?) -> Bool {
        switch value {
        case let value as Bool:
            return value
        case let value as NSNumber:
            return value.boolValue
        case let value as String:
            return ["true", "1", "yes"].contains(value.lowercased())
        default:
            return false
        }
    }

    private func clampedInt(_ value: Any?, defaultValue: Int, min: Int, max: Int) -> Int {
        let number: Int?
        switch value {
        case let value as Int:
            number = value
        case let value as Int64:
            number = Int(value)
        case let value as NSNumber:
            number = value.intValue
        case let value as String:
            number = Int(value)
        default:
            number = nil
        }
        return Swift.max(min, Swift.min(max, number ?? defaultValue))
    }
}
