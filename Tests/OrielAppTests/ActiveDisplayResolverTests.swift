import CoreGraphics
import XCTest
@testable import OrielApp

final class ActiveDisplayResolverTests: XCTestCase {
    private let builtInDisplay = ActiveDisplayResolver.Display(
        id: 100,
        bounds: CGRect(x: 0, y: 0, width: 1440, height: 900)
    )
    private let externalDisplay = ActiveDisplayResolver.Display(
        id: 200,
        bounds: CGRect(x: 1440, y: 0, width: 1920, height: 1080)
    )

    func testFocusedWindowOnBuiltInDisplayResolvesBuiltInDisplay() {
        let displayID = ActiveDisplayResolver.resolveDisplayID(
            focusedWindowBounds: CGRect(x: 120, y: 90, width: 900, height: 700),
            frontmostWindowBounds: [],
            pointerLocation: nil,
            displays: [builtInDisplay, externalDisplay]
        )

        XCTAssertEqual(displayID, builtInDisplay.id)
    }

    func testFocusedWindowOnExternalDisplayResolvesExternalDisplay() {
        let displayID = ActiveDisplayResolver.resolveDisplayID(
            focusedWindowBounds: CGRect(x: 1600, y: 90, width: 1200, height: 700),
            frontmostWindowBounds: [],
            pointerLocation: nil,
            displays: [builtInDisplay, externalDisplay]
        )

        XCTAssertEqual(displayID, externalDisplay.id)
    }

    func testSpanningWindowChoosesDisplayWithLargestOverlap() {
        let displayID = ActiveDisplayResolver.resolveDisplayID(
            focusedWindowBounds: CGRect(x: 1200, y: 100, width: 1000, height: 600),
            frontmostWindowBounds: [],
            pointerLocation: nil,
            displays: [builtInDisplay, externalDisplay]
        )

        XCTAssertEqual(displayID, externalDisplay.id)
    }

    func testFrontmostWindowBoundsFallbackSupportsFullScreenWindows() {
        let displayID = ActiveDisplayResolver.resolveDisplayID(
            focusedWindowBounds: nil,
            frontmostWindowBounds: [
                CGRect(x: 1440, y: 0, width: 1920, height: 1080),
                CGRect(x: 100, y: 100, width: 300, height: 200)
            ],
            pointerLocation: nil,
            displays: [builtInDisplay, externalDisplay]
        )

        XCTAssertEqual(displayID, externalDisplay.id)
    }

    func testPointerFallbackResolvesDisplayWhenNoWindowBoundsAreUsable() {
        let displayID = ActiveDisplayResolver.resolveDisplayID(
            focusedWindowBounds: nil,
            frontmostWindowBounds: [],
            pointerLocation: CGPoint(x: 1700, y: 500),
            displays: [builtInDisplay, externalDisplay]
        )

        XCTAssertEqual(displayID, externalDisplay.id)
    }

    func testUnresolvedDisplayReturnsNilWhenNoFallbackMatches() {
        let displayID = ActiveDisplayResolver.resolveDisplayID(
            focusedWindowBounds: nil,
            frontmostWindowBounds: [CGRect(x: -500, y: -500, width: 100, height: 100)],
            pointerLocation: CGPoint(x: -10, y: -10),
            displays: [builtInDisplay, externalDisplay]
        )

        XCTAssertNil(displayID)
    }
}
