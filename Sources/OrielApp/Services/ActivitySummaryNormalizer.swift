import Foundation

enum ActivitySummaryNormalizer {
    static func normalize(
        summary: [String: Any],
        metadata: ActivitySummaryMetadata? = nil,
        fallbackApp: String = "",
        fallbackBundleID: String = ""
    ) -> [String: Any] {
        let app = nonEmpty(metadata?.frontmostAppName)
            ?? nonEmpty(fallbackApp)
            ?? nonEmpty(string(summary["app"]))
            ?? ""
        let bundleID = nonEmpty(metadata?.bundleID)
            ?? nonEmpty(fallbackBundleID)
            ?? nonEmpty(string(summary["bundle_id"]))
            ?? ""
        let action = normalizedAction(string(summary["action"]))
        let sensitivity = normalizedSensitivity(string(summary["sensitivity"]))

        var normalized = summary
        normalized["app"] = app
        normalized["bundle_id"] = bundleID
        normalized["window_or_page"] = normalizedString(summary["window_or_page"])
        normalized["project_or_context"] = normalizedString(summary["project_or_context"])
        normalized["activity"] = normalizedString(summary["activity"])
        normalized["action"] = action
        normalized["objects"] = normalizedStringArray(summary["objects"])
        normalized["evidence"] = normalizedStringArray(summary["evidence"])
        normalized["uncertainties"] = normalizedStringArray(summary["uncertainties"])
        normalized["cloud_safe_summary"] = normalizedSummary(string(summary["cloud_safe_summary"]))
        normalized["sensitivity"] = sensitivity
        normalized["metadata_conflicts"] = normalizedConflicts(summary["metadata_conflicts"])
        normalized["category"] = normalizedCategory(summary: normalized)
        if let confidence = double(summary["confidence"]) {
            normalized["confidence"] = min(1, max(0, confidence))
        }
        return normalized
    }

    private static func normalizedCategory(summary: [String: Any]) -> String {
        if let category = canonicalCategory(string(summary["category"])) {
            return category
        }

        let text = [
            string(summary["app"]),
            string(summary["window_or_page"]),
            string(summary["project_or_context"]),
            string(summary["activity"]),
            string(summary["action"]),
            (summary["objects"] as? [Any])?.compactMap(string).joined(separator: " ")
        ]
        .compactMap { $0 }
        .joined(separator: " ")
        .lowercased()

        if containsAny(text, ["xcode", "codex", "swift", "javascript", "typescript", "code", "debug", "implementation", "pull request", "git", "test", "schema"]) {
            return "software_development"
        }
        if containsAny(text, ["invoice", "accounting", "tax", "payment", "budget", "bank", "money"]) {
            return "finance"
        }
        if containsAny(text, ["checkout", "cart", "order", "product", "price", "shopping", "e-commerce", "amazon", "proshop"]) {
            return "shopping"
        }
        if containsAny(text, ["email", "message", "chat", "whatsapp", "slack", "fastmail"]) {
            return "communication"
        }
        if containsAny(text, ["calendar", "task", "planning", "project management", "linear", "todo"]) {
            return "planning"
        }
        if containsAny(text, ["documentation", "research", "search", "article", "comparison", "reading"]) {
            return "research"
        }
        if containsAny(text, ["youtube", "video", "soundcloud", "music", "playlist", "movie"]) {
            return "media"
        }
        if containsAny(text, ["twitter", "x home", "social", "feed", "post"]) {
            return "social_media"
        }
        if containsAny(text, ["finder", "file", "folder", "directory"]) {
            return "file_management"
        }
        if containsAny(text, ["settings", "system", "utility", "docker", "terminal"]) {
            return "system_utility"
        }
        if containsAny(text, ["tracking", "shipment", "delivery", "package"]) {
            return "logistics"
        }
        if containsAny(text, ["time tracker", "time logs", "productivity"]) {
            return "productivity"
        }
        if containsAny(text, ["browser", "webpage", "website", "browsing"]) {
            return "general_browsing"
        }
        return "other"
    }

    private static func canonicalCategory(_ value: String?) -> String? {
        guard let normalized = nonEmpty(value)?.lowercased()
            .replacingOccurrences(of: "-", with: "_")
            .replacingOccurrences(of: " ", with: "_")
        else { return nil }
        switch normalized {
        case "development", "software_development", "web_development", "development_tool", "development_tools", "engineering":
            return "software_development"
        case "research", "education", "documentation":
            return "research"
        case "communication", "email", "messaging":
            return "communication"
        case "project_management", "planning", "task_management":
            return "planning"
        case "finance", "finance_/_accounting", "accounting":
            return "finance"
        case "shopping", "e_commerce", "ecommerce":
            return "shopping"
        case "entertainment", "media", "media_consumption":
            return "media"
        case "social_media", "social_networking":
            return "social_media"
        case "system_utility", "system_utilities", "utilities", "utility":
            return "system_utility"
        case "file_management":
            return "file_management"
        case "logistics", "logistics_and_shipping":
            return "logistics"
        case "productivity", "time_tracking":
            return "productivity"
        case "web_browsing", "web_browser", "browser", "browsing":
            return "general_browsing"
        case "other", "general":
            return "other"
        default:
            return nil
        }
    }

    private static func normalizedAction(_ value: String?) -> String {
        let text = nonEmpty(value)?.lowercased() ?? ""
        if containsAny(text, ["code changes", "review"]) { return "reviewing" }
        if containsAny(text, ["test"]) { return "testing" }
        if containsAny(text, ["debug", "troubleshoot"]) { return "debugging" }
        if containsAny(text, ["edit", "refactor"]) { return "editing" }
        if containsAny(text, ["write", "draft", "compose", "inputting", "typing"]) { return "writing" }
        if containsAny(text, ["read"]) { return "reading" }
        if containsAny(text, ["research", "search"]) { return "researching" }
        if containsAny(text, ["compare"]) { return "comparing" }
        if containsAny(text, ["email", "chat", "message", "communicat"]) { return "communicating" }
        if containsAny(text, ["checkout", "shop", "purchase", "order", "product"]) { return "shopping" }
        if containsAny(text, ["config", "setting", "install"]) { return "configuring" }
        if containsAny(text, ["switch", "navigat"]) { return "navigating" }
        if containsAny(text, ["watch", "video"]) { return "watching" }
        if containsAny(text, ["listen", "music"]) { return "listening" }
        if containsAny(text, ["manag"]) { return "managing" }
        if containsAny(text, ["view", "brows"]) { return "viewing" }
        return "other"
    }

    private static func normalizedSensitivity(_ value: String?) -> String {
        let text = nonEmpty(value)?.lowercased() ?? ""
        if text.isEmpty { return "medium" }
        if containsAny(text, ["high", "sensitive", "confidential", "proprietary", "secret", "password", "payment", "billing", "personal"]) {
            return "high"
        }
        if containsAny(text, ["private", "internal", "professional"]) {
            return "medium"
        }
        if containsAny(text, ["low", "public", "non-sensitive", "nonsensitive", "none"]) {
            return "low"
        }
        return "medium"
    }

    private static func normalizedConflicts(_ value: Any?) -> [String] {
        normalizedStringArray(value)
            .filter { conflict in
                let normalized = conflict.lowercased()
                return !["none", "n/a", "na", "no conflicts", "no conflict"].contains(normalized)
            }
    }

    private static func normalizedString(_ value: Any?) -> String {
        nonEmpty(string(value)) ?? ""
    }

    private static func normalizedSummary(_ value: String?) -> String {
        let collapsed = normalizedString(value)
        guard collapsed.count > 220 else { return collapsed }
        if let sentenceEnd = collapsed.firstIndex(of: ".") {
            let sentence = String(collapsed[...sentenceEnd])
            if sentence.count <= 220 {
                return sentence
            }
        }
        let end = collapsed.index(collapsed.startIndex, offsetBy: 220)
        return String(collapsed[..<end]).trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func normalizedStringArray(_ value: Any?) -> [String] {
        let values = value as? [Any] ?? []
        var output: [String] = []
        for item in values {
            guard let value = nonEmpty(string(item)), !output.contains(value) else { continue }
            output.append(value)
        }
        return output
    }

    private static func containsAny(_ text: String, _ needles: [String]) -> Bool {
        needles.contains { text.contains($0) }
    }

    private static func nonEmpty(_ value: String?) -> String? {
        guard let value else { return nil }
        let collapsed = value
            .components(separatedBy: .whitespacesAndNewlines)
            .filter { !$0.isEmpty }
            .joined(separator: " ")
        return collapsed.isEmpty ? nil : collapsed
    }

    private static func string(_ value: Any?) -> String? {
        switch value {
        case let value as String:
            return value
        case let value as NSNumber:
            return value.stringValue
        default:
            return nil
        }
    }

    private static func double(_ value: Any?) -> Double? {
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
