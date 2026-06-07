import Foundation
import XCTest
@testable import OrielApp

final class ActivitySummaryCoordinatorTests: XCTestCase {
    func testDwellCooldownQueueAndDailyCapDecisions() {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        let base = Date(timeIntervalSince1970: 1_779_768_000)
        let settings = ActivitySummarySettings(
            enabled: true,
            frequencyPreset: "balanced",
            dailyCap: 1,
            timeoutSeconds: 20
        )
        let coordinator = ActivitySummaryCoordinator(maxPending: 1, calendar: calendar, now: base)

        XCTAssertEqual(
            coordinator.decision(contextKey: "safari|example.com", durationSeconds: 30, settings: settings, now: base),
            .belowMinimumDwell
        )
        XCTAssertEqual(
            coordinator.decision(contextKey: "safari|example.com", durationSeconds: 60, settings: settings, now: base),
            .enqueue
        )
        XCTAssertEqual(
            coordinator.decision(contextKey: "xcode|project", durationSeconds: 60, settings: settings, now: base),
            .queueFull
        )

        let finished = expectation(description: "reserved work finished")
        coordinator.enqueueReserved({}, completion: { finished.fulfill() })
        wait(for: [finished], timeout: 1)

        XCTAssertEqual(
            coordinator.decision(
                contextKey: "safari|example.com",
                durationSeconds: 60,
                settings: settings,
                now: base.addingTimeInterval(5 * 60)
            ),
            .dailyCapReached
        )

        XCTAssertEqual(
            coordinator.decision(
                contextKey: "safari|example.com",
                durationSeconds: 60,
                settings: settings,
                now: base.addingTimeInterval(24 * 60 * 60)
            ),
            .enqueue
        )
    }

    func testCooldownAppliesBeforeAnotherSameContextScreenshot() {
        let base = Date(timeIntervalSince1970: 1_779_768_000)
        let settings = ActivitySummarySettings(
            enabled: true,
            frequencyPreset: "high",
            dailyCap: 10,
            timeoutSeconds: 20
        )
        let coordinator = ActivitySummaryCoordinator(maxPending: 2, now: base)

        XCTAssertEqual(
            coordinator.decision(contextKey: "safari|example.com", durationSeconds: 45, settings: settings, now: base),
            .enqueue
        )
        let finished = expectation(description: "reserved work finished")
        coordinator.enqueueReserved({}, completion: { finished.fulfill() })
        wait(for: [finished], timeout: 1)

        XCTAssertEqual(
            coordinator.decision(
                contextKey: "safari|example.com",
                durationSeconds: 45,
                settings: settings,
                now: base.addingTimeInterval(4 * 60)
            ),
            .cooldownActive
        )
        XCTAssertEqual(
            coordinator.decision(
                contextKey: "safari|example.com",
                durationSeconds: 45,
                settings: settings,
                now: base.addingTimeInterval(6 * 60)
            ),
            .enqueue
        )
    }
}
