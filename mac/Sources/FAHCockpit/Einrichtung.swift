// ============================================================================
// Erdacht und programmiert von Fabian Hammer, Deutschland.
// (c) 2026 Fabian Hammer - Alle Rechte vorbehalten. Geistiges Eigentum.
// ============================================================================
// Einrichtungs-Assistent (wie in FAH-Friday): alles, was das Cockpit auf einem frischen Mac braucht. Grün = erledigt,
// sonst ein Knopf, der es erledigt oder an die richtige Stelle führt. „Erneut prüfen“ prüft alles neu.

import AppKit
import ServiceManagement
import SwiftUI
import UserNotifications

@MainActor
final class Pruefer: ObservableObject {
    struct Stand {
        var claude: String? = nil          // Pfad
        var claudeVersion = ""
        var angemeldet = false
        var konto = ""
        var git = false
        var projektordner = false
        var vault = false
        var mitteilungen = false
        var anmeldeobjekt = false
        var dienst = false
        var alterDienst = false
        var limitLive = false
        var wissen = ""                    // letzter Lauf des Wissens-Spiegels
        var wissenZiel = ""                // fahgit | ordner | aus
        var wissenOrdner = ""
        var wissenLaeuft = false
        var fahgit = false
        var fahgitText = ""
    }
    @Published var s = Stand()
    @Published var geprueft = ""
    @Published var laeuft = ""             // Rückmeldung zu einer Aktion

    func pruefen() {
        Task.detached {
            var n = Stand()
            n.claude = finde("claude")
            if let c = n.claude {
                n.claudeVersion = ausfuehren(c, ["--version"], zeitMax: 15).aus.trimmingCharacters(in: .whitespacesAndNewlines)
                let st = ausfuehren(c, ["auth", "status", "--json"], zeitMax: 20).aus
                if let d = st.data(using: .utf8), let j = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any] {
                    n.angemeldet = j["loggedIn"] as? Bool ?? false
                    n.konto = [j["email"] as? String, j["planTier"] as? String ?? j["subscriptionType"] as? String].compactMap { $0 }.joined(separator: " · ")
                }
            }
            n.git = ausfuehren("/usr/bin/xcode-select", ["-p"], zeitMax: 10).code == 0
            var ordner: ObjCBool = false
            n.projektordner = FileManager.default.fileExists(atPath: Einstellung.projektordner, isDirectory: &ordner) && ordner.boolValue
            n.vault = FileManager.default.fileExists(atPath: Einstellung.vault + "/maschine/projekte")
            n.anmeldeobjekt = SMAppService.mainApp.status == .enabled
            n.alterDienst = Dienst.shared.alterDienstDa
            n.dienst = await Dienst.shared.antwortet()
            if let l = await dienstJSON("/api/limit"), l["quelle"] as? String == "live",
               let stand = l["stand"] as? String, let t = ISO8601DateFormatter.mitBruch.date(from: stand) ?? ISO8601DateFormatter().date(from: stand) {
                n.limitLive = t.timeIntervalSinceNow > -300
            }
            if let w = await dienstJSON("/api/wissen") { n.wissenLaeuft = w["laeuft"] as? Bool ?? false }
            if let w = await dienstJSON("/api/wissen"), let b = w["letzter"] as? [String: Any] {
                let p = (b["projekte"] as? [[String: Any]] ?? []).filter { ["gepusht", "aktuell", "gespiegelt"].contains($0["status"] as? String ?? "") }.count
                n.wissen = (b["fehler"] as? String).map { "Fehler: \($0)" } ?? (b["ziel"] as? String == "aus" ? "" : "\(p) Projekte gespiegelt")
            }
            if let e = await dienstJSON("/api/einstellungen", zeitMax: 15), let f = e["fahgit"] as? [String: Any] {
                n.wissenOrdner = e["wissenOrdner"] as? String ?? ""
                let z = e["wissenZiel"] as? String ?? ""
                n.wissenZiel = !z.isEmpty ? z : ((e["fahgitAdresse"] as? String ?? "").isEmpty ? "aus" : "fahgit")
                n.fahgit = f["verbunden"] as? Bool ?? false
                n.fahgitText = n.fahgit ? "verbunden mit \(f["adresse"] as? String ?? "") als \(f["name"] as? String ?? "")"
                    : (f["fehler"] as? String ?? "nicht eingerichtet")
                if let e = f["ersatz"] as? [String: Any] {
                    let zustand = !(e["erreichbar"] as? Bool ?? false) ? "nicht erreichbar" : (e["nurLesen"] as? Bool ?? false) ? "bereit" : "übernommen"
                    n.fahgitText += " · Ersatz \(zustand)"
                }
            }
            let mit = await UNUserNotificationCenter.current().notificationSettings()
            n.mitteilungen = mit.authorizationStatus == .authorized || mit.authorizationStatus == .provisional
            let fertig = n
            await MainActor.run {
                self.s = fertig
                let df = DateFormatter(); df.dateFormat = "HH:mm:ss"
                self.geprueft = "zuletzt geprüft " + df.string(from: Date())
            }
        }
    }

    var allesNoetigeDa: Bool { s.claude != nil && s.angemeldet && s.git && s.projektordner && s.vault && s.dienst && !s.alterDienst }

    // ---------- Aktionen ----------

    func claudeInstallieren() {
        laeuft = "Claude Code wird installiert …"
        Task.detached {
            let r = ausfuehren("/bin/bash", ["-c", "curl -fsSL https://claude.ai/install.sh | bash"], zeitMax: 600)
            await MainActor.run {
                self.laeuft = r.code == 0 ? "Claude Code ist installiert. Jetzt anmelden." : "Installation fehlgeschlagen: " + String(r.aus.suffix(200))
                self.pruefen()
            }
        }
    }

    /// Anmelden ist interaktiv (Browser + Bestätigung) – dafür ein Terminal-Fenster mit genau diesem einen Befehl.
    func claudeAnmelden() {
        let ordner = FileManager.default.temporaryDirectory.appendingPathComponent("fah-cockpit", isDirectory: true)
        try? FileManager.default.createDirectory(at: ordner, withIntermediateDirectories: true)
        let datei = ordner.appendingPathComponent("Claude anmelden.command")
        let claude = s.claude ?? (Einstellung.heim + "/.local/bin/claude")
        let skript = "#!/bin/bash\necho 'FAH-Cockpit: Anmeldung bei Claude'\n\"\(claude)\" auth login\necho\necho 'Fertig – dieses Fenster kann zu. Im Cockpit: Erneut prüfen.'\n"
        try? skript.write(to: datei, atomically: true, encoding: .utf8)
        try? FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: datei.path)
        NSWorkspace.shared.open(datei)
    }

    func gitInstallieren() {
        laeuft = "Apple installiert die Befehlszeilenwerkzeuge (eigenes Fenster von macOS) …"
        Task.detached { ausfuehren("/usr/bin/xcode-select", ["--install"], zeitMax: 20) }
    }

    func ordnerWaehlen(vault: Bool) {
        let p = NSOpenPanel()
        p.canChooseDirectories = true; p.canChooseFiles = false; p.canCreateDirectories = true; p.allowsMultipleSelection = false
        p.message = vault ? "Vault (Ordner) für Stand-Dateien und Notizen wählen (z. B. ~/claude/Arbeit)" : "Ordner mit deinen Projekten wählen (z. B. ~/claude)"
        p.directoryURL = URL(fileURLWithPath: vault ? Einstellung.vault : Einstellung.projektordner)
        guard p.runModal() == .OK, let u = p.url else { return }
        if vault { Einstellung.vault = u.path } else { Einstellung.projektordner = u.path }
        Dienst.shared.neuStarten()
        pruefen()
    }

    /// Wissen ohne FAH-Git sichern: Ordner wählen (z. B. ~/claude, iCloud, NAS-Freigabe) – der Abgleich startet sofort.
    func wissenOrdnerWaehlen() {
        let p = NSOpenPanel()
        p.canChooseDirectories = true; p.canChooseFiles = false; p.canCreateDirectories = true; p.allowsMultipleSelection = false
        p.message = "Ordner für das Claude-Wissen wählen – der Projektordner selbst legt es je Projekt in claude-wissen/ ab"
        p.prompt = "Wählen"
        p.directoryURL = URL(fileURLWithPath: s.wissenOrdner.isEmpty ? Einstellung.projektordner : s.wissenOrdner)
        guard p.runModal() == .OK, let u = p.url else { return }
        laeuft = "Wissen wird in \(u.path) abgeglichen …"
        Task {
            let ok = await dienstSenden("/api/einstellungen", ["wissenZiel": "ordner", "wissenOrdner": u.path])
            await MainActor.run { self.laeuft = ok ? "" : "Ordner konnte nicht gespeichert werden – siehe Einstellungen" }
            try? await Task.sleep(nanoseconds: 4_000_000_000)
            await MainActor.run { self.pruefen() }
        }
    }

    /// Abgleich sofort starten (statt bis zum nächsten 30-Minuten-Takt zu warten).
    func wissenJetzt() {
        laeuft = "Wissen wird abgeglichen …"
        s.wissenLaeuft = true
        Task {
            _ = await dienstSenden("/api/wissen/jetzt", [:])     // wartet bis zum Ende (oder 10 s), der Lauf geht weiter
            await MainActor.run { self.laeuft = ""; self.pruefen() }
        }
    }

    func projektordnerAnlegen() {
        try? FileManager.default.createDirectory(atPath: Einstellung.projektordner, withIntermediateDirectories: true)
        Dienst.shared.neuStarten(); pruefen()
    }

    /// Minimaler Vault: maschine/projekte mit Beispiel und Anleitung, mensch/ für eigene Notizen.
    func vaultAnlegen() {
        let p = Einstellung.vault + "/maschine/projekte"
        try? FileManager.default.createDirectory(atPath: p, withIntermediateDirectories: true)
        for o in ["ideen", "notizen", "aufnahmen"] {      // für den Reiter „Notizen“
            try? FileManager.default.createDirectory(atPath: Einstellung.vault + "/mensch/" + o, withIntermediateDirectories: true)
        }
        let beispiel = p + "/BEISPIEL-projekt.md"
        if !FileManager.default.fileExists(atPath: beispiel) {
            try? """
            ---
            ordner: [Ordnername]
            status: [aktiv oder ruht]
            aktualisiert: [Datum]
            quelle: [Quelle]
            ---
            # [Projektname]

            ## Stand

            [Stand]

            ## Offen

            - [ ] [To-do]
            """.write(toFile: beispiel, atomically: true, encoding: .utf8)
        }
        Dienst.shared.neuStarten(); pruefen()
    }

    func mitteilungenErlauben() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { _, _ in
            Task { @MainActor in self.pruefen() }
        }
        oeffnen("x-apple.systempreferences:com.apple.Notifications-Settings.extension")
    }

    func anmeldeobjektEinschalten() {
        do { try SMAppService.mainApp.register(); laeuft = "FAH-Cockpit startet jetzt beim Anmelden." }
        catch { laeuft = "Ging nicht: \(error.localizedDescription) – Systemeinstellungen → Allgemein → Anmeldeobjekte"; SMAppService.openSystemSettingsLoginItems() }
        pruefen()
    }

    func alterDienstUebernehmen() {
        laeuft = "Übernehme den alten Hintergrunddienst …"
        Task { let m = await Dienst.shared.alterDienstUebernehmen(); laeuft = m; pruefen() }
    }
}

extension ISO8601DateFormatter {
    static let mitBruch: ISO8601DateFormatter = { let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]; return f }()
}

struct EinrichtungView: View {
    @ObservedObject var p: Pruefer
    var ohneScroll = false            // für die Bildprobe: ImageRenderer zeichnet keinen ScrollView-Inhalt

    var body: some View {
        if ohneScroll { inhalt.frame(width: 580) } else { ScrollView { inhalt }.frame(width: 580, height: 600) }
    }

    private var inhalt: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("FAH-Cockpit — Einrichtung").font(.title3).bold()
            Text("Alles, was das Cockpit auf diesem Mac braucht. Grün = erledigt, grau = optional.")
                .font(.caption).foregroundStyle(.secondary)
            zeile("Claude Code", p.s.claude == nil ? "Führt die Aufträge aus – noch nicht installiert"
                  : "\(p.s.claudeVersion.isEmpty ? "installiert" : p.s.claudeVersion) – führt die Aufträge aus",
                  p.s.claude != nil, "Installieren") { p.claudeInstallieren() }
            zeile("Bei Claude angemeldet", p.s.angemeldet ? p.s.konto : "Mit deinem Claude-Konto (Abo) anmelden",
                  p.s.angemeldet, "Anmelden …") { p.claudeAnmelden() }
            zeile("git (Befehlszeilenwerkzeuge)", "Stand der Projekte messen (und das Wissen nach FAH-Git spiegeln)",
                  p.s.git, "Installieren") { p.gitInstallieren() }
            zeile("Projektordner", Einstellung.projektordner, p.s.projektordner, "Anlegen") { p.projektordnerAnlegen() }
                .contextMenu { Button("Anderen Ordner wählen …") { p.ordnerWaehlen(vault: false) } }
            zeile("Vault mit Stand-Dateien und Notizen", Einstellung.vault, p.s.vault, "Anlegen") { p.vaultAnlegen() }
                .contextMenu { Button("Anderen Vault wählen …") { p.ordnerWaehlen(vault: true) } }
            zeile("Cockpit-Dienst", p.s.alterDienst ? "Läuft noch als alter Hintergrunddienst – die App übernimmt ihn" : "Läuft in der App auf localhost:\(Einstellung.port)",
                  p.s.dienst && !p.s.alterDienst, p.s.alterDienst ? "Übernehmen" : "Starten") {
                if p.s.alterDienst { p.alterDienstUebernehmen() } else { Dienst.shared.starten(); p.pruefen() }
            }
            zeile("Mitteilungen", "„Wartet auf dein Ja“ und „Auftrag fertig“ – ein Klick öffnet den Auftrag",
                  p.s.mitteilungen, "Erlauben") { p.mitteilungenErlauben() }
            zeile("Beim Anmelden starten", "Das Cockpit ist immer da, Aufträge laufen weiter",
                  p.s.anmeldeobjekt, "Einschalten") { p.anmeldeobjektEinschalten() }
            optional("Nutzungslimit live", "Jede Minute wie /usage – über deine Claude-Anmeldung im Schlüsselbund",
                     p.s.limitLive, "Einstellungen") { Hauptfenster.shared.zeigen("/einstellungen") }
            optional("FAH-Git-Verbindung", p.s.fahgit ? p.s.fahgitText : "Nur wenn du FAH-Git hast – sonst das Wissen in einen Ordner sichern",
                     p.s.fahgit, "Einstellungen") { Hauptfenster.shared.zeigen("/einstellungen") }
            optional("Wissen sichern", wissenText, wissenOk, p.s.wissenZiel == "fahgit" ? "Jetzt abgleichen" : "Ordner wählen …") {
                if p.s.wissenZiel == "fahgit" { p.wissenJetzt() } else { p.wissenOrdnerWaehlen() }
            }
                .contextMenu {
                    Button("Anderen Ordner wählen …") { p.wissenOrdnerWaehlen() }
                    Button("In den Einstellungen (FAH-Git, Ordner, aus) …") { Hauptfenster.shared.zeigen("/einstellungen") }
                }
            if !p.laeuft.isEmpty { Text(p.laeuft).font(.caption).foregroundStyle(.orange).fixedSize(horizontal: false, vertical: true) }
            HStack {
                Button("Erneut prüfen") { p.pruefen() }
                if !p.geprueft.isEmpty { Text(p.geprueft).font(.caption).foregroundStyle(.secondary) }
                Spacer()
                Text("Rechtsklick auf einen Ordner: anderen wählen").font(.caption).foregroundStyle(.secondary)
            }.padding(.top, 6)
        }
        .padding(18)
    }

    @ViewBuilder private func zeile(_ t: String, _ d: String, _ ok: Bool, _ knopf: String, _ tap: @escaping () -> Void) -> some View {
        HStack(spacing: 10) {
            Image(systemName: ok ? "checkmark.circle.fill" : "exclamationmark.circle")
                .foregroundStyle(ok ? Color.green : Color.orange).font(.title3)
            VStack(alignment: .leading, spacing: 1) {
                Text(t).font(.callout).bold()
                Text(d).font(.caption).foregroundStyle(.secondary).lineLimit(2)
            }
            Spacer()
            if !ok { Button(knopf, action: tap) }
        }
    }

    private var wissenOk: Bool { p.s.wissenZiel != "aus" && !p.s.wissen.isEmpty && !p.s.wissen.hasPrefix("Fehler") }
    private var wissenText: String {
        switch p.s.wissenZiel {
        case "fahgit": return "Stand und Claudes Notizen je Projekt nach FAH-Git (claude-wissen/), alle 30 min" + (p.s.wissenLaeuft ? " – läuft gerade …" : p.s.wissen.isEmpty ? " – erster Abgleich kommt 3 min nach dem Start" : ": " + p.s.wissen)
        case "ordner": return "Stand und Claudes Notizen je Projekt in \((p.s.wissenOrdner as NSString).abbreviatingWithTildeInPath)" + (p.s.wissenLaeuft ? " – läuft gerade …" : p.s.wissen.isEmpty ? " – Abgleich steht aus" : ": " + p.s.wissen)
        default: return "Stand und Claudes Notizen je Projekt sichern – Ordner wählen (z. B. ~/claude), der Abgleich startet sofort"
        }
    }

    @ViewBuilder private func optional(_ t: String, _ d: String, _ ok: Bool, _ knopf: String, _ tap: @escaping () -> Void) -> some View {
        HStack(spacing: 10) {
            Image(systemName: ok ? "checkmark.circle.fill" : "circle.dashed")
                .foregroundStyle(ok ? Color.green : Color.secondary).font(.title3)
            VStack(alignment: .leading, spacing: 1) {
                Text(t).font(.callout).bold()
                Text(d).font(.caption).foregroundStyle(.secondary).lineLimit(2)
            }
            Spacer()
            if !ok { Button(knopf, action: tap) }
        }
    }
}

@MainActor
final class EinrichtungFenster {
    static let shared = EinrichtungFenster()
    let pruefer = Pruefer()
    private var fenster: NSWindow?

    func zeigen() {
        if fenster == nil {
            let w = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 580, height: 600), styleMask: [.titled, .closable],
                             backing: .buffered, defer: false)
            w.title = "FAH-Cockpit — Einrichtung"
            w.isReleasedWhenClosed = false
            w.contentView = NSHostingView(rootView: EinrichtungView(p: pruefer))
            w.center()
            fenster = w
        }
        pruefer.pruefen()
        Einstellung.einrichtungGesehen = true
        NSApp.activate(ignoringOtherApps: true)
        fenster?.makeKeyAndOrderFront(nil)
    }

    /// Für die Bildprobe beim Bauen: die Ansicht ohne Fenster als PNG.
    func bild(nach datei: String) async {
        pruefer.pruefen()
        try? await Task.sleep(nanoseconds: 4_000_000_000)
        let r = ImageRenderer(content: EinrichtungView(p: pruefer, ohneScroll: true).environment(\.colorScheme, .dark).background(Color(white: 0.12)))
        r.scale = 2
        if let img = r.nsImage, let tiff = img.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff),
           let png = rep.representation(using: .png, properties: [:]) {
            try? png.write(to: URL(fileURLWithPath: datei))
        }
    }
}
