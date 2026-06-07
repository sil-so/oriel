import AppKit
import Foundation

struct CapturedActivityScreenshot {
    let jpegData: Data
    let width: Int
    let height: Int
    let displayID: String?
}

protocol ActivityScreenshotCapturing {
    func hasScreenRecordingPermission() -> Bool
    func captureMainDisplay(maxPixelWidth: CGFloat, jpegQuality: CGFloat) throws -> CapturedActivityScreenshot
}

enum ActivityScreenshotCaptureError: Error, LocalizedError {
    case screenRecordingPermissionMissing
    case captureFailed
    case encodingFailed

    var errorDescription: String? {
        switch self {
        case .screenRecordingPermissionMissing:
            return "Screen Recording permission is required for screenshot summaries."
        case .captureFailed:
            return "Oriel could not capture a screenshot for this activity."
        case .encodingFailed:
            return "Oriel could not compress the screenshot."
        }
    }
}

final class ActivityScreenshotCapture: ActivityScreenshotCapturing {
    func hasScreenRecordingPermission() -> Bool {
        CGPreflightScreenCaptureAccess()
    }

    func captureMainDisplay(maxPixelWidth: CGFloat = 1280, jpegQuality: CGFloat = 0.62) throws -> CapturedActivityScreenshot {
        guard hasScreenRecordingPermission() else {
            throw ActivityScreenshotCaptureError.screenRecordingPermissionMissing
        }
        guard let image = CGDisplayCreateImage(CGMainDisplayID()) else {
            throw ActivityScreenshotCaptureError.captureFailed
        }

        let sourceWidth = CGFloat(image.width)
        let sourceHeight = CGFloat(image.height)
        let scale = min(1, maxPixelWidth / max(1, sourceWidth))
        let width = Int((sourceWidth * scale).rounded())
        let height = Int((sourceHeight * scale).rounded())
        let bitmap = NSBitmapImageRep(
            bitmapDataPlanes: nil,
            pixelsWide: width,
            pixelsHigh: height,
            bitsPerSample: 8,
            samplesPerPixel: 4,
            hasAlpha: true,
            isPlanar: false,
            colorSpaceName: .deviceRGB,
            bytesPerRow: 0,
            bitsPerPixel: 0
        )
        guard let bitmap, let context = NSGraphicsContext(bitmapImageRep: bitmap)?.cgContext else {
            throw ActivityScreenshotCaptureError.encodingFailed
        }
        context.interpolationQuality = .medium
        context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
        guard let data = bitmap.representation(using: .jpeg, properties: [.compressionFactor: jpegQuality]) else {
            throw ActivityScreenshotCaptureError.encodingFailed
        }
        return CapturedActivityScreenshot(
            jpegData: data,
            width: width,
            height: height,
            displayID: String(CGMainDisplayID())
        )
    }
}
