import Foundation
import XCTest
@testable import OrielApp

final class ActivitySummaryClientTests: XCTestCase {
    func testProviderSpecificScreenshotSummaryPayloads() async throws {
        for provider in ["openai", "google", "anthropic", "openrouter"] {
            let keyStore = SummaryFakeAPIKeyStore(keys: [provider: "test-key"])
            var capturedRequest: URLRequest?
            let client = ProviderActivitySummaryClient(keyStore: keyStore) { request in
                capturedRequest = request
                return (self.successResponseData(for: provider), summaryHTTPResponse(for: request.url!, status: 200))
            }

            let response = try await client.summarize(summaryRequest(provider: provider))

            let request = try XCTUnwrap(capturedRequest)
            let body = try XCTUnwrap(request.httpBody.flatMap { String(data: $0, encoding: .utf8) })
            XCTAssertEqual(response.summary["app"] as? String, "Safari")
            XCTAssertEqual(response.summary["bundle_id"] as? String, "com.apple.Safari")
            XCTAssertTrue(body.contains("activity-test"))
            XCTAssertTrue(body.contains("9j"))

            switch provider {
            case "openai":
                XCTAssertEqual(request.url?.absoluteString, "https://api.openai.com/v1/responses")
                XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer test-key")
                XCTAssertTrue(body.contains("\"type\":\"input_image\""))
                XCTAssertTrue(body.contains("data:image"))
                XCTAssertTrue(body.contains("\"type\":\"json_schema\""))
                XCTAssertTrue(body.contains("\"name\":\"activity_summary\""))
            case "google":
                XCTAssertEqual(request.url?.absoluteString, "https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent")
                XCTAssertEqual(request.value(forHTTPHeaderField: "x-goog-api-key"), "test-key")
                XCTAssertTrue(body.contains("\"inline_data\""))
                XCTAssertTrue(body.contains("\"data\""))
                XCTAssertTrue(body.contains("\"responseMimeType\":\"application\\/json\"") || body.contains("\"responseMimeType\":\"application/json\""))
                XCTAssertTrue(body.contains("\"responseSchema\""))
            case "anthropic":
                XCTAssertEqual(request.url?.absoluteString, "https://api.anthropic.com/v1/messages")
                XCTAssertEqual(request.value(forHTTPHeaderField: "x-api-key"), "test-key")
                XCTAssertEqual(request.value(forHTTPHeaderField: "anthropic-version"), "2023-06-01")
                XCTAssertTrue(body.contains("\"type\":\"image\""))
                XCTAssertTrue(body.contains("\"data\""))
                XCTAssertTrue(body.contains("\"tools\""))
                XCTAssertTrue(body.contains("\"tool_choice\""))
            case "openrouter":
                XCTAssertEqual(request.url?.absoluteString, "https://openrouter.ai/api/v1/chat/completions")
                XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer test-key")
                XCTAssertTrue(body.contains("\"image_url\""))
                XCTAssertTrue(body.contains("data:image"))
                XCTAssertTrue(body.contains("\"allow_fallbacks\":false"))
                XCTAssertTrue(body.contains("\"type\":\"json_schema\""))
                XCTAssertTrue(body.contains("\"json_schema\""))
            default:
                XCTFail("Unexpected provider \(provider)")
            }
        }
    }

    func testProviderErrorsAreNormalizedWithoutRequestBodyOrKey() async throws {
        let client = ProviderActivitySummaryClient(keyStore: SummaryFakeAPIKeyStore(keys: ["openrouter": "secret-key"])) { request in
            let data = #"{"error":{"code":"rate_limited","message":"Slow down"}}"#.data(using: .utf8)!
            return (data, summaryHTTPResponse(for: request.url!, status: 429))
        }

        do {
            _ = try await client.summarize(summaryRequest(provider: "openrouter"))
            XCTFail("Expected provider error")
        } catch ActivitySummaryClientError.providerError(let statusCode, let code, let message) {
            XCTAssertEqual(statusCode, 429)
            XCTAssertEqual(code, "rate_limited")
            XCTAssertEqual(message, "Slow down")
            XCTAssertFalse(message.contains("secret-key"))
            XCTAssertFalse(message.contains("data:image"))
        }
    }

    private func summaryRequest(provider: String) -> ActivitySummaryRequest {
        let model: String
        switch provider {
        case "openai":
            model = "gpt-test"
        case "google":
            model = "gemini-test"
        case "anthropic":
            model = "claude-test"
        default:
            model = "google/gemini-3.1-flash-lite"
        }
        return ActivitySummaryRequest(
            provider: provider,
            model: model,
            metadata: ActivitySummaryMetadata(
                activityID: "activity-test",
                captureTimestampISO: "2026-06-07T14:00:00Z",
                durationSeconds: 90,
                frontmostAppName: "Safari",
                bundleID: "com.apple.Safari",
                processID: 42,
                windowTitle: "Example",
                browserURL: "https://example.com/docs",
                browserDomain: "example.com",
                projectName: "Website",
                inputState: "hands_on",
                screenshotWidth: 640,
                screenshotHeight: 360,
                displayID: "1"
            ),
            jpegData: Data([0xff, 0xd8, 0xff, 0xdb]),
            timeoutSeconds: 12
        )
    }

    private func successResponseData(for provider: String) -> Data {
        let summary = """
        {"app":"Safari","bundle_id":"com.apple.Safari","window_or_page":"Example","project_or_context":"Website","activity":"Reading documentation","category":"research","action":"reading","objects":["documentation"],"confidence":0.82,"evidence":["browser page"],"uncertainties":[],"cloud_safe_summary":"Reviewed documentation.","sensitivity":"low","metadata_conflicts":[]}
        """
        switch provider {
        case "openai":
            return #"{"output_text":"\#(escaped(summary))"}"#.data(using: .utf8)!
        case "google":
            return #"{"candidates":[{"content":{"parts":[{"text":"\#(escaped(summary))"}]}}]}"#.data(using: .utf8)!
        case "anthropic":
            return #"{"content":[{"type":"tool_use","name":"record_activity_summary","input":\#(summary)}]}"#.data(using: .utf8)!
        default:
            return #"{"choices":[{"message":{"content":"\#(escaped(summary))"}}]}"#.data(using: .utf8)!
        }
    }

    private func escaped(_ value: String) -> String {
        let data = try! JSONEncoder().encode(value)
        let encoded = String(data: data, encoding: .utf8)!
        return String(encoded.dropFirst().dropLast())
    }
}

private final class SummaryFakeAPIKeyStore: APIKeyStore {
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

private func summaryHTTPResponse(for url: URL, status: Int) -> HTTPURLResponse {
    HTTPURLResponse(url: url, statusCode: status, httpVersion: nil, headerFields: nil)!
}
