import Foundation

struct DailySummaryContextPayload {
    let activitySummaries: [[String: Any]]
    let dayContext: [String: Any]
    let metrics: [String: Any]?
}

enum DailySummaryContextBuilder {
    private static let maxClusters = 20
    private static let maxClusterValues = 5
    private static let maxRecentOpeners = 5
    private static let maxTopStats = 8
    private static let focusSessionMergeGapMs: Int64 = 15 * 1000
    private static let focusSessionMinDurationMs: Int64 = 60 * 1000
    private static let sensitiveKeys: Set<String> = [
        "appPath",
        "bundleId",
        "bundleIdentifier",
        "bundle_id",
        "url"
    ]

    static func build(
        date: String,
        activitySummaries: [[String: Any]],
        activities: [[String: Any]],
        timeEntries: [[String: Any]],
        recentDailySummaries: [[String: Any]]
    ) -> DailySummaryContextPayload {
        let sanitizedActivities = activities.map(sanitizedActivity)
        let clusters = clusteredActivitySummaries(activitySummaries)
        let metrics = summaryMetrics(activities: sanitizedActivities, clusters: clusters)
        let dayContext: [String: Any] = [
            "date": date,
            "activities": sanitizedActivities,
            "timeEntries": sanitizedObject(timeEntries),
            "activityStats": activityStats(activities: sanitizedActivities, clusters: clusters),
            "metrics": metrics,
            "recentSummaryOpeners": recentSummaryOpeners(recentDailySummaries)
        ]
        return DailySummaryContextPayload(
            activitySummaries: clusters,
            dayContext: dayContext,
            metrics: metrics
        )
    }

    private static func clusteredActivitySummaries(_ rows: [[String: Any]]) -> [[String: Any]] {
        var clusters: [String: SummaryCluster] = [:]
        for row in rows {
            let rawSummary = row["summary"] as? [String: Any] ?? [:]
            let summary = ActivitySummaryNormalizer.normalize(
                summary: rawSummary,
                fallbackApp: string(row["app"]) ?? "",
                fallbackBundleID: string(row["bundleId"]) ?? string(row["bundle_id"]) ?? ""
            )
            let app = string(summary["app"]) ?? string(row["app"]) ?? ""
            let project = string(summary["project_or_context"]) ?? ""
            let category = string(summary["category"]) ?? ""
            let key = [
                normalizedKey(app),
                normalizedKey(project),
                normalizedKey(category)
            ].joined(separator: "\u{1f}")
            var cluster = clusters[key] ?? SummaryCluster(app: app, project: project, category: category)
            cluster.add(row: row, summary: summary)
            clusters[key] = cluster
        }

        return clusters.values
            .sorted { first, second in
                if first.summaryCount != second.summaryCount {
                    return first.summaryCount > second.summaryCount
                }
                return first.durationMs > second.durationMs
            }
            .prefix(maxClusters)
            .map { $0.output(maxValues: maxClusterValues) }
    }

    private static func activityStats(
        activities: [[String: Any]],
        clusters: [[String: Any]]
    ) -> [String: Any] {
        let totalDuration = activities.reduce(Int64(0)) { total, activity in
            total + durationMs(activity)
        }
        let appDurations = groupedDurations(activities, key: "app")
        let daypartDurations = groupedDaypartDurations(activities)
        let categories = groupedSummaryCounts(clusters, key: "category")
        let actions = groupedActions(clusters)

        return [
            "totalRecordedMs": totalDuration,
            "topApps": rankedDurations(appDurations, totalDuration: totalDuration),
            "dayparts": rankedDayparts(daypartDurations, totalDuration: totalDuration),
            "summaryCategories": categories,
            "summaryActions": actions
        ]
    }

    private static func summaryMetrics(
        activities: [[String: Any]],
        clusters: [[String: Any]]
    ) -> [String: Any] {
        let metricActivities = metricSources(from: activities)
        let totalRecordedMs = metricActivities.reduce(Int64(0)) { $0 + $1.durationMs }
        let sessions = focusSessions(from: metricActivities)
        let longest = sessions.max { first, second in
            if first.durationMs != second.durationMs {
                return first.durationMs < second.durationMs
            }
            return first.start > second.start
        }
        let focusTotalMs = sessions.reduce(Int64(0)) { $0 + $1.durationMs }
        let appDurations = groupedDurations(activities, key: "app")

        return [
            "version": 1,
            "totalRecordedMs": totalRecordedMs,
            "longestFocusSession": longest?.output() ?? [:],
            "focusSessions": [
                "count": sessions.count,
                "totalDurationMs": focusTotalMs,
                "averageDurationMs": sessions.isEmpty ? 0 : focusTotalMs / Int64(sessions.count)
            ],
            "fragmentation": [
                "activityFragmentCount": metricActivities.count,
                "sessionCount": sessions.count,
                "contextSwitchCount": contextSwitchCount(metricActivities),
                "interruptionCount": sessions.reduce(0) { $0 + $1.interruptionCount }
            ],
            "appBreakdown": rankedDurations(appDurations, totalDuration: totalRecordedMs),
            "categoryBreakdown": groupedSummaryCounts(clusters, key: "category")
        ]
    }

    private static func metricSources(from activities: [[String: Any]]) -> [MetricActivity] {
        activities.compactMap { activity in
            guard let start = int64(activity["start"]),
                  let end = int64(activity["end"]),
                  end > start else {
                return nil
            }
            let app = string(activity["app"]) ?? ""
            let title = string(activity["title"]) ?? ""
            let domain = string(activity["domain"]) ?? ""
            let key = focusSessionKey(app: app, domain: domain)
            guard !key.isEmpty else { return nil }
            return MetricActivity(
                start: start,
                end: end,
                app: app,
                title: title,
                label: focusSessionLabel(app: app, title: title, domain: domain),
                key: key
            )
        }
        .sorted { first, second in
            if first.start != second.start { return first.start < second.start }
            return first.end < second.end
        }
    }

    private static func focusSessions(from sources: [MetricActivity]) -> [FocusSession] {
        var sessions: [FocusSession] = []
        var current: FocusSession?

        func flushCurrent() {
            guard let session = current else { return }
            if session.durationMs >= focusSessionMinDurationMs {
                sessions.append(session)
            }
            current = nil
        }

        for source in sources {
            guard var session = current else {
                current = FocusSession(source: source)
                continue
            }

            let isNearCurrent = source.start <= session.end + focusSessionMergeGapMs
            if source.key == session.key && isNearCurrent {
                session.add(source)
                current = session
                continue
            }

            if source.key != session.key
                && isNearCurrent
                && source.durationMs < focusSessionMinDurationMs {
                session.interruptionCount += 1
                session.end = max(session.end, source.end)
                current = session
                continue
            }

            flushCurrent()
            current = FocusSession(source: source)
        }

        flushCurrent()
        return sessions
    }

    private static func contextSwitchCount(_ sources: [MetricActivity]) -> Int {
        guard sources.count > 1 else { return 0 }
        var switches = 0
        var previousKey = sources[0].key
        for source in sources.dropFirst() {
            if source.key != previousKey {
                switches += 1
                previousKey = source.key
            }
        }
        return switches
    }

    private static func focusSessionKey(app: String, domain: String) -> String {
        let normalizedApp = normalizedKey(app)
        let normalizedDomain = normalizedKey(domain)
        if normalizedApp.isEmpty { return normalizedDomain }
        return normalizedDomain.isEmpty ? normalizedApp : "\(normalizedApp)|||\(normalizedDomain)"
    }

    private static func focusSessionLabel(app: String, title: String, domain: String) -> String {
        let trimmedTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedApp = app.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmedTitle.isEmpty && normalizedKey(trimmedTitle) != normalizedKey(trimmedApp) {
            return trimmedTitle
        }
        if !trimmedApp.isEmpty { return trimmedApp }
        if !domain.isEmpty { return domain }
        return "Recorded activity"
    }

    private static func groupedDurations(_ activities: [[String: Any]], key: String) -> [String: Int64] {
        var grouped: [String: Int64] = [:]
        for activity in activities {
            guard let name = string(activity[key]), !name.isEmpty else { continue }
            grouped[name, default: 0] += durationMs(activity)
        }
        return grouped
    }

    private static func groupedDaypartDurations(_ activities: [[String: Any]]) -> [String: Int64] {
        var grouped: [String: Int64] = [:]
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = .current
        for activity in activities {
            guard let start = int64(activity["start"]) else { continue }
            let hour = calendar.component(.hour, from: Date(timeIntervalSince1970: Double(start) / 1000))
            grouped[daypart(forHour: hour), default: 0] += durationMs(activity)
        }
        return grouped
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

    private static func rankedDayparts(_ grouped: [String: Int64], totalDuration: Int64) -> [[String: Any]] {
        let order = ["morning", "afternoon", "evening", "night"]
        return order.compactMap { name in
            guard let duration = grouped[name], duration > 0 else { return nil }
            return [
                "name": name,
                "durationMs": duration,
                "percent": percentage(duration, total: totalDuration)
            ] as [String: Any]
        }
    }

    private static func groupedSummaryCounts(_ clusters: [[String: Any]], key: String) -> [[String: Any]] {
        var counts: [String: Int] = [:]
        for cluster in clusters {
            guard let name = string(cluster[key]), !name.isEmpty else { continue }
            counts[name, default: 0] += int(cluster["summaryCount"]) ?? 0
        }
        return counts
            .map { name, count in ["name": name, "summaryCount": count] as [String: Any] }
            .sorted { first, second in
                (int(first["summaryCount"]) ?? 0) > (int(second["summaryCount"]) ?? 0)
            }
            .prefix(maxTopStats)
            .map { $0 }
    }

    private static func groupedActions(_ clusters: [[String: Any]]) -> [[String: Any]] {
        var counts: [String: Int] = [:]
        for cluster in clusters {
            let actionCounts = cluster["actionCounts"] as? [[String: Any]] ?? []
            if actionCounts.isEmpty {
                for action in cluster["actions"] as? [String] ?? [] {
                    counts[action, default: 0] += int(cluster["summaryCount"]) ?? 1
                }
            } else {
                for actionCount in actionCounts {
                    guard let action = string(actionCount["name"]) else { continue }
                    counts[action, default: 0] += int(actionCount["summaryCount"]) ?? 0
                }
            }
        }
        return counts
            .map { name, count in ["name": name, "summaryCount": count] as [String: Any] }
            .sorted { first, second in
                (int(first["summaryCount"]) ?? 0) > (int(second["summaryCount"]) ?? 0)
            }
            .prefix(maxTopStats)
            .map { $0 }
    }

    private static func recentSummaryOpeners(_ rows: [[String: Any]]) -> [String] {
        rows.compactMap { row in
            guard (string(row["status"]) ?? "succeeded") == "succeeded",
                  let summary = row["summary"] as? [String: Any],
                  let text = string(summary["text"]) else {
                return nil
            }
            return firstSentence(text)
        }
        .filter { !$0.isEmpty }
        .prefix(maxRecentOpeners)
        .map { $0 }
    }

    private static func sanitizedActivity(_ activity: [String: Any]) -> [String: Any] {
        var output: [String: Any] = [:]
        for key in ["start", "end", "app", "title", "interactionState"] {
            if let value = activity[key] {
                output[key] = value
            }
        }
        if let domain = domain(from: string(activity["url"])) {
            output["domain"] = domain
        }
        return output
    }

    private static func sanitizedObject(_ value: Any) -> Any {
        if let rows = value as? [[String: Any]] {
            return rows.map { sanitizedObject($0) }
        }
        if let values = value as? [Any] {
            return values.map { sanitizedObject($0) }
        }
        if let object = value as? [String: Any] {
            var output: [String: Any] = [:]
            for (key, item) in object where !sensitiveKeys.contains(key) {
                output[key] = sanitizedObject(item)
            }
            if let domain = domain(from: string(object["url"])) {
                output["domain"] = domain
            }
            return output
        }
        return value
    }

    private static func daypart(forHour hour: Int) -> String {
        switch hour {
        case 5..<12:
            return "morning"
        case 12..<17:
            return "afternoon"
        case 17..<21:
            return "evening"
        default:
            return "night"
        }
    }

    private static func firstSentence(_ text: String) -> String {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let end = trimmed.firstIndex(where: { ".!?".contains($0) }) else {
            return trimmed
        }
        return String(trimmed[...end]).trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func domain(from urlString: String?) -> String? {
        guard let urlString,
              let host = URL(string: urlString)?.host?.lowercased(),
              !host.isEmpty else {
            return nil
        }
        return host
    }

    private static func durationMs(_ row: [String: Any]) -> Int64 {
        guard let start = int64(row["start"]),
              let end = int64(row["end"]),
              end > start else {
            return 0
        }
        return end - start
    }

    private static func percentage(_ value: Int64, total: Int64) -> Int {
        guard total > 0 else { return 0 }
        return Int((Double(value) / Double(total) * 100).rounded())
    }

    private static func normalizedKey(_ value: String) -> String {
        value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
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

    private static func int(_ value: Any?) -> Int? {
        switch value {
        case let value as Int:
            return value
        case let value as Int64:
            return Int(value)
        case let value as NSNumber:
            return value.intValue
        case let value as String:
            return Int(value)
        default:
            return nil
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

    private struct SummaryCluster {
        let app: String
        let project: String
        let category: String
        var summaryCount = 0
        var start: Int64?
        var end: Int64?
        var activityIds: [String] = []
        var titles: [String] = []
        var actions: [String] = []
        var actionCounts: [String: Int] = [:]
        var objects: [String] = []
        var representativeSummaries: [String] = []

        var durationMs: Int64 {
            guard let start, let end, end > start else { return 0 }
            return end - start
        }

        mutating func add(row: [String: Any], summary: [String: Any]) {
            summaryCount += 1
            appendUnique(string(row["activityId"]), to: &activityIds)
            appendUnique(string(row["title"]), to: &titles)
            if let action = string(summary["action"]) {
                appendUnique(action, to: &actions)
                actionCounts[action, default: 0] += 1
            }
            appendUnique(string(summary["cloud_safe_summary"]), to: &representativeSummaries)
            for object in summary["objects"] as? [Any] ?? [] {
                appendUnique(string(object), to: &objects)
            }
            if let rowStart = int64(row["start"]) {
                start = min(start ?? rowStart, rowStart)
            }
            if let rowEnd = int64(row["end"]) {
                end = max(end ?? rowEnd, rowEnd)
            }
        }

        func output(maxValues: Int) -> [String: Any] {
            [
                "app": app,
                "projectOrContext": project,
                "category": category,
                "summaryCount": summaryCount,
                "start": start ?? 0,
                "end": end ?? 0,
                "durationMs": durationMs,
                "activityIds": Array(activityIds.prefix(maxValues)),
                "titles": Array(titles.prefix(maxValues)),
                "actions": Array(actions.prefix(maxValues)),
                "actionCounts": rankedActionCounts(maxValues: maxValues),
                "objects": Array(objects.prefix(maxValues)),
                "representativeSummaries": Array(representativeSummaries.prefix(maxValues))
            ]
        }

        private func rankedActionCounts(maxValues: Int) -> [[String: Any]] {
            actionCounts
                .map { name, count in ["name": name, "summaryCount": count] as [String: Any] }
                .sorted { first, second in
                    (first["summaryCount"] as? Int ?? 0) > (second["summaryCount"] as? Int ?? 0)
                }
                .prefix(maxValues)
                .map { $0 }
        }

        private func appendUnique(_ value: String?, to values: inout [String]) {
            guard let value, !values.contains(value) else { return }
            values.append(value)
        }
    }

    private struct MetricActivity {
        let start: Int64
        let end: Int64
        let app: String
        let title: String
        let label: String
        let key: String

        var durationMs: Int64 {
            max(0, end - start)
        }
    }

    private struct FocusSession {
        let key: String
        let app: String
        let title: String
        let label: String
        var start: Int64
        var end: Int64
        var durationMs: Int64
        var sourceCount: Int
        var interruptionCount: Int

        init(source: MetricActivity) {
            key = source.key
            app = source.app
            title = source.title
            label = source.label
            start = source.start
            end = source.end
            durationMs = source.durationMs
            sourceCount = 1
            interruptionCount = 0
        }

        mutating func add(_ source: MetricActivity) {
            start = min(start, source.start)
            end = max(end, source.end)
            durationMs += source.durationMs
            sourceCount += 1
        }

        func output() -> [String: Any] {
            [
                "start": start,
                "end": end,
                "durationMs": durationMs,
                "app": app,
                "title": title,
                "label": label
            ]
        }
    }
}
