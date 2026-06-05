import Foundation
import XCTest
@testable import OrielApp

final class AIServiceTests: XCTestCase {
    func testAIServiceSendsOpenAIResponsesRequestAndNormalizesJSONText() async throws {
        let keyStore = FakeAPIKeyStore(keys: ["openai": "test-key"])
        var capturedRequest: URLRequest?
        let service = AIService(keyStore: keyStore) { request in
            capturedRequest = request
            let data = #"{"output_text":"{\"text\":\"Summary\",\"suggestions\":[{\"type\":\"draftEntry\",\"start\":1,\"end\":2,\"description\":\"Draft\"}]}"}"#.data(using: .utf8)!
            return (data, httpResponse(for: request.url!, status: 200))
        }

        let response = try await service.chat(payload: [
            "provider": "openai",
            "model": "gpt-test",
            "messages": [["role": "user", "content": "Summarize"]],
            "dayContext": ["date": "2026-05-25"],
            "intent": [
                "kind": "summary",
                "allowDraftSuggestions": false,
                "allowUpdateAssignmentSuggestions": false
            ]
        ])

        XCTAssertEqual(capturedRequest?.url?.absoluteString, "https://api.openai.com/v1/responses")
        XCTAssertEqual(capturedRequest?.value(forHTTPHeaderField: "Authorization"), "Bearer test-key")
        let requestBody = try XCTUnwrap(capturedRequest?.httpBody.flatMap { String(data: $0, encoding: .utf8) })
        XCTAssertTrue(requestBody.contains("dayContext.totals"))
        XCTAssertTrue(requestBody.contains("dayContext.draftCandidates"))
        XCTAssertTrue(requestBody.contains("detailed arrays may be capped"))
        XCTAssertTrue(requestBody.contains("promptIntent"))
        XCTAssertTrue(requestBody.contains("\\\"kind\\\":\\\"summary\\\""))
        XCTAssertTrue(requestBody.contains("Return suggestions only when promptIntent explicitly allows them"))
        XCTAssertTrue(requestBody.contains("generic draft-entry prompts should return suggestions as an empty array"))
        XCTAssertTrue(requestBody.contains("notable ranges"))
        XCTAssertEqual(response["text"] as? String, "Summary")
        XCTAssertEqual((response["suggestions"] as? [[String: Any]])?.count, 1)
    }

    func testAIServiceSendsGeminiRequestAndReportsMissingKey() async throws {
        let keyStore = FakeAPIKeyStore(keys: ["google": "gemini-key"])
        var capturedRequest: URLRequest?
        let service = AIService(keyStore: keyStore) { request in
            capturedRequest = request
            let data = #"{"candidates":[{"content":{"parts":[{"text":"{\"text\":\"Gemini summary\",\"suggestions\":[]}"}]}}]}"#.data(using: .utf8)!
            return (data, httpResponse(for: request.url!, status: 200))
        }

        let response = try await service.chat(payload: [
            "provider": "google",
            "model": "gemini-test",
            "messages": [["role": "user", "content": "Summarize"]],
            "dayContext": ["date": "2026-05-25"]
        ])

        XCTAssertEqual(capturedRequest?.url?.absoluteString, "https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent")
        XCTAssertEqual(capturedRequest?.value(forHTTPHeaderField: "x-goog-api-key"), "gemini-key")
        XCTAssertEqual(response["text"] as? String, "Gemini summary")

        let missingKeyService = AIService(keyStore: FakeAPIKeyStore(keys: [:])) { request in
            XCTFail("Transport should not run without a saved key: \(request)")
            return (Data(), httpResponse(for: URL(string: "https://example.com")!, status: 200))
        }

        do {
            _ = try await missingKeyService.chat(payload: ["provider": "openai", "model": "gpt-test"])
            XCTFail("Expected missing key failure")
        } catch AIServiceError.missingAPIKey {
            // Expected.
        }
    }

    func testAIServiceSendsAnthropicRequestAndExtractsText() async throws {
        let keyStore = FakeAPIKeyStore(keys: ["anthropic": "claude-key"])
        var capturedRequest: URLRequest?
        let service = AIService(keyStore: keyStore) { request in
            capturedRequest = request
            let data = #"{"content":[{"type":"text","text":"{\"text\":\"Claude summary\",\"suggestions\":[]}"}]}"#.data(using: .utf8)!
            return (data, httpResponse(for: request.url!, status: 200))
        }

        let response = try await service.chat(payload: [
            "provider": "anthropic",
            "model": "claude-test",
            "messages": [["role": "user", "content": "Summarize"]],
            "dayContext": ["date": "2026-05-25"]
        ])

        XCTAssertEqual(capturedRequest?.url?.absoluteString, "https://api.anthropic.com/v1/messages")
        XCTAssertEqual(capturedRequest?.value(forHTTPHeaderField: "x-api-key"), "claude-key")
        XCTAssertEqual(capturedRequest?.value(forHTTPHeaderField: "anthropic-version"), "2023-06-01")
        let requestBody = try XCTUnwrap(capturedRequest?.httpBody.flatMap { String(data: $0, encoding: .utf8) })
        XCTAssertTrue(requestBody.contains("\"model\":\"claude-test\""))
        XCTAssertTrue(requestBody.contains("\"max_tokens\""))
        XCTAssertTrue(requestBody.contains("\"system\""))
        XCTAssertEqual(response["text"] as? String, "Claude summary")
    }

    func testAIServiceKeyStatusAndModelListingSupportAllProviders() async throws {
        let keyStore = FakeAPIKeyStore(keys: [
            "openai": "openai-key",
            "google": "gemini-key",
            "anthropic": "claude-key"
        ])
        var capturedRequests: [URLRequest] = []
        let service = AIService(keyStore: keyStore) { request in
            capturedRequests.append(request)
            let absoluteString = request.url!.absoluteString
            let data: Data
            if absoluteString == "https://api.openai.com/v1/models" {
                data = #"{"data":[{"id":"gpt-5.2"},{"id":"text-embedding-3-small"},{"id":"o4-mini"}]}"#.data(using: .utf8)!
            } else if absoluteString == "https://generativelanguage.googleapis.com/v1beta/models" {
                data = #"{"models":[{"name":"models/gemini-3.5-flash","supportedGenerationMethods":["generateContent"]},{"name":"models/embedding-001","supportedGenerationMethods":["embedContent"]}]}"#.data(using: .utf8)!
            } else if absoluteString == "https://api.anthropic.com/v1/models" {
                data = #"{"data":[{"id":"claude-sonnet-4-20250514"},{"id":"claude-haiku-4-20250514"}]}"#.data(using: .utf8)!
            } else {
                XCTFail("Unexpected model list URL: \(absoluteString)")
                data = #"{"data":[]}"#.data(using: .utf8)!
            }
            return (data, httpResponse(for: request.url!, status: 200))
        }

        let keyStatus = service.keyStatus()
        XCTAssertEqual(keyStatus["openai"] as? Bool, true)
        XCTAssertEqual(keyStatus["google"] as? Bool, true)
        XCTAssertEqual(keyStatus["anthropic"] as? Bool, true)

        let openAI = try await service.listModels(payload: ["provider": "openai"])
        XCTAssertEqual(openAI["models"] as? [String], ["gpt-5.2", "o4-mini"])

        let gemini = try await service.listModels(payload: ["provider": "google"])
        XCTAssertEqual(gemini["models"] as? [String], ["gemini-3.5-flash"])

        let anthropic = try await service.listModels(payload: ["provider": "anthropic"])
        XCTAssertEqual(anthropic["models"] as? [String], ["claude-sonnet-4-20250514", "claude-haiku-4-20250514"])

        XCTAssertEqual(capturedRequests.map { $0.value(forHTTPHeaderField: "Authorization") }, ["Bearer openai-key", nil, nil])
        XCTAssertEqual(capturedRequests[1].value(forHTTPHeaderField: "x-goog-api-key"), "gemini-key")
        XCTAssertEqual(capturedRequests[2].value(forHTTPHeaderField: "x-api-key"), "claude-key")
        XCTAssertEqual(capturedRequests[2].value(forHTTPHeaderField: "anthropic-version"), "2023-06-01")
    }
}

private final class FakeAPIKeyStore: APIKeyStore {
    var keys: [String: String]

    init(keys: [String: String]) {
        self.keys = keys
    }

    func save(apiKey: String, provider: String) throws {
        keys[provider] = apiKey
    }

    func apiKey(for provider: String) throws -> String? {
        keys[provider]
    }

    func delete(provider: String) throws {
        keys.removeValue(forKey: provider)
    }

    func hasKey(for provider: String) -> Bool {
        keys[provider]?.isEmpty == false
    }
}

private func httpResponse(for url: URL, status: Int) -> HTTPURLResponse {
    HTTPURLResponse(url: url, statusCode: status, httpVersion: nil, headerFields: nil)!
}
