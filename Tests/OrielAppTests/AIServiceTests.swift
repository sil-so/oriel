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
        XCTAssertTrue(requestBody.contains("\\\"kind\\\":\\\"summary\\\""))
        XCTAssertTrue(requestBody.contains("Do not mention internal policies"))
        XCTAssertTrue(requestBody.contains("Recommend projects only when activity evidence supports the relationship"))
        XCTAssertTrue(requestBody.contains("Do not list projects merely because they exist"))
        XCTAssertFalse(requestBody.contains("prompt permissions"))
        XCTAssertFalse(requestBody.contains("Suggestions are disabled"))
        XCTAssertFalse(requestBody.contains("generic draft-entry prompts should return suggestions as an empty array"))
        XCTAssertFalse(requestBody.contains("local candidate set"))
        XCTAssertFalse(requestBody.contains("detailed arrays may be capped"))
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
            "anthropic": "claude-key",
            "openrouter": "openrouter-key"
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
            } else if absoluteString == "https://openrouter.ai/api/v1/models" {
                data = #"{"data":[{"id":"google/gemini-3.1-flash-lite","architecture":{"input_modalities":["text","image"]}},{"id":"openai/text-embedding-3-small","architecture":{"input_modalities":["text"]}}]}"#.data(using: .utf8)!
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
        XCTAssertEqual(keyStatus["openrouter"] as? Bool, true)

        let openAI = try await service.listModels(payload: ["provider": "openai"])
        XCTAssertEqual(openAI["models"] as? [String], ["gpt-5.2", "o4-mini"])

        let gemini = try await service.listModels(payload: ["provider": "google"])
        XCTAssertEqual(gemini["models"] as? [String], ["gemini-3.5-flash"])

        let anthropic = try await service.listModels(payload: ["provider": "anthropic"])
        XCTAssertEqual(anthropic["models"] as? [String], ["claude-sonnet-4-20250514", "claude-haiku-4-20250514"])

        let openRouter = try await service.listModels(payload: ["provider": "openrouter"])
        XCTAssertEqual(openRouter["models"] as? [String], ["google/gemini-3.1-flash-lite"])

        XCTAssertEqual(capturedRequests.map { $0.value(forHTTPHeaderField: "Authorization") }, ["Bearer openai-key", nil, nil, "Bearer openrouter-key"])
        XCTAssertEqual(capturedRequests[1].value(forHTTPHeaderField: "x-goog-api-key"), "gemini-key")
        XCTAssertEqual(capturedRequests[2].value(forHTTPHeaderField: "x-api-key"), "claude-key")
        XCTAssertEqual(capturedRequests[2].value(forHTTPHeaderField: "anthropic-version"), "2023-06-01")
    }

    func testAIServiceSendsOpenRouterChatRequestAndExtractsJSONText() async throws {
        let keyStore = FakeAPIKeyStore(keys: ["openrouter": "openrouter-key"])
        var capturedRequest: URLRequest?
        let service = AIService(keyStore: keyStore) { request in
            capturedRequest = request
            let data = #"{"choices":[{"message":{"content":"{\"text\":\"OpenRouter summary\",\"suggestions\":[]}"}}]}"#.data(using: .utf8)!
            return (data, httpResponse(for: request.url!, status: 200))
        }

        let response = try await service.chat(payload: [
            "provider": "openrouter",
            "model": "google/gemini-3.1-flash-lite",
            "messages": [["role": "user", "content": "Summarize"]],
            "dayContext": ["date": "2026-05-25"]
        ])

        XCTAssertEqual(capturedRequest?.url?.absoluteString, "https://openrouter.ai/api/v1/chat/completions")
        XCTAssertEqual(capturedRequest?.value(forHTTPHeaderField: "Authorization"), "Bearer openrouter-key")
        let requestBody = try XCTUnwrap(capturedRequest?.httpBody.flatMap { String(data: $0, encoding: .utf8) })
        XCTAssertTrue(requestBody.contains("\"model\":\"google\\/gemini-3.1-flash-lite\"") || requestBody.contains("\"model\":\"google/gemini-3.1-flash-lite\""))
        XCTAssertTrue(requestBody.contains("\"messages\""))
        XCTAssertEqual(response["text"] as? String, "OpenRouter summary")
    }

    func testAIServiceGeneratesDailySummaryWithAskAIProviderAndModel() async throws {
        let keyStore = FakeAPIKeyStore(keys: ["openai": "openai-key"])
        var capturedRequest: URLRequest?
        let service = AIService(keyStore: keyStore) { request in
            capturedRequest = request
            let data = #"{"output_text":"{\"text\":\"Focused implementation work.\",\"highlights\":[\"Built AI settings\"],\"uncertainties\":[]}"}"#.data(using: .utf8)!
            return (data, httpResponse(for: request.url!, status: 200))
        }

        let response = try await service.dailySummary(payload: [
            "provider": "openai",
            "model": "gpt-daily",
            "date": "2026-06-07",
            "activitySummaries": [[
                "activityId": "activity-1",
                "summaryCount": 2,
                "representativeSummaries": ["Edited AI settings."],
                "summary": [
                    "cloud_safe_summary": "Edited AI settings.",
                    "activity": "implementation",
                    "confidence": 0.91
                ]
            ]],
            "dayContext": [
                "totals": ["recordedMs": 3_600_000],
                "activityStats": [
                    "topApps": [["name": "Xcode", "durationMs": 3_600_000, "percent": 100]],
                    "dayparts": [["name": "morning", "durationMs": 3_600_000, "percent": 100]],
                    "summaryCategories": [["name": "engineering", "summaryCount": 2]]
                ],
                "metrics": [
                    "version": 1,
                    "longestFocusSession": [
                        "durationMs": 3_600_000,
                        "app": "Xcode",
                        "label": "AI settings implementation"
                    ],
                    "focusSessions": [
                        "count": 1,
                        "totalDurationMs": 3_600_000,
                        "averageDurationMs": 3_600_000
                    ],
                    "fragmentation": [
                        "contextSwitchCount": 0,
                        "interruptionCount": 0
                    ],
                    "appBreakdown": [["name": "Xcode", "durationMs": 3_600_000, "percent": 100]]
                ],
                "recentSummaryOpeners": [
                    "Your tracked day centered on Oriel implementation."
                ]
            ]
        ])

        XCTAssertEqual(capturedRequest?.url?.absoluteString, "https://api.openai.com/v1/responses")
        XCTAssertEqual(capturedRequest?.value(forHTTPHeaderField: "Authorization"), "Bearer openai-key")
        let requestBody = try XCTUnwrap(capturedRequest?.httpBody.flatMap { String(data: $0, encoding: .utf8) })
        XCTAssertTrue(requestBody.contains("structured activity summaries and local activity context"))
        XCTAssertTrue(requestBody.contains("Use only the provided JSON"))
        XCTAssertTrue(requestBody.contains("Treat activity-summary clusters as high-detail sampled evidence"))
        XCTAssertTrue(requestBody.contains("Use activityStats as precomputed local context"))
        XCTAssertTrue(requestBody.contains("Use dayContext.metrics as precomputed local context"))
        XCTAssertTrue(requestBody.contains("longestFocusSession"))
        XCTAssertTrue(requestBody.contains("contextSwitchCount"))
        XCTAssertFalse(requestBody.contains("focusScore"))
        XCTAssertTrue(requestBody.contains("Use activity-summary clusters as representative evidence"))
        XCTAssertTrue(requestBody.contains("recentSummaryOpeners"))
        XCTAssertTrue(requestBody.contains("Do not reuse or closely paraphrase recentSummaryOpeners"))
        XCTAssertTrue(requestBody.contains("Mention approximate time proportions"))
        XCTAssertTrue(requestBody.contains("Treat highlights as the TL;DR"))
        XCTAssertTrue(requestBody.contains("3 to 5 concrete TL;DR items"))
        XCTAssertTrue(requestBody.contains("text must be one concise narrative paragraph that adds value beyond the highlights"))
        XCTAssertTrue(requestBody.contains("chronology, transitions, time proportions"))
        XCTAssertTrue(requestBody.contains("Light inline Markdown is allowed inside text and highlights"))
        XCTAssertFalse(requestBody.contains("Avoid generic formulas like \"Your tracked day centered on\""))
        XCTAssertTrue(requestBody.contains("Write directly to the user using"))
        XCTAssertTrue(requestBody.contains("Do not invent goals, emotions, productivity judgments"))
        XCTAssertTrue(requestBody.contains("Do not start with, repeat, or name the selected date"))
        XCTAssertTrue(requestBody.contains("the screenshots show"))
        XCTAssertTrue(requestBody.contains("Structured activity-summary sources for the selected date"))
        XCTAssertTrue(requestBody.contains("representativeSummaries"))
        XCTAssertTrue(requestBody.contains("activityStats"))
        XCTAssertTrue(requestBody.contains("Your tracked day centered on Oriel implementation."))
        XCTAssertTrue(requestBody.contains("Generate the daily recap JSON now."))
        XCTAssertFalse(requestBody.contains("\"uncertainties\""))
        XCTAssertTrue(requestBody.contains("Edited AI settings."))
        XCTAssertFalse(requestBody.contains("data:image"))
        XCTAssertFalse(requestBody.contains("base64"))
        XCTAssertEqual(response["text"] as? String, "Focused implementation work.")
        XCTAssertEqual(response["highlights"] as? [String], ["Built AI settings"])
        XCTAssertNil(response["uncertainties"])
    }

    func testAIServiceDailySummaryFailsCleanlyWithoutAskAIKey() async throws {
        let service = AIService(keyStore: FakeAPIKeyStore(keys: [:])) { request in
            XCTFail("Transport should not run without a saved key: \(request)")
            return (Data(), httpResponse(for: URL(string: "https://example.com")!, status: 200))
        }

        do {
            _ = try await service.dailySummary(payload: [
                "provider": "openai",
                "model": "gpt-daily",
                "date": "2026-06-07",
                "activitySummaries": []
            ])
            XCTFail("Expected missing key failure")
        } catch AIServiceError.missingAPIKey {
            // Expected.
        }
    }

    func testAIServiceGeneratesRollupSummaryWithAskAIProviderAndModel() async throws {
        let keyStore = FakeAPIKeyStore(keys: ["openai": "openai-key"])
        var capturedRequest: URLRequest?
        let service = AIService(keyStore: keyStore) { request in
            capturedRequest = request
            let data = #"{"output_text":"{\"text\":\"The week centered on Oriel rollups.\",\"highlights\":[\"Built weekly recap cards\"],\"metrics\":{\"version\":999}}"}"#.data(using: .utf8)!
            return (data, httpResponse(for: request.url!, status: 200))
        }

        let response = try await service.rollupSummary(payload: [
            "provider": "openai",
            "model": "gpt-rollup",
            "period": "week",
            "periodStart": "2026-06-01",
            "periodEnd": "2026-06-07",
            "dailySummaries": [[
                "date": "2026-06-01",
                "text": "You implemented rollup storage.",
                "highlights": ["Built rollup persistence"]
            ]],
            "periodContext": [
                "period": "week",
                "sourceDailyCount": 1,
                "metrics": [
                    "version": 1,
                    "totalRecordedMs": 3_600_000,
                    "longestFocusSession": [
                        "durationMs": 3_600_000,
                        "app": "Codex",
                        "label": "Oriel rollups"
                    ]
                ]
            ]
        ])

        XCTAssertEqual(capturedRequest?.url?.absoluteString, "https://api.openai.com/v1/responses")
        XCTAssertEqual(capturedRequest?.value(forHTTPHeaderField: "Authorization"), "Bearer openai-key")
        let requestBody = try XCTUnwrap(capturedRequest?.httpBody.flatMap { String(data: $0, encoding: .utf8) })
        XCTAssertTrue(requestBody.contains("weekly or monthly AI insights writer"))
        XCTAssertTrue(requestBody.contains("successful daily AI summaries"))
        XCTAssertTrue(requestBody.contains("Use periodContext.metrics as precomputed local context"))
        XCTAssertTrue(requestBody.contains("Selected period"))
        XCTAssertTrue(requestBody.contains("2026-06-01"))
        XCTAssertTrue(requestBody.contains("Built rollup persistence"))
        XCTAssertFalse(requestBody.contains("data:image"))
        XCTAssertFalse(requestBody.contains("base64"))
        XCTAssertEqual(response["text"] as? String, "The week centered on Oriel rollups.")
        XCTAssertEqual(response["highlights"] as? [String], ["Built weekly recap cards"])
        XCTAssertNil(response["metrics"])
    }

    func testAIServiceRollupSummaryFailsCleanlyWithoutAskAIKey() async throws {
        let service = AIService(keyStore: FakeAPIKeyStore(keys: [:])) { request in
            XCTFail("Transport should not run without a saved key: \(request)")
            return (Data(), httpResponse(for: URL(string: "https://example.com")!, status: 200))
        }

        do {
            _ = try await service.rollupSummary(payload: [
                "provider": "openai",
                "model": "gpt-rollup",
                "period": "month",
                "periodStart": "2026-06-01",
                "periodEnd": "2026-06-30",
                "dailySummaries": []
            ])
            XCTFail("Expected missing key failure")
        } catch AIServiceError.missingAPIKey {
            // Expected.
        }
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
