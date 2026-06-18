import Foundation
import XCTest
@testable import OrielApp

final class OrielBridgeScreenshotSummaryTests: XCTestCase {
    @MainActor
    func testScreenshotSummaryTestUsesCurrentActivityDisplayID() async throws {
        let capture = BridgeRecordingScreenshotCapture()
        let client = BridgeRecordingActivitySummaryClient()
        let bridge = OrielBridge(
            store: try makeStore(),
            activitySummaryClient: client,
            screenshotCapture: capture,
            statusProvider: { [:] },
            currentActivityProvider: { _ in
                [
                    "app": "Xcode",
                    "title": "OrielApp.swift",
                    "url": "",
                    "bundleId": "com.apple.dt.Xcode",
                    "displayId": "200",
                    "interactionState": "handsOn",
                    "start": 1_779_768_000_000 as Int64,
                    "end": 1_779_768_060_000 as Int64
                ]
            }
        )

        let result = try await bridge.testScreenshotSummary(payload: [
            "provider": "openai",
            "model": "gpt-5.2",
            "timeoutSeconds": 20
        ])

        XCTAssertEqual(capture.capturedDisplayIDs, [200])
        XCTAssertEqual(client.requests.first?.metadata.displayID, "200")
        XCTAssertEqual(result["imageWidth"] as? Int, 10)
    }

    @MainActor
    func testScreenshotSummaryTestFailsBeforeCaptureWhenDisplayIDIsMissing() async throws {
        let capture = BridgeRecordingScreenshotCapture()
        let client = BridgeRecordingActivitySummaryClient()
        let bridge = OrielBridge(
            store: try makeStore(),
            activitySummaryClient: client,
            screenshotCapture: capture,
            statusProvider: { [:] },
            currentActivityProvider: { _ in
                [
                    "app": "Xcode",
                    "title": "OrielApp.swift",
                    "interactionState": "handsOn"
                ]
            }
        )

        do {
            _ = try await bridge.testScreenshotSummary(payload: ["provider": "openai"])
            XCTFail("Expected missing display ID to fail the explicit screenshot test.")
        } catch ActivityScreenshotCaptureError.activeDisplayUnavailable {
            XCTAssertTrue(capture.capturedDisplayIDs.isEmpty)
            XCTAssertTrue(client.requests.isEmpty)
        }
    }

    private func makeStore() throws -> SQLiteStore {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("OrielBridgeScreenshotTests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return try SQLiteStore(databaseURL: directory.appendingPathComponent("Oriel.sqlite"))
    }
}

private final class BridgeRecordingScreenshotCapture: ActivityScreenshotCapturing {
    private(set) var capturedDisplayIDs: [UInt32] = []

    func hasScreenRecordingPermission() -> Bool {
        true
    }

    func captureDisplay(displayID: UInt32, maxPixelWidth: CGFloat, jpegQuality: CGFloat) throws -> CapturedActivityScreenshot {
        capturedDisplayIDs.append(displayID)
        return CapturedActivityScreenshot(
            jpegData: Data([0xFF, 0xD8, 0xFF, 0xD9]),
            width: 10,
            height: 10,
            displayID: String(displayID)
        )
    }
}

private final class BridgeRecordingActivitySummaryClient: ActivitySummaryClient {
    private(set) var requests: [ActivitySummaryRequest] = []

    func summarize(_ request: ActivitySummaryRequest) async throws -> ActivitySummaryResponse {
        requests.append(request)
        return ActivitySummaryResponse(summary: [
            "app": request.metadata.frontmostAppName,
            "bundle_id": request.metadata.bundleID,
            "window_or_page": request.metadata.windowTitle ?? "",
            "project_or_context": "Oriel",
            "activity": "Testing screenshot summaries",
            "category": "engineering",
            "action": "testing",
            "objects": ["screenshot summary"],
            "confidence": 0.9,
            "evidence": ["settings test"],
            "uncertainties": [],
            "cloud_safe_summary": "Tested screenshot summaries.",
            "sensitivity": "low",
            "metadata_conflicts": []
        ])
    }
}
