import XCTest
@testable import OrielApp

final class ActivitySummarySchemaTests: XCTestCase {
    func testValidatorRequiresFieldsAndNormalizesMetadataSourceOfTruth() throws {
        let validator = ActivitySummarySchemaValidator()
        let response = try validator.validate(
            object: [
                "app": "Guessed App",
                "bundle_id": "guessed.bundle",
                "window_or_page": "Pull Request",
                "project_or_context": "Oriel",
                "activity": "Reviewing implementation plan",
                "category": "engineering",
                "action": "reviewing",
                "objects": ["plan", "code"],
                "confidence": 1.2,
                "evidence": ["visible code review"],
                "uncertainties": ["exact repository private"],
                "cloud_safe_summary": "Reviewed a software implementation plan.",
                "sensitivity": "low",
                "metadata_conflicts": []
            ],
            metadata: ActivitySummaryMetadata(
                activityID: "activity-1",
                captureTimestampISO: "2026-06-07T12:00:00Z",
                durationSeconds: 120,
                frontmostAppName: "Xcode",
                bundleID: "com.apple.dt.Xcode",
                processID: 42,
                windowTitle: "OrielApp.swift",
                browserURL: nil,
                browserDomain: nil,
                projectName: nil,
                inputState: "handsOn",
                screenshotWidth: 1280,
                screenshotHeight: 720,
                displayID: "main"
            )
        )

        XCTAssertEqual(response.app, "Xcode")
        XCTAssertEqual(response.bundleID, "com.apple.dt.Xcode")
        XCTAssertEqual(response.confidence, 1)
        XCTAssertTrue(response.metadataConflicts.contains { $0.contains("app") })
        XCTAssertTrue(response.metadataConflicts.contains { $0.contains("bundle_id") })
    }

    func testValidatorRejectsMissingRequiredField() {
        let validator = ActivitySummarySchemaValidator()

        XCTAssertThrowsError(try validator.validate(
            object: [
                "app": "Xcode",
                "bundle_id": "com.apple.dt.Xcode",
                "window_or_page": "OrielApp.swift",
                "project_or_context": "Oriel",
                "activity": "Coding",
                "category": "engineering",
                "action": "editing",
                "objects": ["Swift"],
                "confidence": 0.8,
                "evidence": ["editor visible"],
                "uncertainties": [],
                "cloud_safe_summary": "Edited Swift code.",
                "sensitivity": "low"
            ],
            metadata: ActivitySummaryMetadata(
                activityID: "activity-1",
                captureTimestampISO: "2026-06-07T12:00:00Z",
                durationSeconds: nil,
                frontmostAppName: "Xcode",
                bundleID: "com.apple.dt.Xcode",
                processID: nil,
                windowTitle: nil,
                browserURL: nil,
                browserDomain: nil,
                projectName: nil,
                inputState: "handsOn",
                screenshotWidth: 1280,
                screenshotHeight: 720,
                displayID: nil
            )
        )) { error in
            XCTAssertTrue(String(describing: error).contains("metadata_conflicts"))
        }
    }
}
