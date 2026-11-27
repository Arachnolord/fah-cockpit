// ============================================================================
// Erdacht und programmiert von Fabian Hammer, Deutschland.
// (c) 2026 Fabian Hammer - Alle Rechte vorbehalten. Geistiges Eigentum.
// ============================================================================
// Gemeinsame Hilfen: Einstellungen der App, Pfade, Befehle ausführen, JSON vom eigenen Dienst holen.

import AppKit
import Foundation

enum Einstellung {
    static let d = UserDefaults.standard
    static var heim: String { NSHomeDirectory() }
    static var port: Int { (d.object(forKey: "port") as? Int) ?? 8130 }
    static var projektordner: String {
        get { d.string(forKey: "projektordner") ?? heim + "/claude" }
        set { d.set(newValue, forKey: "projektordner") }
    }
    static var vault: String {
        get { d.string(forKey: "vault") ?? projektordner + "/Arbeit" }
        set { d.set(newValue, forKey: "vault") }
    }
    static var basis: URL { URL(string: "http://localhost:\(port)")! }
    static var einrichtungGesehen: Bool {
        get { d.bool(forKey: "einrichtungGesehen") }
        set { d.set(newValue, forKey: "einrichtungGesehen") }
    }
}

/// Suchpfad wie in einer Anmelde-Shell – Claude Code liegt meist in ~/.local/bin.
let suchpfad = [Einstellung.heim + "/.local/bin", "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"]

func finde(_ name: String) -> String? {
    for o in suchpfad {
        let p = o + "/" + name
        if FileManager.default.isExecutableFile(atPath: p) { return p }
    }
    return nil
}

/// Befehl ausführen und Ausgabe holen (nicht auf dem Hauptthread aufrufen).
@discardableResult
func ausfuehren(_ programm: String, _ args: [String], zeitMax: TimeInterval = 30) -> (code: Int32, aus: String) {
    let p = Process()
    p.executableURL = URL(fileURLWithPath: programm)
    p.arguments = args
    var env = ProcessInfo.processInfo.environment
    env["PATH"] = suchpfad.joined(separator: ":")
    p.environment = env
    let rohr = Pipe()
    p.standardOutput = rohr
    p.standardError = rohr
    p.standardInput = FileHandle.nullDevice
    do { try p.run() } catch { return (-1, error.localizedDescription) }
    let ende = Date().addingTimeInterval(zeitMax)
    var daten = Data()
    let leser = rohr.fileHandleForReading
    DispatchQueue.global().async { daten = leser.readDataToEndOfFile() }
    while p.isRunning && Date() < ende { Thread.sleep(forTimeInterval: 0.05) }
    if p.isRunning { p.terminate(); return (-2, "Zeitüberschreitung") }
    Thread.sleep(forTimeInterval: 0.05)
    return (p.terminationStatus, String(data: daten, encoding: .utf8) ?? "")
}

/// JSON vom eigenen Dienst holen (Host = localhost:<port>, wie es der Dienst verlangt).
func dienstJSON(_ pfad: String, zeitMax: TimeInterval = 4) async -> [String: Any]? {
    guard let url = URL(string: pfad, relativeTo: Einstellung.basis) else { return nil }
    var req = URLRequest(url: url, timeoutInterval: zeitMax)
    req.cachePolicy = .reloadIgnoringLocalCacheData
    guard let (daten, antwort) = try? await URLSession.shared.data(for: req),
          (antwort as? HTTPURLResponse)?.statusCode == 200 else { return nil }
    return (try? JSONSerialization.jsonObject(with: daten)) as? [String: Any]
}

/// POST an den eigenen Dienst (mit dem Kopf, den die Oberfläche auch schickt).
func dienstSenden(_ pfad: String, _ koerper: [String: Any]) async -> Bool {
    guard let url = URL(string: pfad, relativeTo: Einstellung.basis) else { return false }
    var req = URLRequest(url: url, timeoutInterval: 10)
    req.httpMethod = "POST"
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    req.setValue("1", forHTTPHeaderField: "X-Cockpit")
    req.httpBody = try? JSONSerialization.data(withJSONObject: koerper)
    guard let (_, antwort) = try? await URLSession.shared.data(for: req) else { return false }
    return (antwort as? HTTPURLResponse)?.statusCode == 200
}

func oeffnen(_ s: String) { if let u = URL(string: s) { NSWorkspace.shared.open(u) } }
