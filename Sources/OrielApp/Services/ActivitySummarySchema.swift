import Foundation

struct ActivitySummaryMetadata {
    let activityID: String
    let captureTimestampISO: String
    let durationSeconds: Int?
    let frontmostAppName: String
    let bundleID: String
    let processID: Int?
    let windowTitle: String?
    let browserURL: String?
    let browserDomain: String?
    let projectName: String?
    let inputState: String
    let screenshotWidth: Int
    let screenshotHeight: Int
    let displayID: String?
}

struct ActivitySummaryResponse {
    let summary: [String: Any]

    var app: String { summary["app"] as? String ?? "" }
    var bundleID: String { summary["bundle_id"] as? String ?? "" }
    var confidence: Double { summary["confidence"] as? Double ?? 0 }
    var metadataConflicts: [String] { summary["metadata_conflicts"] as? [String] ?? [] }
}

enum ActivitySummaryValidationError: Error, CustomStringConvertible {
    case missingField(String)
    case invalidField(String)

    var description: String {
        switch self {
        case .missingField(let field):
            return "Missing required activity summary field: \(field)"
        case .invalidField(let field):
            return "Invalid activity summary field: \(field)"
        }
    }
}

struct ActivitySummarySchemaValidator {
    private let stringFields = [
        "app",
        "bundle_id",
        "window_or_page",
        "project_or_context",
        "activity",
        "category",
        "action",
        "cloud_safe_summary",
        "sensitivity"
    ]
    private let stringArrayFields = [
        "objects",
        "evidence",
        "uncertainties",
        "metadata_conflicts"
    ]

    var jsonSchema: [String: Any] {
        var properties: [String: Any] = [:]
        for field in stringFields {
            properties[field] = ["type": "string"]
        }
        for field in stringArrayFields {
            properties[field] = [
                "type": "array",
                "items": ["type": "string"]
            ]
        }
        properties["confidence"] = [
            "type": "number",
            "minimum": 0,
            "maximum": 1
        ]
        return [
            "type": "object",
            "additionalProperties": false,
            "required": stringFields + stringArrayFields + ["confidence"],
            "properties": properties
        ]
    }

    var geminiResponseSchema: [String: Any] {
        var properties: [String: Any] = [:]
        for field in stringFields {
            properties[field] = ["type": "STRING"]
        }
        for field in stringArrayFields {
            properties[field] = [
                "type": "ARRAY",
                "items": ["type": "STRING"]
            ]
        }
        properties["confidence"] = [
            "type": "NUMBER",
            "minimum": 0,
            "maximum": 1
        ]
        return [
            "type": "OBJECT",
            "required": stringFields + stringArrayFields + ["confidence"],
            "properties": properties
        ]
    }

    func validate(object: [String: Any], metadata: ActivitySummaryMetadata) throws -> ActivitySummaryResponse {
        var normalized: [String: Any] = [:]
        for field in stringFields {
            guard object.keys.contains(field) else { throw ActivitySummaryValidationError.missingField(field) }
            guard let value = object[field] as? String else { throw ActivitySummaryValidationError.invalidField(field) }
            normalized[field] = value
        }
        for field in stringArrayFields {
            guard object.keys.contains(field) else { throw ActivitySummaryValidationError.missingField(field) }
            guard let value = object[field] as? [String] else { throw ActivitySummaryValidationError.invalidField(field) }
            normalized[field] = value
        }
        guard object.keys.contains("confidence") else {
            throw ActivitySummaryValidationError.missingField("confidence")
        }
        guard let confidence = doubleValue(object["confidence"]) else {
            throw ActivitySummaryValidationError.invalidField("confidence")
        }

        var conflicts = normalized["metadata_conflicts"] as? [String] ?? []
        if (normalized["app"] as? String) != metadata.frontmostAppName {
            conflicts.append("app provider value did not match captured metadata")
        }
        if (normalized["bundle_id"] as? String) != metadata.bundleID {
            conflicts.append("bundle_id provider value did not match captured metadata")
        }
        normalized["app"] = metadata.frontmostAppName
        normalized["bundle_id"] = metadata.bundleID
        normalized["confidence"] = min(1, max(0, confidence))
        normalized["metadata_conflicts"] = Array(Set(conflicts)).sorted()
        return ActivitySummaryResponse(summary: normalized)
    }

    private func doubleValue(_ value: Any?) -> Double? {
        switch value {
        case let value as Double:
            return value
        case let value as Float:
            return Double(value)
        case let value as Int:
            return Double(value)
        case let value as Int64:
            return Double(value)
        case let value as NSNumber:
            return value.doubleValue
        default:
            return nil
        }
    }
}
