import Foundation
import XCTest
@testable import OrielApp

final class OrielBridgeDailySummaryTests: XCTestCase {
    private var directory: URL!
    private var store: SQLiteStore!

    override func setUpWithError() throws {
        directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("OrielBridgeTests-\(UUID().uuidString)", isDirectory: true)
        store = try SQLiteStore(databaseURL: directory.appendingPathComponent("Oriel.sqlite"))
    }

    override func tearDownWithError() throws {
        store = nil
        try? FileManager.default.removeItem(at: directory)
    }

    @MainActor
    func testGenerateDailyAISummarySendsClusteredSanitizedContext() async throws {
        let base = try millis(2026, 6, 7, hour: 9, minute: 0)
        try recordActivitySummary(
            id: "activity-a",
            start: base,
            end: base + 60 * 60 * 1000,
            title: "DailySummaryContextBuilder.swift",
            summary: [
                "project_or_context": "Oriel",
                "activity": "Editing summary context code",
                "category": "engineering",
                "action": "editing",
                "objects": ["Swift"],
                "cloud_safe_summary": "Edited the daily summary context builder."
            ]
        )
        try recordActivitySummary(
            id: "activity-b",
            start: base + 60 * 60 * 1000,
            end: base + 2 * 60 * 60 * 1000,
            title: "DailySummaryContextBuilderTests.swift",
            summary: [
                "project_or_context": "Oriel",
                "activity": "Writing summary context tests",
                "category": "engineering",
                "action": "testing",
                "objects": ["Swift tests"],
                "cloud_safe_summary": "Added coverage for clustered AI summary evidence."
            ]
        )
        try recordActivitySummary(
            id: "activity-c",
            start: base + 4 * 60 * 60 * 1000,
            end: base + 4 * 60 * 60 * 1000 + 30 * 60 * 1000,
            app: "Brave Browser",
            title: "Portable monitor comparison",
            url: "https://shop.example.com/monitors?token=secret",
            bundleIdentifier: "com.brave.Browser",
            appPath: "/Applications/Brave Browser.app",
            summary: [
                "project_or_context": "Product research",
                "activity": "Comparing monitor options",
                "category": "research",
                "action": "comparing",
                "objects": ["portable monitors"],
                "cloud_safe_summary": "Compared portable monitor options."
            ]
        )
        _ = try store.request(operation: "settings.update", payload: ["aiProvider": "openai"])
        _ = try store.request(operation: "dailyAISummaries.upsert", payload: [
            "date": "2026-06-06",
            "status": "succeeded",
            "summary": ["text": "Your tracked day centered on Oriel implementation. You also reviewed settings."],
            "sourceSummaryCount": 2
        ])

        var capturedRequest: URLRequest?
        let service = AIService(keyStore: BridgeFakeAPIKeyStore(keys: ["openai": "openai-key"])) { request in
            capturedRequest = request
            let data = #"{"output_text":"{\"text\":\"You refined AI summary context.\",\"highlights\":[\"Clustered summary evidence\"]}"}"#.data(using: .utf8)!
            return (data, bridgeHTTPResponse(for: request.url!, status: 200))
        }
        let bridge = OrielBridge(store: store, aiService: service, statusProvider: { [:] })

        let row = try await bridge.generateDailyAISummary(payload: ["date": "2026-06-07"])

        XCTAssertEqual(row["status"] as? String, "succeeded")
        let requestBody = try XCTUnwrap(capturedRequest?.httpBody.flatMap { String(data: $0, encoding: .utf8) })
        XCTAssertTrue(requestBody.contains("activityStats"))
        XCTAssertTrue(requestBody.contains("recentSummaryOpeners"))
        XCTAssertTrue(requestBody.contains("summaryCount"))
        XCTAssertTrue(requestBody.contains("shop.example.com"))
        XCTAssertTrue(requestBody.contains("Your tracked day centered on Oriel implementation."))
        XCTAssertFalse(requestBody.contains("token=secret"))
        XCTAssertFalse(requestBody.contains("appPath"))
        XCTAssertFalse(requestBody.contains("bundleId"))
        XCTAssertFalse(requestBody.contains("com.apple.dt.Xcode"))
        XCTAssertFalse(requestBody.contains("file:///Users"))
    }

    private func recordActivitySummary(
        id: String,
        start: Int64,
        end: Int64,
        app: String = "Xcode",
        title: String,
        url: String? = nil,
        bundleIdentifier: String = "com.apple.dt.Xcode",
        appPath: String = "/Applications/Xcode.app",
        summary: [String: Any]
    ) throws {
        try store.recordActivity(
            id: id,
            start: start,
            end: end,
            app: app,
            title: title,
            url: url,
            bundleIdentifier: bundleIdentifier,
            appPath: appPath,
            interactionState: "handsOn"
        )
        try store.upsertActivityAISummary([
            "activityId": id,
            "status": "succeeded",
            "provider": "openai",
            "model": "gpt-5.2",
            "summary": summary
        ])
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
}

private final class BridgeFakeAPIKeyStore: APIKeyStore {
    var keys: [String: String]

    init(keys: [String: String]) {
        self.keys = keys
    }

    func save(apiKey: String, provider: String) throws {
        keys[provider] = apiKey
    }

    func apiKey(for provider: String) throws -> String? {
        keys[provider]
    }

    func delete(provider: String) throws {
        keys.removeValue(forKey: provider)
    }

    func hasKey(for provider: String) -> Bool {
        keys[provider]?.isEmpty == false
    }
}

private func bridgeHTTPResponse(for url: URL, status: Int) -> HTTPURLResponse {
    HTTPURLResponse(url: url, statusCode: status, httpVersion: nil, headerFields: nil)!
}
