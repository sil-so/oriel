import Foundation
import XCTest
@testable import OrielApp

final class RollupSummaryContextBuilderTests: XCTestCase {
    func testBuildAggregatesSuccessfulDailySummariesAndMetrics() throws {
        let output = RollupSummaryContextBuilder.build(
            period: "week",
            periodStart: "2026-06-01",
            periodEnd: "2026-06-07",
            dailySummaries: [
                [
                    "date": "2026-06-01",
                    "status": "succeeded",
                    "summary": [
                        "text": "You implemented rollup storage.",
                        "highlights": ["Built rollup persistence"],
                        "metrics": [
                            "version": 1,
                            "totalRecordedMs": 3_600_000,
                            "longestFocusSession": [
                                "start": 1_780_810_800_000 as Int64,
                                "end": 1_780_814_400_000 as Int64,
                                "durationMs": 3_600_000,
                                "app": "Codex",
                                "title": "Oriel rollups",
                                "label": "Oriel rollups"
                            ],
                            "focusSessions": [
                                "count": 1,
                                "totalDurationMs": 3_600_000,
                                "averageDurationMs": 3_600_000
                            ],
                            "fragmentation": [
                                "activityFragmentCount": 2,
                                "sessionCount": 1,
                                "contextSwitchCount": 0,
                                "interruptionCount": 0
                            ],
                            "appBreakdown": [["name": "Codex", "durationMs": 3_600_000, "percent": 100]],
                            "categoryBreakdown": [["name": "engineering", "summaryCount": 2]]
                        ]
                    ]
                ],
                [
                    "date": "2026-06-02",
                    "status": "succeeded",
                    "summary": [
                        "text": "You connected the AI Insights grid.",
                        "highlights": ["Rendered weekly cards"],
                        "metrics": [
                            "version": 1,
                            "totalRecordedMs": 1_800_000,
                            "longestFocusSession": [
                                "start": 1_780_897_200_000 as Int64,
                                "end": 1_780_899_000_000 as Int64,
                                "durationMs": 1_800_000,
                                "app": "Safari",
                                "title": "AI Insights notes",
                                "label": "AI Insights notes"
                            ],
                            "focusSessions": [
                                "count": 2,
                                "totalDurationMs": 1_800_000,
                                "averageDurationMs": 900_000
                            ],
                            "fragmentation": [
                                "activityFragmentCount": 3,
                                "sessionCount": 2,
                                "contextSwitchCount": 2,
                                "interruptionCount": 1
                            ],
                            "appBreakdown": [["name": "Safari", "durationMs": 1_800_000, "percent": 100]],
                            "categoryBreakdown": [["name": "research", "summaryCount": 1]]
                        ]
                    ]
                ],
                [
                    "date": "2026-06-03",
                    "status": "failed",
                    "summary": ["text": "This failed daily summary must not be included."]
                ]
            ]
        )

        XCTAssertEqual(output.dailySummaries.count, 2)
        XCTAssertEqual(output.periodContext["period"] as? String, "week")
        XCTAssertEqual(output.periodContext["periodStart"] as? String, "2026-06-01")
        XCTAssertEqual(output.periodContext["periodEnd"] as? String, "2026-06-07")
        XCTAssertEqual(output.periodContext["sourceDailyCount"] as? Int, 2)

        let metrics = try XCTUnwrap(output.metrics)
        XCTAssertEqual(metrics["version"] as? Int, 1)
        XCTAssertEqual(metrics["totalRecordedMs"] as? Int64, 5_400_000)
        let longest = try XCTUnwrap(metrics["longestFocusSession"] as? [String: Any])
        XCTAssertEqual(longest["date"] as? String, "2026-06-01")
        XCTAssertEqual(longest["durationMs"] as? Int64, 3_600_000)

        let focusSessions = try XCTUnwrap(metrics["focusSessions"] as? [String: Any])
        XCTAssertEqual(focusSessions["count"] as? Int, 3)
        XCTAssertEqual(focusSessions["totalDurationMs"] as? Int64, 5_400_000)
        XCTAssertEqual(focusSessions["averageDurationMs"] as? Int64, 1_800_000)

        let fragmentation = try XCTUnwrap(metrics["fragmentation"] as? [String: Any])
        XCTAssertEqual(fragmentation["activityFragmentCount"] as? Int, 5)
        XCTAssertEqual(fragmentation["sessionCount"] as? Int, 3)
        XCTAssertEqual(fragmentation["contextSwitchCount"] as? Int, 2)
        XCTAssertEqual(fragmentation["interruptionCount"] as? Int, 1)

        let apps = try XCTUnwrap(metrics["appBreakdown"] as? [[String: Any]])
        XCTAssertEqual(apps.first?["name"] as? String, "Codex")
        XCTAssertEqual(apps.first?["percent"] as? Int, 67)

        let categories = try XCTUnwrap(metrics["categoryBreakdown"] as? [[String: Any]])
        XCTAssertEqual(categories.first?["name"] as? String, "engineering")
        XCTAssertEqual(categories.first?["summaryCount"] as? Int, 2)

        let serialized = try serializedJSONObject(output.periodContext)
        XCTAssertFalse(serialized.contains("data:image"))
        XCTAssertFalse(serialized.contains("base64"))
        XCTAssertFalse(serialized.contains("failed daily summary"))
    }

    private func serializedJSONObject(_ value: Any) throws -> String {
        let data = try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
        return String(decoding: data, as: UTF8.self)
    }
}
