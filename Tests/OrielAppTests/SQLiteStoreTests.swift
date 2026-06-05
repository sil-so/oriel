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
                    "theme": "light",
                    "minActivityThreshold": 30,
                    "aiProvider": "openai",
                    "aiOpenAIModel": "gpt-5.2",
                    "aiGoogleModel": "gemini-3.5-flash",
                    "aiAnthropicModel": "claude-sonnet-4-20250514"
                ]
            ) as? [String: Any]
        )

        XCTAssertEqual(updated["logoDevIconsEnabled"] as? Bool, true)
        XCTAssertEqual(updated["theme"] as? String, "light")
        XCTAssertEqual(updated["minActivityThreshold"] as? Int, 30)
        XCTAssertEqual(updated["aiProvider"] as? String, "openai")
        XCTAssertEqual(updated["aiOpenAIModel"] as? String, "gpt-5.2")
        XCTAssertEqual(updated["aiGoogleModel"] as? String, "gemini-3.5-flash")
        XCTAssertEqual(updated["aiAnthropicModel"] as? String, "claude-sonnet-4-20250514")

        store = nil
        store = try SQLiteStore(databaseURL: directory.appendingPathComponent("Oriel.sqlite"))
        let persisted = try XCTUnwrap(try store.request(operation: "settings.get", payload: [:]) as? [String: Any])
        XCTAssertEqual(persisted["logoDevIconsEnabled"] as? Bool, true)
        XCTAssertEqual(persisted["theme"] as? String, "light")
        XCTAssertEqual(persisted["minActivityThreshold"] as? Int, 30)
        XCTAssertEqual(persisted["aiProvider"] as? String, "openai")
        XCTAssertEqual(persisted["aiOpenAIModel"] as? String, "gpt-5.2")
        XCTAssertEqual(persisted["aiGoogleModel"] as? String, "gemini-3.5-flash")
        XCTAssertEqual(persisted["aiAnthropicModel"] as? String, "claude-sonnet-4-20250514")
    }

    func testSettingsExposeDefaultAiPreferences() throws {
        let settings = try XCTUnwrap(try store.request(operation: "settings.get", payload: [:]) as? [String: Any])

        XCTAssertEqual(settings["aiProvider"] as? String, "")
        XCTAssertEqual(settings["aiOpenAIModel"] as? String, "gpt-5.2")
        XCTAssertEqual(settings["aiGoogleModel"] as? String, "gemini-3.5-flash")
        XCTAssertEqual(settings["aiAnthropicModel"] as? String, "claude-sonnet-4-20250514")
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
