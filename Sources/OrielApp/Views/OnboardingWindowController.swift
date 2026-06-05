import AppKit

final class OnboardingWindowController: NSWindowController {
    init() {
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 530, height: 270),
            styleMask: [.titled, .closable],
            backing: .buffered,
            defer: false
        )
        window.title = "Welcome to Oriel"
        super.init(window: window)
        buildContent()
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    func present() {
        showWindow(nil)
        window?.center()
        NSApp.activate(ignoringOtherApps: true)
    }

    private func buildContent() {
        let heading = NSTextField(labelWithString: "Record your workday locally")
        heading.font = .systemFont(ofSize: 20, weight: .semibold)
        let copy = NSTextField(wrappingLabelWithString: "Oriel records foreground application activity on this Mac. Allow Accessibility access for Oriel.app to capture window titles. Tracking can continue at application level when permission is unavailable.")
        copy.textColor = .secondaryLabelColor
        copy.maximumNumberOfLines = 4

        let permissionButton = NSButton(title: "Open Accessibility Settings", target: self, action: #selector(openAccessibilitySettings))
        permissionButton.bezelStyle = .rounded
        let doneButton = NSButton(title: "Continue", target: self, action: #selector(closeOnboarding))
        doneButton.keyEquivalent = "\r"
        let actions = NSStackView(views: [permissionButton, doneButton])
        actions.orientation = .horizontal
        actions.spacing = 10

        let stack = NSStackView(views: [heading, copy, actions])
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 18
        stack.translatesAutoresizingMaskIntoConstraints = false
        guard let contentView = window?.contentView else { return }
        contentView.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 28),
            stack.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -28),
            stack.topAnchor.constraint(equalTo: contentView.topAnchor, constant: 30)
        ])
    }

    @objc private func openAccessibilitySettings() {
        let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")!
        NSWorkspace.shared.open(url)
    }

    @objc private func closeOnboarding() {
        UserDefaults.standard.set(true, forKey: "didPresentOrielOnboarding")
        close()
    }
}
