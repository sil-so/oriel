import AppKit
import ApplicationServices
import CoreGraphics
import Foundation

enum ActiveDisplayResolver {
    struct Display {
        let id: CGDirectDisplayID
        let bounds: CGRect
    }

    static func resolveDisplayID(
        focusedWindowBounds: CGRect?,
        frontmostWindowBounds: [CGRect],
        pointerLocation: CGPoint?,
        displays: [Display]
    ) -> CGDirectDisplayID? {
        if let focusedWindowBounds,
           let displayID = displayID(forWindowBounds: focusedWindowBounds, displays: displays) {
            return displayID
        }

        let windowMatches = frontmostWindowBounds.compactMap { bounds -> (displayID: CGDirectDisplayID, visibleArea: CGFloat)? in
            guard let match = displayMatch(forWindowBounds: bounds, displays: displays) else { return nil }
            return (match.displayID, match.totalVisibleArea)
        }
        if let displayID = windowMatches.max(by: { $0.visibleArea < $1.visibleArea })?.displayID {
            return displayID
        }

        if let pointerLocation {
            return displays.first { $0.bounds.contains(pointerLocation) }?.id
        }

        return nil
    }

    static func resolveDisplayID(
        for application: NSRunningApplication,
        focusedWindow: AXUIElement?
    ) -> CGDirectDisplayID? {
        let displays = activeDisplays()
        guard !displays.isEmpty else { return nil }
        return resolveDisplayID(
            focusedWindowBounds: focusedWindow.flatMap(windowBounds),
            frontmostWindowBounds: frontmostWindowBounds(processID: application.processIdentifier),
            pointerLocation: currentPointerLocation(),
            displays: displays
        )
    }

    static func activeDisplays() -> [Display] {
        var count: UInt32 = 0
        guard CGGetActiveDisplayList(0, nil, &count) == .success, count > 0 else {
            return []
        }
        var ids = [CGDirectDisplayID](repeating: 0, count: Int(count))
        guard CGGetActiveDisplayList(count, &ids, &count) == .success else {
            return []
        }
        return ids
            .prefix(Int(count))
            .map { Display(id: $0, bounds: CGDisplayBounds($0)) }
            .filter { !$0.bounds.isNull && !$0.bounds.isEmpty }
    }

    static func windowBounds(_ window: AXUIElement) -> CGRect? {
        guard let positionValue = accessibilityValue(kAXPositionAttribute as CFString, from: window),
              let sizeValue = accessibilityValue(kAXSizeAttribute as CFString, from: window) else {
            return nil
        }
        var position = CGPoint.zero
        var size = CGSize.zero
        guard AXValueGetType(positionValue) == .cgPoint,
              AXValueGetType(sizeValue) == .cgSize,
              AXValueGetValue(positionValue, .cgPoint, &position),
              AXValueGetValue(sizeValue, .cgSize, &size),
              size.width > 0,
              size.height > 0 else {
            return nil
        }
        return CGRect(origin: position, size: size)
    }

    static func frontmostWindowBounds(processID: pid_t) -> [CGRect] {
        guard let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID)
            as? [[String: Any]] else {
            return []
        }

        return windows.compactMap { window in
            guard intValue(window[kCGWindowOwnerPID as String]) == Int(processID),
                  intValue(window[kCGWindowLayer as String]) == 0,
                  doubleValue(window[kCGWindowAlpha as String]) ?? 1 > 0,
                  let bounds = window[kCGWindowBounds as String] as? NSDictionary,
                  let rect = CGRect(dictionaryRepresentation: bounds),
                  rect.width > 0,
                  rect.height > 0 else {
                return nil
            }
            return rect
        }
    }

    static func currentPointerLocation() -> CGPoint? {
        CGEvent(source: nil)?.location
    }

    private static func displayID(forWindowBounds bounds: CGRect, displays: [Display]) -> CGDirectDisplayID? {
        displayMatch(forWindowBounds: bounds, displays: displays)?.displayID
    }

    private static func displayMatch(
        forWindowBounds bounds: CGRect,
        displays: [Display]
    ) -> (displayID: CGDirectDisplayID, totalVisibleArea: CGFloat)? {
        guard bounds.width > 0, bounds.height > 0 else { return nil }
        var best: (displayID: CGDirectDisplayID, overlapArea: CGFloat)?
        var totalVisibleArea: CGFloat = 0

        for display in displays {
            let intersection = display.bounds.intersection(bounds)
            guard !intersection.isNull, !intersection.isEmpty else { continue }
            let area = intersection.width * intersection.height
            totalVisibleArea += area
            if best == nil || area > best!.overlapArea {
                best = (display.id, area)
            }
        }

        guard let best else { return nil }
        return (best.displayID, totalVisibleArea)
    }

    private static func accessibilityValue(_ name: CFString, from element: AXUIElement) -> AXValue? {
        var result: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, name, &result) == .success,
              let value = result,
              CFGetTypeID(value) == AXValueGetTypeID() else {
            return nil
        }
        return (value as! AXValue)
    }

    private static func intValue(_ value: Any?) -> Int? {
        switch value {
        case let value as Int:
            return value
        case let value as Int32:
            return Int(value)
        case let value as Int64:
            return Int(value)
        case let value as UInt32:
            return Int(value)
        case let value as NSNumber:
            return value.intValue
        default:
            return nil
        }
    }

    private static func doubleValue(_ value: Any?) -> Double? {
        switch value {
        case let value as Double:
            return value
        case let value as CGFloat:
            return Double(value)
        case let value as NSNumber:
            return value.doubleValue
        default:
            return nil
        }
    }
}
