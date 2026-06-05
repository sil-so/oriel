import Foundation
import WebKit

final class OrielBridge: NSObject, WKScriptMessageHandlerWithReply {
    private let store: SQLiteStore
    private let aiService: AIService
    private let logoDevKeyService: LogoDevKeyService
    private let statusProvider: () -> [String: Any]
    private let currentActivityProvider: ([String: Any]) -> [String: Any]?
    private let passiveReviewResolver: ([String: Any]) throws -> [String: Any]
    private let beforeMutationHandler: (String) -> Void
    private let privacyMutationHandler: (String, [String: Any]) -> Void

    init(
        store: SQLiteStore,
        aiService: AIService = AIService(),
        logoDevKeyService: LogoDevKeyService = LogoDevKeyService(),
        statusProvider: @escaping () -> [String: Any],
        currentActivityProvider: @escaping ([String: Any]) -> [String: Any]? = { _ in nil },
        passiveReviewResolver: @escaping ([String: Any]) throws -> [String: Any] = { _ in ["resolved": false] },
        beforeMutationHandler: @escaping (String) -> Void = { _ in },
        privacyMutationHandler: @escaping (String, [String: Any]) -> Void = { _, _ in }
    ) {
        self.store = store
        self.aiService = aiService
        self.logoDevKeyService = logoDevKeyService
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

        if operation == "ai.chat" || operation == "ai.models.list" {
            Task {
                do {
                    let value = operation == "ai.chat"
                        ? try await aiService.chat(payload: payload)
                        : try await aiService.listModels(payload: payload)
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
            "aiAnthropicModel": settings["aiAnthropicModel"] as? String ?? "claude-sonnet-4-20250514"
        ]
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
