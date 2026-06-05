// swift-tools-version: 5.10
import PackageDescription

let package = Package(
    name: "Oriel",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "OrielApp", targets: ["OrielApp"]),
        .executable(name: "OrielBrowserBridge", targets: ["OrielBrowserBridge"])
    ],
    targets: [
        .systemLibrary(
            name: "CSQLite",
            path: "Sources/CSQLite"
        ),
        .executableTarget(
            name: "OrielApp",
            dependencies: ["CSQLite"],
            path: "Sources/OrielApp",
            exclude: ["Support"],
            linkerSettings: [
                .linkedFramework("AppKit"),
                .linkedFramework("WebKit"),
                .linkedFramework("ServiceManagement"),
                .linkedFramework("ApplicationServices"),
                .linkedFramework("Security")
            ]
        ),
        .executableTarget(
            name: "OrielBrowserBridge",
            path: "Sources/OrielBrowserBridge"
        ),
        .testTarget(
            name: "OrielAppTests",
            dependencies: ["OrielApp"],
            path: "Tests/OrielAppTests"
        )
    ]
)
