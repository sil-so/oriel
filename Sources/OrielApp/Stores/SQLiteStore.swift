import Foundation
import CSQLite

enum OrielStoreError: Error, LocalizedError {
    case invalidRequest(String)
    case storage(String)
    case unsupported(String)

    var errorDescription: String? {
        switch self {
        case .invalidRequest(let message), .storage(let message), .unsupported(let message):
            return message
        }
    }
}

final class SQLiteStore {
    private let autoAssignmentMergeToleranceMs: Int64 = 5_000
    private let defaultInteractionState = "handsOn"
    private let allowedInteractionStates: Set<String> = ["handsOn", "handsOff"]
    private var database: OpaquePointer?
    let databaseURL: URL

    static func defaultDatabaseURL() throws -> URL {
        let supportDirectory = try FileManager.default.url(
            for: .applicationSupportDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        )
        return supportDirectory
            .appendingPathComponent("Oriel", isDirectory: true)
            .appendingPathComponent("Oriel.sqlite")
    }

    init(databaseURL: URL? = nil) throws {
        self.databaseURL = try databaseURL ?? Self.defaultDatabaseURL()
        try FileManager.default.createDirectory(
            at: self.databaseURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        guard sqlite3_open(self.databaseURL.path, &database) == SQLITE_OK else {
            throw OrielStoreError.storage("Unable to open the Oriel database.")
        }
        try execute("PRAGMA foreign_keys = ON")
        try execute("PRAGMA journal_mode = WAL")
        try migrate()
    }

    deinit {
        sqlite3_close(database)
    }

    func request(operation: String, payload: [String: Any]) throws -> Any {
        switch operation {
        case "activities.list":
            return try listActivities(payload: payload)
        case "activityAISummaries.list":
            return try listActivityAISummaries(payload: payload)
        case "dailyAISummaries.get":
            return try dailyAISummary(payload: payload)
        case "dailyAISummaries.list":
            return try dailyAISummaries(payload: payload)
        case "dailyAISummaries.upsert":
            try upsertDailyAISummary(payload)
            return try dailyAISummary(payload: payload)
        case "projects.list":
            return try listProjects()
        case "projects.create":
            return try createProject(payload)
        case "projects.update":
            return try updateProject(payload)
        case "projects.delete":
            return try deleteByIdentifier(table: "projects", payload: payload)
        case "entries.list":
            return try listEntries(payload: payload)
        case "entries.create":
            return try createEntry(payload)
        case "entries.update":
            return try updateEntry(payload)
        case "entries.delete":
            return try deleteByIdentifier(table: "time_entries", payload: payload)
        case "rules.list":
            return try listRules()
        case "rules.create":
            return try createRule(payload)
        case "rules.delete":
            return try deleteByIdentifier(table: "assignment_rules", payload: payload)
        case "exclusions.list":
            return try listExclusions()
        case "exclusions.create":
            return try createExclusion(payload)
        case "exclusions.delete":
            return try deleteByIdentifier(table: "capture_exclusions", payload: payload)
        case "settings.get":
            return try settings()
        case "settings.update":
            return try updateSettings(payload)
        case "data.export":
            return try exportArchive()
        case "data.purge":
            try purge()
            return ["purged": true]
        case "data.restore":
            guard let archive = payload["archive"] as? [String: Any] else {
                throw OrielStoreError.invalidRequest("A portable Oriel archive is required.")
            }
            try restoreArchive(archive)
            return ["restored": true]
        default:
            throw OrielStoreError.invalidRequest("Unknown Oriel operation: \(operation)")
        }
    }

    func recordActivity(
        id: String? = nil,
        start: Int64,
        end: Int64,
        app: String,
        title: String,
        url: String?,
        bundleIdentifier: String?,
        appPath: String?,
        interactionState: String = "handsOn",
        source: String = "native"
    ) throws {
        guard end > start, !app.isEmpty else {
            throw OrielStoreError.invalidRequest("An activity requires an application and a valid time range.")
        }
        guard allowedInteractionStates.contains(interactionState) else {
            throw OrielStoreError.invalidRequest("An activity interaction state must be handsOn or handsOff.")
        }
        if isExcludedActivityApp(app) { return }
        let slices = try normalizedActivityRows([[
            "start": start,
            "end": end,
            "app": app,
            "title": title,
            "url": url ?? NSNull(),
            "bundleId": bundleIdentifier ?? NSNull(),
            "appPath": appPath ?? NSNull(),
            "interactionState": interactionState,
            "source": source,
            "id": id ?? NSNull()
        ]])
        try transaction {
            for slice in slices {
                try execute(
                    """
                    INSERT INTO activities (
                        id, start_ms, end_ms, app, title, url,
                        bundle_identifier, app_path, interaction_state, source
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    values: [
                        slice["id"], slice["start"], slice["end"], slice["app"], slice["title"],
                        slice["url"], slice["bundleId"], slice["appPath"], slice["interactionState"],
                        slice["source"]
                    ]
                )
                try autoLogActivityIfMatched(slice)
            }
        }
    }

    func isCaptureExcluded(app: String, title: String, url: String?) throws -> Bool {
        for rule in try listExclusions() {
            guard let field = rule["field"] as? String,
                  let matchType = rule["matchType"] as? String,
                  let pattern = rule["pattern"] as? String else { continue }
            let candidate: String
            switch field {
            case "app":
                candidate = app
            case "title":
                candidate = title
            case "url":
                candidate = url ?? ""
            default:
                continue
            }
            if activityValueMatchesExclusion(candidate: candidate, matchType: matchType, pattern: pattern) { return true }
        }
        return false
    }

    func createPassiveReview(
        id: String,
        start: Int64,
        end: Int64,
        activeGraceCutoff: Int64,
        app: String,
        title: String,
        url: String?,
        bundleIdentifier: String?,
        appPath: String?,
        reason: String,
        isClosed: Bool
    ) throws {
        guard end > start, !app.isEmpty, ["reading", "audible-browser"].contains(reason) else {
            throw OrielStoreError.invalidRequest("A passive review requires an application, reason, and valid time range.")
        }
        if isExcludedActivityApp(app) { return }
        try execute(
            """
            INSERT INTO passive_reviews
                (id, start_ms, end_ms, active_grace_cutoff_ms, app, title, url,
                 bundle_identifier, app_path, reason, is_closed, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            """,
            values: [
                id, start, end, activeGraceCutoff, app, title, url, bundleIdentifier, appPath,
                reason, isClosed
            ]
        )
    }

    func updatePassiveReview(id: String, end: Int64, isClosed: Bool) throws {
        try execute(
            """
            UPDATE passive_reviews
            SET end_ms = max(end_ms, ?), is_closed = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            values: [end, isClosed, id]
        )
    }

    func passiveReview(id: String) throws -> [String: Any]? {
        try passiveReviewRows(whereClause: "WHERE id = ?", values: [id]).first
    }

    func listPassiveReviews() throws -> [[String: Any]] {
        try passiveReviewRows(whereClause: "", values: [])
    }

    func deletePassiveReview(id: String) throws {
        try execute("DELETE FROM passive_reviews WHERE id = ?", values: [id])
    }

    func restoreArchive(_ archive: [String: Any]) throws {
        guard archive["format"] as? String == "so.sil.oriel.portable-data",
              (archive["version"] as? NSNumber)?.intValue == 1,
              let projects = archive["projects"] as? [[String: Any]],
              let entries = archive["timeEntries"] as? [[String: Any]],
              let activities = archive["activities"] as? [[String: Any]],
              let rules = archive["rules"] as? [[String: Any]],
              let exclusions = archive["exclusions"] as? [[String: Any]] else {
            throw OrielStoreError.invalidRequest("The selected file is not a supported Oriel archive.")
        }
        let records = try validatePortableRecords(
            projects: projects,
            entries: entries,
            activities: activities,
            rules: rules,
            exclusions: exclusions,
            activityAISummaries: archive["activityAISummaries"] as? [[String: Any]] ?? [],
            dailyAISummaries: archive["dailyAISummaries"] as? [[String: Any]] ?? []
        )
        let portableSettings = archive["settings"] as? [String: Any] ?? [:]
        try transaction {
            for table in ["time_entry_activities", "time_entries", "assignment_rules", "capture_exclusions", "passive_reviews", "daily_ai_summaries", "activity_ai_summaries", "activities", "projects", "settings"] {
                try execute("DELETE FROM \(table)")
            }
            try insertPortableRecords(records)
            _ = try updateSettings(portableSettings)
        }
    }

    func writePortableArchive(to destinationURL: URL) throws {
        let archive = try exportArchive()
        let data = try JSONSerialization.data(withJSONObject: archive, options: [.prettyPrinted, .sortedKeys])
        try data.write(to: destinationURL, options: .atomic)
    }

    func restorePortableArchive(from sourceURL: URL) throws {
        let data = try Data(contentsOf: sourceURL)
        guard let archive = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw OrielStoreError.invalidRequest("The selected file is not valid JSON.")
        }
        try restoreArchive(archive)
    }

    private struct PortableRecords {
        let projects: [[String: Any]]
        let entries: [[String: Any]]
        let activities: [[String: Any]]
        let rules: [[String: Any]]
        let exclusions: [[String: Any]]
        let activityAISummaries: [[String: Any]]
        let dailyAISummaries: [[String: Any]]
    }

    private func validatePortableRecords(
        projects: [[String: Any]],
        entries: [[String: Any]],
        activities: [[String: Any]],
        rules: [[String: Any]],
        exclusions: [[String: Any]],
        activityAISummaries: [[String: Any]],
        dailyAISummaries: [[String: Any]]
    ) throws -> PortableRecords {
        let normalizedProjects = try projects.map { project -> [String: Any] in
            let id = optionalString(project, key: "id", defaultValue: identifier("project"))
            return try validatedProject(project, id: id)
        }
        let projectIDs = Set(normalizedProjects.compactMap { $0["id"] as? String })
        let normalizedEntries = try entries.map { entry -> [String: Any] in
            let id = optionalString(entry, key: "id", defaultValue: identifier("entry"))
            let normalized = try validatedEntry(entry, id: id)
            guard projectIDs.contains(normalized["projectId"] as? String ?? "") else {
                throw OrielStoreError.invalidRequest("A time entry references a missing project.")
            }
            var result = normalized
            if let snapshots = entry["activities"] as? [[String: Any]] {
                result["activities"] = snapshots
            }
            return result
        }
        let normalizedActivities = try normalizedActivityRows(activities)
        let activityIDs = Set(normalizedActivities.compactMap { $0["id"] as? String })
        let normalizedRules = try rules.map { rule -> [String: Any] in
            let projectID = try requiredString(rule, key: "projectId", maxLength: 128)
            guard projectIDs.contains(projectID) else {
                throw OrielStoreError.invalidRequest("An assignment rule references a missing project.")
            }
            return [
                "id": optionalString(rule, key: "id", defaultValue: identifier("rule")),
                "field": try requiredString(rule, key: "field", maxLength: 32),
                "matchType": try requiredString(rule, key: "matchType", maxLength: 32),
                "pattern": try requiredString(rule, key: "pattern", maxLength: 500),
                "projectId": projectID,
                "createdAt": intValue(rule["createdAt"]) ?? currentTimeMillis()
            ]
        }
        let normalizedExclusions = try exclusions.map { exclusion -> [String: Any] in
            [
                "id": optionalString(exclusion, key: "id", defaultValue: identifier("exclusion")),
                "field": try requiredString(exclusion, key: "field", maxLength: 32),
                "matchType": try requiredString(exclusion, key: "matchType", maxLength: 32),
                "pattern": try requiredString(exclusion, key: "pattern", maxLength: 500)
            ]
        }
        let normalizedActivityAISummaries = try normalizedActivityAISummaries(
            activityAISummaries,
            activityIDs: activityIDs
        )
        let normalizedDailyAISummaries = try normalizedDailyAISummaries(dailyAISummaries)
        return PortableRecords(
            projects: normalizedProjects,
            entries: normalizedEntries,
            activities: normalizedActivities,
            rules: normalizedRules,
            exclusions: normalizedExclusions,
            activityAISummaries: normalizedActivityAISummaries,
            dailyAISummaries: normalizedDailyAISummaries
        )
    }

    private func normalizedActivityRows(_ rows: [[String: Any]]) throws -> [[String: Any]] {
        var result: [[String: Any]] = []
        for row in rows {
            let start = try requiredInt64(row, key: "start")
            let end = try requiredInt64(row, key: "end")
            let app = try requiredString(row, key: "app", maxLength: 300)
            let interactionState = optionalString(row, key: "interactionState", defaultValue: defaultInteractionState)
            guard allowedInteractionStates.contains(interactionState) else {
                throw OrielStoreError.invalidRequest("A recorded activity has an invalid interaction state.")
            }
            if isExcludedActivityApp(app) { continue }
            guard end > start else {
                throw OrielStoreError.invalidRequest("A recorded activity has an invalid time range.")
            }
            let requestedID = nonEmptyString(row["id"])
            guard (requestedID?.count ?? 0) <= 128 else {
                throw OrielStoreError.invalidRequest("A recorded activity has an invalid id.")
            }
            var cursor = start
            var isFirstSlice = true
            while cursor < end {
                let date = Date(timeIntervalSince1970: TimeInterval(cursor) / 1000)
                let nextDay = Calendar.current.startOfDay(for: date).addingTimeInterval(24 * 60 * 60)
                let boundary = Int64(nextDay.timeIntervalSince1970 * 1000)
                let sliceEnd = min(end, boundary)
                result.append([
                    "id": isFirstSlice ? (requestedID ?? identifier("activity")) : identifier("activity"),
                    "start": cursor,
                    "end": sliceEnd,
                    "app": app,
                    "title": optionalString(row, key: "title", defaultValue: app),
                    "url": row["url"] ?? NSNull(),
                    "bundleId": row["bundleId"] ?? NSNull(),
                    "appPath": row["appPath"] ?? NSNull(),
                    "interactionState": interactionState,
                    "source": optionalString(row, key: "source", defaultValue: "legacy")
                ])
                isFirstSlice = false
                cursor = sliceEnd
            }
        }
        return result
    }

    private func normalizedActivityAISummaries(
        _ rows: [[String: Any]],
        activityIDs: Set<String>
    ) throws -> [[String: Any]] {
        try rows.map { row in
            let activityID = try requiredString(row, key: "activityId", maxLength: 128)
            guard activityIDs.contains(activityID) else {
                throw OrielStoreError.invalidRequest("An activity AI summary references a missing activity.")
            }
            let status = optionalString(row, key: "status", defaultValue: "failed")
            guard ["pending", "succeeded", "failed", "skipped"].contains(status) else {
                throw OrielStoreError.invalidRequest("An activity AI summary has an invalid status.")
            }
            var normalized: [String: Any] = [
                "activityId": activityID,
                "status": status,
                "provider": String(optionalString(row, key: "provider", defaultValue: "").prefix(64)),
                "model": String(optionalString(row, key: "model", defaultValue: "").prefix(200)),
                "errorCode": String(optionalString(row, key: "errorCode", defaultValue: "").prefix(100)),
                "errorMessage": String(optionalString(row, key: "errorMessage", defaultValue: "").prefix(500)),
                "imageWidth": max(0, intValue(row["imageWidth"]) ?? 0),
                "imageHeight": max(0, intValue(row["imageHeight"]) ?? 0),
                "compressedBytes": max(0, intValue(row["compressedBytes"]) ?? 0)
            ]
            if let summary = row["summary"] as? [String: Any] {
                normalized["summary"] = summary
            }
            if let requestMetadata = row["requestMetadata"] as? [String: Any] {
                normalized["requestMetadata"] = requestMetadata
            }
            normalized["zdrRequested"] = boolean(row["zdrRequested"])
            return normalized
        }
    }

    private func normalizedDailyAISummaries(_ rows: [[String: Any]]) throws -> [[String: Any]] {
        try rows.map { row in
            let date = try requiredString(row, key: "date", maxLength: 10)
            guard isValidDateString(date) else {
                throw OrielStoreError.invalidRequest("A daily AI summary has an invalid date.")
            }
            let status = optionalString(row, key: "status", defaultValue: "failed")
            guard ["pending", "succeeded", "failed", "empty"].contains(status) else {
                throw OrielStoreError.invalidRequest("A daily AI summary has an invalid status.")
            }
            var normalized: [String: Any] = [
                "date": date,
                "status": status,
                "provider": String(optionalString(row, key: "provider", defaultValue: "").prefix(64)),
                "model": String(optionalString(row, key: "model", defaultValue: "").prefix(200)),
                "errorCode": String(optionalString(row, key: "errorCode", defaultValue: "").prefix(100)),
                "errorMessage": String(optionalString(row, key: "errorMessage", defaultValue: "").prefix(500)),
                "sourceSummaryCount": max(0, intValue(row["sourceSummaryCount"]) ?? 0)
            ]
            if let summary = row["summary"] as? [String: Any] {
                normalized["summary"] = summary
            }
            return normalized
        }
    }

    private func dayFormatter() -> DateFormatter {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }

    private func isValidDateString(_ value: String) -> Bool {
        let formatter = dayFormatter()
        return formatter.date(from: value) != nil
    }

    private func insertPortableRecords(_ records: PortableRecords) throws {
        for project in records.projects {
            try insertProject(project)
        }
        for activity in records.activities {
            try execute(
                """
                INSERT INTO activities (
                    id, start_ms, end_ms, app, title, url,
                    bundle_identifier, app_path, interaction_state, source
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                values: [
                    activity["id"], activity["start"], activity["end"], activity["app"], activity["title"],
                    activity["url"], activity["bundleId"], activity["appPath"], activity["interactionState"],
                    activity["source"]
                ]
            )
        }
        for entry in records.entries {
            try insertEntry(entry)
            try replaceEntryActivities(id: entry["id"] as! String, payload: entry)
        }
        for summary in records.activityAISummaries {
            try upsertActivityAISummary(summary)
        }
        for summary in records.dailyAISummaries {
            try upsertDailyAISummary(summary)
        }
        for rule in records.rules {
            try execute(
                """
                INSERT INTO assignment_rules (id, field, match_type, pattern, project_id, created_at_ms)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                values: [rule["id"], rule["field"], rule["matchType"], rule["pattern"], rule["projectId"], rule["createdAt"]]
            )
        }
        for exclusion in records.exclusions {
            try execute(
                "INSERT INTO capture_exclusions (id, field, match_type, pattern) VALUES (?, ?, ?, ?)",
                values: [exclusion["id"], exclusion["field"], exclusion["matchType"], exclusion["pattern"]]
            )
        }
    }

    private func migrate() throws {
        try execute(
            """
            CREATE TABLE IF NOT EXISTS schema_metadata (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS activities (
                id TEXT PRIMARY KEY,
                start_ms INTEGER NOT NULL,
                end_ms INTEGER NOT NULL,
                app TEXT NOT NULL,
                title TEXT NOT NULL DEFAULT '',
                url TEXT,
                bundle_identifier TEXT,
                app_path TEXT,
                interaction_state TEXT NOT NULL DEFAULT 'handsOn',
                source TEXT NOT NULL DEFAULT 'native',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            """
        )
        try repairLegacyProjectsTableIfNeeded()
        try repairLegacyTimeEntriesTableIfNeeded()
        try execute(
            """
            CREATE TABLE IF NOT EXISTS projects (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                color TEXT NOT NULL,
                billable INTEGER NOT NULL DEFAULT 0,
                rate_type TEXT NOT NULL DEFAULT 'none',
                hourly_rate REAL NOT NULL DEFAULT 0,
                fixed_rate REAL NOT NULL DEFAULT 0,
                currency TEXT NOT NULL DEFAULT '$',
                tasks_json TEXT NOT NULL DEFAULT '[]'
            );
            CREATE TABLE IF NOT EXISTS time_entries (
                id TEXT PRIMARY KEY,
                start_ms INTEGER NOT NULL,
                end_ms INTEGER NOT NULL,
                project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                description TEXT NOT NULL DEFAULT '',
                billable INTEGER NOT NULL DEFAULT 0,
                task_id TEXT NOT NULL DEFAULT '',
                created_by TEXT NOT NULL DEFAULT 'manual',
                auto_rule_id TEXT NOT NULL DEFAULT '',
                auto_context_key TEXT NOT NULL DEFAULT ''
            );
            CREATE TABLE IF NOT EXISTS time_entry_activities (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                time_entry_id TEXT NOT NULL REFERENCES time_entries(id) ON DELETE CASCADE,
                activity_json TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS assignment_rules (
                id TEXT PRIMARY KEY,
                field TEXT NOT NULL,
                match_type TEXT NOT NULL,
                pattern TEXT NOT NULL,
                project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                created_at_ms INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS capture_exclusions (
                id TEXT PRIMARY KEY,
                field TEXT NOT NULL,
                match_type TEXT NOT NULL,
                pattern TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS passive_reviews (
                id TEXT PRIMARY KEY,
                start_ms INTEGER NOT NULL,
                end_ms INTEGER NOT NULL,
                active_grace_cutoff_ms INTEGER NOT NULL,
                app TEXT NOT NULL,
                title TEXT NOT NULL DEFAULT '',
                url TEXT,
                bundle_identifier TEXT,
                app_path TEXT,
                reason TEXT NOT NULL,
                is_closed INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS activity_ai_summaries (
                activity_id TEXT PRIMARY KEY REFERENCES activities(id) ON DELETE CASCADE,
                status TEXT NOT NULL,
                provider TEXT NOT NULL DEFAULT '',
                model TEXT NOT NULL DEFAULT '',
                summary_json TEXT,
                error_code TEXT NOT NULL DEFAULT '',
                error_message TEXT NOT NULL DEFAULT '',
                image_width INTEGER NOT NULL DEFAULT 0,
                image_height INTEGER NOT NULL DEFAULT 0,
                compressed_bytes INTEGER NOT NULL DEFAULT 0,
                request_metadata_json TEXT NOT NULL DEFAULT '{}',
                zdr_requested INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS daily_ai_summaries (
                date TEXT PRIMARY KEY,
                status TEXT NOT NULL,
                provider TEXT NOT NULL DEFAULT '',
                model TEXT NOT NULL DEFAULT '',
                summary_json TEXT,
                error_code TEXT NOT NULL DEFAULT '',
                error_message TEXT NOT NULL DEFAULT '',
                source_summary_count INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value_json TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS activities_range_idx ON activities(start_ms, end_ms);
            CREATE INDEX IF NOT EXISTS entries_range_idx ON time_entries(start_ms, end_ms);
            CREATE INDEX IF NOT EXISTS passive_reviews_range_idx ON passive_reviews(start_ms, end_ms);
            CREATE INDEX IF NOT EXISTS activity_ai_summaries_status_idx ON activity_ai_summaries(status, updated_at);
            CREATE INDEX IF NOT EXISTS daily_ai_summaries_status_idx ON daily_ai_summaries(status, updated_at);
            """
        )
        try addColumnIfMissing(table: "projects", column: "tasks_json", definition: "TEXT NOT NULL DEFAULT '[]'")
        try addColumnIfMissing(table: "time_entries", column: "task_id", definition: "TEXT NOT NULL DEFAULT ''")
        try addColumnIfMissing(table: "time_entries", column: "created_by", definition: "TEXT NOT NULL DEFAULT 'manual'")
        try addColumnIfMissing(table: "time_entries", column: "auto_rule_id", definition: "TEXT NOT NULL DEFAULT ''")
        try addColumnIfMissing(table: "time_entries", column: "auto_context_key", definition: "TEXT NOT NULL DEFAULT ''")
        try addColumnIfMissing(table: "assignment_rules", column: "created_at_ms", definition: "INTEGER NOT NULL DEFAULT 0")
        try addColumnIfMissing(table: "activities", column: "interaction_state", definition: "TEXT NOT NULL DEFAULT 'handsOn'")
        try execute(
            """
            CREATE INDEX IF NOT EXISTS entries_auto_assignment_idx
                ON time_entries(created_by, auto_rule_id, project_id, auto_context_key, end_ms)
            """
        )
        try execute(
            "UPDATE assignment_rules SET created_at_ms = ? WHERE created_at_ms = 0",
            values: [currentTimeMillis()]
        )
        try execute("UPDATE activities SET interaction_state = 'handsOn' WHERE interaction_state NOT IN ('handsOn', 'handsOff')")
        try migratePassiveReviewsToHandsOffActivities()
        try execute("DELETE FROM activities WHERE lower(app) IN ('idle', 'loginwindow')")
        try execute(
            "INSERT OR REPLACE INTO schema_metadata (key, value) VALUES ('schema_version', '1')"
        )
    }

    private func migratePassiveReviewsToHandsOffActivities() throws {
        let reviews = try listPassiveReviews()
        guard !reviews.isEmpty else { return }

        for review in reviews {
            guard let start = intValue(review["start"]),
                  let end = intValue(review["end"]),
                  end > start else { continue }
            let app = stringValue(review["app"]) ?? ""
            let title = stringValue(review["title"]) ?? app
            try recordActivity(
                start: start,
                end: end,
                app: app,
                title: title,
                url: nonEmptyString(review["url"]),
                bundleIdentifier: nonEmptyString(review["bundleId"]),
                appPath: nonEmptyString(review["appPath"]),
                interactionState: "handsOff",
                source: "passive-review-migration"
            )
        }

        try execute("DELETE FROM passive_reviews")
    }

    private func repairLegacyProjectsTableIfNeeded() throws {
        guard try tableExists("projects") else { return }
        let expected = ["id", "name", "color", "billable", "rate_type", "hourly_rate", "fixed_rate", "currency", "tasks_json"]
        let currentColumns = try columns(in: "projects")
        guard !Set(expected).isSubset(of: currentColumns) else { return }

        let rows = try query("SELECT * FROM projects")
        try execute("PRAGMA foreign_keys = OFF")
        defer { try? execute("PRAGMA foreign_keys = ON") }

        try execute("DROP TABLE IF EXISTS projects_rebuilt")
        try execute(
            """
            CREATE TABLE projects_rebuilt (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                color TEXT NOT NULL,
                billable INTEGER NOT NULL DEFAULT 0,
                rate_type TEXT NOT NULL DEFAULT 'none',
                hourly_rate REAL NOT NULL DEFAULT 0,
                fixed_rate REAL NOT NULL DEFAULT 0,
                currency TEXT NOT NULL DEFAULT '$',
                tasks_json TEXT NOT NULL DEFAULT '[]'
            );
            """
        )
        for row in rows {
            guard let id = stringValue(row["id"]), let name = stringValue(row["name"]) else { continue }
            try execute(
                """
                INSERT OR IGNORE INTO projects_rebuilt
                    (id, name, color, billable, rate_type, hourly_rate, fixed_rate, currency, tasks_json)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                values: [
                    id,
                    name,
                    stringValue(row["color"]) ?? "#64748b",
                    intValue(row["billable"]) ?? 0,
                    stringValue(row["rate_type"]) ?? "none",
                    doubleValue(row["hourly_rate"]) ?? 0,
                    doubleValue(row["fixed_rate"]) ?? 0,
                    stringValue(row["currency"]) ?? "$",
                    stringValue(row["tasks_json"]) ?? "[]"
                ]
            )
        }
        try execute("DROP TABLE projects")
        try execute("ALTER TABLE projects_rebuilt RENAME TO projects")
    }

    private func repairLegacyTimeEntriesTableIfNeeded() throws {
        guard try tableExists("time_entries") else { return }
        let currentColumns = try columns(in: "time_entries")
        let expected = ["id", "start_ms", "end_ms", "project_id", "description", "billable", "task_id"]
        let hasLegacyBlockingColumns = currentColumns.contains("start")
            || currentColumns.contains("end")
            || currentColumns.contains("project")
            || currentColumns.contains("note")
        guard !Set(expected).isSubset(of: currentColumns) || hasLegacyBlockingColumns else { return }

        let projectRows = (try? query("SELECT id, name FROM projects")) ?? []
        var projectIDsByName: [String: String] = [:]
        for project in projectRows {
            guard let id = stringValue(project["id"]), let name = stringValue(project["name"]) else { continue }
            projectIDsByName[name] = id
        }

        let rows = try query("SELECT * FROM time_entries")
        try execute("PRAGMA foreign_keys = OFF")
        defer { try? execute("PRAGMA foreign_keys = ON") }

        try execute("DROP TABLE IF EXISTS time_entries_rebuilt")
        try execute(
            """
            CREATE TABLE time_entries_rebuilt (
                id TEXT PRIMARY KEY,
                start_ms INTEGER NOT NULL,
                end_ms INTEGER NOT NULL,
                project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                description TEXT NOT NULL DEFAULT '',
                billable INTEGER NOT NULL DEFAULT 0,
                task_id TEXT NOT NULL DEFAULT '',
                created_by TEXT NOT NULL DEFAULT 'manual',
                auto_rule_id TEXT NOT NULL DEFAULT '',
                auto_context_key TEXT NOT NULL DEFAULT ''
            );
            """
        )
        for row in rows {
            guard let id = stringValue(row["id"]),
                  let start = intValue(row["start_ms"]) ?? intValue(row["start"]),
                  let end = intValue(row["end_ms"]) ?? intValue(row["end"]),
                  end > start else {
                continue
            }
            let legacyProject = stringValue(row["project"])
            let projectID = nonEmptyString(row["project_id"])
                ?? legacyProject.flatMap { projectIDsByName[$0] }
                ?? legacyProject
                ?? "legacy-project"
            try execute(
                """
                INSERT OR IGNORE INTO time_entries_rebuilt
                    (id, start_ms, end_ms, project_id, description, billable, task_id,
                     created_by, auto_rule_id, auto_context_key)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                values: [
                    id,
                    start,
                    end,
                    projectID,
                    stringValue(row["description"]) ?? stringValue(row["note"]) ?? "",
                    intValue(row["billable"]) ?? 0,
                    stringValue(row["task_id"]) ?? "",
                    stringValue(row["created_by"]) ?? "manual",
                    stringValue(row["auto_rule_id"]) ?? "",
                    stringValue(row["auto_context_key"]) ?? ""
                ]
            )
        }
        try execute("DROP TABLE time_entries")
        try execute("ALTER TABLE time_entries_rebuilt RENAME TO time_entries")
    }

    private func listProjects() throws -> [[String: Any]] {
        try query(
            """
            SELECT id, name, color, billable, rate_type AS rateType,
                   hourly_rate AS hourlyRate, fixed_rate AS fixedRate, currency,
                   tasks_json AS tasksJson
            FROM projects ORDER BY name COLLATE NOCASE
            """
        ).map { projectOutput($0) }
    }

    private func createProject(_ payload: [String: Any]) throws -> [String: Any] {
        let project = try validatedProject(payload, id: identifier("project"))
        try insertProject(project)
        return projectOutput(project)
    }

    private func updateProject(_ payload: [String: Any]) throws -> [String: Any] {
        let id = try requiredString(payload, key: "id", maxLength: 128)
        guard var existing = try query(
            """
            SELECT id, name, color, billable, rate_type AS rateType,
                   hourly_rate AS hourlyRate, fixed_rate AS fixedRate, currency,
                   tasks_json AS tasksJson
            FROM projects WHERE id = ?
            """,
            values: [id]
        ).first else {
            throw OrielStoreError.invalidRequest("Project not found.")
        }
        existing = projectOutput(existing)
        for (key, value) in payload where key != "id" {
            existing[key] = value
        }
        let project = try validatedProject(existing, id: id)
        try execute(
            """
            UPDATE projects SET name = ?, color = ?, billable = ?, rate_type = ?,
                hourly_rate = ?, fixed_rate = ?, currency = ?, tasks_json = ? WHERE id = ?
            """,
            values: [
                project["name"], project["color"], project["billable"], project["rateType"],
                project["hourlyRate"], project["fixedRate"], project["currency"], project["tasksJson"], id
            ]
        )
        return projectOutput(project)
    }

    private func validatedProject(_ payload: [String: Any], id: String) throws -> [String: Any] {
        let name = try requiredString(payload, key: "name", maxLength: 200)
        let color = try requiredString(payload, key: "color", maxLength: 32)
        let rateType = optionalString(payload, key: "rateType", defaultValue: "none")
        guard ["none", "hourly", "fixed"].contains(rateType) else {
            throw OrielStoreError.invalidRequest("Unsupported billing type.")
        }
        let tasks = try validatedTasks(payload["tasks"])
        return [
            "id": id,
            "name": name,
            "color": color,
            "billable": boolean(payload["billable"]),
            "rateType": rateType,
            "hourlyRate": number(payload["hourlyRate"]),
            "fixedRate": number(payload["fixedRate"]),
            "currency": optionalString(payload, key: "currency", defaultValue: "$"),
            "tasks": tasks,
            "tasksJson": try encodedTasks(tasks)
        ]
    }

    private func insertProject(_ project: [String: Any]) throws {
        try execute(
            """
            INSERT INTO projects (id, name, color, billable, rate_type, hourly_rate, fixed_rate, currency, tasks_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            values: [
                project["id"], project["name"], project["color"], project["billable"], project["rateType"],
                project["hourlyRate"], project["fixedRate"], project["currency"], project["tasksJson"]
            ]
        )
    }

    private func projectOutput(_ row: [String: Any]) -> [String: Any] {
        var output = row
        output["tasks"] = decodedTasks(row["tasksJson"] as? String)
        output.removeValue(forKey: "tasksJson")
        return output
    }

    private func validatedTasks(_ value: Any?) throws -> [[String: Any]] {
        guard let value else { return [] }
        guard let tasks = value as? [[String: Any]] else {
            throw OrielStoreError.invalidRequest("Project tasks must be an array.")
        }

        return try tasks.map { task in
            let id = nonEmptyString(task["id"]) ?? identifier("task")
            guard id.count <= 128 else {
                throw OrielStoreError.invalidRequest("A valid task id is required.")
            }
            return [
                "id": id,
                "name": try requiredString(task, key: "name", maxLength: 200),
                "archived": boolean(task["archived"])
            ]
        }
    }

    private func encodedTasks(_ tasks: [[String: Any]]) throws -> String {
        let data = try JSONSerialization.data(withJSONObject: tasks, options: [.sortedKeys])
        guard let value = String(data: data, encoding: .utf8) else {
            throw OrielStoreError.invalidRequest("Project tasks could not be encoded.")
        }
        return value
    }

    private func decodedTasks(_ json: String?) -> [[String: Any]] {
        guard let json,
              let data = json.data(using: .utf8),
              let tasks = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else {
            return []
        }
        return tasks
    }

    private func listActivities(payload: [String: Any]) throws -> [[String: Any]] {
        let rows: [[String: Any]]
        if optionalString(payload, key: "date", defaultValue: "") == "all" {
            rows = try query(
                """
                SELECT start_ms AS start, end_ms AS end, app, title, url,
                       bundle_identifier AS bundleId, app_path AS appPath,
                       interaction_state AS interactionState
                FROM activities
                WHERE lower(app) NOT IN ('idle', 'loginwindow')
                ORDER BY start_ms
                """
            )
        } else {
            let bounds = try timeBounds(payload)
            rows = try query(
            """
            SELECT start_ms AS start, end_ms AS end, app, title, url,
                   bundle_identifier AS bundleId, app_path AS appPath,
                   interaction_state AS interactionState
            FROM activities
            WHERE start_ms < ? AND end_ms > ? AND lower(app) NOT IN ('idle', 'loginwindow')
            ORDER BY start_ms
            """,
            values: [bounds.end, bounds.start]
            )
        }
        return rows.map { row in
            var activity = row
            for key in ["url", "bundleId", "appPath"] where activity[key] is NSNull {
                activity[key] = ""
            }
            return activity
        }
    }

    func upsertActivityAISummary(_ payload: [String: Any]) throws {
        let activityID = try requiredString(payload, key: "activityId", maxLength: 128)
        let status = optionalString(payload, key: "status", defaultValue: "failed")
        guard ["pending", "succeeded", "failed", "skipped"].contains(status) else {
            throw OrielStoreError.invalidRequest("Unsupported activity AI summary status.")
        }
        let provider = optionalString(payload, key: "provider", defaultValue: "")
        let model = optionalString(payload, key: "model", defaultValue: "")
        let summaryJSON: String?
        if let summary = payload["summary"] as? [String: Any] {
            summaryJSON = try encodedJSONObject(summary)
        } else {
            summaryJSON = nil
        }
        let requestMetadata = payload["requestMetadata"] as? [String: Any] ?? [:]
        let requestMetadataJSON = try encodedJSONObject(requestMetadata)
        let zdrRequested = boolean(payload["zdrRequested"]) || boolean(requestMetadata["zdrRequested"])

        try execute(
            """
            INSERT INTO activity_ai_summaries (
                activity_id, status, provider, model, summary_json, error_code, error_message,
                image_width, image_height, compressed_bytes, request_metadata_json, zdr_requested, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(activity_id) DO UPDATE SET
                status = excluded.status,
                provider = excluded.provider,
                model = excluded.model,
                summary_json = excluded.summary_json,
                error_code = excluded.error_code,
                error_message = excluded.error_message,
                image_width = excluded.image_width,
                image_height = excluded.image_height,
                compressed_bytes = excluded.compressed_bytes,
                request_metadata_json = excluded.request_metadata_json,
                zdr_requested = excluded.zdr_requested,
                updated_at = CURRENT_TIMESTAMP
            """,
            values: [
                activityID,
                status,
                provider,
                model,
                summaryJSON,
                optionalString(payload, key: "errorCode", defaultValue: ""),
                String(optionalString(payload, key: "errorMessage", defaultValue: "").prefix(500)),
                intValue(payload["imageWidth"]) ?? 0,
                intValue(payload["imageHeight"]) ?? 0,
                intValue(payload["compressedBytes"]) ?? 0,
                requestMetadataJSON,
                zdrRequested ? 1 : 0
            ]
        )
    }

    private func listActivityAISummaries(payload: [String: Any] = [:]) throws -> [[String: Any]] {
        let rows: [[String: Any]]
        if optionalString(payload, key: "date", defaultValue: "").isEmpty {
            rows = try query(
                """
                SELECT activity_id AS activityId, status, provider, model,
                       summary_json AS summaryJson, error_code AS errorCode,
                       error_message AS errorMessage, image_width AS imageWidth,
                       image_height AS imageHeight, compressed_bytes AS compressedBytes,
                       request_metadata_json AS requestMetadataJson,
                       zdr_requested AS zdrRequested, created_at AS createdAt, updated_at AS updatedAt
                FROM activity_ai_summaries
                ORDER BY updated_at, activity_id
                """
            )
        } else {
            let bounds = try timeBounds(payload)
            rows = try query(
                """
                SELECT s.activity_id AS activityId, s.status, s.provider, s.model,
                       s.summary_json AS summaryJson, s.error_code AS errorCode,
                       s.error_message AS errorMessage, s.image_width AS imageWidth,
                       s.image_height AS imageHeight, s.compressed_bytes AS compressedBytes,
                       s.request_metadata_json AS requestMetadataJson,
                       s.zdr_requested AS zdrRequested, s.created_at AS createdAt, s.updated_at AS updatedAt,
                       a.start_ms AS start, a.end_ms AS end, a.app, a.title, a.url,
                       a.bundle_identifier AS bundleId
                FROM activity_ai_summaries s
                JOIN activities a ON a.id = s.activity_id
                WHERE a.start_ms < ? AND a.end_ms > ?
                ORDER BY a.start_ms, s.updated_at
                """,
                values: [bounds.end, bounds.start]
            )
        }
        return rows.map { row in
            var output = row
            if let summaryJSON = stringValue(row["summaryJson"]),
               let summary = decodedJSONObject(summaryJSON) {
                output["summary"] = summary
            }
            if let metadataJSON = stringValue(row["requestMetadataJson"]),
               let metadata = decodedJSONObject(metadataJSON) {
                output["requestMetadata"] = metadata
            }
            output["zdrRequested"] = (intValue(row["zdrRequested"]) ?? 0) != 0
            output.removeValue(forKey: "summaryJson")
            output.removeValue(forKey: "requestMetadataJson")
            return output
        }
    }

    func upsertDailyAISummary(_ payload: [String: Any]) throws {
        let date = try requiredString(payload, key: "date", maxLength: 10)
        guard isValidDateString(date) else {
            throw OrielStoreError.invalidRequest("A daily AI summary requires a valid date.")
        }
        let status = optionalString(payload, key: "status", defaultValue: "failed")
        guard ["pending", "succeeded", "failed", "empty"].contains(status) else {
            throw OrielStoreError.invalidRequest("Unsupported daily AI summary status.")
        }
        let summaryJSON: String?
        if let summary = payload["summary"] as? [String: Any] {
            summaryJSON = try encodedJSONObject(summary)
        } else {
            summaryJSON = nil
        }
        try execute(
            """
            INSERT INTO daily_ai_summaries (
                date, status, provider, model, summary_json, error_code,
                error_message, source_summary_count, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(date) DO UPDATE SET
                status = excluded.status,
                provider = excluded.provider,
                model = excluded.model,
                summary_json = excluded.summary_json,
                error_code = excluded.error_code,
                error_message = excluded.error_message,
                source_summary_count = excluded.source_summary_count,
                updated_at = CURRENT_TIMESTAMP
            """,
            values: [
                date,
                status,
                optionalString(payload, key: "provider", defaultValue: ""),
                optionalString(payload, key: "model", defaultValue: ""),
                summaryJSON,
                optionalString(payload, key: "errorCode", defaultValue: ""),
                String(optionalString(payload, key: "errorMessage", defaultValue: "").prefix(500)),
                max(0, intValue(payload["sourceSummaryCount"]) ?? 0)
            ]
        )
    }

    private func dailyAISummary(payload: [String: Any]) throws -> [String: Any] {
        let date = try requiredString(payload, key: "date", maxLength: 10)
        guard isValidDateString(date) else {
            throw OrielStoreError.invalidRequest("A daily AI summary requires a valid date.")
        }
        let sourceCount = try dailyAISummarySourceCount(for: date)
        guard let row = try query(
            """
            SELECT date, status, provider, model, summary_json AS summaryJson,
                   error_code AS errorCode, error_message AS errorMessage,
                   source_summary_count AS sourceSummaryCount,
                   created_at AS createdAt, updated_at AS updatedAt
            FROM daily_ai_summaries
            WHERE date = ?
            LIMIT 1
            """,
            values: [date]
        ).first else {
            return [
                "date": date,
                "status": sourceCount > 0 ? "ready" : "empty",
                "sourceSummaryCount": sourceCount
            ]
        }
        var output = row
        if let summaryJSON = stringValue(row["summaryJson"]),
           let summary = decodedJSONObject(summaryJSON) {
            output["summary"] = summary
        }
        output.removeValue(forKey: "summaryJson")
        if intValue(output["sourceSummaryCount"]) == 0 {
            output["sourceSummaryCount"] = sourceCount
        }
        return output
    }

    private func dailyAISummaries(payload: [String: Any]) throws -> [[String: Any]] {
        let dates = try dailyAISummaryDateRange(payload)
        let includeEmpty = boolean(payload["includeEmpty"])
        guard let startDate = dates.first, let endDate = dates.last else {
            return []
        }
        let storedRows = try query(
            """
            SELECT date, status, provider, model, summary_json AS summaryJson,
                   error_code AS errorCode, error_message AS errorMessage,
                   source_summary_count AS sourceSummaryCount,
                   created_at AS createdAt, updated_at AS updatedAt
            FROM daily_ai_summaries
            WHERE date >= ? AND date <= ?
            ORDER BY date DESC
            """,
            values: [startDate, endDate]
        )
        var storedByDate: [String: [String: Any]] = [:]
        storedRows.forEach { row in
            if let date = stringValue(row["date"]) {
                storedByDate[date] = row
            }
        }

        var output: [[String: Any]] = []
        for date in dates.reversed() {
            let sourceCount = try dailyAISummarySourceCount(for: date)
            if let row = storedByDate[date] {
                var summary = decodedDailyAISummaryRow(row, sourceCount: sourceCount)
                let status = stringValue(summary["status"]) ?? "empty"
                if status == "empty" && !includeEmpty && sourceCount == 0 {
                    continue
                }
                if status == "empty" && sourceCount > 0 {
                    summary["status"] = "ready"
                }
                output.append(summary)
                continue
            }
            if sourceCount > 0 {
                output.append([
                    "date": date,
                    "status": "ready",
                    "sourceSummaryCount": sourceCount
                ])
            } else if includeEmpty {
                output.append([
                    "date": date,
                    "status": "empty",
                    "sourceSummaryCount": 0
                ])
            }
        }
        return output
    }

    private func decodedDailyAISummaryRow(_ row: [String: Any], sourceCount: Int) -> [String: Any] {
        var output = row
        if let summaryJSON = stringValue(row["summaryJson"]),
           let summary = decodedJSONObject(summaryJSON) {
            output["summary"] = summary
        }
        output.removeValue(forKey: "summaryJson")
        if intValue(output["sourceSummaryCount"]) == 0 {
            output["sourceSummaryCount"] = sourceCount
        }
        return output
    }

    private func dailyAISummarySourceCount(for date: String) throws -> Int {
        try listActivityAISummaries(payload: ["date": date])
            .filter { ($0["status"] as? String) == "succeeded" }
            .count
    }

    private func dailyAISummaryDateRange(_ payload: [String: Any]) throws -> [String] {
        let startText = try requiredString(payload, key: "startDate", maxLength: 10)
        let endText = optionalString(payload, key: "endDate", defaultValue: startText)
        guard endText.count <= 10 else {
            throw OrielStoreError.invalidRequest("A valid daily AI summary date range is required.")
        }
        let formatter = dayFormatter()
        guard let startDate = formatter.date(from: startText),
              let endDate = formatter.date(from: endText),
              startDate <= endDate else {
            throw OrielStoreError.invalidRequest("A valid daily AI summary date range is required.")
        }
        let calendar = Calendar(identifier: .gregorian)
        let dayCount = calendar.dateComponents([.day], from: startDate, to: endDate).day ?? 0
        guard dayCount >= 0, dayCount < 366 else {
            throw OrielStoreError.invalidRequest("Daily AI summary ranges can cover at most 366 days.")
        }
        return (0...dayCount).compactMap { offset in
            calendar.date(byAdding: .day, value: offset, to: startDate).map { formatter.string(from: $0) }
        }
    }

    private func passiveReviewRows(whereClause: String, values: [Any?]) throws -> [[String: Any]] {
        try query(
            """
            SELECT id, start_ms AS start, end_ms AS end,
                   active_grace_cutoff_ms AS activeGraceCutoff,
                   app, title, url, bundle_identifier AS bundleId,
                   app_path AS appPath, reason, is_closed AS isClosed
            FROM passive_reviews
            \(whereClause)
            ORDER BY start_ms
            """,
            values: values
        ).map { row in
            var review = row
            for key in ["url", "bundleId", "appPath"] where review[key] is NSNull {
                review[key] = ""
            }
            let start = intValue(review["start"]) ?? 0
            let end = intValue(review["end"]) ?? start
            review["durationMs"] = max(0, end - start)
            review["isClosed"] = (intValue(review["isClosed"]) ?? 0) != 0
            return review
        }
    }

    private func listEntries(payload: [String: Any]) throws -> [[String: Any]] {
        let rows: [[String: Any]]
        if optionalString(payload, key: "date", defaultValue: "") == "all" {
            rows = try query(
                """
                SELECT id, start_ms AS start, end_ms AS end, project_id AS projectId,
                       description, billable, task_id AS taskId,
                       created_by AS createdBy, auto_rule_id AS autoRuleId
                FROM time_entries ORDER BY start_ms
                """
            )
        } else {
            let bounds = try timeBounds(payload)
            rows = try query(
                """
                SELECT id, start_ms AS start, end_ms AS end, project_id AS projectId,
                       description, billable, task_id AS taskId,
                       created_by AS createdBy, auto_rule_id AS autoRuleId
                FROM time_entries
                WHERE start_ms < ? AND end_ms > ? ORDER BY start_ms
                """,
                values: [bounds.end, bounds.start]
            )
        }
        return try rows.map { row in
            var enriched = row
            enriched["createdBy"] = stringValue(row["createdBy"]) ?? "manual"
            enriched["autoRuleId"] = stringValue(row["autoRuleId"]) ?? ""
            enriched["activities"] = try entryActivities(id: row["id"] as? String ?? "")
            return enriched
        }
    }

    private func createEntry(_ payload: [String: Any]) throws -> [String: Any] {
        let entry = try validatedEntry(payload, id: identifier("entry"))
        try transaction {
            try insertEntry(entry)
            try replaceEntryActivities(id: entry["id"] as! String, payload: payload)
        }
        var output = entry
        output["activities"] = try entryActivities(id: entry["id"] as! String)
        output["createdBy"] = "manual"
        output["autoRuleId"] = ""
        return output
    }

    private func updateEntry(_ payload: [String: Any]) throws -> [String: Any] {
        let id = try requiredString(payload, key: "id", maxLength: 128)
        guard var existing = try query(
            """
            SELECT id, start_ms AS start, end_ms AS end, project_id AS projectId,
                   description, billable, task_id AS taskId FROM time_entries WHERE id = ?
            """,
            values: [id]
        ).first else {
            throw OrielStoreError.invalidRequest("Time entry not found.")
        }
        for (key, value) in payload where key != "id" && key != "activities" {
            existing[key] = value
        }
        let entry = try validatedEntry(existing, id: id)
        try transaction {
            try execute(
                """
                UPDATE time_entries SET start_ms = ?, end_ms = ?, project_id = ?,
                    description = ?, billable = ?, task_id = ?,
                    created_by = 'manual', auto_rule_id = '', auto_context_key = ''
                WHERE id = ?
                """,
                values: [
                    entry["start"], entry["end"], entry["projectId"],
                    entry["description"], entry["billable"], entry["taskId"], id
                ]
            )
            if payload["activities"] != nil {
                try replaceEntryActivities(id: id, payload: payload)
            }
        }
        var output = entry
        output["activities"] = try entryActivities(id: id)
        output["createdBy"] = "manual"
        output["autoRuleId"] = ""
        return output
    }

    private func validatedEntry(_ payload: [String: Any], id: String) throws -> [String: Any] {
        let start = try requiredInt64(payload, key: "start")
        let end = try requiredInt64(payload, key: "end")
        guard end > start else {
            throw OrielStoreError.invalidRequest("Time entry end must be later than start.")
        }
        let taskID = optionalString(payload, key: "taskId", defaultValue: "")
        guard taskID.count <= 128 else {
            throw OrielStoreError.invalidRequest("A valid task id is required.")
        }
        return [
            "id": id,
            "start": start,
            "end": end,
            "projectId": try requiredString(payload, key: "projectId", maxLength: 128),
            "taskId": taskID,
            "description": optionalString(payload, key: "description", defaultValue: ""),
            "billable": boolean(payload["billable"])
        ]
    }

    private func insertEntry(_ entry: [String: Any]) throws {
        try execute(
            """
            INSERT INTO time_entries (id, start_ms, end_ms, project_id, description, billable, task_id)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            values: [
                entry["id"], entry["start"], entry["end"], entry["projectId"],
                entry["description"], entry["billable"], entry["taskId"]
            ]
        )
    }

    private func replaceEntryActivities(id: String, payload: [String: Any]) throws {
        try execute("DELETE FROM time_entry_activities WHERE time_entry_id = ?", values: [id])
        guard let activities = payload["activities"] as? [[String: Any]] else { return }
        for activity in activities {
            try insertEntryActivity(id: id, activity: activity)
        }
    }

    private func insertEntryActivity(id: String, activity: [String: Any]) throws {
        let data = try JSONSerialization.data(withJSONObject: activity)
        guard let value = String(data: data, encoding: .utf8) else { return }
        try execute(
            "INSERT INTO time_entry_activities (time_entry_id, activity_json) VALUES (?, ?)",
            values: [id, value]
        )
    }

    private func entryActivities(id: String) throws -> [[String: Any]] {
        try query("SELECT activity_json FROM time_entry_activities WHERE time_entry_id = ?", values: [id])
            .compactMap { row in
                guard let json = row["activity_json"] as? String,
                      let data = json.data(using: .utf8),
                      let value = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                    return nil
                }
                return value
            }
    }

    private func autoLogActivityIfMatched(_ activity: [String: Any]) throws {
        guard let rule = try firstMatchingAutoAssignmentRule(for: activity),
              let ruleID = rule["id"] as? String,
              let projectID = rule["projectId"] as? String,
              let ruleCreatedAt = intValue(rule["createdAt"]),
              let activityStart = intValue(activity["start"]),
              let activityEnd = intValue(activity["end"]) else {
            return
        }

        let start = max(activityStart, ruleCreatedAt)
        guard activityEnd > start else { return }

        let app = stringValue(activity["app"]) ?? ""
        let title = stringValue(activity["title"]) ?? app
        let url = nonEmptyString(activity["url"])
        let bundleID = nonEmptyString(activity["bundleId"])
        let appPath = nonEmptyString(activity["appPath"])
        let interactionState = nonEmptyString(activity["interactionState"]) ?? defaultInteractionState
        let contextKey = autoAssignmentContextKey(app: app, url: url)
        let snapshot = autoAssignmentSnapshot(
            ruleID: ruleID,
            start: start,
            end: activityEnd,
            app: app,
            title: title,
            url: url,
            bundleID: bundleID,
            appPath: appPath,
            interactionState: interactionState
        )

        if let existing = try autoEntryToExtend(
            ruleID: ruleID,
            projectID: projectID,
            contextKey: contextKey,
            start: start,
            end: activityEnd
        ) {
            guard let entryID = existing["id"] as? String else { return }
            try execute(
                "UPDATE time_entries SET start_ms = min(start_ms, ?), end_ms = max(end_ms, ?) WHERE id = ?",
                values: [start, activityEnd, entryID]
            )
            try insertEntryActivity(id: entryID, activity: snapshot)
            return
        }

        guard let project = try query("SELECT billable FROM projects WHERE id = ?", values: [projectID]).first else {
            return
        }
        let entryID = identifier("entry")
        try execute(
            """
            INSERT INTO time_entries (
                id, start_ms, end_ms, project_id, description, billable, task_id,
                created_by, auto_rule_id, auto_context_key
            )
            VALUES (?, ?, ?, ?, '', ?, '', 'auto-rule', ?, ?)
            """,
            values: [
                entryID,
                start,
                activityEnd,
                projectID,
                intValue(project["billable"]) ?? 0,
                ruleID,
                contextKey
            ]
        )
        try insertEntryActivity(id: entryID, activity: snapshot)
    }

    private func firstMatchingAutoAssignmentRule(for activity: [String: Any]) throws -> [String: Any]? {
        let app = stringValue(activity["app"]) ?? ""
        let title = stringValue(activity["title"]) ?? ""
        let url = stringValue(activity["url"]) ?? ""

        for rule in try listRules() {
            guard let field = rule["field"] as? String,
                  let matchType = rule["matchType"] as? String,
                  let pattern = rule["pattern"] as? String else { continue }

            let candidate: String
            switch field {
            case "app":
                candidate = app
            case "title":
                candidate = title
            case "url":
                candidate = url
            default:
                continue
            }

            if activityValueMatchesExclusion(candidate: candidate, matchType: matchType, pattern: pattern) {
                return rule
            }
        }

        return nil
    }

    private func autoEntryToExtend(
        ruleID: String,
        projectID: String,
        contextKey: String,
        start: Int64,
        end: Int64
    ) throws -> [String: Any]? {
        try query(
            """
            SELECT id, start_ms AS start, end_ms AS end
            FROM time_entries
            WHERE created_by = 'auto-rule'
              AND auto_rule_id = ?
              AND project_id = ?
              AND auto_context_key = ?
              AND end_ms >= ?
              AND start_ms <= ?
            ORDER BY end_ms DESC
            LIMIT 1
            """,
            values: [ruleID, projectID, contextKey, start - autoAssignmentMergeToleranceMs, end]
        ).first
    }

    private func autoAssignmentSnapshot(
        ruleID: String,
        start: Int64,
        end: Int64,
        app: String,
        title: String,
        url: String?,
        bundleID: String?,
        appPath: String?,
        interactionState: String
    ) -> [String: Any] {
        let duration = max(0, end - start)
        return [
            "app": app,
            "title": title,
            "url": url ?? "",
            "bundleId": bundleID ?? "",
            "appPath": appPath ?? "",
            "interactionState": interactionState,
            "start": start,
            "end": end,
            "duration": duration,
            "assignedDurationMs": duration,
            "assignmentStart": start,
            "assignmentEnd": end,
            "assignmentSource": "activity-stream",
            "assignmentModel": "auto-assigned-capture",
            "assignmentDisplayZoom": 1,
            "autoAssigned": true,
            "autoAssignmentRuleId": ruleID
        ]
    }

    private func autoAssignmentContextKey(app: String, url: String?) -> String {
        let normalizedApp = app.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard let url,
              let host = URL(string: url)?.host?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(),
              !host.isEmpty else {
            return normalizedApp
        }
        return "\(normalizedApp)|||\(host)"
    }

    private func listRules() throws -> [[String: Any]] {
        try query(
            """
            SELECT id, field, match_type AS matchType, pattern,
                   project_id AS projectId, created_at_ms AS createdAt
            FROM assignment_rules
            ORDER BY created_at_ms, rowid
            """
        )
    }

    private func createRule(_ payload: [String: Any]) throws -> [String: Any] {
        let createdAt = currentTimeMillis()
        let rule: [String: Any] = [
            "id": identifier("rule"),
            "field": try requiredString(payload, key: "field", maxLength: 32),
            "matchType": try requiredString(payload, key: "matchType", maxLength: 32),
            "pattern": try requiredString(payload, key: "pattern", maxLength: 500),
            "projectId": try requiredString(payload, key: "projectId", maxLength: 128),
            "createdAt": createdAt
        ]
        try execute(
            """
            INSERT INTO assignment_rules (id, field, match_type, pattern, project_id, created_at_ms)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            values: [rule["id"], rule["field"], rule["matchType"], rule["pattern"], rule["projectId"], rule["createdAt"]]
        )
        return rule
    }

    private func listExclusions() throws -> [[String: Any]] {
        try query("SELECT id, field, match_type AS matchType, pattern FROM capture_exclusions")
    }

    private func createExclusion(_ payload: [String: Any]) throws -> [String: Any] {
        var exclusion: [String: Any] = [
            "id": identifier("exclusion"),
            "field": try requiredString(payload, key: "field", maxLength: 32),
            "matchType": try requiredString(payload, key: "matchType", maxLength: 32),
            "pattern": try requiredString(payload, key: "pattern", maxLength: 500)
        ]
        try execute(
            "INSERT INTO capture_exclusions (id, field, match_type, pattern) VALUES (?, ?, ?, ?)",
            values: [exclusion["id"], exclusion["field"], exclusion["matchType"], exclusion["pattern"]]
        )
        if boolean(payload["applyToHistory"]) {
            exclusion["removedHistoryCount"] = try pruneActivityHistory(
                field: exclusion["field"] as? String ?? "",
                matchType: exclusion["matchType"] as? String ?? "",
                pattern: exclusion["pattern"] as? String ?? ""
            )
        }
        return exclusion
    }

    private func pruneActivityHistory(field: String, matchType: String, pattern: String) throws -> Int {
        let rows = try query("SELECT id, app, title, url FROM activities")
        var removedCount = 0
        for row in rows {
            let candidate: String
            switch field {
            case "app":
                candidate = row["app"] as? String ?? ""
            case "title":
                candidate = row["title"] as? String ?? ""
            case "url":
                candidate = row["url"] as? String ?? ""
            default:
                continue
            }
            guard activityValueMatchesExclusion(candidate: candidate, matchType: matchType, pattern: pattern),
                  let id = row["id"] as? String else {
                continue
            }
            try execute("DELETE FROM activities WHERE id = ?", values: [id])
            removedCount += 1
        }
        return removedCount
    }

    private func deleteByIdentifier(table: String, payload: [String: Any]) throws -> [String: Any] {
        let allowed = ["projects", "time_entries", "assignment_rules", "capture_exclusions"]
        guard allowed.contains(table) else {
            throw OrielStoreError.invalidRequest("Unsupported record deletion.")
        }
        let id = try requiredString(payload, key: "id", maxLength: 128)
        try execute("DELETE FROM \(table) WHERE id = ?", values: [id])
        return ["deleted": true, "id": id]
    }

    private func settings() throws -> [String: Any] {
        var output: [String: Any] = [
            "theme": "graphite",
            "minActivityThreshold": 60,
            "logoDevIconsEnabled": false,
            "hideEmptyActivityRows": false,
            "trackingEnabled": true,
            "startAtLogin": false,
            "aiProvider": "",
            "aiOpenAIModel": "gpt-5.2",
            "aiGoogleModel": "gemini-3.5-flash",
            "aiAnthropicModel": "claude-sonnet-4-20250514",
            "aiOpenRouterModel": "google/gemini-3.1-flash-lite",
            "aiScreenshotProvider": "",
            "aiScreenshotSummariesEnabled": false,
            "aiScreenshotFrequencyPreset": "balanced",
            "aiScreenshotDailyCap": 100,
            "aiScreenshotTimeoutSeconds": 20,
            "aiScreenshotModelMode": "askAI",
            "aiScreenshotOpenAIModel": "gpt-5.2",
            "aiScreenshotGoogleModel": "gemini-3.5-flash",
            "aiScreenshotAnthropicModel": "claude-sonnet-4-20250514",
            "aiScreenshotOpenRouterModel": "google/gemini-3.1-flash-lite",
            "aiScreenshotSensitiveApps": defaultScreenshotSensitiveApps(),
            "titleCleanupRules": defaultTitleCleanupRules()
        ]
        for row in try query("SELECT key, value_json FROM settings") {
            guard let key = row["key"] as? String,
                  let json = row["value_json"] as? String,
                  let value = decodedSettingValue(json) else { continue }
            if key == "titleCleanupRules" {
                if let rules = try? normalizedTitleCleanupRules(value) {
                    output[key] = rules
                }
                continue
            }
            output[key] = value
        }
        return output
    }

    private func updateSettings(_ payload: [String: Any]) throws -> [String: Any] {
        let accepted = [
            "theme",
            "minActivityThreshold",
            "logoDevIconsEnabled",
            "hideEmptyActivityRows",
            "trackingEnabled",
            "startAtLogin",
            "aiProvider",
            "aiOpenAIModel",
            "aiGoogleModel",
            "aiAnthropicModel",
            "aiOpenRouterModel",
            "aiScreenshotProvider",
            "aiScreenshotSummariesEnabled",
            "aiScreenshotFrequencyPreset",
            "aiScreenshotDailyCap",
            "aiScreenshotTimeoutSeconds",
            "aiScreenshotModelMode",
            "aiScreenshotOpenAIModel",
            "aiScreenshotGoogleModel",
            "aiScreenshotAnthropicModel",
            "aiScreenshotOpenRouterModel",
            "aiScreenshotSensitiveApps",
            "titleCleanupRules"
        ]
        for (key, value) in payload where accepted.contains(key) {
            let settingValue: Any
            if key == "minActivityThreshold" {
                settingValue = normalizedMinActivityThreshold(value)
            } else if key == "titleCleanupRules" {
                settingValue = try normalizedTitleCleanupRules(value)
            } else if key == "aiScreenshotFrequencyPreset" {
                settingValue = normalizedScreenshotFrequency(value)
            } else if key == "aiScreenshotDailyCap" {
                settingValue = normalizedPositiveInteger(value, defaultValue: 100, min: 1, max: 1000)
            } else if key == "aiScreenshotTimeoutSeconds" {
                settingValue = normalizedPositiveInteger(value, defaultValue: 20, min: 5, max: 60)
            } else if key == "aiScreenshotModelMode" {
                settingValue = normalizedScreenshotModelMode(value)
            } else if key == "aiScreenshotProvider" {
                settingValue = normalizedAIProvider(value)
            } else if key == "aiScreenshotSensitiveApps" {
                settingValue = try normalizedStringList(value, maxCount: 80, maxLength: 200)
            } else {
                settingValue = value
            }
            let encoded = try encodedSettingValue(settingValue)
            try execute(
                "INSERT OR REPLACE INTO settings (key, value_json) VALUES (?, ?)",
                values: [key, encoded]
            )
        }
        return try settings()
    }

    private func normalizedScreenshotFrequency(_ value: Any) -> String {
        let raw = stringValue(value) ?? "balanced"
        return ["low", "balanced", "high"].contains(raw) ? raw : "balanced"
    }

    private func normalizedScreenshotModelMode(_ value: Any) -> String {
        stringValue(value) == "override" ? "override" : "askAI"
    }

    private func normalizedAIProvider(_ value: Any) -> String {
        let raw = stringValue(value) ?? ""
        return AIProvider.normalize(raw)?.rawValue ?? ""
    }

    private func normalizedPositiveInteger(_ value: Any, defaultValue: Int, min: Int, max: Int) -> Int {
        let raw = intValue(value).map { Int($0) } ?? defaultValue
        return Swift.max(min, Swift.min(max, raw))
    }

    private func normalizedMinActivityThreshold(_ value: Any) -> Int {
        let threshold: Int?
        switch value {
        case let value as Int:
            threshold = value
        case let value as Int64:
            threshold = Int(value)
        case let value as NSNumber:
            threshold = value.intValue
        case let value as String:
            threshold = Int(value)
        default:
            threshold = nil
        }
        guard let threshold, [10, 30, 60].contains(threshold) else { return 60 }
        return threshold
    }

    private func defaultTitleCleanupRules() -> [[String: Any]] {
        [
            [
                "id": "brave-base-profile",
                "name": "Brave profile suffix",
                "enabled": true,
                "pattern": "\\s+-\\s*Brave\\s+-\\s*Base$",
                "appContains": "",
                "urlContains": ""
            ],
            [
                "id": "browser-prefix",
                "name": "Browser title prefix",
                "enabled": true,
                "pattern": "^(Brave Browser|Google Chrome|Brave|Chrome|Safari|Arc|Microsoft Edge|Edge)\\s+-\\s*",
                "appContains": "",
                "urlContains": ""
            ],
            [
                "id": "browser-suffix",
                "name": "Browser title suffix",
                "enabled": true,
                "pattern": "\\s+-\\s*(Brave Browser|Google Chrome|Brave|Chrome|Safari|Arc|Microsoft Edge|Edge)$",
                "appContains": "",
                "urlContains": ""
            ],
            [
                "id": "audio-playing",
                "name": "Audio playing status",
                "enabled": true,
                "pattern": "\\s+-\\s*Audio playing",
                "appContains": "",
                "urlContains": ""
            ],
            [
                "id": "high-memory-usage",
                "name": "High memory usage status",
                "enabled": true,
                "pattern": "\\s+-\\s*High memory usage\\s+-\\s*\\d+(?:\\.\\d+)?\\s*(?:MB|GB)",
                "appContains": "",
                "urlContains": ""
            ],
            [
                "id": "youtube-site-suffix",
                "name": "YouTube site suffix",
                "enabled": true,
                "pattern": "\\s+-\\s*YouTube$",
                "appContains": "",
                "urlContains": "youtube.com"
            ],
            [
                "id": "brave-notification-count",
                "name": "Brave notification count",
                "enabled": true,
                "pattern": "^\\(\\d+\\)\\s+",
                "appContains": "Brave",
                "urlContains": ""
            ],
            [
                "id": "chrome-notification-count",
                "name": "Chrome notification count",
                "enabled": true,
                "pattern": "^\\(\\d+\\)\\s+",
                "appContains": "Chrome",
                "urlContains": ""
            ],
            [
                "id": "obsidian-version-suffix",
                "name": "Obsidian version suffix",
                "enabled": true,
                "pattern": "\\s+-\\s*Obsidian\\s+\\d+(?:\\.\\d+)+$",
                "appContains": "Obsidian",
                "urlContains": ""
            ]
        ]
    }

    private func defaultScreenshotSensitiveApps() -> [String] {
        [
            "1password",
            "bitwarden",
            "dashlane",
            "keychain access",
            "lastpass",
            "proton pass",
            "keeper password",
            "authenticator"
        ]
    }

    private func normalizedStringList(_ value: Any, maxCount: Int, maxLength: Int) throws -> [String] {
        guard let items = value as? [Any], items.count <= maxCount else {
            throw OrielStoreError.invalidRequest("Setting list is invalid.")
        }
        var seen = Set<String>()
        var output: [String] = []
        for item in items {
            guard let raw = item as? String else { continue }
            let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty, trimmed.count <= maxLength else { continue }
            let key = trimmed.lowercased()
            guard !seen.contains(key) else { continue }
            seen.insert(key)
            output.append(trimmed)
        }
        return output
    }

    private func normalizedTitleCleanupRules(_ value: Any) throws -> [[String: Any]] {
        guard let rules = value as? [Any], rules.count <= 100 else {
            throw OrielStoreError.invalidRequest("Title cleanup rules must be an array.")
        }
        return try rules.map { item in
            guard let rule = item as? [String: Any] else {
                throw OrielStoreError.invalidRequest("A title cleanup rule must be an object.")
            }
            return [
                "id": try requiredString(rule, key: "id", maxLength: 120),
                "name": try requiredString(rule, key: "name", maxLength: 160),
                "enabled": titleCleanupRuleEnabled(rule["enabled"]),
                "pattern": try requiredString(rule, key: "pattern", maxLength: 500),
                "appContains": optionalLimitedString(rule, key: "appContains", maxLength: 160),
                "urlContains": optionalLimitedString(rule, key: "urlContains", maxLength: 300)
            ]
        }
    }

    private func titleCleanupRuleEnabled(_ value: Any?) -> Bool {
        switch value {
        case let value as Bool:
            return value
        case let value as NSNumber:
            return value.boolValue
        default:
            return true
        }
    }

    private func optionalLimitedString(_ payload: [String: Any], key: String, maxLength: Int) -> String {
        guard let value = payload[key] as? String else { return "" }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return String(trimmed.prefix(maxLength))
    }

    private func encodedSettingValue(_ value: Any) throws -> String {
        switch value {
        case let value as Bool:
            return value ? "true" : "false"
        case let value as NSNumber:
            if CFGetTypeID(value as CFTypeRef) == CFBooleanGetTypeID() {
                return value.boolValue ? "true" : "false"
            }
            if value.doubleValue.truncatingRemainder(dividingBy: 1) == 0 {
                return String(value.int64Value)
            }
            return String(value.doubleValue)
        case let value as Int:
            return String(value)
        case let value as Int64:
            return String(value)
        case let value as Double:
            return String(value)
        case let value as String:
            let data = try JSONSerialization.data(withJSONObject: value, options: .fragmentsAllowed)
            return String(decoding: data, as: UTF8.self)
        case let value as [Any]:
            let data = try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
            return String(decoding: data, as: UTF8.self)
        case let value as [String: Any]:
            let data = try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
            return String(decoding: data, as: UTF8.self)
        default:
            throw OrielStoreError.invalidRequest("Unsupported settings value.")
        }
    }

    private func decodedSettingValue(_ json: String) -> Any? {
        if json == "true" { return true }
        if json == "false" { return false }
        if let intValue = Int(json) { return intValue }
        if let doubleValue = Double(json) { return doubleValue }
        guard let data = json.data(using: .utf8) else { return nil }
        return try? JSONSerialization.jsonObject(with: data, options: .fragmentsAllowed)
    }

    private func encodedJSONObject(_ value: [String: Any]) throws -> String {
        let data = try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
        return String(decoding: data, as: UTF8.self)
    }

    private func decodedJSONObject(_ json: String) -> [String: Any]? {
        guard let data = json.data(using: .utf8) else { return nil }
        return try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    }

    private func exportArchive() throws -> [String: Any] {
        [
            "format": "so.sil.oriel.portable-data",
            "version": 1,
            "exportedAt": ISO8601DateFormatter().string(from: Date()),
            "projects": try listProjects(),
            "timeEntries": try listEntries(payload: ["date": "all"]),
            "activities": try query(
                """
                SELECT id, start_ms AS start, end_ms AS end, app, title, url,
                       bundle_identifier AS bundleId, app_path AS appPath,
                       interaction_state AS interactionState, source
                FROM activities WHERE lower(app) NOT IN ('idle', 'loginwindow') ORDER BY start_ms
                """
            ),
            "activityAISummaries": try listActivityAISummaries(),
            "dailyAISummaries": try query(
                """
                SELECT date, status, provider, model, summary_json AS summaryJson,
                       error_code AS errorCode, error_message AS errorMessage,
                       source_summary_count AS sourceSummaryCount,
                       created_at AS createdAt, updated_at AS updatedAt
                FROM daily_ai_summaries
                ORDER BY date
                """
            ).map { row in
                var output = row
                if let summaryJSON = stringValue(row["summaryJson"]),
                   let summary = decodedJSONObject(summaryJSON) {
                    output["summary"] = summary
                }
                output.removeValue(forKey: "summaryJson")
                return output
            },
            "rules": try listRules(),
            "exclusions": try listExclusions(),
            "settings": try settings()
        ]
    }

    private func purge() throws {
        try transaction {
            for table in ["time_entry_activities", "time_entries", "assignment_rules", "capture_exclusions", "passive_reviews", "daily_ai_summaries", "activity_ai_summaries", "activities", "projects", "settings"] {
                try execute("DELETE FROM \(table)")
            }
        }
    }

    private func timeBounds(_ payload: [String: Any]) throws -> (start: Int64, end: Int64) {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.dateFormat = "yyyy-MM-dd"
        let startText = optionalString(payload, key: "startDate", defaultValue: optionalString(payload, key: "date", defaultValue: ""))
        let endText = optionalString(payload, key: "endDate", defaultValue: startText)
        guard let startDate = formatter.date(from: startText),
              let endDate = formatter.date(from: endText),
              let endExclusive = Calendar.current.date(byAdding: .day, value: 1, to: endDate) else {
            throw OrielStoreError.invalidRequest("A valid activity date or date range is required.")
        }
        return (Int64(startDate.timeIntervalSince1970 * 1000), Int64(endExclusive.timeIntervalSince1970 * 1000))
    }

    private func identifier(_ prefix: String) -> String {
        "\(prefix)-\(UUID().uuidString.lowercased())"
    }

    private func currentTimeMillis() -> Int64 {
        Int64(Date().timeIntervalSince1970 * 1000)
    }

    private func tableExists(_ table: String) throws -> Bool {
        try !query(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
            values: [table]
        ).isEmpty
    }

    private func columns(in table: String) throws -> Set<String> {
        let allowed = [
            "projects",
            "time_entries",
            "activities",
            "schema_metadata",
            "time_entry_activities",
            "assignment_rules",
            "capture_exclusions",
            "passive_reviews",
            "activity_ai_summaries",
            "daily_ai_summaries",
            "settings"
        ]
        guard allowed.contains(table) else {
            throw OrielStoreError.invalidRequest("Unsupported schema inspection table.")
        }
        return Set(try query("PRAGMA table_info(\(table))").compactMap { row in
            row["name"] as? String
        })
    }

    private func addColumnIfMissing(table: String, column: String, definition: String) throws {
        guard !(try columns(in: table).contains(column)) else { return }
        try execute("ALTER TABLE \(table) ADD COLUMN \(column) \(definition)")
    }

    private func requiredString(_ payload: [String: Any], key: String, maxLength: Int) throws -> String {
        guard let value = payload[key] as? String,
              !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              value.count <= maxLength else {
            throw OrielStoreError.invalidRequest("A valid \(key) is required.")
        }
        return value
    }

    private func optionalString(_ payload: [String: Any], key: String, defaultValue: String) -> String {
        payload[key] as? String ?? defaultValue
    }

    private func requiredInt64(_ payload: [String: Any], key: String) throws -> Int64 {
        if let number = payload[key] as? NSNumber {
            return number.int64Value
        }
        throw OrielStoreError.invalidRequest("A valid \(key) timestamp is required.")
    }

    private func boolean(_ value: Any?) -> Bool {
        switch value {
        case let value as Bool:
            return value
        case let value as NSNumber:
            return value.boolValue
        default:
            return false
        }
    }

    private func number(_ value: Any?) -> Double {
        (value as? NSNumber)?.doubleValue ?? 0
    }

    private func stringValue(_ value: Any?) -> String? {
        switch value {
        case let value as String:
            return value
        case let value as NSNumber:
            return value.stringValue
        case let value as Int64:
            return String(value)
        case let value as Int:
            return String(value)
        default:
            return nil
        }
    }

    private func nonEmptyString(_ value: Any?) -> String? {
        guard let value = stringValue(value)?.trimmingCharacters(in: .whitespacesAndNewlines),
              !value.isEmpty else {
            return nil
        }
        return value
    }

    private func isExcludedActivityApp(_ app: String) -> Bool {
        let normalized = app.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return normalized == "idle" || normalized == "loginwindow"
    }

    private func activityValueMatchesExclusion(candidate: String, matchType: String, pattern: String) -> Bool {
        switch matchType {
        case "equals":
            return candidate.caseInsensitiveCompare(pattern) == .orderedSame
        case "contains":
            return candidate.range(of: pattern, options: .caseInsensitive) != nil
        case "regex":
            guard let expression = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else {
                return false
            }
            return expression.firstMatch(
                in: candidate,
                range: NSRange(candidate.startIndex..., in: candidate)
            ) != nil
        default:
            return false
        }
    }

    private func intValue(_ value: Any?) -> Int64? {
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

    private func doubleValue(_ value: Any?) -> Double? {
        switch value {
        case let value as Double:
            return value
        case let value as Int64:
            return Double(value)
        case let value as Int:
            return Double(value)
        case let value as NSNumber:
            return value.doubleValue
        case let value as String:
            return Double(value)
        default:
            return nil
        }
    }

    private func transaction(_ body: () throws -> Void) throws {
        try execute("BEGIN IMMEDIATE TRANSACTION")
        do {
            try body()
            try execute("COMMIT")
        } catch {
            try? execute("ROLLBACK")
            throw error
        }
    }

    private func execute(_ sql: String, values: [Any?] = []) throws {
        if values.isEmpty {
            var errorMessage: UnsafeMutablePointer<CChar>?
            let result = sqlite3_exec(database, sql, nil, nil, &errorMessage)
            if let errorMessage {
                sqlite3_free(errorMessage)
            }
            guard result == SQLITE_OK else {
                throw databaseError()
            }
            return
        }
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(database, sql, -1, &statement, nil) == SQLITE_OK else {
            throw databaseError()
        }
        defer { sqlite3_finalize(statement) }
        try bind(values, to: statement)
        var result = sqlite3_step(statement)
        while result == SQLITE_ROW {
            result = sqlite3_step(statement)
        }
        guard result == SQLITE_DONE else {
            throw databaseError()
        }
    }

    private func query(_ sql: String, values: [Any?] = []) throws -> [[String: Any]] {
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(database, sql, -1, &statement, nil) == SQLITE_OK else {
            throw databaseError()
        }
        defer { sqlite3_finalize(statement) }
        try bind(values, to: statement)
        var records: [[String: Any]] = []
        while sqlite3_step(statement) == SQLITE_ROW {
            var record: [String: Any] = [:]
            for index in 0..<sqlite3_column_count(statement) {
                let key = String(cString: sqlite3_column_name(statement, index))
                switch sqlite3_column_type(statement, index) {
                case SQLITE_INTEGER:
                    record[key] = sqlite3_column_int64(statement, index)
                case SQLITE_FLOAT:
                    record[key] = sqlite3_column_double(statement, index)
                case SQLITE_TEXT:
                    record[key] = String(cString: sqlite3_column_text(statement, index))
                case SQLITE_NULL:
                    record[key] = NSNull()
                default:
                    break
                }
            }
            records.append(record)
        }
        return records
    }

    private func bind(_ values: [Any?], to statement: OpaquePointer?) throws {
        let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
        for (offset, value) in values.enumerated() {
            let index = Int32(offset + 1)
            let result: Int32
            switch value {
            case nil, is NSNull:
                result = sqlite3_bind_null(statement, index)
            case let value as Bool:
                result = sqlite3_bind_int(statement, index, value ? 1 : 0)
            case let value as Int64:
                result = sqlite3_bind_int64(statement, index, value)
            case let value as Int:
                result = sqlite3_bind_int64(statement, index, Int64(value))
            case let value as Double:
                result = sqlite3_bind_double(statement, index, value)
            case let value as NSNumber:
                result = sqlite3_bind_double(statement, index, value.doubleValue)
            case let value as String:
                result = sqlite3_bind_text(statement, index, value, -1, transient)
            default:
                throw OrielStoreError.invalidRequest("Unsupported SQLite value.")
            }
            guard result == SQLITE_OK else { throw databaseError() }
        }
    }

    private func databaseError() -> OrielStoreError {
        let message = database.flatMap { sqlite3_errmsg($0) }.map(String.init(cString:)) ?? "Unknown database error."
        return .storage(message)
    }
}
