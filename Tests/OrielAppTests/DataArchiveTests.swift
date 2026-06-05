import XCTest
@testable import OrielApp

final class DataArchiveTests: XCTestCase {
    private var directory: URL!
    private var store: SQLiteStore!

    override func setUpWithError() throws {
        directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("OrielDataArchiveTests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        store = try SQLiteStore(databaseURL: directory.appendingPathComponent("Oriel.sqlite"))
    }

    override func tearDownWithError() throws {
        store = nil
        try? FileManager.default.removeItem(at: directory)
    }

    func testPortableRestoreReplacesRecordsOnlyAfterValidatedArchive() throws {
        _ = try store.request(
            operation: "projects.create",
            payload: ["name": "Original", "color": "#000000", "billable": false]
        )
        let archive: [String: Any] = [
            "format": "so.sil.oriel.portable-data",
            "version": 1,
            "projects": [["id": "restored", "name": "Restored", "color": "#ffffff", "billable": false]],
            "timeEntries": [],
            "activities": [],
            "rules": [],
            "exclusions": [],
            "settings": ["theme": "light"]
        ]

        try store.restoreArchive(archive)

        let projects = try XCTUnwrap(try store.request(operation: "projects.list", payload: [:]) as? [[String: Any]])
        XCTAssertEqual(projects.first?["id"] as? String, "restored")
        XCTAssertEqual(projects.count, 1)
    }

    func testPortableRestoreRejectsMalformedArchivesWithoutMutatingRecords() throws {
        _ = try store.request(
            operation: "projects.create",
            payload: ["name": "Original", "color": "#000000", "billable": false]
        )

        XCTAssertThrowsError(try store.restoreArchive(["format": "unknown"]))

        let projects = try XCTUnwrap(try store.request(operation: "projects.list", payload: [:]) as? [[String: Any]])
        XCTAssertEqual(projects.count, 1)
        XCTAssertEqual(projects.first?["name"] as? String, "Original")
    }
}
