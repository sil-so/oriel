import XCTest
@testable import OrielApp

final class ActivitySummarySchemaTests: XCTestCase {
    func testValidatorRequiresFieldsAndNormalizesMetadataSourceOfTruth() throws {
        let validator = ActivitySummarySchemaValidator()
        let response = try validator.validate(
            object: [
                "window_or_page": "Pull Request",
                "project_or_context": "Oriel",
                "activity": "Reviewing implementation plan",
                "action": "Reviewing code changes and test results",
                "objects": ["plan", "code"],
                "confidence": 1.2,
                "evidence": ["visible code review"],
                "uncertainties": ["exact repository private"],
                "cloud_safe_summary": "Reviewed a software implementation plan.",
                "sensitivity": "Public",
                "metadata_conflicts": ["None"]
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
        XCTAssertEqual(response.summary["category"] as? String, "software_development")
        XCTAssertEqual(response.summary["action"] as? String, "reviewing")
        XCTAssertEqual(response.summary["sensitivity"] as? String, "low")
        XCTAssertEqual(response.confidence, 1)
        XCTAssertEqual(response.metadataConflicts, [])
    }

    func testLegacySummaryNormalizerCanonicalizesFreeformTaxonomy() {
        let normalized = ActivitySummaryNormalizer.normalize(
            summary: [
                "app": "Guessed App",
                "bundle_id": "guessed.bundle",
                "window_or_page": "ChatGPT",
                "project_or_context": "Oriel",
                "activity": "Developing and debugging activity summary code",
                "category": "Development",
                "action": "Viewing code changes",
                "objects": ["Swift", "tests"],
                "confidence": 0.93,
                "evidence": ["editor visible"],
                "uncertainties": [],
                "cloud_safe_summary": "The user is reviewing code changes in a development tool.",
                "sensitivity": "proprietary code",
                "metadata_conflicts": ["none"]
            ],
            fallbackApp: "Codex",
            fallbackBundleID: "com.openai.chat"
        )

        XCTAssertEqual(normalized["app"] as? String, "Codex")
        XCTAssertEqual(normalized["bundle_id"] as? String, "com.openai.chat")
        XCTAssertEqual(normalized["category"] as? String, "software_development")
        XCTAssertEqual(normalized["action"] as? String, "reviewing")
        XCTAssertEqual(normalized["sensitivity"] as? String, "high")
        XCTAssertEqual(normalized["metadata_conflicts"] as? [String], [])
    }

    func testValidatorRejectsMissingRequiredField() {
        let validator = ActivitySummarySchemaValidator()

        XCTAssertThrowsError(try validator.validate(
            object: [
                "window_or_page": "OrielApp.swift",
                "project_or_context": "Oriel",
                "activity": "Coding",
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
