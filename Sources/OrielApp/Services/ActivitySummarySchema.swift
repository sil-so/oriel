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
        "window_or_page",
        "project_or_context",
        "activity",
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
            properties[field] = [
                "type": "string",
                "description": description(for: field)
            ]
        }
        for field in stringArrayFields {
            properties[field] = [
                "type": "array",
                "description": description(for: field),
                "items": ["type": "string"]
            ]
        }
        properties["confidence"] = [
            "type": "number",
            "description": "A visual confidence score from 0 to 1 for the observed activity.",
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
            properties[field] = [
                "type": "STRING",
                "description": description(for: field)
            ]
        }
        for field in stringArrayFields {
            properties[field] = [
                "type": "ARRAY",
                "description": description(for: field),
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

        normalized["confidence"] = min(1, max(0, confidence))
        return ActivitySummaryResponse(
            summary: ActivitySummaryNormalizer.normalize(summary: normalized, metadata: metadata)
        )
    }

    private func description(for field: String) -> String {
        switch field {
        case "window_or_page":
            return "Visible window, document, page, or surface name. Use metadata title only when the image supports it."
        case "project_or_context":
            return "Best visible project, task, topic, website, or context. Use an empty string if unclear."
        case "activity":
            return "One concrete sentence fragment describing what the user appears to be doing."
        case "action":
            return "A short lowercase gerund or verb phrase such as reading, writing, reviewing, editing, testing, debugging, comparing, configuring, or viewing."
        case "objects":
            return "Concrete visible objects, documents, products, files, topics, or tools. Return [] if none are clear."
        case "confidence":
            return "A visual confidence score from 0 to 1 for the observed activity."
        case "evidence":
            return "Brief visible cues supporting the activity. Return [] if none are useful."
        case "uncertainties":
            return "Brief uncertainties. Return [] if none. Do not use strings like None."
        case "cloud_safe_summary":
            return "One short privacy-conscious sentence describing the activity without secrets, raw URLs, or unnecessary personal data."
        case "sensitivity":
            return "One of low, medium, or high. Use high for personal, credential, payment, confidential, or proprietary code/content."
        case "metadata_conflicts":
            return "Only real conflicts between metadata and image evidence. Return [] if none. Do not use strings like None."
        default:
            return ""
        }
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
