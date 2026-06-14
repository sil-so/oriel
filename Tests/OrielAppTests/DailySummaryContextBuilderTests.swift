import Foundation
import XCTest
@testable import OrielApp

final class DailySummaryContextBuilderTests: XCTestCase {
    func testBuildClustersEvidenceAndComputesSanitizedStats() throws {
        let base = try millis(2026, 6, 7, hour: 9, minute: 0)
        let output = DailySummaryContextBuilder.build(
            date: "2026-06-07",
            activitySummaries: [
                [
                    "activityId": "activity-a",
                    "start": base,
                    "end": base + 60 * 60 * 1000,
                    "app": "Xcode",
                    "title": "DailySummaryContextBuilder.swift",
                    "bundleId": "com.apple.dt.Xcode",
                    "summary": [
                        "project_or_context": "Oriel",
                        "activity": "Editing summary context code",
                        "category": "engineering",
                        "action": "editing",
                        "objects": ["Swift", "daily summary prompt"],
                        "cloud_safe_summary": "Edited the daily summary context builder."
                    ]
                ],
                [
                    "activityId": "activity-b",
                    "start": base + 60 * 60 * 1000,
                    "end": base + 2 * 60 * 60 * 1000,
                    "app": "Xcode",
                    "title": "DailySummaryContextBuilderTests.swift",
                    "summary": [
                        "project_or_context": "Oriel",
                        "activity": "Writing summary context tests",
                        "category": "engineering",
                        "action": "testing",
                        "objects": ["Swift tests"],
                        "cloud_safe_summary": "Added coverage for clustered AI summary evidence."
                    ]
                ],
                [
                    "activityId": "activity-b2",
                    "start": base + 2 * 60 * 60 * 1000,
                    "end": base + 2 * 60 * 60 * 1000 + 20 * 60 * 1000,
                    "app": "Xcode",
                    "title": "AIService.swift",
                    "summary": [
                        "project_or_context": "Oriel",
                        "activity": "Editing daily summary prompt guidance",
                        "category": "engineering",
                        "action": "editing",
                        "objects": ["prompt guidance"],
                        "cloud_safe_summary": "Tightened daily summary prompt instructions."
                    ]
                ],
                [
                    "activityId": "activity-c",
                    "start": base + 4 * 60 * 60 * 1000,
                    "end": base + 4 * 60 * 60 * 1000 + 30 * 60 * 1000,
                    "app": "Brave Browser",
                    "title": "Portable monitor comparison",
                    "summary": [
                        "project_or_context": "Product research",
                        "activity": "Comparing monitor options",
                        "category": "research",
                        "action": "comparing",
                        "objects": ["portable monitors"],
                        "cloud_safe_summary": "Compared portable monitor options."
                    ]
                ]
            ],
            activities: [
                [
                    "start": base,
                    "end": base + 2 * 60 * 60 * 1000,
                    "app": "Xcode",
                    "title": "DailySummaryContextBuilder.swift",
                    "url": "file:///Users/example/private/DailySummaryContextBuilder.swift",
                    "bundleId": "com.apple.dt.Xcode",
                    "appPath": "/Applications/Xcode.app"
                ],
                [
                    "start": base + 4 * 60 * 60 * 1000,
                    "end": base + 4 * 60 * 60 * 1000 + 30 * 60 * 1000,
                    "app": "Brave Browser",
                    "title": "Portable monitor comparison",
                    "url": "https://shop.example.com/monitors?token=secret",
                    "bundleId": "com.brave.Browser",
                    "appPath": "/Applications/Brave Browser.app"
                ]
            ],
            timeEntries: [],
            recentDailySummaries: [
                ["date": "2026-06-06", "status": "succeeded", "summary": ["text": "Your tracked day centered on Oriel implementation. You also reviewed settings."]],
                ["date": "2026-06-05", "status": "succeeded", "summary": ["text": "Most of your recorded activity focused on product research. Later work shifted to finance."]]
            ]
        )

        XCTAssertEqual(output.activitySummaries.count, 2)
        let engineeringCluster = try XCTUnwrap(output.activitySummaries.first { ($0["category"] as? String) == "engineering" })
        XCTAssertEqual(engineeringCluster["summaryCount"] as? Int, 3)
        XCTAssertEqual(engineeringCluster["app"] as? String, "Xcode")
        XCTAssertEqual(engineeringCluster["projectOrContext"] as? String, "Oriel")
        XCTAssertEqual(engineeringCluster["actions"] as? [String], ["editing", "testing"])
        XCTAssertEqual(engineeringCluster["titles"] as? [String], ["DailySummaryContextBuilder.swift", "DailySummaryContextBuilderTests.swift", "AIService.swift"])
        XCTAssertEqual((engineeringCluster["actionCounts"] as? [[String: Any]])?.first?["name"] as? String, "editing")
        XCTAssertEqual((engineeringCluster["actionCounts"] as? [[String: Any]])?.first?["summaryCount"] as? Int, 2)
        XCTAssertEqual(engineeringCluster["representativeSummaries"] as? [String], [
            "Edited the daily summary context builder.",
            "Added coverage for clustered AI summary evidence.",
            "Tightened daily summary prompt instructions."
        ])

        let stats = try XCTUnwrap(output.dayContext["activityStats"] as? [String: Any])
        let topApps = try XCTUnwrap(stats["topApps"] as? [[String: Any]])
        XCTAssertEqual(topApps.first?["name"] as? String, "Xcode")
        XCTAssertEqual(topApps.first?["durationMs"] as? Int64, 2 * 60 * 60 * 1000)
        XCTAssertEqual(topApps.first?["percent"] as? Int, 80)

        let categories = try XCTUnwrap(stats["summaryCategories"] as? [[String: Any]])
        XCTAssertEqual(categories.first?["name"] as? String, "engineering")
        XCTAssertEqual(categories.first?["summaryCount"] as? Int, 3)

        let actions = try XCTUnwrap(stats["summaryActions"] as? [[String: Any]])
        XCTAssertEqual(actions.first?["name"] as? String, "editing")
        XCTAssertEqual(actions.first?["summaryCount"] as? Int, 2)

        let dayparts = try XCTUnwrap(stats["dayparts"] as? [[String: Any]])
        XCTAssertTrue(dayparts.contains { ($0["name"] as? String) == "morning" && ($0["durationMs"] as? Int64) == 2 * 60 * 60 * 1000 })
        XCTAssertTrue(dayparts.contains { ($0["name"] as? String) == "afternoon" && ($0["durationMs"] as? Int64) == 30 * 60 * 1000 })

        XCTAssertEqual(output.dayContext["recentSummaryOpeners"] as? [String], [
            "Your tracked day centered on Oriel implementation.",
            "Most of your recorded activity focused on product research."
        ])

        let serialized = try serializedJSONObject(output.dayContext)
        XCTAssertFalse(serialized.contains("token=secret"))
        XCTAssertFalse(serialized.contains("file:///Users"))
        XCTAssertFalse(serialized.contains("bundleId"))
        XCTAssertFalse(serialized.contains("appPath"))

        let activities = try XCTUnwrap(output.dayContext["activities"] as? [[String: Any]])
        XCTAssertEqual(activities[1]["domain"] as? String, "shop.example.com")
        XCTAssertNil(activities[1]["url"])
    }

    private func millis(
        _ year: Int,
        _ month: Int,
        _ day: Int,
        hour: Int,
        minute: Int
    ) throws -> Int64 {
        var components = DateComponents()
        components.calendar = Calendar(identifier: .gregorian)
        components.year = year
        components.month = month
        components.day = day
        components.hour = hour
        components.minute = minute
        let date = try XCTUnwrap(components.date)
        return Int64(date.timeIntervalSince1970 * 1000)
    }

    private func serializedJSONObject(_ value: Any) throws -> String {
        let data = try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
        return String(decoding: data, as: UTF8.self)
    }
}
