import AppKit
import Foundation
import WebKit

final class OrielBridge: NSObject, WKScriptMessageHandlerWithReply {
    private let store: SQLiteStore
    private let aiService: AIService
    private let logoDevKeyService: LogoDevKeyService
    private let activitySummaryClient: ActivitySummaryClient
    private let screenshotCapture: ActivityScreenshotCapturing
    private let statusProvider: () -> [String: Any]
    private let currentActivityProvider: ([String: Any]) -> [String: Any]?
    private let passiveReviewResolver: ([String: Any]) throws -> [String: Any]
    private let beforeMutationHandler: (String) -> Void
    private let privacyMutationHandler: (String, [String: Any]) -> Void

    init(
        store: SQLiteStore,
        aiService: AIService = AIService(),
        logoDevKeyService: LogoDevKeyService = LogoDevKeyService(),
        activitySummaryClient: ActivitySummaryClient = ProviderActivitySummaryClient(),
        screenshotCapture: ActivityScreenshotCapturing = ActivityScreenshotCapture(),
        statusProvider: @escaping () -> [String: Any],
        currentActivityProvider: @escaping ([String: Any]) -> [String: Any]? = { _ in nil },
        passiveReviewResolver: @escaping ([String: Any]) throws -> [String: Any] = { _ in ["resolved": false] },
        beforeMutationHandler: @escaping (String) -> Void = { _ in },
        privacyMutationHandler: @escaping (String, [String: Any]) -> Void = { _, _ in }
    ) {
        self.store = store
        self.aiService = aiService
        self.logoDevKeyService = logoDevKeyService
        self.activitySummaryClient = activitySummaryClient
        self.screenshotCapture = screenshotCapture
        self.statusProvider = statusProvider
        self.currentActivityProvider = currentActivityProvider
        self.passiveReviewResolver = passiveReviewResolver
        self.beforeMutationHandler = beforeMutationHandler
        self.privacyMutationHandler = privacyMutationHandler
    }

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage,
        replyHandler: @escaping (Any?, String?) -> Void
    ) {
        guard let request = message.body as? [String: Any],
              let operation = request["operation"] as? String,
              operation.count <= 80,
              let payload = request["payload"] as? [String: Any] else {
            replyHandler(errorReply(code: "invalid_request", message: "Malformed Oriel bridge request."), nil)
            return
        }

        if operation == "ai.chat" || operation == "ai.models.list" || operation == "ai.screenshotSummary.test" || operation == "dailyAISummaries.generate" {
            Task {
                do {
                    let value: Any
                    if operation == "ai.chat" {
                        value = try await aiService.chat(payload: payload)
                    } else if operation == "ai.models.list" {
                        value = try await aiService.listModels(payload: payload)
                    } else if operation == "dailyAISummaries.generate" {
                        value = try await generateDailyAISummary(payload: payload)
                    } else {
                        value = try await testScreenshotSummary(payload: payload)
                    }
                    replyHandler(["ok": true, "value": value], nil)
                } catch {
                    replyHandler(errorReply(code: "ai_failure", message: error.localizedDescription), nil)
                }
            }
            return
        }

        do {
            let value: Any
            if operation == "status.get" {
                value = statusProvider()
            } else if operation == "passiveReview.resolve" {
                value = try passiveReviewResolver(payload)
            } else if operation == "ai.keys.status" {
                value = aiService.keyStatus()
            } else if operation == "ai.keys.save" {
                let provider = payload["provider"] as? String ?? ""
                let apiKey = payload["apiKey"] as? String ?? ""
                value = try aiService.saveKey(provider: provider, apiKey: apiKey)
            } else if operation == "ai.keys.delete" {
                let provider = payload["provider"] as? String ?? ""
                value = try aiService.deleteKey(provider: provider)
            } else if operation == "system.openScreenRecordingSettings" {
                value = openScreenRecordingSettings()
            } else if operation == "logoDev.key.status" {
                value = logoDevKeyService.keyStatus()
            } else if operation == "logoDev.key.save" {
                let apiKey = payload["apiKey"] as? String ?? ""
                value = try logoDevKeyService.saveKey(apiKey: apiKey)
            } else if operation == "logoDev.key.delete" {
                value = try logoDevKeyService.deleteKey()
            } else if operation == "ai.settings.get" {
                value = try aiSettings()
            } else if operation == "ai.settings.update" {
                _ = try store.request(operation: "settings.update", payload: payload)
                value = try aiSettings()
            } else if operation == "activities.list" {
                var activities = try store.request(operation: operation, payload: payload) as? [[String: Any]] ?? []
                if let current = currentActivityProvider(payload) {
                    activities.append(current)
                }
                value = activities
            } else {
                if ["exclusions.create", "exclusions.delete"].contains(operation) {
                    beforeMutationHandler(operation)
                }
                value = try store.request(operation: operation, payload: payload)
                privacyMutationHandler(operation, payload)
            }
            replyHandler(["ok": true, "value": value], nil)
        } catch let storeError as OrielStoreError {
            replyHandler(errorReply(code: "invalid_operation", message: storeError.localizedDescription), nil)
        } catch let aiError as AIServiceError {
            replyHandler(errorReply(code: "ai_failure", message: aiError.localizedDescription), nil)
        } catch let logoDevError as LogoDevKeyServiceError {
            replyHandler(errorReply(code: "logo_dev_key_failure", message: logoDevError.localizedDescription), nil)
        } catch let keychainError as KeychainStoreError {
            replyHandler(errorReply(code: "keychain_failure", message: keychainError.localizedDescription), nil)
        } catch {
            replyHandler(errorReply(code: "storage_failure", message: "Oriel could not complete the request."), nil)
        }
    }

    private func aiSettings() throws -> [String: Any] {
        let settings = try store.request(operation: "settings.get", payload: [:]) as? [String: Any] ?? [:]
        return [
            "aiProvider": settings["aiProvider"] as? String ?? "",
            "aiOpenAIModel": settings["aiOpenAIModel"] as? String ?? "gpt-5.2",
            "aiGoogleModel": settings["aiGoogleModel"] as? String ?? "gemini-3.5-flash",
            "aiAnthropicModel": settings["aiAnthropicModel"] as? String ?? "claude-sonnet-4-20250514",
            "aiOpenRouterModel": settings["aiOpenRouterModel"] as? String ?? "google/gemini-3.1-flash-lite",
            "aiScreenshotProvider": settings["aiScreenshotProvider"] as? String ?? "",
            "aiScreenshotSummariesEnabled": settings["aiScreenshotSummariesEnabled"] as? Bool ?? false,
            "aiScreenshotFrequencyPreset": settings["aiScreenshotFrequencyPreset"] as? String ?? "balanced",
            "aiScreenshotDailyCap": settings["aiScreenshotDailyCap"] as? Int ?? 100,
            "aiScreenshotTimeoutSeconds": settings["aiScreenshotTimeoutSeconds"] as? Int ?? 20,
            "aiScreenshotModelMode": settings["aiScreenshotModelMode"] as? String ?? "askAI",
            "aiScreenshotOpenAIModel": settings["aiScreenshotOpenAIModel"] as? String ?? "gpt-5.2",
            "aiScreenshotGoogleModel": settings["aiScreenshotGoogleModel"] as? String ?? "gemini-3.5-flash",
            "aiScreenshotAnthropicModel": settings["aiScreenshotAnthropicModel"] as? String ?? "claude-sonnet-4-20250514",
            "aiScreenshotOpenRouterModel": settings["aiScreenshotOpenRouterModel"] as? String ?? "google/gemini-3.1-flash-lite",
            "aiScreenshotSensitiveApps": settings["aiScreenshotSensitiveApps"] as? [String] ?? []
        ]
    }

    func generateDailyAISummary(payload: [String: Any]) async throws -> [String: Any] {
        let date = stringValue(payload["date"]) ?? todayString()
        let activitySummaries = try store.request(operation: "activityAISummaries.list", payload: ["date": date]) as? [[String: Any]] ?? []
        let succeededSummaries = activitySummaries.filter { ($0["status"] as? String) == "succeeded" }
        if succeededSummaries.isEmpty {
            try store.upsertDailyAISummary([
                "date": date,
                "status": "empty",
                "sourceSummaryCount": 0
            ])
            return try store.request(operation: "dailyAISummaries.get", payload: ["date": date]) as? [String: Any] ?? [:]
        }

        let settings = try store.request(operation: "settings.get", payload: [:]) as? [String: Any] ?? [:]
        guard let provider = AIProvider.normalize(settings["aiProvider"] as? String ?? "") else {
            try store.upsertDailyAISummary([
                "date": date,
                "status": "failed",
                "errorCode": "missing_provider",
                "errorMessage": "Choose an Ask AI provider before generating daily AI summaries.",
                "sourceSummaryCount": succeededSummaries.count
            ])
            return try store.request(operation: "dailyAISummaries.get", payload: ["date": date]) as? [String: Any] ?? [:]
        }
        let model = askAIModel(provider: provider, settings: settings)
        do {
            let activities = try store.request(operation: "activities.list", payload: ["date": date]) as? [[String: Any]] ?? []
            let timeEntries = try store.request(operation: "entries.list", payload: ["date": date]) as? [[String: Any]] ?? []
            let context = DailySummaryContextBuilder.build(
                date: date,
                activitySummaries: succeededSummaries.map(sanitizedDailySummarySource),
                activities: activities,
                timeEntries: timeEntries,
                recentDailySummaries: try recentDailySummaries(before: date)
            )
            let summary = try await aiService.dailySummary(payload: [
                "provider": provider.rawValue,
                "model": model,
                "date": date,
                "activitySummaries": context.activitySummaries,
                "dayContext": context.dayContext
            ])
            try store.upsertDailyAISummary([
                "date": date,
                "status": "succeeded",
                "provider": provider.rawValue,
                "model": model,
                "summary": summary,
                "sourceSummaryCount": succeededSummaries.count
            ])
        } catch {
            try store.upsertDailyAISummary([
                "date": date,
                "status": "failed",
                "provider": provider.rawValue,
                "model": model,
                "errorCode": "ai_failure",
                "errorMessage": error.localizedDescription,
                "sourceSummaryCount": succeededSummaries.count
            ])
        }
        return try store.request(operation: "dailyAISummaries.get", payload: ["date": date]) as? [String: Any] ?? [:]
    }

    private func askAIModel(provider: AIProvider, settings: [String: Any]) -> String {
        let key: String
        switch provider {
        case .openai:
            key = "aiOpenAIModel"
        case .google:
            key = "aiGoogleModel"
        case .anthropic:
            key = "aiAnthropicModel"
        case .openrouter:
            key = "aiOpenRouterModel"
        }
        return stringValue(settings[key]) ?? provider.defaultModel
    }

    private func sanitizedDailySummarySource(_ row: [String: Any]) -> [String: Any] {
        [
            "activityId": row["activityId"] as? String ?? "",
            "start": row["start"] ?? 0,
            "end": row["end"] ?? 0,
            "app": row["app"] as? String ?? "",
            "title": row["title"] as? String ?? "",
            "summary": row["summary"] as? [String: Any] ?? [:]
        ]
    }

    private func recentDailySummaries(before date: String) throws -> [[String: Any]] {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.dateFormat = "yyyy-MM-dd"
        guard let selectedDate = formatter.date(from: date),
              let endDate = formatter.calendar.date(byAdding: .day, value: -1, to: selectedDate),
              let startDate = formatter.calendar.date(byAdding: .day, value: -14, to: selectedDate) else {
            return []
        }
        let rows = try store.request(operation: "dailyAISummaries.list", payload: [
            "startDate": formatter.string(from: startDate),
            "endDate": formatter.string(from: endDate)
        ]) as? [[String: Any]] ?? []
        return rows.filter { ($0["status"] as? String) == "succeeded" }
    }

    private func testScreenshotSummary(payload: [String: Any]) async throws -> [String: Any] {
        guard let provider = AIProvider.normalize(stringValue(payload["provider"]) ?? "") else {
            throw ActivitySummaryClientError.unsupportedProvider
        }
        let model = stringValue(payload["model"]) ?? provider.defaultModel
        let timeoutSeconds = clampedInt(payload["timeoutSeconds"], defaultValue: 20, min: 5, max: 60)
        let screenshot = try screenshotCapture.captureMainDisplay(maxPixelWidth: 1280, jpegQuality: 0.62)
        let activity = currentActivityProvider(["date": todayString()]) ?? [:]
        let app = stringValue(activity["app"]) ?? "Oriel"
        let title = stringValue(activity["title"]) ?? app
        let url = stringValue(activity["url"])
        let start = intValue(activity["start"])
        let end = intValue(activity["end"])
        let metadata = ActivitySummaryMetadata(
            activityID: "test-\(UUID().uuidString.lowercased())",
            captureTimestampISO: ISO8601DateFormatter().string(from: Date()),
            durationSeconds: start.flatMap { start in end.map { max(0, Int(($0 - start) / 1000)) } },
            frontmostAppName: app,
            bundleID: stringValue(activity["bundleId"]) ?? "",
            processID: nil,
            windowTitle: title,
            browserURL: url,
            browserDomain: browserDomain(from: url),
            projectName: nil,
            inputState: snakeInputState(stringValue(activity["interactionState"]) ?? "unknown"),
            screenshotWidth: screenshot.width,
            screenshotHeight: screenshot.height,
            displayID: screenshot.displayID
        )
        let response = try await activitySummaryClient.summarize(ActivitySummaryRequest(
            provider: provider.rawValue,
            model: model,
            metadata: metadata,
            jpegData: screenshot.jpegData,
            timeoutSeconds: timeoutSeconds
        ))
        return [
            "tested": true,
            "provider": provider.rawValue,
            "model": model,
            "summary": response.summary,
            "imageWidth": screenshot.width,
            "imageHeight": screenshot.height,
            "compressedBytes": screenshot.jpegData.count
        ]
    }

    private func openScreenRecordingSettings() -> [String: Any] {
        if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture") {
            _ = NSWorkspace.shared.open(url)
        }
        return ["opened": true]
    }

    private func stringValue(_ value: Any?) -> String? {
        switch value {
        case let value as String:
            let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
            return trimmed.isEmpty ? nil : trimmed
        default:
            return nil
        }
    }

    private func intValue(_ value: Any?) -> Int64? {
        switch value {
        case let value as Int64:
            return value
        case let value as Int:
            return Int64(value)
        case let value as NSNumber:
            return value.int64Value
        case let value as String:
            return Int64(value)
        default:
            return nil
        }
    }

    private func clampedInt(_ value: Any?, defaultValue: Int, min: Int, max: Int) -> Int {
        let number: Int?
        switch value {
        case let value as Int:
            number = value
        case let value as Int64:
            number = Int(value)
        case let value as NSNumber:
            number = value.intValue
        case let value as String:
            number = Int(value)
        default:
            number = nil
        }
        return Swift.max(min, Swift.min(max, number ?? defaultValue))
    }

    private func browserDomain(from urlString: String?) -> String? {
        guard let urlString, let host = URL(string: urlString)?.host?.lowercased(), !host.isEmpty else {
            return nil
        }
        return host
    }

    private func snakeInputState(_ value: String) -> String {
        switch value {
        case "handsOn":
            return "hands_on"
        case "handsOff":
            return "hands_off"
        default:
            return value
        }
    }

    private func todayString() -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: Date())
    }

    private func errorReply(code: String, message: String) -> [String: Any] {
        [
            "ok": false,
            "error": [
                "code": code,
                "message": message
            ]
        ]
    }
}
