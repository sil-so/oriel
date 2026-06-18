import Foundation
import XCTest
@testable import OrielApp

final class TrackingControllerTests: XCTestCase {
    func testBrowserTabContextSurvivesGenericNativeSnapshot() {
        let current = TrackingController.ActiveSegment(
            start: 1_000,
            app: "Brave Browser",
            title: "Example research",
            url: "https://example.com/research",
            bundleIdentifier: "com.brave.Browser",
            appPath: "/Applications/Brave Browser.app",
            processIdentifier: 42,
            focusedDisplayID: 100,
            interactionState: .handsOn
        )
        let genericNativeSnapshot = TrackingController.ActiveSegment(
            start: 3_000,
            app: "Brave Browser",
            title: "Brave Browser",
            url: nil,
            bundleIdentifier: "com.brave.Browser",
            appPath: "/Applications/Brave Browser.app",
            processIdentifier: 42,
            focusedDisplayID: 200,
            interactionState: .handsOff
        )

        let resolved = TrackingController.resolvedSnapshot(
            current: current,
            incoming: genericNativeSnapshot
        )

        XCTAssertEqual(resolved.start, genericNativeSnapshot.start)
        XCTAssertEqual(resolved.app, "Brave Browser")
        XCTAssertEqual(resolved.title, current.title)
        XCTAssertEqual(resolved.url, current.url)
        XCTAssertEqual(resolved.bundleIdentifier, genericNativeSnapshot.bundleIdentifier)
        XCTAssertEqual(resolved.appPath, genericNativeSnapshot.appPath)
        XCTAssertEqual(resolved.processIdentifier, genericNativeSnapshot.processIdentifier)
        XCTAssertEqual(resolved.focusedDisplayID, genericNativeSnapshot.focusedDisplayID)
        XCTAssertEqual(resolved.interactionState, .handsOff)
    }

    func testMeaningfulBrowserSnapshotReplacesPreviousTabContext() {
        let current = TrackingController.ActiveSegment(
            start: 1_000,
            app: "Brave Browser",
            title: "Example research",
            url: "https://example.com/research",
            bundleIdentifier: "com.brave.Browser",
            appPath: "/Applications/Brave Browser.app",
            processIdentifier: 42,
            focusedDisplayID: 100,
            interactionState: .handsOn
        )
        let meaningfulNativeSnapshot = TrackingController.ActiveSegment(
            start: 3_000,
            app: "Brave Browser",
            title: "Example dashboard",
            url: nil,
            bundleIdentifier: "com.brave.Browser",
            appPath: "/Applications/Brave Browser.app",
            processIdentifier: 42,
            focusedDisplayID: 200,
            interactionState: .handsOn
        )

        let resolved = TrackingController.resolvedSnapshot(
            current: current,
            incoming: meaningfulNativeSnapshot
        )

        XCTAssertEqual(resolved.title, meaningfulNativeSnapshot.title)
        XCTAssertNil(resolved.url)
        XCTAssertEqual(resolved.focusedDisplayID, meaningfulNativeSnapshot.focusedDisplayID)
    }

    func testDisplayChangeIsNotTheSameActiveSegment() {
        let builtInDisplaySegment = TrackingController.ActiveSegment(
            start: 1_000,
            app: "Xcode",
            title: "OrielApp.swift",
            url: nil,
            bundleIdentifier: "com.apple.dt.Xcode",
            appPath: "/Applications/Xcode.app",
            processIdentifier: 42,
            focusedDisplayID: 100,
            interactionState: .handsOn
        )
        let externalDisplaySegment = TrackingController.ActiveSegment(
            start: 3_000,
            app: "Xcode",
            title: "OrielApp.swift",
            url: nil,
            bundleIdentifier: "com.apple.dt.Xcode",
            appPath: "/Applications/Xcode.app",
            processIdentifier: 42,
            focusedDisplayID: 200,
            interactionState: .handsOn
        )

        XCTAssertFalse(builtInDisplaySegment.matches(externalDisplaySegment))
    }

    func testMissingFocusedDisplaySkipsScreenshotSummaryWithoutProviderRequest() throws {
        let store = try makeStore()
        let activityID = "activity-missing-display"
        try store.recordActivity(
            id: activityID,
            start: 1_779_768_000_000,
            end: 1_779_768_060_000,
            app: "Xcode",
            title: "OrielApp.swift",
            url: nil,
            bundleIdentifier: "com.apple.dt.Xcode",
            appPath: "/Applications/Xcode.app",
            interactionState: "handsOn"
        )
        _ = try store.request(operation: "settings.update", payload: [
            "aiScreenshotSummariesEnabled": true,
            "aiScreenshotProvider": "openai",
            "aiScreenshotFrequencyPreset": "high"
        ])
        let client = RecordingActivitySummaryClient()
        let controller = TrackingController(
            store: store,
            keyStore: TrackingFakeAPIKeyStore(keys: ["openai": "test-key"]),
            activitySummaryClient: client,
            screenshotCapture: TrackingPermissionOnlyScreenshotCapture()
        )
        let segment = TrackingController.ActiveSegment(
            start: 1_779_768_000_000,
            app: "Xcode",
            title: "OrielApp.swift",
            url: nil,
            bundleIdentifier: "com.apple.dt.Xcode",
            appPath: "/Applications/Xcode.app",
            processIdentifier: 42,
            focusedDisplayID: nil,
            interactionState: .handsOn
        )

        controller.maybeEnqueueActivitySummary(
            activityID: activityID,
            segment: segment,
            start: 1_779_768_000_000,
            end: 1_779_768_060_000
        )
        let persisted = expectation(description: "skipped summary persisted")
        DispatchQueue.main.async { persisted.fulfill() }
        wait(for: [persisted], timeout: 1)

        let rows = try XCTUnwrap(try store.request(operation: "activityAISummaries.list", payload: [:]) as? [[String: Any]])
        XCTAssertEqual(rows.count, 1)
        XCTAssertEqual(rows.first?["status"] as? String, "skipped")
        XCTAssertEqual(rows.first?["errorCode"] as? String, "active_display_unavailable")
        XCTAssertTrue(client.requests.isEmpty)
    }

    private func makeStore() throws -> SQLiteStore {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("OrielTrackingControllerTests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return try SQLiteStore(databaseURL: directory.appendingPathComponent("Oriel.sqlite"))
    }
}

private final class TrackingFakeAPIKeyStore: APIKeyStore {
    private let keys: [String: String]

    init(keys: [String: String]) {
        self.keys = keys
    }

    func save(apiKey: String, provider: String) throws {}
    func apiKey(for provider: String) throws -> String? { keys[provider] }
    func delete(provider: String) throws {}
    func hasKey(for provider: String) -> Bool { keys[provider] != nil }
}

private final class RecordingActivitySummaryClient: ActivitySummaryClient {
    private(set) var requests: [ActivitySummaryRequest] = []

    func summarize(_ request: ActivitySummaryRequest) async throws -> ActivitySummaryResponse {
        requests.append(request)
        return ActivitySummaryResponse(summary: [
            "app": request.metadata.frontmostAppName,
            "bundle_id": request.metadata.bundleID,
            "window_or_page": request.metadata.windowTitle ?? "",
            "project_or_context": "",
            "activity": "Editing Swift code",
            "category": "engineering",
            "action": "editing",
            "objects": ["code"],
            "confidence": 0.9,
            "evidence": ["editor"],
            "uncertainties": [],
            "cloud_safe_summary": "Edited Swift code.",
            "sensitivity": "low",
            "metadata_conflicts": []
        ])
    }
}

private final class TrackingPermissionOnlyScreenshotCapture: ActivityScreenshotCapturing {
    func hasScreenRecordingPermission() -> Bool {
        true
    }

    func captureDisplay(displayID: UInt32, maxPixelWidth: CGFloat, jpegQuality: CGFloat) throws -> CapturedActivityScreenshot {
        XCTFail("Missing display IDs should skip before screenshot capture.")
        throw ActivityScreenshotCaptureError.activeDisplayUnavailable
    }
}
