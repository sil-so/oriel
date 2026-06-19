import AppKit
import Foundation

let arguments = CommandLine.arguments
if arguments.count < 3 {
    print("Usage: extract_icon <app_path> <output_png_path>")
    exit(1)
}

let appPath = arguments[1]
let outputPath = arguments[2]

func bundledIconPath(for appPath: String) -> String? {
    guard let bundle = Bundle(path: appPath),
          let iconName = bundle.object(forInfoDictionaryKey: "CFBundleIconFile") as? String else {
        return nil
    }

    let resourceName = iconName.hasSuffix(".icns") ? String(iconName.dropLast(5)) : iconName
    return bundle.path(forResource: resourceName, ofType: "icns")
}

let icon: NSImage
if let iconPath = bundledIconPath(for: appPath),
   let bundledIcon = NSImage(contentsOfFile: iconPath) {
    icon = bundledIcon
} else {
    icon = NSWorkspace.shared.icon(forFile: appPath)
}

let targetSize = NSSize(width: 128, height: 128)
let renderedIcon = NSImage(size: targetSize)
renderedIcon.lockFocus()
NSGraphicsContext.current?.imageInterpolation = .high
icon.draw(
    in: NSRect(origin: .zero, size: targetSize),
    from: .zero,
    operation: .sourceOver,
    fraction: 1.0
)
renderedIcon.unlockFocus()

if let tiffData = renderedIcon.tiffRepresentation,
   let bitmap = NSBitmapImageRep(data: tiffData),
   let pngData = bitmap.representation(using: .png, properties: [:]) {
    do {
        try pngData.write(to: URL(fileURLWithPath: outputPath))
        print("SUCCESS")
    } catch {
        print("FAILED: \(error)")
    }
} else {
    print("FAILED: representation error")
}
