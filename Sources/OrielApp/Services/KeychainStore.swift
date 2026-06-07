import Foundation
import Security

protocol APIKeyStore {
    func save(apiKey: String, provider: String) throws
    func apiKey(for provider: String) throws -> String?
    func delete(provider: String) throws
    func hasKey(for provider: String) -> Bool
}

protocol LogoDevAPIKeyStore {
    func saveLogoDevAPIKey(_ apiKey: String) throws
    func logoDevAPIKey() throws -> String?
    func deleteLogoDevAPIKey() throws
    func hasLogoDevAPIKey() -> Bool
}

enum KeychainStoreError: LocalizedError {
    case invalidProvider
    case keychainFailure(OSStatus)

    var errorDescription: String? {
        switch self {
        case .invalidProvider:
            return "Unsupported AI provider."
        case .keychainFailure(let status):
            return "Keychain operation failed with status \(status)."
        }
    }
}

enum LogoDevKeyServiceError: LocalizedError {
    case invalidAPIKey

    var errorDescription: String? {
        switch self {
        case .invalidAPIKey:
            return "Paste a Logo.dev API key first."
        }
    }
}

final class LogoDevKeyService {
    private let keyStore: LogoDevAPIKeyStore

    init(keyStore: LogoDevAPIKeyStore = KeychainStore()) {
        self.keyStore = keyStore
    }

    func keyStatus() -> [String: Any] {
        ["saved": keyStore.hasLogoDevAPIKey()]
    }

    func saveKey(apiKey: String) throws -> [String: Any] {
        let trimmed = apiKey.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.hasPrefix("pk_") else {
            throw LogoDevKeyServiceError.invalidAPIKey
        }
        try keyStore.saveLogoDevAPIKey(trimmed)
        return keyStatus()
    }

    func deleteKey() throws -> [String: Any] {
        try keyStore.deleteLogoDevAPIKey()
        return keyStatus()
    }
}

final class KeychainStore: APIKeyStore, LogoDevAPIKeyStore {
    private let service: String
    private let logoDevAccount = "logo-dev"

    init(service: String = "so.sil.oriel.ai-keys") {
        self.service = service
    }

    func save(apiKey: String, provider: String) throws {
        let account = try normalizedProvider(provider)
        try saveSecret(apiKey, account: account)
    }

    func apiKey(for provider: String) throws -> String? {
        let account = try normalizedProvider(provider)
        return try secret(account: account)
    }

    func delete(provider: String) throws {
        let account = try normalizedProvider(provider)
        try deleteSecret(account: account)
    }

    func hasKey(for provider: String) -> Bool {
        (try? apiKey(for: provider))?.isEmpty == false
    }

    func saveLogoDevAPIKey(_ apiKey: String) throws {
        try saveSecret(apiKey, account: logoDevAccount)
    }

    func logoDevAPIKey() throws -> String? {
        try secret(account: logoDevAccount)
    }

    func deleteLogoDevAPIKey() throws {
        try deleteSecret(account: logoDevAccount)
    }

    func hasLogoDevAPIKey() -> Bool {
        (try? logoDevAPIKey())?.isEmpty == false
    }

    private func saveSecret(_ value: String, account: String) throws {
        let data = Data(value.utf8)
        try deleteSecret(account: account)

        var query = baseQuery(account: account)
        query[kSecValueData as String] = data
        query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly

        let status = SecItemAdd(query as CFDictionary, nil)
        guard status == errSecSuccess else {
            throw KeychainStoreError.keychainFailure(status)
        }
    }

    private func secret(account: String) throws -> String? {
        var query = baseQuery(account: account)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data else {
            throw KeychainStoreError.keychainFailure(status)
        }
        return String(data: data, encoding: .utf8)
    }

    private func deleteSecret(account: String) throws {
        let status = SecItemDelete(baseQuery(account: account) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw KeychainStoreError.keychainFailure(status)
        }
    }

    private func baseQuery(account: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
    }

    private func normalizedProvider(_ provider: String) throws -> String {
        guard let provider = AIProvider.normalize(provider) else {
            throw KeychainStoreError.invalidProvider
        }
        return provider.rawValue
    }
}
