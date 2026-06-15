import Foundation

struct RollupSummaryContextPayload {
    let dailySummaries: [[String: Any]]
    let periodContext: [String: Any]
    let metrics: [String: Any]?
}

enum RollupSummaryContextBuilder {
    private static let maxDailySummaries = 31
    private static let maxHighlightsPerDay = 5
    private static let maxTopStats = 8

    static func build(
        period: String,
        periodStart: String,
        periodEnd: String,
        dailySummaries: [[String: Any]]
    ) -> RollupSummaryContextPayload {
        let sanitized = dailySummaries
            .filter { string($0["status"]) == "succeeded" }
            .sorted { (string($0["date"]) ?? "") < (string($1["date"]) ?? "") }
            .prefix(maxDailySummaries)
            .compactMap(sanitizedDailySummary)
        let metrics = aggregateMetrics(from: sanitized)
        let periodContext: [String: Any] = [
            "period": period,
            "periodStart": periodStart,
            "periodEnd": periodEnd,
            "sourceDailyCount": sanitized.count,
            "metrics": metrics ?? [:]
        ]
        return RollupSummaryContextPayload(
            dailySummaries: Array(sanitized),
            periodContext: periodContext,
            metrics: metrics
        )
    }

    private static func sanitizedDailySummary(_ row: [String: Any]) -> [String: Any]? {
        guard let date = string(row["date"]) else { return nil }
        let summary = row["summary"] as? [String: Any] ?? [:]
        var output: [String: Any] = [
            "date": date,
            "text": string(summary["text"]) ?? "",
            "highlights": stringArray(summary["highlights"]).prefix(maxHighlightsPerDay).map { $0 }
        ]
        if let metrics = summary["metrics"] as? [String: Any] {
            output["metrics"] = metrics
        }
        return output
    }

    private static func aggregateMetrics(from summaries: [[String: Any]]) -> [String: Any]? {
        guard !summaries.isEmpty else { return nil }

        var totalRecordedMs: Int64 = 0
        var focusCount = 0
        var focusTotalMs: Int64 = 0
        var activityFragmentCount = 0
        var sessionCount = 0
        var contextSwitchCount = 0
        var interruptionCount = 0
        var appDurations: [String: Int64] = [:]
        var categoryCounts: [String: Int] = [:]
        var longest: [String: Any] = [:]
        var longestDuration: Int64 = 0
        var daysWithMetrics = 0

        for summary in summaries {
            guard let metrics = summary["metrics"] as? [String: Any] else { continue }
            daysWithMetrics += 1
            totalRecordedMs += int64(metrics["totalRecordedMs"]) ?? 0

            if var candidate = metrics["longestFocusSession"] as? [String: Any],
               let duration = int64(candidate["durationMs"]),
               duration > longestDuration {
                candidate["date"] = string(summary["date"]) ?? ""
                candidate["durationMs"] = duration
                if let start = int64(candidate["start"]) {
                    candidate["start"] = start
                }
                if let end = int64(candidate["end"]) {
                    candidate["end"] = end
                }
                longest = candidate
                longestDuration = duration
            }

            if let focusSessions = metrics["focusSessions"] as? [String: Any] {
                let count = int(focusSessions["count"])
                focusCount += count
                focusTotalMs += int64(focusSessions["totalDurationMs"]) ?? 0
            }

            if let fragmentation = metrics["fragmentation"] as? [String: Any] {
                activityFragmentCount += int(fragmentation["activityFragmentCount"])
                sessionCount += int(fragmentation["sessionCount"])
                contextSwitchCount += int(fragmentation["contextSwitchCount"])
                interruptionCount += int(fragmentation["interruptionCount"])
            }

            for app in metrics["appBreakdown"] as? [[String: Any]] ?? [] {
                guard let name = string(app["name"]), !name.isEmpty else { continue }
                appDurations[name, default: 0] += int64(app["durationMs"]) ?? 0
            }

            for category in metrics["categoryBreakdown"] as? [[String: Any]] ?? [] {
                guard let name = string(category["name"]), !name.isEmpty else { continue }
                categoryCounts[name, default: 0] += int(category["summaryCount"])
            }
        }

        return [
            "version": 1,
            "sourceDailyCount": summaries.count,
            "daysWithMetrics": daysWithMetrics,
            "totalRecordedMs": totalRecordedMs,
            "longestFocusSession": longest,
            "focusSessions": [
                "count": focusCount,
                "totalDurationMs": focusTotalMs,
                "averageDurationMs": focusCount == 0 ? 0 : focusTotalMs / Int64(focusCount)
            ],
            "fragmentation": [
                "activityFragmentCount": activityFragmentCount,
                "sessionCount": sessionCount,
                "contextSwitchCount": contextSwitchCount,
                "interruptionCount": interruptionCount
            ],
            "appBreakdown": rankedDurations(appDurations, totalDuration: totalRecordedMs),
            "categoryBreakdown": rankedCounts(categoryCounts)
        ]
    }

    private static func rankedDurations(_ grouped: [String: Int64], totalDuration: Int64) -> [[String: Any]] {
        grouped
            .map { name, duration in
                [
                    "name": name,
                    "durationMs": duration,
                    "percent": percentage(duration, total: totalDuration)
                ] as [String: Any]
            }
            .sorted { first, second in
                (int64(first["durationMs"]) ?? 0) > (int64(second["durationMs"]) ?? 0)
            }
            .prefix(maxTopStats)
            .map { $0 }
    }

    private static func rankedCounts(_ grouped: [String: Int]) -> [[String: Any]] {
        grouped
            .map { ["name": $0.key, "summaryCount": $0.value] as [String: Any] }
            .sorted { first, second in
                int(first["summaryCount"]) > int(second["summaryCount"])
            }
            .prefix(maxTopStats)
            .map { $0 }
    }

    private static func percentage(_ value: Int64, total: Int64) -> Int {
        guard total > 0 else { return 0 }
        return Int((Double(value) / Double(total) * 100).rounded())
    }

    private static func stringArray(_ value: Any?) -> [String] {
        (value as? [Any] ?? []).compactMap { item in
            guard let string = string(item) else { return nil }
            return string
        }
    }

    private static func string(_ value: Any?) -> String? {
        switch value {
        case let value as String:
            let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
            return trimmed.isEmpty ? nil : trimmed
        case let value as NSNumber:
            return value.stringValue
        default:
            return nil
        }
    }

    private static func int(_ value: Any?) -> Int {
        switch value {
        case let value as Int:
            return value
        case let value as Int64:
            return Int(value)
        case let value as NSNumber:
            return value.intValue
        case let value as String:
            return Int(value) ?? 0
        default:
            return 0
        }
    }

    private static func int64(_ value: Any?) -> Int64? {
        switch value {
        case let value as Int64:
            return value
        case let value as Int:
            return Int64(value)
        case let value as NSNumber:
            return value.int64Value
        case let value as String:
            return Int64(value)
        default:
            return nil
        }
    }
}
