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
            contentRect: NSRect(x: 0, y: 0, width: 660, height: 465),
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
        trackingCheckbox.target = self
        trackingCheckbox.action = #selector(toggleTracking)
        loginCheckbox.target = self
        loginCheckbox.action = #selector(toggleLoginItem)

        let exportButton = NSButton(title: "Export Archive...", target: self, action: #selector(exportArchive))
        exportButton.bezelStyle = .rounded
        let restoreButton = NSButton(title: "Restore Archive...", target: self, action: #selector(restoreArchive))
        restoreButton.bezelStyle = .rounded
        let dataActions = NSStackView(views: [exportButton, restoreButton])
        dataActions.orientation = .horizontal
        dataActions.alignment = .centerY
        dataActions.spacing = 10

        browserStatusLabel.font = .systemFont(ofSize: 12)
        browserStatusLabel.textColor = .secondaryLabelColor
        extensionIdentifierField.placeholderString = "Unpacked extension identifier"
        extensionIdentifierField.font = .systemFont(ofSize: 13)
        extensionIdentifierField.widthAnchor.constraint(equalToConstant: 380).isActive = true
        let browserButton = NSButton(title: "Enable Browser Tracking", target: self, action: #selector(enableBrowserTracking))
        browserButton.bezelStyle = .rounded
        browserButton.widthAnchor.constraint(greaterThanOrEqualToConstant: 172).isActive = true
        let browserActions = NSStackView(views: [extensionIdentifierField, browserButton])
        browserActions.orientation = .horizontal
        browserActions.alignment = .centerY
        browserActions.spacing = 12

        let captureSection = makeSection(
            title: "Capture",
            views: [
                makeBodyLabel("Recorded activity remains on this Mac. Browser brand icons stay disabled unless you enable them in Oriel."),
                makeControlStack([trackingCheckbox, loginCheckbox])
            ]
        )
        let browserSection = makeSection(
            title: "Developer Browser Companion",
            views: [
                makeBodyLabel("For unpacked Chrome or Brave extension testing, enter the extension identifier. Registration restricts the native host to that extension origin."),
                browserStatusLabel,
                browserActions
            ]
        )
        let dataSection = makeSection(
            title: "Data Backup",
            views: [
                makeBodyLabel("Export a portable archive or restore one you previously exported. Restoring replaces the current local database after confirmation."),
                dataActions
            ]
        )
        let firstDivider = makeSeparator()
        let secondDivider = makeSeparator()

        let stack = NSStackView(views: [
            captureSection,
            firstDivider,
            browserSection,
            secondDivider,
            dataSection
        ])
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 18
        stack.translatesAutoresizingMaskIntoConstraints = false
        guard let contentView = window?.contentView else { return }
        contentView.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 28),
            stack.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -28),
            stack.topAnchor.constraint(equalTo: contentView.topAnchor, constant: 28),
            stack.bottomAnchor.constraint(lessThanOrEqualTo: contentView.bottomAnchor, constant: -28),
            captureSection.widthAnchor.constraint(equalTo: stack.widthAnchor),
            browserSection.widthAnchor.constraint(equalTo: stack.widthAnchor),
            dataSection.widthAnchor.constraint(equalTo: stack.widthAnchor),
            firstDivider.widthAnchor.constraint(equalTo: stack.widthAnchor),
            secondDivider.widthAnchor.constraint(equalTo: stack.widthAnchor)
        ])
    }

    private func makeSection(title: String, views: [NSView]) -> NSStackView {
        let heading = NSTextField(labelWithString: title)
        heading.font = .systemFont(ofSize: 13, weight: .semibold)
        heading.textColor = .labelColor

        let arrangedViews: [NSView] = [heading] + views
        let stack = NSStackView(views: arrangedViews)
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 10
        stack.translatesAutoresizingMaskIntoConstraints = false
        stack.setCustomSpacing(8, after: heading)
        for view in arrangedViews where view is NSTextField {
            view.widthAnchor.constraint(equalTo: stack.widthAnchor).isActive = true
        }
        return stack
    }

    private func makeBodyLabel(_ text: String) -> NSTextField {
        let label = NSTextField(wrappingLabelWithString: text)
        label.font = .systemFont(ofSize: 13)
        label.textColor = .secondaryLabelColor
        label.maximumNumberOfLines = 3
        label.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        return label
    }

    private func makeControlStack(_ controls: [NSView]) -> NSStackView {
        let stack = NSStackView(views: controls)
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 8
        return stack
    }

    private func makeSeparator() -> NSBox {
        let separator = NSBox()
        separator.boxType = .separator
        separator.translatesAutoresizingMaskIntoConstraints = false
        return separator
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
