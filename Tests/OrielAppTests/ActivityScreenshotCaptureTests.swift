import XCTest
@testable import OrielApp

final class ActivityScreenshotCaptureTests: XCTestCase {
    func testActiveDisplayUnavailableErrorIsDiagnosticAndFriendly() {
        XCTAssertEqual(
            ActivityScreenshotCaptureError.activeDisplayUnavailable.errorDescription,
            "Oriel could not identify which display contains the active app."
        )
    }

    func testScreenshotCapturingProtocolRequiresTargetDisplayID() throws {
        let capture = RecordingScreenshotCapture()

        _ = try capture.captureDisplay(displayID: 200, maxPixelWidth: 1280, jpegQuality: 0.62)

        XCTAssertEqual(capture.capturedDisplayIDs, [200])
    }
}

private final class RecordingScreenshotCapture: ActivityScreenshotCapturing {
    var capturedDisplayIDs: [UInt32] = []

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
