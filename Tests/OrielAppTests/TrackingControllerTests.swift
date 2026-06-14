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
            interactionState: .handsOn
        )

        let resolved = TrackingController.resolvedSnapshot(
            current: current,
            incoming: meaningfulNativeSnapshot
        )

        XCTAssertEqual(resolved.title, meaningfulNativeSnapshot.title)
        XCTAssertNil(resolved.url)
    }
}
