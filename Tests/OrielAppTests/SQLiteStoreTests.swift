import XCTest
@testable import OrielApp

final class SQLiteStoreTests: XCTestCase {
    private var directory: URL!
    private var store: SQLiteStore!

    override func setUpWithError() throws {
        directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("OrielTests-\(UUID().uuidString)", isDirectory: true)
        store = try SQLiteStore(databaseURL: directory.appendingPathComponent("Oriel.sqlite"))
    }

    override func tearDownWithError() throws {
        store = nil
        try? FileManager.default.removeItem(at: directory)
    }

    private func createProject(
        name: String = "Oriel Time Tracker",
        color: String = "#3b82f6",
        billable: Bool = false
    ) throws -> String {
        let project = try XCTUnwrap(
            try store.request(
                operation: "projects.create",
                payload: [
                    "name": name,
                    "color": color,
                    "billable": billable
                ]
            ) as? [String: Any]
        )
        return try XCTUnwrap(project["id"] as? String)
    }

    private func createRule(
        field: String = "app",
        matchType: String = "contains",
        pattern: String = "Codex",
        projectID: String
    ) throws -> [String: Any] {
        try XCTUnwrap(
            try store.request(
                operation: "rules.create",
                payload: [
                    "field": field,
                    "matchType": matchType,
                    "pattern": pattern,
                    "projectId": projectID
                ]
            ) as? [String: Any]
        )
    }

    private func allEntries() throws -> [[String: Any]] {
        try XCTUnwrap(try store.request(operation: "entries.list", payload: ["date": "all"]) as? [[String: Any]])
    }

    private func int64Value(_ value: Any?) -> Int64? {
        switch value {
        case let value as Int64:
            return value
        case let value as Int:
            return Int64(value)
        case let value as NSNumber:
            return value.int64Value
        default:
            return nil
        }
    }

    private func millis(
        _ year: Int,
        _ month: Int,
        _ day: Int,
        hour: Int = 9,
        minute: Int = 0
    ) throws -> Int64 {
        var components = DateComponents()
        components.calendar = Calendar(identifier: .gregorian)
        components.year = year
        components.month = month
        components.day = day
        components.hour = hour
        components.minute = minute
        components.second = 0
        let date = try XCTUnwrap(components.date)
        return Int64(date.timeIntervalSince1970 * 1000)
    }

    func testFreshDatabaseCreatesSchemaAndSupportsProjectAndEntryCRUD() throws {
        let project = try XCTUnwrap(
            try store.request(
                operation: "projects.create",
                payload: [
                    "name": "Client",
                    "color": "#3b82f6",
                    "billable": true,
                    "rateType": "hourly",
                    "hourlyRate": 120,
                    "currency": "$",
                    "tasks": [
                        ["id": "task-planning", "name": "Planning", "archived": false]
                    ]
                ]
            ) as? [String: Any]
        )
        let projectID = try XCTUnwrap(project["id"] as? String)
        let tasks = try XCTUnwrap(project["tasks"] as? [[String: Any]])
        XCTAssertEqual(tasks.first?["id"] as? String, "task-planning")

        _ = try store.request(
            operation: "entries.create",
            payload: [
                "start": 1_779_768_000_000 as Int64,
                "end": 1_779_771_600_000 as Int64,
                "projectId": projectID,
                "taskId": "task-planning",
                "description": "Implementation",
                "billable": true
            ]
        )

        let projects = try XCTUnwrap(try store.request(operation: "projects.list", payload: [:]) as? [[String: Any]])
        let entries = try XCTUnwrap(try store.request(operation: "entries.list", payload: ["date": "all"]) as? [[String: Any]])
        XCTAssertEqual(projects.count, 1)
        XCTAssertEqual(entries.count, 1)
        XCTAssertEqual((projects.first?["tasks"] as? [[String: Any]])?.first?["name"] as? String, "Planning")
        XCTAssertEqual(entries.first?["projectId"] as? String, projectID)
        XCTAssertEqual(entries.first?["taskId"] as? String, "task-planning")
    }

    func testTimeEntriesRejectNonPositiveRangesOnCreateAndUpdate() throws {
        let projectID = try createProject()

        XCTAssertThrowsError(
            try store.request(
                operation: "entries.create",
                payload: [
                    "start": 1_779_768_000_000 as Int64,
                    "end": 1_779_768_000_000 as Int64,
                    "projectId": projectID
                ]
            )
        )

        let validEntry = try XCTUnwrap(
            try store.request(
                operation: "entries.create",
                payload: [
                    "start": 1_779_768_000_000 as Int64,
                    "end": 1_779_768_060_000 as Int64,
                    "projectId": projectID
                ]
            ) as? [String: Any]
        )
        let validEntryID = try XCTUnwrap(validEntry["id"] as? String)

        XCTAssertThrowsError(
            try store.request(
                operation: "entries.update",
                payload: [
                    "id": validEntryID,
                    "start": 1_779_768_060_000 as Int64,
                    "end": 1_779_768_060_000 as Int64
                ]
            )
        )
    }

    func testAssignmentRuleDoesNotBackfillExistingActivity() throws {
        let projectID = try createProject()
        try store.recordActivity(
            start: 1_779_768_000_000,
            end: 1_779_768_120_000,
            app: "Codex",
            title: "Codex",
            url: nil,
            bundleIdentifier: "com.openai.codex",
            appPath: "/Applications/Codex.app"
        )

        let rule = try createRule(projectID: projectID)

        XCTAssertNotNil(int64Value(rule["createdAt"]))
        XCTAssertEqual(try allEntries().count, 0)
    }

    func testFutureMatchingActivityCreatesAutoLoggedTimeEntry() throws {
        let projectID = try createProject(billable: true)
        let rule = try createRule(projectID: projectID)
        let createdAt = try XCTUnwrap(int64Value(rule["createdAt"]))
        let start = createdAt + 1_000
        let end = start + 120_000

        try store.recordActivity(
            start: start,
            end: end,
            app: "Codex",
            title: "Codex",
            url: nil,
            bundleIdentifier: "com.openai.codex",
            appPath: "/Applications/Codex.app"
        )

        let entries = try allEntries()
        XCTAssertEqual(entries.count, 1)
        XCTAssertEqual(entries[0]["start"] as? Int64, start)
        XCTAssertEqual(entries[0]["end"] as? Int64, end)
        XCTAssertEqual(entries[0]["projectId"] as? String, projectID)
        XCTAssertEqual(int64Value(entries[0]["billable"]), 1)
        XCTAssertEqual(entries[0]["createdBy"] as? String, "auto-rule")
        XCTAssertEqual(entries[0]["autoRuleId"] as? String, rule["id"] as? String)
        let activities = try XCTUnwrap(entries[0]["activities"] as? [[String: Any]])
        XCTAssertEqual(activities.count, 1)
        XCTAssertEqual(activities[0]["assignmentSource"] as? String, "activity-stream")
        XCTAssertEqual(activities[0]["assignmentModel"] as? String, "auto-assigned-capture")
        XCTAssertEqual(activities[0]["autoAssigned"] as? Bool, true)
        XCTAssertEqual(activities[0]["autoAssignmentRuleId"] as? String, rule["id"] as? String)
        XCTAssertEqual(int64Value(activities[0]["assignedDurationMs"]), 120_000)
    }

    func testShortAutoLoggedEntryIsReturnedFromEntriesList() throws {
        let projectID = try createProject()
        let rule = try createRule(projectID: projectID)
        let createdAt = try XCTUnwrap(int64Value(rule["createdAt"]))

        try store.recordActivity(
            start: createdAt + 1_000,
            end: createdAt + 45_000,
            app: "Codex",
            title: "Codex",
            url: nil,
            bundleIdentifier: "com.openai.codex",
            appPath: "/Applications/Codex.app"
        )

        let entries = try allEntries()
        XCTAssertEqual(entries.count, 1)
        XCTAssertEqual(entries[0]["createdBy"] as? String, "auto-rule")
        XCTAssertEqual(int64Value(entries[0]["start"]), createdAt + 1_000)
        XCTAssertEqual(int64Value(entries[0]["end"]), createdAt + 45_000)
    }

    func testManualEntryWithLegacyAutoAssignedSnapshotIsNotHidden() throws {
        let projectID = try createProject()
        _ = try store.request(
            operation: "entries.create",
            payload: [
                "start": 1_779_768_000_000 as Int64,
                "end": 1_779_768_045_000 as Int64,
                "projectId": projectID,
                "description": "Manually reviewed",
                "activities": [[
                    "app": "Codex",
                    "title": "Codex",
                    "start": 1_779_768_000_000 as Int64,
                    "end": 1_779_768_045_000 as Int64,
                    "duration": 45_000,
                    "assignedDurationMs": 45_000,
                    "assignmentSource": "activity-stream",
                    "assignmentModel": "auto-assigned-capture",
                    "autoAssigned": true,
                    "autoAssignmentRuleId": "rule-legacy"
                ]]
            ]
        )

        let entries = try allEntries()
        XCTAssertEqual(entries.count, 1)
        XCTAssertEqual(entries[0]["createdBy"] as? String, "manual")
        XCTAssertEqual(entries[0]["autoRuleId"] as? String, "")
    }

    func testActivityCrossingRuleCreationIsClippedToRuleCreationTime() throws {
        let projectID = try createProject()
        let rule = try createRule(projectID: projectID)
        let createdAt = try XCTUnwrap(int64Value(rule["createdAt"]))

        try store.recordActivity(
            start: createdAt - 60_000,
            end: createdAt + 60_000,
            app: "Codex",
            title: "Codex",
            url: nil,
            bundleIdentifier: "com.openai.codex",
            appPath: "/Applications/Codex.app"
        )

        let entry = try XCTUnwrap(try allEntries().first)
        XCTAssertEqual(entry["start"] as? Int64, createdAt)
        XCTAssertEqual(entry["end"] as? Int64, createdAt + 60_000)
        let activity = try XCTUnwrap((entry["activities"] as? [[String: Any]])?.first)
        XCTAssertEqual(int64Value(activity["assignmentStart"]), createdAt)
        XCTAssertEqual(int64Value(activity["assignmentEnd"]), createdAt + 60_000)
        XCTAssertEqual(int64Value(activity["assignedDurationMs"]), 60_000)
    }

    func testAdjacentMatchingCapturesExtendOneAutoLoggedEntry() throws {
        let projectID = try createProject()
        let rule = try createRule(projectID: projectID)
        let createdAt = try XCTUnwrap(int64Value(rule["createdAt"]))
        let firstStart = createdAt + 1_000
        let firstEnd = firstStart + 60_000
        let secondStart = firstEnd + 4_000
        let secondEnd = secondStart + 90_000

        try store.recordActivity(
            start: firstStart,
            end: firstEnd,
            app: "Codex",
            title: "Codex",
            url: nil,
            bundleIdentifier: "com.openai.codex",
            appPath: "/Applications/Codex.app"
        )
        try store.recordActivity(
            start: secondStart,
            end: secondEnd,
            app: "Codex",
            title: "Codex",
            url: nil,
            bundleIdentifier: "com.openai.codex",
            appPath: "/Applications/Codex.app"
        )

        let entries = try allEntries()
        XCTAssertEqual(entries.count, 1)
        XCTAssertEqual(entries[0]["start"] as? Int64, firstStart)
        XCTAssertEqual(entries[0]["end"] as? Int64, secondEnd)
        let activities = try XCTUnwrap(entries[0]["activities"] as? [[String: Any]])
        XCTAssertEqual(activities.count, 2)
        XCTAssertEqual(activities.compactMap { int64Value($0["assignedDurationMs"]) }.reduce(0, +), 150_000)
    }

    func testNonMatchingActivityDoesNotCreateAutoLoggedEntry() throws {
        let projectID = try createProject()
        let rule = try createRule(projectID: projectID)
        let createdAt = try XCTUnwrap(int64Value(rule["createdAt"]))

        try store.recordActivity(
            start: createdAt + 1_000,
            end: createdAt + 61_000,
            app: "Safari",
            title: "Safari",
            url: nil,
            bundleIdentifier: "com.apple.Safari",
            appPath: "/Applications/Safari.app"
        )

        XCTAssertEqual(try allEntries().count, 0)
    }

    func testFirstCreatedMatchingRuleWinsAutoAssignment() throws {
        let firstProjectID = try createProject(name: "First Project", color: "#3b82f6")
        let secondProjectID = try createProject(name: "Second Project", color: "#10b981")
        let firstRule = try createRule(pattern: "Code", projectID: firstProjectID)
        _ = try createRule(pattern: "Codex", projectID: secondProjectID)
        let createdAt = try XCTUnwrap(int64Value(firstRule["createdAt"]))

        try store.recordActivity(
            start: createdAt + 1_000,
            end: createdAt + 61_000,
            app: "Codex",
            title: "Codex",
            url: nil,
            bundleIdentifier: "com.openai.codex",
            appPath: "/Applications/Codex.app"
        )

        let entry = try XCTUnwrap(try allEntries().first)
        XCTAssertEqual(entry["projectId"] as? String, firstProjectID)
    }

    func testEditingAutoLoggedEntryPreventsFutureAutoExtensionIntoThatEntry() throws {
        let projectID = try createProject()
        let rule = try createRule(projectID: projectID)
        let createdAt = try XCTUnwrap(int64Value(rule["createdAt"]))
        let firstStart = createdAt + 1_000
        let firstEnd = firstStart + 60_000
        let secondStart = firstEnd + 4_000
        let secondEnd = secondStart + 60_000

        try store.recordActivity(
            start: firstStart,
            end: firstEnd,
            app: "Codex",
            title: "Codex",
            url: nil,
            bundleIdentifier: "com.openai.codex",
            appPath: "/Applications/Codex.app"
        )
        let originalEntry = try XCTUnwrap(try allEntries().first)
        let originalEntryID = try XCTUnwrap(originalEntry["id"] as? String)

        _ = try store.request(
            operation: "entries.update",
            payload: [
                "id": originalEntryID,
                "description": "Reviewed manually"
            ]
        )
        try store.recordActivity(
            start: secondStart,
            end: secondEnd,
            app: "Codex",
            title: "Codex",
            url: nil,
            bundleIdentifier: "com.openai.codex",
            appPath: "/Applications/Codex.app"
        )

        let entries = try allEntries()
        XCTAssertEqual(entries.count, 2)
        XCTAssertEqual(entries.first(where: { ($0["id"] as? String) == originalEntryID })?["end"] as? Int64, firstEnd)
        XCTAssertTrue(entries.contains { ($0["id"] as? String) != originalEntryID && ($0["start"] as? Int64) == secondStart })
    }

    func testCurrentSchemaWithoutAutoColumnsMigratesBeforeIndexCreation() throws {
        store = nil
        try? FileManager.default.removeItem(at: directory)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let databaseURL = directory.appendingPathComponent("Oriel.sqlite")
        try runSQLite(
            databaseURL,
            """
            CREATE TABLE projects (
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
            INSERT INTO projects (id, name, color, billable)
            VALUES ('project-existing', 'Existing Project', '#3b82f6', 1);
            CREATE TABLE time_entries (
              id TEXT PRIMARY KEY,
              start_ms INTEGER NOT NULL,
              end_ms INTEGER NOT NULL,
              project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
              description TEXT NOT NULL DEFAULT '',
              billable INTEGER NOT NULL DEFAULT 0,
              task_id TEXT NOT NULL DEFAULT ''
            );
            CREATE TABLE assignment_rules (
              id TEXT PRIMARY KEY,
              field TEXT NOT NULL,
              match_type TEXT NOT NULL,
              pattern TEXT NOT NULL,
              project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE
            );
            INSERT INTO assignment_rules (id, field, match_type, pattern, project_id)
            VALUES ('rule-existing', 'app', 'contains', 'Codex', 'project-existing');
            """
        )

        store = try SQLiteStore(databaseURL: databaseURL)
        let rules = try XCTUnwrap(try store.request(operation: "rules.list", payload: [:]) as? [[String: Any]])
        let rule = try XCTUnwrap(rules.first)
        let createdAt = try XCTUnwrap(int64Value(rule["createdAt"]))

        try store.recordActivity(
            start: createdAt + 1_000,
            end: createdAt + 61_000,
            app: "Codex",
            title: "Codex",
            url: nil,
            bundleIdentifier: "com.openai.codex",
            appPath: "/Applications/Codex.app"
        )

        let entry = try XCTUnwrap(try allEntries().first)
        XCTAssertEqual(entry["projectId"] as? String, "project-existing")
        XCTAssertEqual(int64Value(entry["billable"]), 1)
    }

    func testLegacyDevelopmentTablesAreRebuiltBeforeUse() throws {
        store = nil
        try? FileManager.default.removeItem(at: directory)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let databaseURL = directory.appendingPathComponent("Oriel.sqlite")
        try runSQLite(
            databaseURL,
            """
            CREATE TABLE projects (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL UNIQUE
            );
            INSERT INTO projects (id, name) VALUES ('project-legacy', 'Legacy Client');
            CREATE TABLE time_entries (
              id TEXT PRIMARY KEY,
              start INTEGER NOT NULL,
              end INTEGER NOT NULL,
              project TEXT NOT NULL,
              note TEXT NOT NULL,
              day TEXT NOT NULL DEFAULT '',
              project_id TEXT
            );
            INSERT INTO time_entries (id, start, end, project, note, day, project_id)
            VALUES ('entry-legacy', 1779768000000, 1779771600000, 'Legacy Client', 'Old note', '2026-05-25', NULL);
            """
        )

        store = try SQLiteStore(databaseURL: databaseURL)
        let projects = try XCTUnwrap(try store.request(operation: "projects.list", payload: [:]) as? [[String: Any]])
        let entries = try XCTUnwrap(try store.request(operation: "entries.list", payload: ["date": "all"]) as? [[String: Any]])
        XCTAssertEqual(projects.first?["color"] as? String, "#64748b")
        XCTAssertEqual(entries.first?["projectId"] as? String, "project-legacy")
        XCTAssertEqual(entries.first?["description"] as? String, "Old note")

        _ = try store.request(
            operation: "entries.create",
            payload: [
                "start": 1_779_771_600_000 as Int64,
                "end": 1_779_775_200_000 as Int64,
                "projectId": "project-legacy",
                "description": "New entry",
                "billable": false
            ]
        )
        let updatedEntries = try XCTUnwrap(try store.request(operation: "entries.list", payload: ["date": "all"]) as? [[String: Any]])
        XCTAssertEqual(updatedEntries.count, 2)
    }

    func testRecordedActivityAndPortableExportRemainInsideSelectedDatabase() throws {
        try store.recordActivity(
            start: 1_779_768_000_000,
            end: 1_779_768_600_000,
            app: "Xcode",
            title: "OrielApp.swift",
            url: nil,
            bundleIdentifier: "com.apple.dt.Xcode",
            appPath: "/Applications/Xcode.app",
            interactionState: "handsOff"
        )
        let listed = try XCTUnwrap(try store.request(operation: "activities.list", payload: ["date": "all"]) as? [[String: Any]])
        let archive = try XCTUnwrap(try store.request(operation: "data.export", payload: [:]) as? [String: Any])
        let activities = try XCTUnwrap(archive["activities"] as? [[String: Any]])
        XCTAssertEqual(listed.first?["interactionState"] as? String, "handsOff")
        XCTAssertEqual(activities.count, 1)
        XCTAssertEqual(activities.first?["interactionState"] as? String, "handsOff")
        XCTAssertTrue(store.databaseURL.path.contains("OrielTests-"))
    }

    func testActivityAISummaryPersistsAndExportsWithoutSecretsOrScreenshots() throws {
        let activityID = "activity-summary-test"
        try store.recordActivity(
            id: activityID,
            start: 1_779_768_000_000,
            end: 1_779_768_120_000,
            app: "Xcode",
            title: "OrielApp.swift",
            url: nil,
            bundleIdentifier: "com.apple.dt.Xcode",
            appPath: "/Applications/Xcode.app",
            interactionState: "handsOn"
        )

        try store.upsertActivityAISummary([
            "activityId": activityID,
            "status": "succeeded",
            "provider": "openrouter",
            "model": "google/gemini-3.1-flash-lite",
            "summary": [
                "app": "Xcode",
                "bundle_id": "com.apple.dt.Xcode",
                "window_or_page": "OrielApp.swift",
                "project_or_context": "Oriel",
                "activity": "Editing Swift code",
                "category": "engineering",
                "action": "editing",
                "objects": ["Swift"],
                "confidence": 0.92,
                "evidence": ["code editor"],
                "uncertainties": [],
                "cloud_safe_summary": "Edited Swift implementation code.",
                "sensitivity": "low",
                "metadata_conflicts": []
            ],
            "imageWidth": 1280,
            "imageHeight": 720,
            "compressedBytes": 54_321,
            "requestMetadata": ["zdrRequested": true]
        ])

        let rows = try XCTUnwrap(try store.request(operation: "activityAISummaries.list", payload: [:]) as? [[String: Any]])
        XCTAssertEqual(rows.count, 1)
        XCTAssertEqual(rows.first?["activityId"] as? String, activityID)
        XCTAssertEqual(rows.first?["status"] as? String, "succeeded")
        XCTAssertEqual(rows.first?["provider"] as? String, "openrouter")

        let archive = try XCTUnwrap(try store.request(operation: "data.export", payload: [:]) as? [String: Any])
        let summaries = try XCTUnwrap(archive["activityAISummaries"] as? [[String: Any]])
        let exportedActivities = try XCTUnwrap(archive["activities"] as? [[String: Any]])
        let encoded = String(data: try JSONSerialization.data(withJSONObject: archive), encoding: .utf8) ?? ""
        XCTAssertEqual(summaries.count, 1)
        XCTAssertEqual(exportedActivities.first?["id"] as? String, activityID)
        XCTAssertFalse(encoded.contains("apiKey"))
        XCTAssertFalse(encoded.contains("Authorization"))
        XCTAssertFalse(encoded.contains("data:image"))
        XCTAssertFalse(encoded.contains("base64"))

        let restored = try SQLiteStore(databaseURL: directory.appendingPathComponent("Restored.sqlite"))
        try restored.restoreArchive(archive)
        let restoredRows = try XCTUnwrap(try restored.request(operation: "activityAISummaries.list", payload: [:]) as? [[String: Any]])
        XCTAssertEqual(restoredRows.count, 1)
        XCTAssertEqual(restoredRows.first?["activityId"] as? String, activityID)
        XCTAssertEqual(restoredRows.first?["provider"] as? String, "openrouter")
        XCTAssertEqual(restoredRows.first?["compressedBytes"] as? Int64, 54_321)
    }

    func testPendingPassiveReviewsMigrateToHandsOffActivitiesOnStartup() throws {
        try store.createPassiveReview(
            id: "review-audible",
            start: 1_779_768_000_000,
            end: 1_779_769_080_000,
            activeGraceCutoff: 1_779_768_000_000,
            app: "Brave Browser",
            title: "YouTube",
            url: "https://youtube.com/watch?v=123",
            bundleIdentifier: "com.brave.Browser",
            appPath: "/Applications/Brave Browser.app",
            reason: "audible-browser",
            isClosed: false
        )
        try store.createPassiveReview(
            id: "review-reading",
            start: 1_779_769_200_000,
            end: 1_779_769_800_000,
            activeGraceCutoff: 1_779_769_200_000,
            app: "Preview",
            title: "Spec.pdf",
            url: nil,
            bundleIdentifier: "com.apple.Preview",
            appPath: "/System/Applications/Preview.app",
            reason: "reading",
            isClosed: true
        )

        store = nil
        store = try SQLiteStore(databaseURL: directory.appendingPathComponent("Oriel.sqlite"))
        let reopenedReviews = try store.listPassiveReviews()
        let migratedActivities = try XCTUnwrap(try store.request(operation: "activities.list", payload: ["date": "all"]) as? [[String: Any]])

        XCTAssertEqual(reopenedReviews.count, 0)
        XCTAssertEqual(migratedActivities.count, 2)
        XCTAssertTrue(migratedActivities.allSatisfy { ($0["interactionState"] as? String) == "handsOff" })
        XCTAssertEqual(migratedActivities[0]["app"] as? String, "Brave Browser")
        XCTAssertEqual(migratedActivities[1]["app"] as? String, "Preview")
    }

    func testTrackingStatusOmitsPassiveReviewInbox() throws {
        let status = TrackingController(store: store).status()
        XCTAssertNil(status["pendingPassiveReviews"])
        XCTAssertNil(status["pendingPassiveReviewCount"])
        XCTAssertNil(status["pendingPassiveReview"])
    }

    func testMalformedMutationDoesNotCreateProject() throws {
        XCTAssertThrowsError(
            try store.request(operation: "projects.create", payload: ["name": "", "color": "#000000"])
        )
        let projects = try XCTUnwrap(try store.request(operation: "projects.list", payload: [:]) as? [[String: Any]])
        XCTAssertEqual(projects.count, 0)
    }

    func testSettingsPersistPrimitiveBooleansAndTheme() throws {
        let updated = try XCTUnwrap(
            try store.request(
                operation: "settings.update",
                payload: [
                    "logoDevIconsEnabled": true,
                    "hideEmptyActivityRows": true,
                    "theme": "light",
                    "minActivityThreshold": 30,
                    "aiProvider": "openai",
                    "aiOpenAIModel": "gpt-5.2",
                    "aiGoogleModel": "gemini-3.5-flash",
                    "aiAnthropicModel": "claude-sonnet-4-20250514",
                    "aiOpenRouterModel": "google/gemini-3.1-flash-lite",
                    "aiScreenshotProvider": "openrouter",
                    "aiScreenshotSummariesEnabled": true,
                    "aiScreenshotFrequencyPreset": "high",
                    "aiScreenshotDailyCap": 100,
                    "aiScreenshotTimeoutSeconds": 20,
                    "aiScreenshotModelMode": "override",
                    "aiScreenshotOpenRouterModel": "google/gemini-3.1-flash-lite",
                    "aiScreenshotSensitiveApps": ["Banking App", "com.example.secret"]
                ]
            ) as? [String: Any]
        )

        XCTAssertEqual(updated["logoDevIconsEnabled"] as? Bool, true)
        XCTAssertEqual(updated["hideEmptyActivityRows"] as? Bool, true)
        XCTAssertEqual(updated["theme"] as? String, "light")
        XCTAssertEqual(updated["minActivityThreshold"] as? Int, 30)
        XCTAssertEqual(updated["aiProvider"] as? String, "openai")
        XCTAssertEqual(updated["aiOpenAIModel"] as? String, "gpt-5.2")
        XCTAssertEqual(updated["aiGoogleModel"] as? String, "gemini-3.5-flash")
        XCTAssertEqual(updated["aiAnthropicModel"] as? String, "claude-sonnet-4-20250514")
        XCTAssertEqual(updated["aiOpenRouterModel"] as? String, "google/gemini-3.1-flash-lite")
        XCTAssertEqual(updated["aiScreenshotProvider"] as? String, "openrouter")
        XCTAssertEqual(updated["aiScreenshotSummariesEnabled"] as? Bool, true)
        XCTAssertEqual(updated["aiScreenshotFrequencyPreset"] as? String, "high")
        XCTAssertEqual(updated["aiScreenshotDailyCap"] as? Int, 100)
        XCTAssertEqual(updated["aiScreenshotTimeoutSeconds"] as? Int, 20)
        XCTAssertEqual(updated["aiScreenshotModelMode"] as? String, "override")
        XCTAssertEqual(updated["aiScreenshotOpenRouterModel"] as? String, "google/gemini-3.1-flash-lite")
        XCTAssertEqual(updated["aiScreenshotSensitiveApps"] as? [String], ["Banking App", "com.example.secret"])

        store = nil
        store = try SQLiteStore(databaseURL: directory.appendingPathComponent("Oriel.sqlite"))
        let persisted = try XCTUnwrap(try store.request(operation: "settings.get", payload: [:]) as? [String: Any])
        XCTAssertEqual(persisted["logoDevIconsEnabled"] as? Bool, true)
        XCTAssertEqual(persisted["hideEmptyActivityRows"] as? Bool, true)
        XCTAssertEqual(persisted["theme"] as? String, "light")
        XCTAssertEqual(persisted["minActivityThreshold"] as? Int, 30)
        XCTAssertEqual(persisted["aiProvider"] as? String, "openai")
        XCTAssertEqual(persisted["aiOpenAIModel"] as? String, "gpt-5.2")
        XCTAssertEqual(persisted["aiGoogleModel"] as? String, "gemini-3.5-flash")
        XCTAssertEqual(persisted["aiAnthropicModel"] as? String, "claude-sonnet-4-20250514")
        XCTAssertEqual(persisted["aiOpenRouterModel"] as? String, "google/gemini-3.1-flash-lite")
        XCTAssertEqual(persisted["aiScreenshotProvider"] as? String, "openrouter")
        XCTAssertEqual(persisted["aiScreenshotSummariesEnabled"] as? Bool, true)
        XCTAssertEqual(persisted["aiScreenshotFrequencyPreset"] as? String, "high")
        XCTAssertEqual(persisted["aiScreenshotDailyCap"] as? Int, 100)
        XCTAssertEqual(persisted["aiScreenshotTimeoutSeconds"] as? Int, 20)
        XCTAssertEqual(persisted["aiScreenshotModelMode"] as? String, "override")
        XCTAssertEqual(persisted["aiScreenshotOpenRouterModel"] as? String, "google/gemini-3.1-flash-lite")
        XCTAssertEqual(persisted["aiScreenshotSensitiveApps"] as? [String], ["Banking App", "com.example.secret"])
    }

    func testSettingsNormalizeThemeCompatibilityValues() throws {
        let legacy = try XCTUnwrap(
            try store.request(
                operation: "settings.update",
                payload: ["theme": "variant"]
            ) as? [String: Any]
        )
        XCTAssertEqual(legacy["theme"] as? String, "reference")

        store = nil
        store = try SQLiteStore(databaseURL: directory.appendingPathComponent("Oriel.sqlite"))
        let persistedLegacy = try XCTUnwrap(try store.request(operation: "settings.get", payload: [:]) as? [String: Any])
        XCTAssertEqual(persistedLegacy["theme"] as? String, "reference")

        let unsupported = try XCTUnwrap(
            try store.request(
                operation: "settings.update",
                payload: ["theme": "blueprint"]
            ) as? [String: Any]
        )
        XCTAssertEqual(unsupported["theme"] as? String, "graphite")

        store = nil
        store = try SQLiteStore(databaseURL: directory.appendingPathComponent("Oriel.sqlite"))
        let persistedUnsupported = try XCTUnwrap(try store.request(operation: "settings.get", payload: [:]) as? [String: Any])
        XCTAssertEqual(persistedUnsupported["theme"] as? String, "graphite")
    }

    func testSettingsExposeDefaultAiPreferences() throws {
        let settings = try XCTUnwrap(try store.request(operation: "settings.get", payload: [:]) as? [String: Any])

        XCTAssertEqual(settings["hideEmptyActivityRows"] as? Bool, false)
        XCTAssertEqual(settings["aiProvider"] as? String, "")
        XCTAssertEqual(settings["aiOpenAIModel"] as? String, "gpt-5.2")
        XCTAssertEqual(settings["aiGoogleModel"] as? String, "gemini-3.5-flash")
        XCTAssertEqual(settings["aiAnthropicModel"] as? String, "claude-sonnet-4-20250514")
        XCTAssertEqual(settings["aiOpenRouterModel"] as? String, "google/gemini-3.1-flash-lite")
        XCTAssertEqual(settings["aiScreenshotProvider"] as? String, "")
        XCTAssertEqual(settings["aiScreenshotSummariesEnabled"] as? Bool, false)
        XCTAssertEqual(settings["aiScreenshotFrequencyPreset"] as? String, "balanced")
        XCTAssertEqual(settings["aiScreenshotDailyCap"] as? Int, 100)
        XCTAssertEqual(settings["aiScreenshotTimeoutSeconds"] as? Int, 20)
        XCTAssertEqual(settings["aiScreenshotModelMode"] as? String, "askAI")
        XCTAssertEqual(settings["aiScreenshotSensitiveApps"] as? [String], [
            "1password",
            "bitwarden",
            "dashlane",
            "keychain access",
            "lastpass",
            "proton pass",
            "keeper password",
            "authenticator"
        ])
    }

    func testDailyAISummariesPersistExportAndRestoreWithoutSecretsOrScreenshots() throws {
        _ = try store.request(operation: "dailyAISummaries.upsert", payload: [
            "date": "2026-06-07",
            "status": "succeeded",
            "provider": "openai",
            "model": "gpt-5.2",
            "summary": [
                "text": "Focused implementation work.",
                "highlights": ["Implemented AI settings"],
                "metrics": [
                    "version": 1,
                    "totalRecordedMs": 3_600_000,
                    "longestFocusSession": [
                        "start": 1_780_810_800_000 as Int64,
                        "end": 1_780_814_400_000 as Int64,
                        "durationMs": 3_600_000,
                        "app": "Codex",
                        "title": "Oriel",
                        "label": "Oriel"
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
                    "appBreakdown": [
                        ["name": "Codex", "durationMs": 3_600_000, "percent": 100]
                    ],
                    "categoryBreakdown": [
                        ["name": "engineering", "summaryCount": 1]
                    ]
                ],
                "uncertainties": []
            ],
            "sourceSummaryCount": 3
        ])

        let row = try XCTUnwrap(try store.request(operation: "dailyAISummaries.get", payload: ["date": "2026-06-07"]) as? [String: Any])
        XCTAssertEqual(row["date"] as? String, "2026-06-07")
        XCTAssertEqual(row["status"] as? String, "succeeded")
        XCTAssertEqual(row["sourceSummaryCount"] as? Int64, 3)
        let summary = try XCTUnwrap(row["summary"] as? [String: Any])
        XCTAssertEqual(summary["text"] as? String, "Focused implementation work.")
        let metrics = try XCTUnwrap(summary["metrics"] as? [String: Any])
        XCTAssertEqual(metrics["totalRecordedMs"] as? Int64, 3_600_000)

        let archive = try XCTUnwrap(try store.request(operation: "data.export", payload: [:]) as? [String: Any])
        let encoded = String(data: try JSONSerialization.data(withJSONObject: archive), encoding: .utf8) ?? ""
        XCTAssertTrue(encoded.contains("dailyAISummaries"))
        XCTAssertFalse(encoded.contains("apiKey"))
        XCTAssertFalse(encoded.contains("Authorization"))
        XCTAssertFalse(encoded.contains("data:image"))
        XCTAssertFalse(encoded.contains("base64"))

        let restored = try SQLiteStore(databaseURL: directory.appendingPathComponent("RestoredDaily.sqlite"))
        try restored.restoreArchive(archive)
        let restoredRow = try XCTUnwrap(try restored.request(operation: "dailyAISummaries.get", payload: ["date": "2026-06-07"]) as? [String: Any])
        XCTAssertEqual(restoredRow["status"] as? String, "succeeded")
        XCTAssertEqual((restoredRow["summary"] as? [String: Any])?["text"] as? String, "Focused implementation work.")
        let restoredMetrics = try XCTUnwrap((restoredRow["summary"] as? [String: Any])?["metrics"] as? [String: Any])
        XCTAssertEqual(restoredMetrics["totalRecordedMs"] as? Int64, 3_600_000)
    }

    func testDailyAISummariesListMergesGeneratedFailedAndReadyDays() throws {
        try store.recordActivity(
            id: "ready-activity",
            start: try millis(2026, 6, 8),
            end: try millis(2026, 6, 8, hour: 9, minute: 20),
            app: "Codex",
            title: "AI Insights",
            url: nil,
            bundleIdentifier: "com.openai.chat",
            appPath: "/Applications/Codex.app",
            interactionState: "handsOn"
        )
        try store.upsertActivityAISummary([
            "activityId": "ready-activity",
            "status": "succeeded",
            "provider": "openrouter",
            "model": "google/gemini-3.1-flash-lite",
            "summary": [
                "app": "Codex",
                "bundle_id": "com.openai.chat",
                "window_or_page": "AI Insights",
                "project_or_context": "Oriel",
                "activity": "Designing AI insights",
                "category": "engineering",
                "action": "designing",
                "objects": ["AI Insights"],
                "confidence": 0.9,
                "evidence": ["settings UI"],
                "uncertainties": [],
                "cloud_safe_summary": "Designed AI Insights cards.",
                "sensitivity": "low",
                "metadata_conflicts": []
            ]
        ])

        _ = try store.request(operation: "dailyAISummaries.upsert", payload: [
            "date": "2026-06-07",
            "status": "succeeded",
            "provider": "openai",
            "model": "gpt-5.2",
            "summary": [
                "text": "Focused implementation work.",
                "highlights": ["Improved AI Insights"]
            ],
            "sourceSummaryCount": 3
        ])
        _ = try store.request(operation: "dailyAISummaries.upsert", payload: [
            "date": "2026-06-06",
            "status": "failed",
            "errorMessage": "Provider unavailable.",
            "sourceSummaryCount": 2
        ])

        let rows = try XCTUnwrap(try store.request(operation: "dailyAISummaries.list", payload: [
            "startDate": "2026-06-06",
            "endDate": "2026-06-08"
        ]) as? [[String: Any]])

        XCTAssertEqual(rows.compactMap { $0["date"] as? String }, ["2026-06-08", "2026-06-07", "2026-06-06"])
        XCTAssertEqual(rows.first?["status"] as? String, "ready")
        XCTAssertEqual(rows.first?["sourceSummaryCount"] as? Int, 1)
        XCTAssertEqual(rows[1]["status"] as? String, "succeeded")
        XCTAssertEqual((rows[1]["summary"] as? [String: Any])?["text"] as? String, "Focused implementation work.")
        XCTAssertEqual(rows[2]["status"] as? String, "failed")
    }

    func testDailyAISummariesListExcludesEmptyByDefaultAndValidatesRange() throws {
        let rows = try XCTUnwrap(try store.request(operation: "dailyAISummaries.list", payload: [
            "startDate": "2026-06-06",
            "endDate": "2026-06-08"
        ]) as? [[String: Any]])
        XCTAssertEqual(rows.count, 0)

        let rowsWithEmpty = try XCTUnwrap(try store.request(operation: "dailyAISummaries.list", payload: [
            "startDate": "2026-06-06",
            "endDate": "2026-06-08",
            "includeEmpty": true
        ]) as? [[String: Any]])
        XCTAssertEqual(rowsWithEmpty.count, 3)
        XCTAssertTrue(rowsWithEmpty.allSatisfy { ($0["status"] as? String) == "empty" })

        XCTAssertThrowsError(try store.request(operation: "dailyAISummaries.list", payload: [
            "startDate": "2026-01-01",
            "endDate": "2027-02-01"
        ]))
    }

    func testScreenshotSummaryProviderFallsBackToAskAIProvider() throws {
        XCTAssertEqual(
            TrackingController.screenshotSummaryProvider(from: [
                "aiProvider": "openai",
                "aiScreenshotProvider": ""
            ]),
            .openai
        )
        XCTAssertEqual(
            TrackingController.screenshotSummaryProvider(from: [
                "aiProvider": "openai",
                "aiScreenshotProvider": "openrouter"
            ]),
            .openrouter
        )
        XCTAssertNil(
            TrackingController.screenshotSummaryProvider(from: [
                "aiProvider": "",
                "aiScreenshotProvider": "not-a-provider"
            ])
        )
    }

    func testScreenshotSummaryModelUsesScreenshotSpecificProviderModel() throws {
        XCTAssertEqual(
            TrackingController.screenshotSummaryModel(
                provider: .openrouter,
                settings: [
                    "aiOpenRouterModel": "openrouter/chat-model",
                    "aiScreenshotOpenRouterModel": "openrouter/vision-model",
                    "aiScreenshotModelMode": "askAI"
                ]
            ),
            "openrouter/vision-model"
        )
        XCTAssertEqual(
            TrackingController.screenshotSummaryModel(provider: .google, settings: [:]),
            "gemini-3.5-flash"
        )
    }

    func testScreenshotSensitiveMatcherUsesScreenshotOnlySettings() throws {
        XCTAssertTrue(TrackingController.isScreenshotSensitive(
            app: "Banking App",
            title: "Dashboard",
            bundleIdentifier: "com.bank.desktop",
            appPath: "/Applications/Banking App.app",
            settings: ["aiScreenshotSensitiveApps": ["Banking App"]]
        ))
        XCTAssertTrue(TrackingController.isScreenshotSensitive(
            app: "Safari",
            title: "Work",
            bundleIdentifier: "com.example.secret",
            appPath: "/Applications/Safari.app",
            settings: ["aiScreenshotSensitiveApps": ["com.example.secret"]]
        ))
        XCTAssertFalse(TrackingController.isScreenshotSensitive(
            app: "Safari",
            title: "Client Portal",
            bundleIdentifier: "com.apple.Safari",
            appPath: "/Applications/Safari.app",
            settings: ["aiScreenshotSensitiveApps": ["Banking App"]]
        ))
    }

    func testSettingsExposeDefaultTitleCleanupRules() throws {
        let settings = try XCTUnwrap(try store.request(operation: "settings.get", payload: [:]) as? [String: Any])
        let rules = try XCTUnwrap(settings["titleCleanupRules"] as? [[String: Any]])

        XCTAssertTrue(rules.contains { $0["id"] as? String == "audio-playing" })
        XCTAssertTrue(rules.contains { $0["id"] as? String == "high-memory-usage" })
        XCTAssertTrue(rules.contains { $0["id"] as? String == "youtube-site-suffix" })
        XCTAssertTrue(rules.contains { $0["id"] as? String == "obsidian-version-suffix" })
    }

    func testSettingsPersistTitleCleanupRules() throws {
        let customRules: [[String: Any]] = [[
            "id": "custom-strip-ticket",
            "name": "Strip Ticket",
            "enabled": true,
            "pattern": "\\s+\\[TICKET-\\d+\\]$",
            "appContains": "Brave",
            "urlContains": ""
        ]]

        let updated = try XCTUnwrap(
            try store.request(
                operation: "settings.update",
                payload: ["titleCleanupRules": customRules]
            ) as? [String: Any]
        )
        let updatedRules = try XCTUnwrap(updated["titleCleanupRules"] as? [[String: Any]])
        XCTAssertEqual(updatedRules.count, 1)
        XCTAssertEqual(updatedRules[0]["id"] as? String, "custom-strip-ticket")
        XCTAssertEqual(updatedRules[0]["enabled"] as? Bool, true)

        store = nil
        store = try SQLiteStore(databaseURL: directory.appendingPathComponent("Oriel.sqlite"))
        let persisted = try XCTUnwrap(try store.request(operation: "settings.get", payload: [:]) as? [String: Any])
        let persistedRules = try XCTUnwrap(persisted["titleCleanupRules"] as? [[String: Any]])
        XCTAssertEqual(persistedRules.count, 1)
        XCTAssertEqual(persistedRules[0]["pattern"] as? String, "\\s+\\[TICKET-\\d+\\]$")
        XCTAssertEqual(persistedRules[0]["appContains"] as? String, "Brave")
    }

    func testSettingsRejectInvalidTitleCleanupRuleShapes() throws {
        XCTAssertThrowsError(
            try store.request(
                operation: "settings.update",
                payload: ["titleCleanupRules": [["id": "missing-required-fields"]]]
            )
        )
    }

    func testDeprecatedActivityThresholdSettingStillNormalizesUnsupportedValues() throws {
        let updated = try XCTUnwrap(
            try store.request(
                operation: "settings.update",
                payload: ["minActivityThreshold": 95]
            ) as? [String: Any]
        )

        XCTAssertEqual(updated["minActivityThreshold"] as? Int, 60)
    }

    func testCaptureExclusionsApplyProspectivelyBeforeActivityPersistence() throws {
        _ = try store.request(
            operation: "exclusions.create",
            payload: ["field": "app", "matchType": "contains", "pattern": "Passwords"]
        )
        XCTAssertTrue(try store.isCaptureExcluded(app: "Passwords", title: "Vault", url: nil))
        XCTAssertFalse(try store.isCaptureExcluded(app: "Xcode", title: "Oriel", url: nil))
    }

    func testRecordedActivityIsSplitAtLocalMidnightWhenPersisted() throws {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd HH:mm"
        let start = try XCTUnwrap(formatter.date(from: "2026-05-25 23:59"))
        let end = try XCTUnwrap(formatter.date(from: "2026-05-26 00:01"))
        try store.recordActivity(
            start: Int64(start.timeIntervalSince1970 * 1000),
            end: Int64(end.timeIntervalSince1970 * 1000),
            app: "Xcode",
            title: "Oriel",
            url: nil,
            bundleIdentifier: nil,
            appPath: nil
        )

        let firstDay = try XCTUnwrap(try store.request(operation: "activities.list", payload: ["date": "2026-05-25"]) as? [[String: Any]])
        let secondDay = try XCTUnwrap(try store.request(operation: "activities.list", payload: ["date": "2026-05-26"]) as? [[String: Any]])
        XCTAssertEqual(firstDay.count, 1)
        XCTAssertEqual(secondDay.count, 1)
        XCTAssertEqual(firstDay[0]["end"] as? Int64, secondDay[0]["start"] as? Int64)
    }

    func testLoginwindowActivityIsExcludedFromNativeHistory() throws {
        try store.recordActivity(
            start: 1_779_768_000_000,
            end: 1_779_768_600_000,
            app: "loginwindow",
            title: "Login Window",
            url: nil,
            bundleIdentifier: nil,
            appPath: nil
        )
        try store.recordActivity(
            start: 1_779_768_600_000,
            end: 1_779_769_200_000,
            app: "Codex",
            title: "Codex",
            url: nil,
            bundleIdentifier: nil,
            appPath: nil
        )

        let activities = try XCTUnwrap(try store.request(operation: "activities.list", payload: ["date": "2026-05-26"]) as? [[String: Any]])
        XCTAssertEqual(activities.count, 1)
        XCTAssertEqual(activities.first?["app"] as? String, "Codex")
    }

    func testActivitiesListSupportsAllTimeHistory() throws {
        try store.recordActivity(
            start: 1_779_768_000_000,
            end: 1_779_768_600_000,
            app: "Xcode",
            title: "Oriel",
            url: nil,
            bundleIdentifier: nil,
            appPath: nil
        )

        let activities = try XCTUnwrap(try store.request(operation: "activities.list", payload: ["date": "all"]) as? [[String: Any]])
        XCTAssertEqual(activities.count, 1)
        XCTAssertEqual(activities.first?["app"] as? String, "Xcode")
    }

    func testExclusionCanPruneNativeActivityHistory() throws {
        try store.recordActivity(
            start: 1_779_768_000_000,
            end: 1_779_768_600_000,
            app: "Passwords",
            title: "Vault",
            url: nil,
            bundleIdentifier: nil,
            appPath: nil
        )

        let created = try XCTUnwrap(try store.request(
            operation: "exclusions.create",
            payload: ["field": "app", "matchType": "equals", "pattern": "Passwords", "applyToHistory": true]
        ) as? [String: Any])

        let activities = try XCTUnwrap(try store.request(operation: "activities.list", payload: ["date": "2026-05-26"]) as? [[String: Any]])
        XCTAssertEqual(created["removedHistoryCount"] as? Int, 1)
        XCTAssertEqual(activities.count, 0)
    }

    private func runSQLite(_ databaseURL: URL, _ sql: String) throws {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/sqlite3")
        process.arguments = [databaseURL.path, sql]
        try process.run()
        process.waitUntilExit()
        XCTAssertEqual(process.terminationStatus, 0)
    }
}
