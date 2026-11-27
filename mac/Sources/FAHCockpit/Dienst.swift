// ============================================================================
// Erdacht und programmiert von Fabian Hammer, Deutschland.
// (c) 2026 Fabian Hammer - Alle Rechte vorbehalten. Geistiges Eigentum.
// ============================================================================
// Der Cockpit-Dienst (Node) läuft als Kind der App: Node und Code liegen im App-Paket (Contents/Resources/node,
// Contents/Resources/cockpit). Stürzt er ab, startet die App ihn neu. Läuft noch der alte LaunchAgent, nutzt die App
// diesen, bis die Einrichtung ihn übernimmt.

import AppKit
import Foundation

final class Dienst {
    static let shared = Dienst()
    private var prozess: Process?
    private var neustarts: [Date] = []
    private(set) var meldung = ""
    private var beendenGewollt = false

    let altePlist = Einstellung.heim + "/Library/LaunchAgents/de.fah.cockpit.plist"
    var alterDienstDa: Bool { FileManager.default.fileExists(atPath: altePlist) }
    var eigenerLaeuft: Bool { prozess?.isRunning == true }

    private var ressourcen: URL { Bundle.main.resourceURL ?? URL(fileURLWithPath: ".") }
    var nodePfad: String { ressourcen.appendingPathComponent("node/bin/node").path }
    var serverPfad: String { ressourcen.appendingPathComponent("cockpit/src/server.js").path }

    /// Antwortet überhaupt ein Dienst auf dem Port (eigener oder alter LaunchAgent)?
    func antwortet() async -> Bool { await dienstJSON("/api/auftraege", zeitMax: 2) != nil }

    var appVersion: String { Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "" }

    func starten() {
        Task {
            if await antwortet() {
                if alterDienstDa { meldung = "alter Hintergrunddienst läuft"; return }
                if eigenerLaeuft { meldung = "läuft"; return }
                // Ein Dienst ohne App (z. B. nach hartem Beenden verwaist oder von einer älteren Version):
                // ablösen, damit immer der Code dieser App läuft – nur wenn gerade kein Auftrag arbeitet.
                let v = await dienstJSON("/api/version")
                if let a = await dienstJSON("/api/auftraege"), (a["laeuft"] as? Int ?? 0) > 0 || (a["schlange"] as? Int ?? 0) > 0 {
                    meldung = "älterer Dienst läuft noch (Auftrag aktiv) – wird danach abgelöst"
                    DispatchQueue.main.asyncAfter(deadline: .now() + 60) { [weak self] in self?.starten() }
                    return
                }
                if let pid = v?["pid"] as? Int, pid > 1 { kill(pid_t(pid), SIGTERM) }
                else if let pid = verwaisterNode() { kill(pid, SIGTERM) }
                for _ in 0..<40 { if !(await antwortet()) { break }; try? await Task.sleep(nanoseconds: 250_000_000) }
                if await antwortet() { meldung = "fremder Dienst auf Port \(Einstellung.port) – nicht ersetzt"; return }
            }
            await MainActor.run { self.beendenGewollt = false; self.prozessStarten() }
        }
    }

    /// Node-Prozess aus einem FAH-Cockpit-App-Paket (für Dienste vor 0.10.3 ohne /api/version).
    private func verwaisterNode() -> pid_t? {
        let r = ausfuehren("/usr/bin/pgrep", ["-f", "FAH-Cockpit.app/Contents/Resources/node/bin/node"], zeitMax: 5)
        return r.aus.split(separator: "\n").compactMap { pid_t($0.trimmingCharacters(in: .whitespaces)) }.first
    }

    private func prozessStarten() {
        guard FileManager.default.isExecutableFile(atPath: nodePfad), FileManager.default.fileExists(atPath: serverPfad) else {
            meldung = "Node oder Cockpit-Code fehlt im App-Paket"; return
        }
        let p = Process()
        p.executableURL = URL(fileURLWithPath: nodePfad)
        p.arguments = [serverPfad]
        var env = ProcessInfo.processInfo.environment
        env["PATH"] = suchpfad.joined(separator: ":")
        env["HOME"] = Einstellung.heim
        env["COCKPIT_PORT"] = String(Einstellung.port)
        env["COCKPIT_WURZEL"] = Einstellung.projektordner
        env["COCKPIT_VAULT"] = Einstellung.vault
        env["COCKPIT_MITTEILUNGEN"] = "app"          // Mitteilungen macht die App selbst (anklickbar)
        p.environment = env
        p.currentDirectoryURL = URL(fileURLWithPath: Einstellung.heim)
        let logPfad = Einstellung.heim + "/Library/Logs/fah-cockpit.log"
        if !FileManager.default.fileExists(atPath: logPfad) { FileManager.default.createFile(atPath: logPfad, contents: nil) }
        if let log = FileHandle(forWritingAtPath: logPfad) { log.seekToEndOfFile(); p.standardOutput = log; p.standardError = log }
        p.standardInput = FileHandle.nullDevice
        p.terminationHandler = { [weak self] _ in
            DispatchQueue.main.async { self?.beendet() }
        }
        do { try p.run(); prozess = p; meldung = "läuft" } catch { meldung = "Start fehlgeschlagen: \(error.localizedDescription)" }
    }

    private func beendet() {
        prozess = nil
        if beendenGewollt { return }
        neustarts = neustarts.filter { $0.timeIntervalSinceNow > -60 } + [Date()]
        if neustarts.count > 5 { meldung = "Dienst stürzt immer wieder ab – siehe ~/Library/Logs/fah-cockpit.log"; return }
        meldung = "wird neu gestartet …"
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self] in self?.prozessStarten() }
    }

    func neuStarten() {
        guard let p = prozess else { starten(); return }
        p.terminate()                                   // terminationHandler startet neu
    }

    func beenden() {
        beendenGewollt = true
        prozess?.terminate()
    }

    /// Den alten LaunchAgent (aus werkzeuge/installieren.sh) ablösen und selbst übernehmen.
    func alterDienstUebernehmen() async -> String {
        if let a = await dienstJSON("/api/auftraege"), (a["laeuft"] as? Int ?? 0) > 0 || (a["schlange"] as? Int ?? 0) > 0 {
            return "Es läuft gerade ein Auftrag – übernehme, sobald er fertig ist."
        }
        let uid = getuid()
        ausfuehren("/bin/launchctl", ["bootout", "gui/\(uid)/de.fah.cockpit"])
        try? FileManager.default.removeItem(atPath: altePlist)
        for _ in 0..<40 { if !(await antwortet()) { break }; try? await Task.sleep(nanoseconds: 250_000_000) }
        await MainActor.run { self.beendenGewollt = false; self.prozessStarten() }
        return "Übernommen – der Dienst läuft jetzt in der App."
    }
}
