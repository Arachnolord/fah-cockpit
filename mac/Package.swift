// swift-tools-version:5.9
// (c) 2026 Fabian Hammer - Alle Rechte vorbehalten. FAH-Cockpit – Mac-App (Hülle um den Node-Dienst des Cockpits).
import PackageDescription

let package = Package(
    name: "FAHCockpit",
    platforms: [.macOS(.v14)],
    targets: [
        .executableTarget(name: "FAHCockpit", path: "Sources/FAHCockpit"),
    ]
)
