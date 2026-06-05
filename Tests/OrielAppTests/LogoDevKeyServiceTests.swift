import XCTest
@testable import OrielApp

final class LogoDevKeyServiceTests: XCTestCase {
    func testLogoDevKeyServiceTrimsSavesReportsAndDeletesKey() throws {
        let keyStore = FakeLogoDevKeyStore()
        let service = LogoDevKeyService(keyStore: keyStore)

        XCTAssertEqual(service.keyStatus()["saved"] as? Bool, false)
        XCTAssertThrowsError(try service.saveKey(apiKey: "  "))

        let saved = try service.saveKey(apiKey: "  pk_test_logo_dev  ")

        XCTAssertEqual(saved["saved"] as? Bool, true)
        XCTAssertEqual(keyStore.logoDevKey, "pk_test_logo_dev")
        XCTAssertEqual(service.keyStatus()["saved"] as? Bool, true)

        let deleted = try service.deleteKey()

        XCTAssertEqual(deleted["saved"] as? Bool, false)
        XCTAssertNil(keyStore.logoDevKey)
    }

    func testLogoDevKeyServiceRejectsSecretKeys() throws {
        let keyStore = FakeLogoDevKeyStore()
        let service = LogoDevKeyService(keyStore: keyStore)

        XCTAssertThrowsError(try service.saveKey(apiKey: "sk_test_secret"))
        XCTAssertNil(keyStore.logoDevKey)
    }
}

private final class FakeLogoDevKeyStore: LogoDevAPIKeyStore {
    var logoDevKey: String?

    func saveLogoDevAPIKey(_ apiKey: String) throws {
        logoDevKey = apiKey
    }

    func logoDevAPIKey() throws -> String? {
        logoDevKey
    }

    func deleteLogoDevAPIKey() throws {
        logoDevKey = nil
    }

    func hasLogoDevAPIKey() -> Bool {
        logoDevKey?.isEmpty == false
    }
}
