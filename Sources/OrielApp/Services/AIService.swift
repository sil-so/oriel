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

    func dailySummary(payload: [String: Any]) async throws -> [String: Any] {
        let provider = try normalizedProvider(payload["provider"] as? String)
        let model = normalizedModel(payload["model"] as? String, provider: provider)
        guard let apiKey = try keyStore.apiKey(for: provider), !apiKey.isEmpty else {
            throw AIServiceError.missingAPIKey
        }

        let systemPrompt = """
        You are Oriel's daily AI insights writer.

        Your task is to turn selected-day structured activity summaries and local activity context into one concise recap of the user's tracked day.

        Use only the provided JSON. Do not invent goals, emotions, productivity judgments, task intent, project names, clients, outcomes, purchases, or missing details that are not supported by the input.

        Source interpretation:

        * Treat activity-summary clusters as high-detail sampled evidence, not a complete record of the day.
        * Use activity-summary clusters as representative evidence; summaryCount, titles, actions, objects, and representativeSummaries describe repeated related activity without listing every sample.
        * Use activityStats as precomputed local context for top apps, category/action emphasis, and daypart proportions. Do not recalculate totals from individual timestamps when activityStats provides them.
        * Treat local activity and time-entry context as the broader tracked-day scaffold.
        * Use activity-summary clusters for concrete details, task descriptions, recurring themes, and specific work evidence.
        * Use local activity context to understand chronology, relative emphasis, app/title patterns, and broader recorded activity that may not have an activity summary.
        * Use time-entry context to understand user-labeled work categories, projects, tasks, or manual corrections when present.
        * Do not overfocus on only the sampled activity-summary clusters when the local context shows broader tracked activity.
        * Do not claim full real-world day coverage. Prefer phrasing like "your tracked day", "your recorded activity", "most of the recorded work", or "the clearest thread".

        Voice and tone:

        * Write directly to the user using "you" and "your" when natural.
        * Do not refer to the user as "the user".
        * Keep the recap personal but not overly familiar.
        * Prefer phrasing like "you worked on", "you reviewed", "you compared", "you continued", and "your recorded activity centered on".
        * Avoid clinical phrasing like "the session focused on" when a more natural second-person version is available.
        * Avoid surveillance-like phrasing such as "you were observed", "your behavior indicates", or "the screenshots show".
        * Keep the tone neutral, calm, specific, and observational.
        * Do not judge productivity, effort, mood, focus, discipline, or value.

        Synthesis rules:

        * Prefer a coherent narrative over app-by-app narration.
        * Preserve concrete details when clearly supported, such as project names, apps, product categories, purchases, recurring topics, or time-entry labels.
        * Merge repeated or adjacent activity into a single coherent theme when it clearly refers to the same task.
        * Mention approximate time proportions when activityStats supports them, such as "most of the morning", "a shorter afternoon block", or "the largest recorded block".
        * Use recentSummaryOpeners only as anti-repetition context. Do not reuse or closely paraphrase recentSummaryOpeners.
        * Start with a concrete activity, object, project, product, transition, or theme. Avoid generic formulas like "Your tracked day centered on" when a more specific opener is supported.
        * Distinguish long same-theme work from fragmented context switching only when the clusters or activityStats support that distinction.
        * Include secondary themes when they are meaningful in the broader local context, even if they are less detailed than the sampled activity summaries.
        * Avoid flattening specific activity into vague categories. For example, prefer "comparing portable monitors and monitor arms" over "online shopping" when the context supports it.
        * Do not overfit to a single low-confidence source if stronger or repeated evidence points elsewhere.
        * If evidence is sparse, keep the recap shorter and factual rather than adding caveats.

        Length and emphasis:

        * Let the number of distinct supported themes determine the recap length, not the number of individual source rows.
        * If many summaries describe the same activity, merge them into one theme.
        * If the local context shows meaningful activity that is not deeply covered by activity summaries, mention it briefly without inventing details.
        * Use more detail only when the input supports it clearly.
        * Keep the recap readable as a daily card first, not as a full audit log.
        * Adapt the length to the amount of distinct supported activity:

          * Sparse evidence: 1 to 2 sentences.
          * Normal evidence: 2 to 3 sentences.
          * Rich evidence with several distinct themes: 3 to 5 sentences.
        * Do not make the recap longer just because there are many repeated summaries of the same task.
        * Prefer staying under 140 words unless the input contains several clearly distinct work themes.

        Privacy and product constraints:

        * Do not mention screenshots, raw images, stored artifacts, providers, models, schemas, metadata conflicts, confidence scores, evidence fields, sensitivity labels, debug fields, or internal processing.
        * Oriel does not store raw screenshots, so never imply that screenshots were stored or reviewed directly.
        * Do not start with, repeat, or name the selected date, weekday, or calendar day. General phrasing like "your tracked day" is allowed.
        * Do not include Markdown formatting inside "text".
        * Do not prefix highlight strings with bullets, hyphens, numbers, or Markdown syntax. The app renders the highlights array as a bullet list.

        Output requirements:

        * Return only a valid JSON object.
        * Do not wrap the JSON in markdown.
        * Do not include commentary before or after the JSON.
        * The JSON must have exactly this shape:
        {"text":"daily recap","highlights":["short highlight"]}
        * "text" must be a concise paragraph, not a list.
        * "highlights" must contain 0 to 5 short strings.
        * Highlights must name concrete deliverables, decisions, transitions, objects, or specific threads.
        * Each highlight must be specific, factual, and no longer than 12 words.
        * Do not include empty, generic, or duplicate highlights.

        Avoid:

        * Do not write "the user spent the day".
        * Do not write "the screenshots show".
        * Do not write "based on screenshots".
        * Do not write "you were productive", "you wasted time", or similar judgments.
        * Do not speculate about intent, mood, clients, deadlines, outcomes, or purchases unless the provided JSON clearly supports them.
        """
        let userPrompt = try buildDailySummaryPrompt(payload: payload)

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
        return normalizeDailySummaryText(responseText)
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

    private func buildDailySummaryPrompt(payload: [String: Any]) throws -> String {
        let date = payload["date"] as? String ?? ""
        let activitySummaries = payload["activitySummaries"] as? [[String: Any]] ?? []
        let dayContext = payload["dayContext"] as? [String: Any] ?? [:]
        let activityData = try JSONSerialization.data(withJSONObject: activitySummaries, options: [.sortedKeys])
        let activityJSON = String(decoding: activityData, as: UTF8.self)
        let contextData = try JSONSerialization.data(withJSONObject: dayContext, options: [.sortedKeys])
        let contextJSON = String(decoding: contextData, as: UTF8.self)

        return """
        Selected date:
        \(date)

        Structured activity-summary sources for the selected date:
        \(activityJSON)

        Local selected-day context for chronology and emphasis:
        \(contextJSON)

        Generate the daily recap JSON now.
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

    private func normalizeDailySummaryText(_ text: String) -> [String: Any] {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            return ["text": "The provider returned an empty daily summary.", "highlights": []]
        }

        let object = parseJSONObject(trimmed) ?? {
            if let start = trimmed.firstIndex(of: "{"),
               let end = trimmed.lastIndex(of: "}"),
               start <= end {
                return parseJSONObject(String(trimmed[start...end]))
            }
            return nil
        }()

        guard let object else {
            return ["text": trimmed, "highlights": []]
        }

        return [
            "text": object["text"] as? String ?? trimmed,
            "highlights": stringArray(object["highlights"])
        ]
    }

    private func stringArray(_ value: Any?) -> [String] {
        (value as? [Any] ?? []).compactMap { item in
            guard let string = item as? String else { return nil }
            let trimmed = string.trimmingCharacters(in: .whitespacesAndNewlines)
            return trimmed.isEmpty ? nil : String(trimmed.prefix(500))
        }
    }

    private func parseJSONObject(_ text: String) -> [String: Any]? {
        guard let data = text.data(using: .utf8) else { return nil }
        return try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    }
}
