import Foundation

struct ActivitySummaryRequest {
    let provider: String
    let model: String
    let metadata: ActivitySummaryMetadata
    let jpegData: Data
    let timeoutSeconds: Int
}

enum ActivitySummaryClientError: Error, LocalizedError {
    case unsupportedProvider
    case missingAPIKey
    case providerError(statusCode: Int, code: String, message: String)
    case invalidProviderResponse

    var errorDescription: String? {
        switch self {
        case .unsupportedProvider:
            return "The selected provider does not support screenshot summaries."
        case .missingAPIKey:
            return "No API key is saved for the selected provider."
        case .providerError(_, _, let message):
            return message
        case .invalidProviderResponse:
            return "The provider returned an invalid screenshot summary."
        }
    }
}

protocol ActivitySummaryClient {
    func summarize(_ request: ActivitySummaryRequest) async throws -> ActivitySummaryResponse
}

final class ProviderActivitySummaryClient: ActivitySummaryClient {
    typealias Transport = (URLRequest) async throws -> (Data, URLResponse)

    private let keyStore: APIKeyStore
    private let validator: ActivitySummarySchemaValidator
    private let transport: Transport

    init(
        keyStore: APIKeyStore = KeychainStore(),
        validator: ActivitySummarySchemaValidator = ActivitySummarySchemaValidator(),
        transport: @escaping Transport = { request in try await URLSession.shared.data(for: request) }
    ) {
        self.keyStore = keyStore
        self.validator = validator
        self.transport = transport
    }

    func summarize(_ request: ActivitySummaryRequest) async throws -> ActivitySummaryResponse {
        guard let provider = AIProvider.normalize(request.provider) else {
            throw ActivitySummaryClientError.unsupportedProvider
        }
        guard let apiKey = try keyStore.apiKey(for: provider.rawValue), !apiKey.isEmpty else {
            throw ActivitySummaryClientError.missingAPIKey
        }
        let urlRequest = try buildRequest(provider: provider, request: request, apiKey: apiKey)
        let (data, response) = try await transport(urlRequest)
        if let httpResponse = response as? HTTPURLResponse,
           !(200...299).contains(httpResponse.statusCode) {
            throw providerError(from: data, statusCode: httpResponse.statusCode)
        }
        guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let summary = extractSummaryObject(object, provider: provider) else {
            throw ActivitySummaryClientError.invalidProviderResponse
        }
        return try validator.validate(object: summary, metadata: request.metadata)
    }

    private func buildRequest(provider: AIProvider, request: ActivitySummaryRequest, apiKey: String) throws -> URLRequest {
        switch provider {
        case .openai:
            return try openAIRequest(request, apiKey: apiKey)
        case .google:
            return try googleRequest(request, apiKey: apiKey)
        case .anthropic:
            return try anthropicRequest(request, apiKey: apiKey)
        case .openrouter:
            return try openRouterRequest(request, apiKey: apiKey)
        }
    }

    private func metadataJSON(_ metadata: ActivitySummaryMetadata) throws -> String {
        var object: [String: Any] = [
            "activity_id": metadata.activityID,
            "capture_timestamp_iso": metadata.captureTimestampISO,
            "frontmost_app_name": metadata.frontmostAppName,
            "bundle_id": metadata.bundleID,
            "input_state": metadata.inputState,
            "screenshot_width": metadata.screenshotWidth,
            "screenshot_height": metadata.screenshotHeight
        ]
        object["duration_seconds"] = metadata.durationSeconds.map { $0 as Any } ?? NSNull()
        object["process_id"] = metadata.processID.map { $0 as Any } ?? NSNull()
        object["window_title"] = metadata.windowTitle ?? NSNull()
        object["browser_url"] = metadata.browserURL ?? NSNull()
        object["browser_domain"] = metadata.browserDomain ?? NSNull()
        object["project_name"] = metadata.projectName ?? NSNull()
        object["display_id"] = metadata.displayID ?? NSNull()
        let data = try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
        return String(decoding: data, as: UTF8.self)
    }

    private func instruction(metadata: ActivitySummaryMetadata) throws -> String {
        """
        Analyze the screenshot using the metadata as source of truth for app identity.
        Return only a JSON object with required fields: app, bundle_id, window_or_page,
        project_or_context, activity, category, action, objects, confidence, evidence,
        uncertainties, cloud_safe_summary, sensitivity, metadata_conflicts.
        Metadata JSON:
        \(try metadataJSON(metadata))
        """
    }

    private func openAIRequest(_ request: ActivitySummaryRequest, apiKey: String) throws -> URLRequest {
        let imageURL = "data:image/jpeg;base64,\(request.jpegData.base64EncodedString())"
        let body: [String: Any] = [
            "model": request.model,
            "input": [
                [
                    "role": "user",
                    "content": [
                        ["type": "input_text", "text": try instruction(metadata: request.metadata)],
                        ["type": "input_image", "image_url": imageURL]
                    ]
                ]
            ],
            "text": [
                "format": [
                    "type": "json_schema",
                    "name": "activity_summary",
                    "strict": true,
                    "schema": validator.jsonSchema
                ]
            ]
        ]
        var urlRequest = URLRequest(url: URL(string: "https://api.openai.com/v1/responses")!)
        urlRequest.httpMethod = "POST"
        urlRequest.timeoutInterval = TimeInterval(request.timeoutSeconds)
        urlRequest.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        urlRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
        urlRequest.httpBody = try JSONSerialization.data(withJSONObject: body)
        return urlRequest
    }

    private func googleRequest(_ request: ActivitySummaryRequest, apiKey: String) throws -> URLRequest {
        let escapedModel = request.model.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? request.model
        let body: [String: Any] = [
            "contents": [
                [
                    "role": "user",
                    "parts": [
                        ["text": try instruction(metadata: request.metadata)],
                        [
                            "inline_data": [
                                "mime_type": "image/jpeg",
                                "data": request.jpegData.base64EncodedString()
                            ]
                        ]
                    ]
                ]
            ],
            "generationConfig": [
                "responseMimeType": "application/json",
                "responseSchema": validator.geminiResponseSchema
            ]
        ]
        var urlRequest = URLRequest(url: URL(string: "https://generativelanguage.googleapis.com/v1beta/models/\(escapedModel):generateContent")!)
        urlRequest.httpMethod = "POST"
        urlRequest.timeoutInterval = TimeInterval(request.timeoutSeconds)
        urlRequest.setValue(apiKey, forHTTPHeaderField: "x-goog-api-key")
        urlRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
        urlRequest.httpBody = try JSONSerialization.data(withJSONObject: body)
        return urlRequest
    }

    private func anthropicRequest(_ request: ActivitySummaryRequest, apiKey: String) throws -> URLRequest {
        let body: [String: Any] = [
            "model": request.model,
            "max_tokens": 1000,
            "messages": [
                [
                    "role": "user",
                    "content": [
                        ["type": "text", "text": try instruction(metadata: request.metadata)],
                        [
                            "type": "image",
                            "source": [
                                "type": "base64",
                                "media_type": "image/jpeg",
                                "data": request.jpegData.base64EncodedString()
                            ]
                        ]
                    ]
                ]
            ],
            "tools": [
                [
                    "name": "record_activity_summary",
                    "description": "Record the validated activity summary JSON for this screenshot.",
                    "input_schema": validator.jsonSchema
                ]
            ],
            "tool_choice": [
                "type": "tool",
                "name": "record_activity_summary"
            ]
        ]
        var urlRequest = URLRequest(url: URL(string: "https://api.anthropic.com/v1/messages")!)
        urlRequest.httpMethod = "POST"
        urlRequest.timeoutInterval = TimeInterval(request.timeoutSeconds)
        urlRequest.setValue(apiKey, forHTTPHeaderField: "x-api-key")
        urlRequest.setValue("2023-06-01", forHTTPHeaderField: "anthropic-version")
        urlRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
        urlRequest.httpBody = try JSONSerialization.data(withJSONObject: body)
        return urlRequest
    }

    private func openRouterRequest(_ request: ActivitySummaryRequest, apiKey: String) throws -> URLRequest {
        let imageURL = "data:image/jpeg;base64,\(request.jpegData.base64EncodedString())"
        let body: [String: Any] = [
            "model": request.model,
            "messages": [
                [
                    "role": "user",
                    "content": [
                        ["type": "text", "text": try instruction(metadata: request.metadata)],
                        ["type": "image_url", "image_url": ["url": imageURL]]
                    ]
                ]
            ],
            "response_format": [
                "type": "json_schema",
                "json_schema": [
                    "name": "activity_summary",
                    "strict": true,
                    "schema": validator.jsonSchema
                ]
            ],
            "provider": ["allow_fallbacks": false]
        ]
        var urlRequest = URLRequest(url: URL(string: "https://openrouter.ai/api/v1/chat/completions")!)
        urlRequest.httpMethod = "POST"
        urlRequest.timeoutInterval = TimeInterval(request.timeoutSeconds)
        urlRequest.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        urlRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
        urlRequest.setValue("Oriel", forHTTPHeaderField: "X-Title")
        urlRequest.httpBody = try JSONSerialization.data(withJSONObject: body)
        return urlRequest
    }

    private func extractSummaryObject(_ object: [String: Any], provider: AIProvider) -> [String: Any]? {
        let text: String?
        switch provider {
        case .openai:
            text = object["output_text"] as? String
        case .google:
            let candidates = object["candidates"] as? [[String: Any]] ?? []
            let parts = (candidates.first?["content"] as? [String: Any])?["parts"] as? [[String: Any]] ?? []
            text = parts.compactMap { $0["text"] as? String }.first
        case .anthropic:
            let content = object["content"] as? [[String: Any]] ?? []
            if let toolInput = content.first(where: { $0["type"] as? String == "tool_use" })?["input"] as? [String: Any] {
                return toolInput
            }
            text = content.compactMap { $0["text"] as? String }.joined(separator: "\n")
        case .openrouter:
            let choices = object["choices"] as? [[String: Any]] ?? []
            text = (choices.first?["message"] as? [String: Any])?["content"] as? String
        }
        guard let text, let data = text.data(using: .utf8) else { return nil }
        return try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    }

    private func providerError(from data: Data, statusCode: Int) -> ActivitySummaryClientError {
        let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        let errorObject = object?["error"] as? [String: Any]
        let code = errorObject?["code"] as? String
            ?? errorObject?["type"] as? String
            ?? errorObject?["status"] as? String
            ?? "http_\(statusCode)"
        let message = String(
            (errorObject?["message"] as? String ?? "The provider rejected the screenshot summary request.")
                .prefix(300)
        )
        return .providerError(statusCode: statusCode, code: code, message: message)
    }
}
