import AppKit
import ServiceManagement
import UniformTypeIdentifiers

final class PreferencesWindowController: NSWindowController {
    private let trackingController: TrackingController
    private let store: SQLiteStore
    private let browserCompanion: BrowserCompanionService?
    private let trackingCheckbox = NSButton(checkboxWithTitle: "Enable activity tracking", target: nil, action: nil)
    private let loginCheckbox = NSButton(checkboxWithTitle: "Start Oriel at Login", target: nil, action: nil)
    private let extensionIdentifierField = NSTextField(string: "")
    private let browserStatusLabel = NSTextField(labelWithString: "Not configured")

    init(trackingController: TrackingController, store: SQLiteStore, browserCompanion: BrowserCompanionService?) {
        self.trackingController = trackingController
        self.store = store
        self.browserCompanion = browserCompanion
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 570, height: 390),
            styleMask: [.titled, .closable],
            backing: .buffered,
            defer: false
        )
        window.title = "Oriel Preferences"
        super.init(window: window)
        buildContent()
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    func present() {
        trackingCheckbox.state = trackingController.isPaused ? .off : .on
        loginCheckbox.state = SMAppService.mainApp.status == .enabled ? .on : .off
        extensionIdentifierField.stringValue = UserDefaults.standard.string(forKey: "browserExtensionIdentifier") ?? ""
        updateBrowserStatus()
        showWindow(nil)
        window?.center()
        NSApp.activate(ignoringOtherApps: true)
    }

    private func buildContent() {
        let heading = NSTextField(labelWithString: "Oriel Preferences")
        heading.font = .systemFont(ofSize: 17, weight: .semibold)
        let note = NSTextField(wrappingLabelWithString: "Recorded activity remains on this Mac. Browser brand icons are disabled unless explicitly enabled in the Oriel interface.")
        note.textColor = .secondaryLabelColor
        note.maximumNumberOfLines = 3

        trackingCheckbox.target = self
        trackingCheckbox.action = #selector(toggleTracking)
        loginCheckbox.target = self
        loginCheckbox.action = #selector(toggleLoginItem)

        let dataHeading = NSTextField(labelWithString: "Data Backup")
        dataHeading.font = .systemFont(ofSize: 13, weight: .semibold)
        let dataNote = NSTextField(wrappingLabelWithString: "Export a portable archive or restore one you previously exported. Restoring replaces the current local database after confirmation.")
        dataNote.textColor = .secondaryLabelColor
        let exportButton = NSButton(title: "Export Archive...", target: self, action: #selector(exportArchive))
        let restoreButton = NSButton(title: "Restore Archive...", target: self, action: #selector(restoreArchive))
        let dataActions = NSStackView(views: [exportButton, restoreButton])
        dataActions.orientation = .horizontal
        dataActions.spacing = 8

        let browserHeading = NSTextField(labelWithString: "Developer Browser Companion")
        browserHeading.font = .systemFont(ofSize: 13, weight: .semibold)
        let browserNote = NSTextField(wrappingLabelWithString: "For unpacked Chrome/Brave extension testing, enter the extension identifier. Registration restricts the native host to that extension origin.")
        browserNote.textColor = .secondaryLabelColor
        browserStatusLabel.textColor = .secondaryLabelColor
        extensionIdentifierField.placeholderString = "Unpacked extension identifier"
        extensionIdentifierField.widthAnchor.constraint(equalToConstant: 310).isActive = true
        let browserButton = NSButton(title: "Enable Browser Tracking", target: self, action: #selector(enableBrowserTracking))
        let browserActions = NSStackView(views: [extensionIdentifierField, browserButton])
        browserActions.orientation = .horizontal
        browserActions.spacing = 8

        let stack = NSStackView(views: [
            heading, note, trackingCheckbox, loginCheckbox,
            browserHeading, browserNote, browserStatusLabel, browserActions,
            dataHeading, dataNote, dataActions
        ])
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 15
        stack.translatesAutoresizingMaskIntoConstraints = false
        guard let contentView = window?.contentView else { return }
        contentView.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 24),
            stack.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -24),
            stack.topAnchor.constraint(equalTo: contentView.topAnchor, constant: 24)
        ])
    }

    @objc private func toggleTracking() {
        let shouldTrack = trackingCheckbox.state == .on
        if shouldTrack == trackingController.isPaused {
            trackingController.togglePaused()
        }
        _ = try? store.request(operation: "settings.update", payload: ["trackingEnabled": shouldTrack])
    }

    @objc private func toggleLoginItem() {
        let shouldStart = loginCheckbox.state == .on
        do {
            if shouldStart {
                try SMAppService.mainApp.register()
            } else {
                try SMAppService.mainApp.unregister()
            }
            _ = try store.request(operation: "settings.update", payload: ["startAtLogin": shouldStart])
        } catch {
            loginCheckbox.state = shouldStart ? .off : .on
            presentAlert("Unable to change login item", message: error.localizedDescription)
        }
    }

    @objc private func enableBrowserTracking() {
        do {
            guard let browserCompanion else {
                throw BrowserCompanionError.bridgeNotBundled
            }
            let identifier = extensionIdentifierField.stringValue
            let manifests = try browserCompanion.installManifests(extensionIdentifier: identifier)
            UserDefaults.standard.set(identifier, forKey: "browserExtensionIdentifier")
            updateBrowserStatus()
            presentAlert(
                "Browser tracking configured",
                message: "Installed restricted Native Messaging manifests for Chrome and Brave:\n\(manifests.map(\.path).joined(separator: "\n"))"
            )
        } catch {
            presentAlert("Browser setup failed", message: error.localizedDescription)
        }
    }

    private func updateBrowserStatus() {
        let configured = !(UserDefaults.standard.string(forKey: "browserExtensionIdentifier") ?? "").isEmpty
        browserStatusLabel.stringValue = browserCompanion?.statusDescription(isConfigured: configured) ?? "Unavailable"
    }

    @objc private func exportArchive() {
        let panel = NSSavePanel()
        panel.title = "Export Oriel Data"
        panel.nameFieldStringValue = "Oriel-Export.json"
        panel.allowedContentTypes = [.json]
        guard let window else { return }
        panel.beginSheetModal(for: window) { [weak self] response in
            guard response == .OK, let destination = panel.url else { return }
            do {
                try self?.store.writePortableArchive(to: destination)
            } catch {
                self?.presentAlert("Export failed", message: error.localizedDescription)
            }
        }
    }

    @objc private func restoreArchive() {
        let panel = NSOpenPanel()
        panel.title = "Restore Oriel Data"
        panel.allowedContentTypes = [.json]
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = false
        guard let window else { return }
        panel.beginSheetModal(for: window) { [weak self] response in
            guard response == .OK, let source = panel.url else { return }
            self?.confirm(
                title: "Replace current Oriel data?",
                message: "Restoring a validated archive replaces recorded activity, time entries, projects, rules, exclusions, and portable preferences in the local database."
            ) {
                do {
                    try self?.store.restorePortableArchive(from: source)
                    self?.presentAlert("Restore completed", message: "The selected local Oriel archive was restored.")
                } catch {
                    self?.presentAlert("Restore failed", message: error.localizedDescription)
                }
            }
        }
    }

    private func confirm(title: String, message: String, action: @escaping () -> Void) {
        let alert = NSAlert()
        alert.messageText = title
        alert.informativeText = message
        alert.addButton(withTitle: "Continue")
        alert.addButton(withTitle: "Cancel")
        guard let window else { return }
        alert.beginSheetModal(for: window) { response in
            if response == .alertFirstButtonReturn {
                action()
            }
        }
    }

    private func presentAlert(_ title: String, message: String) {
        let alert = NSAlert()
        alert.messageText = title
        alert.informativeText = message
        if let window {
            alert.beginSheetModal(for: window)
        }
    }
}
