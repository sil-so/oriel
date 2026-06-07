import Foundation

enum AIServiceError: LocalizedError {
    case invalidProvider
    case missingAPIKey
    case invalidRequest
    case providerFailure(String)
    case invalidProviderResponse

    var errorDescription: String? {
        switch self {
        case .invalidProvider:
            return "Unsupported AI provider."
        case .missingAPIKey:
            return "No API key is saved for the selected provider."
        case .invalidRequest:
            return "Invalid AI request."
        case .providerFailure(let message):
            return message
        case .invalidProviderResponse:
            return "The AI provider returned an unreadable response."
        }
    }
}

final class AIService {
    typealias Transport = (URLRequest) async throws -> (Data, URLResponse)

    private let keyStore: APIKeyStore
    private let transport: Transport

    init(
        keyStore: APIKeyStore = KeychainStore(),
        transport: @escaping Transport = { request in
            try await URLSession.shared.data(for: request)
        }
    ) {
        self.keyStore = keyStore
        self.transport = transport
    }

    func keyStatus() -> [String: Any] {
        [
            "openai": keyStore.hasKey(for: "openai"),
            "google": keyStore.hasKey(for: "google"),
            "anthropic": keyStore.hasKey(for: "anthropic"),
            "openrouter": keyStore.hasKey(for: "openrouter")
        ]
    }

    func saveKey(provider: String, apiKey: String) throws -> [String: Any] {
        guard !apiKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw AIServiceError.invalidRequest
        }
        try keyStore.save(apiKey: apiKey.trimmingCharacters(in: .whitespacesAndNewlines), provider: provider)
        return keyStatus()
    }

    func deleteKey(provider: String) throws -> [String: Any] {
        try keyStore.delete(provider: provider)
        return keyStatus()
    }

    func chat(payload: [String: Any]) async throws -> [String: Any] {
        let provider = try normalizedProvider(payload["provider"] as? String)
        let model = normalizedModel(payload["model"] as? String, provider: provider)
        guard let apiKey = try keyStore.apiKey(for: provider), !apiKey.isEmpty else {
            throw AIServiceError.missingAPIKey
        }

        let dayContext = payload["dayContext"] as? [String: Any] ?? [:]
        let promptIntent = sanitizeIntent(payload["intent"] as? [String: Any])
        let messages = sanitizeMessages(payload["messages"] as? [[String: Any]] ?? [])
        let systemPrompt = """
        You are Oriel's local time-tracking assistant. Answer questions using only the selected-day context.
        Return only a JSON object with this shape:
        {"text":"concise answer","suggestions":[{"type":"draftEntry","start":0,"end":0,"description":"","projectId":"","taskId":"","billable":false},{"type":"updateAssignment","entryId":"","projectId":"","taskId":""}]}
        Return suggestions only when promptIntent explicitly allows them. If promptIntent does not allow draft or assignment suggestions, return "suggestions":[].
        Never invent project IDs, task IDs, or entry IDs that are not present in the day context.
        Treat dayContext.totals as authoritative for recorded, logged, billable, non-billable, and unlogged time; detailed arrays may be capped and must not be summed to recompute daily totals.
        Describe dayContext.unloggedRanges as notable ranges, not as the total unlogged time.
        dayContext.draftCandidates contains local, selected-day draft candidates that Oriel validates and reviews in the app before saving.
        generic draft-entry prompts should return suggestions as an empty array; explain the local candidate set instead.
        For summaries, use clear accounting language: recorded active time, logged project time, and unlogged active time.
        Avoid "visible activity"; say captured activity or included detail rows when detail arrays are capped.
        When suggesting a draft entry, include a plain description of what the entry is for, based on overlapping apps, cleaned titles, domains, project names, or task names in the selected-day context.
        """
        let userPrompt = try buildUserPrompt(dayContext: dayContext, promptIntent: promptIntent, messages: messages)

        let responseText: String
        switch provider {
        case "openai":
            responseText = try await requestOpenAI(model: model, apiKey: apiKey, systemPrompt: systemPrompt, userPrompt: userPrompt)
        case "google":
            responseText = try await requestGoogle(model: model, apiKey: apiKey, systemPrompt: systemPrompt, userPrompt: userPrompt)
        case "anthropic":
            responseText = try await requestAnthropic(model: model, apiKey: apiKey, systemPrompt: systemPrompt, userPrompt: userPrompt)
        case "openrouter":
            responseText = try await requestOpenRouter(model: model, apiKey: apiKey, systemPrompt: systemPrompt, userPrompt: userPrompt)
        default:
            throw AIServiceError.invalidProvider
        }

        return normalizeProviderText(responseText)
    }

    func listModels(payload: [String: Any]) async throws -> [String: Any] {
        let provider = try normalizedProvider(payload["provider"] as? String)
        guard let apiKey = try keyStore.apiKey(for: provider), !apiKey.isEmpty else {
            throw AIServiceError.missingAPIKey
        }

        let models: [String]
        switch provider {
        case "openai":
            models = try await requestOpenAIModels(apiKey: apiKey)
        case "google":
            models = try await requestGoogleModels(apiKey: apiKey)
        case "anthropic":
            models = try await requestAnthropicModels(apiKey: apiKey)
        case "openrouter":
            models = try await requestOpenRouterModels(apiKey: apiKey)
        default:
            throw AIServiceError.invalidProvider
        }

        return [
            "provider": provider,
            "models": models,
            "refreshedAt": ISO8601DateFormatter().string(from: Date())
        ]
    }

    private func normalizedProvider(_ value: String?) throws -> String {
        guard let provider = AIProvider.normalize(value) else {
            throw AIServiceError.invalidProvider
        }
        return provider.rawValue
    }

    private func normalizedModel(_ value: String?, provider: String) -> String {
        let model = (value ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if !model.isEmpty { return model }
        return AIProvider(rawValue: provider)?.defaultModel ?? AIProvider.openai.defaultModel
    }

    private func sanitizeMessages(_ messages: [[String: Any]]) -> [[String: String]] {
        messages.compactMap { message in
            guard let role = message["role"] as? String,
                  ["user", "assistant"].contains(role),
                  let content = message["content"] as? String,
                  !content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                return nil
            }
            return [
                "role": role,
                "content": String(content.prefix(8_000))
            ]
        }
    }

    private func sanitizeIntent(_ intent: [String: Any]?) -> [String: Any] {
        let allowedKinds = Set(["summary", "loggingReview", "projectTotals", "entryDraft", "assignmentUpdate"])
        let rawKind = intent?["kind"] as? String ?? "summary"
        let kind = allowedKinds.contains(rawKind) ? rawKind : "summary"
        return [
            "kind": kind,
            "allowDraftSuggestions": intent?["allowDraftSuggestions"] as? Bool ?? false,
            "allowUpdateAssignmentSuggestions": intent?["allowUpdateAssignmentSuggestions"] as? Bool ?? false
        ]
    }

    private func buildUserPrompt(dayContext: [String: Any], promptIntent: [String: Any], messages: [[String: String]]) throws -> String {
        let contextData = try JSONSerialization.data(withJSONObject: dayContext, options: [.sortedKeys])
        let contextJSON = String(decoding: contextData, as: UTF8.self)
        let intentData = try JSONSerialization.data(withJSONObject: promptIntent, options: [.sortedKeys])
        let intentJSON = String(decoding: intentData, as: UTF8.self)
        let conversation = messages.map { message in
            "\(message["role"] ?? "user"): \(message["content"] ?? "")"
        }.joined(separator: "\n")

        return """
        promptIntent:
        \(intentJSON)

        Selected-day context JSON:
        \(contextJSON)

        Recent conversation:
        \(conversation)
        """
    }

    private func requestOpenAI(model: String, apiKey: String, systemPrompt: String, userPrompt: String) async throws -> String {
        let body: [String: Any] = [
            "model": model,
            "input": [
                [
                    "role": "system",
                    "content": [["type": "input_text", "text": systemPrompt]]
                ],
                [
                    "role": "user",
                    "content": [["type": "input_text", "text": userPrompt]]
                ]
            ]
        ]

        var request = URLRequest(url: URL(string: "https://api.openai.com/v1/responses")!)
        request.httpMethod = "POST"
        request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let data = try await perform(request)
        guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw AIServiceError.invalidProviderResponse
        }
        return extractOpenAIText(object)
    }

    private func requestGoogle(model: String, apiKey: String, systemPrompt: String, userPrompt: String) async throws -> String {
        var modelPathCharacters = CharacterSet.urlPathAllowed
        modelPathCharacters.remove(charactersIn: "/:")
        let escapedModel = model.addingPercentEncoding(withAllowedCharacters: modelPathCharacters) ?? model
        let url = URL(string: "https://generativelanguage.googleapis.com/v1beta/models/\(escapedModel):generateContent")!
        let body: [String: Any] = [
            "system_instruction": [
                "parts": [["text": systemPrompt]]
            ],
            "contents": [
                [
                    "role": "user",
                    "parts": [["text": userPrompt]]
                ]
            ],
            "generationConfig": [
                "responseMimeType": "application/json"
            ]
        ]

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue(apiKey, forHTTPHeaderField: "x-goog-api-key")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let data = try await perform(request)
        guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw AIServiceError.invalidProviderResponse
        }
        return extractGoogleText(object)
    }

    private func requestAnthropic(model: String, apiKey: String, systemPrompt: String, userPrompt: String) async throws -> String {
        let body: [String: Any] = [
            "model": model,
            "max_tokens": 1200,
            "system": systemPrompt,
            "messages": [
                [
                    "role": "user",
                    "content": userPrompt
                ]
            ]
        ]

        var request = URLRequest(url: URL(string: "https://api.anthropic.com/v1/messages")!)
        request.httpMethod = "POST"
        request.setValue(apiKey, forHTTPHeaderField: "x-api-key")
        request.setValue("2023-06-01", forHTTPHeaderField: "anthropic-version")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let data = try await perform(request)
        guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw AIServiceError.invalidProviderResponse
        }
        return extractAnthropicText(object)
    }

    private func requestOpenRouter(model: String, apiKey: String, systemPrompt: String, userPrompt: String) async throws -> String {
        let body: [String: Any] = [
            "model": model,
            "messages": [
                [
                    "role": "system",
                    "content": systemPrompt
                ],
                [
                    "role": "user",
                    "content": userPrompt
                ]
            ],
            "response_format": [
                "type": "json_object"
            ],
            "provider": [
                "allow_fallbacks": false
            ]
        ]

        var request = URLRequest(url: URL(string: "https://openrouter.ai/api/v1/chat/completions")!)
        request.httpMethod = "POST"
        request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Oriel", forHTTPHeaderField: "X-Title")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let data = try await perform(request)
        guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw AIServiceError.invalidProviderResponse
        }
        return extractOpenRouterText(object)
    }

    private func requestOpenAIModels(apiKey: String) async throws -> [String] {
        var request = URLRequest(url: URL(string: "https://api.openai.com/v1/models")!)
        request.httpMethod = "GET"
        request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")

        let data = try await perform(request)
        guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw AIServiceError.invalidProviderResponse
        }
        let rows = object["data"] as? [[String: Any]] ?? []
        return rows.compactMap { $0["id"] as? String }.filter(isOpenAITextModel)
    }

    private func requestGoogleModels(apiKey: String) async throws -> [String] {
        var request = URLRequest(url: URL(string: "https://generativelanguage.googleapis.com/v1beta/models")!)
        request.httpMethod = "GET"
        request.setValue(apiKey, forHTTPHeaderField: "x-goog-api-key")

        let data = try await perform(request)
        guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw AIServiceError.invalidProviderResponse
        }
        let rows = object["models"] as? [[String: Any]] ?? []
        return rows.compactMap { row in
            let methods = row["supportedGenerationMethods"] as? [String] ?? []
            guard methods.contains("generateContent"), let name = row["name"] as? String else { return nil }
            return name.replacingOccurrences(of: "models/", with: "")
        }
    }

    private func requestAnthropicModels(apiKey: String) async throws -> [String] {
        var request = URLRequest(url: URL(string: "https://api.anthropic.com/v1/models")!)
        request.httpMethod = "GET"
        request.setValue(apiKey, forHTTPHeaderField: "x-api-key")
        request.setValue("2023-06-01", forHTTPHeaderField: "anthropic-version")

        let data = try await perform(request)
        guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw AIServiceError.invalidProviderResponse
        }
        let rows = object["data"] as? [[String: Any]] ?? []
        return rows.compactMap { $0["id"] as? String }.filter { $0.hasPrefix("claude-") }
    }

    private func requestOpenRouterModels(apiKey: String) async throws -> [String] {
        var request = URLRequest(url: URL(string: "https://openrouter.ai/api/v1/models")!)
        request.httpMethod = "GET"
        request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")

        let data = try await perform(request)
        guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw AIServiceError.invalidProviderResponse
        }
        let rows = object["data"] as? [[String: Any]] ?? []
        return rows.compactMap { row in
            guard let id = row["id"] as? String else { return nil }
            let architecture = row["architecture"] as? [String: Any] ?? [:]
            let inputModalities = architecture["input_modalities"] as? [String] ?? []
            guard inputModalities.contains("image") else { return nil }
            return id
        }
    }

    private func perform(_ request: URLRequest) async throws -> Data {
        let (data, response) = try await transport(request)
        guard let httpResponse = response as? HTTPURLResponse else {
            return data
        }
        guard 200..<300 ~= httpResponse.statusCode else {
            let message = String(data: data, encoding: .utf8) ?? "AI provider request failed."
            throw AIServiceError.providerFailure(message)
        }
        return data
    }

    private func extractOpenAIText(_ object: [String: Any]) -> String {
        if let outputText = object["output_text"] as? String {
            return outputText
        }
        let output = object["output"] as? [[String: Any]] ?? []
        for item in output {
            let content = item["content"] as? [[String: Any]] ?? []
            for part in content {
                if let text = part["text"] as? String { return text }
                if let text = part["output_text"] as? String { return text }
            }
        }
        return ""
    }

    private func extractGoogleText(_ object: [String: Any]) -> String {
        let candidates = object["candidates"] as? [[String: Any]] ?? []
        for candidate in candidates {
            let content = candidate["content"] as? [String: Any]
            let parts = content?["parts"] as? [[String: Any]] ?? []
            for part in parts {
                if let text = part["text"] as? String { return text }
            }
        }
        return ""
    }

    private func extractAnthropicText(_ object: [String: Any]) -> String {
        let content = object["content"] as? [[String: Any]] ?? []
        return content.compactMap { $0["text"] as? String }.joined(separator: "\n")
    }

    private func extractOpenRouterText(_ object: [String: Any]) -> String {
        let choices = object["choices"] as? [[String: Any]] ?? []
        for choice in choices {
            let message = choice["message"] as? [String: Any] ?? [:]
            if let content = message["content"] as? String {
                return content
            }
            if let content = message["content"] as? [[String: Any]] {
                return content.compactMap { $0["text"] as? String }.joined(separator: "\n")
            }
        }
        return ""
    }

    private func isOpenAITextModel(_ id: String) -> Bool {
        let lowercased = id.lowercased()
        let blockedFragments = [
            "embedding",
            "whisper",
            "tts",
            "dall-e",
            "image",
            "moderation",
            "transcribe",
            "speech",
            "audio",
            "realtime"
        ]
        if blockedFragments.contains(where: { lowercased.contains($0) }) { return false }
        return lowercased.hasPrefix("gpt-") || lowercased.hasPrefix("o")
    }

    private func normalizeProviderText(_ text: String) -> [String: Any] {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            return ["text": "The provider returned an empty response.", "suggestions": []]
        }

        if let object = parseJSONObject(trimmed) {
            return [
                "text": object["text"] as? String ?? trimmed,
                "suggestions": object["suggestions"] as? [[String: Any]] ?? []
            ]
        }

        if let start = trimmed.firstIndex(of: "{"),
           let end = trimmed.lastIndex(of: "}"),
           start <= end {
            let jsonSubstring = String(trimmed[start...end])
            if let object = parseJSONObject(jsonSubstring) {
                return [
                    "text": object["text"] as? String ?? trimmed,
                    "suggestions": object["suggestions"] as? [[String: Any]] ?? []
                ]
            }
        }

        return ["text": trimmed, "suggestions": []]
    }

    private func parseJSONObject(_ text: String) -> [String: Any]? {
        guard let data = text.data(using: .utf8) else { return nil }
        return try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    }
}
