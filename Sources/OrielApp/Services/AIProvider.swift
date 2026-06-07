import Foundation

enum AIProvider: String, CaseIterable {
    case openai
    case google
    case anthropic
    case openrouter

    static func normalize(_ value: String?) -> AIProvider? {
        guard let value else { return nil }
        return AIProvider(rawValue: value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased())
    }

    var defaultModel: String {
        switch self {
        case .openai:
            return "gpt-5.2"
        case .google:
            return "gemini-3.5-flash"
        case .anthropic:
            return "claude-sonnet-4-20250514"
        case .openrouter:
            return "google/gemini-3.1-flash-lite"
        }
    }
}
