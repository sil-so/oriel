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

    func testBuildComputesDailyFocusMetrics() throws {
        let base = try millis(2026, 6, 7, hour: 9, minute: 0)
        let codexFirstStart = base
        let codexFirstEnd = codexFirstStart + 20 * 60 * 1000
        let slackStart = codexFirstEnd
        let slackEnd = slackStart + 10 * 1000
        let codexSecondStart = slackEnd
        let codexSecondEnd = codexSecondStart + 29 * 60 * 1000 + 50 * 1000
        let codexThirdStart = codexSecondEnd + 5 * 1000
        let codexThirdEnd = codexThirdStart + 15 * 60 * 1000
        let safariStart = base + 2 * 60 * 60 * 1000
        let safariEnd = safariStart + 45 * 60 * 1000

        let output = DailySummaryContextBuilder.build(
            date: "2026-06-07",
            activitySummaries: [
                [
                    "activityId": "summary-a",
                    "start": codexFirstStart,
                    "end": codexFirstEnd,
                    "app": "Codex",
                    "title": "Oriel metrics plan",
                    "summary": [
                        "project_or_context": "Oriel",
                        "category": "engineering",
                        "action": "implementing",
                        "cloud_safe_summary": "Implemented summary metrics."
                    ]
                ],
                [
                    "activityId": "summary-b",
                    "start": safariStart,
                    "end": safariEnd,
                    "app": "Safari",
                    "title": "Research notes",
                    "summary": [
                        "project_or_context": "Research",
                        "category": "research",
                        "action": "reviewing",
                        "cloud_safe_summary": "Reviewed research notes."
                    ]
                ]
            ],
            activities: [
                [
                    "start": codexFirstStart,
                    "end": codexFirstEnd,
                    "app": "Codex",
                    "title": "Oriel metrics plan"
                ],
                [
                    "start": slackStart,
                    "end": slackEnd,
                    "app": "Slack",
                    "title": "Short interruption"
                ],
                [
                    "start": codexSecondStart,
                    "end": codexSecondEnd,
                    "app": "Codex",
                    "title": "Oriel metrics plan"
                ],
                [
                    "start": codexThirdStart,
                    "end": codexThirdEnd,
                    "app": "Codex",
                    "title": "Oriel metrics plan"
                ],
                [
                    "start": safariStart,
                    "end": safariEnd,
                    "app": "Safari",
                    "title": "Research notes",
                    "url": "https://example.com/research?token=private"
                ]
            ],
            timeEntries: [],
            recentDailySummaries: []
        )

        let codexFocusMs = (codexFirstEnd - codexFirstStart)
            + (codexSecondEnd - codexSecondStart)
            + (codexThirdEnd - codexThirdStart)
        let safariFocusMs = safariEnd - safariStart
        let interruptionMs = slackEnd - slackStart
        let totalRecordedMs = codexFocusMs + interruptionMs + safariFocusMs
        let focusTotalMs = codexFocusMs + safariFocusMs

        let metrics = try XCTUnwrap(output.metrics)
        XCTAssertEqual(metrics["version"] as? Int, 1)
        XCTAssertEqual(metrics["totalRecordedMs"] as? Int64, totalRecordedMs)

        let longest = try XCTUnwrap(metrics["longestFocusSession"] as? [String: Any])
        XCTAssertEqual(longest["app"] as? String, "Codex")
        XCTAssertEqual(longest["title"] as? String, "Oriel metrics plan")
        XCTAssertEqual(longest["label"] as? String, "Oriel metrics plan")
        XCTAssertEqual(longest["start"] as? Int64, codexFirstStart)
        XCTAssertEqual(longest["end"] as? Int64, codexThirdEnd)
        XCTAssertEqual(longest["durationMs"] as? Int64, codexFocusMs)

        let focusSessions = try XCTUnwrap(metrics["focusSessions"] as? [String: Any])
        XCTAssertEqual(focusSessions["count"] as? Int, 2)
        XCTAssertEqual(focusSessions["totalDurationMs"] as? Int64, focusTotalMs)
        XCTAssertEqual(focusSessions["averageDurationMs"] as? Int64, focusTotalMs / 2)

        let fragmentation = try XCTUnwrap(metrics["fragmentation"] as? [String: Any])
        XCTAssertEqual(fragmentation["activityFragmentCount"] as? Int, 5)
        XCTAssertEqual(fragmentation["sessionCount"] as? Int, 2)
        XCTAssertEqual(fragmentation["contextSwitchCount"] as? Int, 3)
        XCTAssertEqual(fragmentation["interruptionCount"] as? Int, 1)

        let apps = try XCTUnwrap(metrics["appBreakdown"] as? [[String: Any]])
        XCTAssertEqual(apps.first?["name"] as? String, "Codex")
        XCTAssertEqual(apps.first?["durationMs"] as? Int64, codexFocusMs)

        let categories = try XCTUnwrap(metrics["categoryBreakdown"] as? [[String: Any]])
        XCTAssertTrue(categories.contains { category in
            (category["name"] as? String) == "engineering"
                && (category["summaryCount"] as? Int) == 1
        })

        let serializedMetrics = try serializedJSONObject(metrics)
        XCTAssertFalse(serializedMetrics.contains("token=private"))
        XCTAssertFalse(serializedMetrics.contains("https://example.com"))
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
