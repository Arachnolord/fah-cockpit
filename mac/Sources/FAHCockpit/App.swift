// ============================================================================
// Erdacht und programmiert von Fabian Hammer, Deutschland.
// (c) 2026 Fabian Hammer - Alle Rechte vorbehalten. Geistiges Eigentum.
// ============================================================================
// FAH-Cockpit als Mac-App: eigenes Fenster mit der Cockpit-Oberfläche, Menüleisten-Symbol mit „wartet auf dich“ und
// Nutzungslimit, echte Mitteilungen (Klick öffnet den Auftrag), Einrichtungs-Assistent. Der Node-Dienst läuft als Kind
// der App (Node und Code liegen im App-Paket).

import AppKit
import UserNotifications

@main
final class AppDelegate: NSObject, NSApplicationDelegate, UNUserNotificationCenterDelegate {
    static func main() {
        let app = NSApplication.shared
        let d = AppDelegate()
        app.delegate = d
        app.run()
    }

    private var symbol: NSStatusItem?
    private var takt: Timer?
    private var bekannteKarten = Set<String>()
    private var bekannteStati: [String: String] = [:]
    private var ersterTakt = true
    private var wartet = 0, laeuft = 0
    private var limitText = ""

    private var sigterm: DispatchSourceSignal?

    func applicationDidFinishLaunching(_ n: Notification) {
        // Bildprobe beim Bauen: Einrichtung als PNG, ohne Fenster, dann beenden
        let args = CommandLine.arguments
        if let i = args.firstIndex(of: "--probe-einrichtung"), i + 1 < args.count {
            NSApp.setActivationPolicy(.prohibited)
            Task { @MainActor in await EinrichtungFenster.shared.bild(nach: args[i + 1]); NSApp.terminate(nil) }
            return
        }
        NSApp.setActivationPolicy(.regular)
        // SIGTERM (z. B. pkill, Abmelden) wie „Beenden“ behandeln, damit der Dienst mit beendet wird und nicht verwaist
        signal(SIGTERM, SIG_IGN)
        let sig = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
        sig.setEventHandler { Dienst.shared.beenden(); exit(0) }
        sig.resume()
        sigterm = sig
        menueBauen()
        symbolBauen()
        UNUserNotificationCenter.current().delegate = self
        Dienst.shared.starten()
        Hauptfenster.shared.zeigen()
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 1_500_000_000)
            let p = EinrichtungFenster.shared.pruefer
            p.pruefen()
            try? await Task.sleep(nanoseconds: 3_000_000_000)
            if !Einstellung.einrichtungGesehen || !p.allesNoetigeDa { EinrichtungFenster.shared.zeigen() }
        }
        takt = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in self?.nachsehen() }
        nachsehen()
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows: Bool) -> Bool {
        if !hasVisibleWindows { Hauptfenster.shared.zeigen() }
        return true
    }

    /// Fenster zu = App bleibt (Menüleiste, Aufträge laufen weiter).
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        if laeuft > 0 {
            let a = NSAlert()
            a.messageText = "Claude arbeitet gerade an einem Auftrag."
            a.informativeText = "Beim Beenden bricht der Auftrag ab. Du kannst ihn später im selben Gespräch fortsetzen."
            a.addButton(withTitle: "Weiterlaufen lassen")
            a.addButton(withTitle: "Trotzdem beenden")
            if a.runModal() == .alertFirstButtonReturn { return .terminateCancel }
        }
        Dienst.shared.beenden()
        return .terminateNow
    }

    // ---------- Menüs ----------

    private func menueBauen() {
        let haupt = NSMenu()
        let appMenue = NSMenu()
        appMenue.addItem(withTitle: "Über FAH-Cockpit", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenue.addItem(.separator())
        appMenue.addItem(withTitle: "Einrichtung …", action: #selector(einrichtung), keyEquivalent: ",")
        appMenue.addItem(.separator())
        appMenue.addItem(withTitle: "FAH-Cockpit ausblenden", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        appMenue.addItem(withTitle: "FAH-Cockpit beenden", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        let appEintrag = NSMenuItem(); appEintrag.submenu = appMenue; haupt.addItem(appEintrag)

        // Bearbeiten: ohne dieses Menü gehen ⌘C/⌘V/⌘A in den Textfeldern der Seite nicht
        let bearb = NSMenu(title: "Bearbeiten")
        bearb.addItem(withTitle: "Widerrufen", action: Selector(("undo:")), keyEquivalent: "z")
        bearb.addItem(withTitle: "Wiederholen", action: Selector(("redo:")), keyEquivalent: "Z")
        bearb.addItem(.separator())
        bearb.addItem(withTitle: "Ausschneiden", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        bearb.addItem(withTitle: "Kopieren", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        bearb.addItem(withTitle: "Einsetzen", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        bearb.addItem(withTitle: "Alles auswählen", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        let bearbEintrag = NSMenuItem(); bearbEintrag.submenu = bearb; haupt.addItem(bearbEintrag)

        let ansicht = NSMenu(title: "Ansicht")
        ansicht.addItem(withTitle: "Übersicht", action: #selector(zeigeUebersicht), keyEquivalent: "1")
        ansicht.addItem(withTitle: "Offene To-dos", action: #selector(zeigeTodos), keyEquivalent: "2")
        ansicht.addItem(withTitle: "Aufträge", action: #selector(zeigeAuftraege), keyEquivalent: "3")
        ansicht.addItem(withTitle: "Wissensnetz", action: #selector(zeigeNetz), keyEquivalent: "4")
        ansicht.addItem(.separator())
        ansicht.addItem(withTitle: "Neu laden", action: #selector(neuLaden), keyEquivalent: "r")
        let ansichtEintrag = NSMenuItem(); ansichtEintrag.submenu = ansicht; haupt.addItem(ansichtEintrag)

        let fenster = NSMenu(title: "Fenster")
        fenster.addItem(withTitle: "Minimieren", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        fenster.addItem(withTitle: "Schließen", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        let fensterEintrag = NSMenuItem(); fensterEintrag.submenu = fenster; haupt.addItem(fensterEintrag)
        NSApp.windowsMenu = fenster
        NSApp.mainMenu = haupt
    }

    private func symbolBauen() {
        let s = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        s.button?.image = NSImage(systemSymbolName: "point.3.connected.trianglepath.dotted", accessibilityDescription: "FAH-Cockpit")
        s.button?.imagePosition = .imageLeading
        symbol = s
        symbolMenue()
    }

    private func symbolMenue() {
        let m = NSMenu()
        m.addItem(withTitle: "Cockpit öffnen", action: #selector(zeigeUebersicht), keyEquivalent: "")
        let auf = m.addItem(withTitle: wartet > 0 ? "Aufträge – \(wartet) wartet auf dein Ja" : laeuft > 0 ? "Aufträge – Claude arbeitet" : "Aufträge",
                            action: #selector(zeigeAuftraege), keyEquivalent: "")
        if wartet > 0 { auf.image = NSImage(systemSymbolName: "exclamationmark.circle.fill", accessibilityDescription: nil) }
        if !limitText.isEmpty { let l = m.addItem(withTitle: limitText, action: #selector(zeigeEinstellungen), keyEquivalent: ""); l.isEnabled = true }
        m.addItem(.separator())
        m.addItem(withTitle: "Einrichtung …", action: #selector(einrichtung), keyEquivalent: "")
        m.addItem(withTitle: "FAH-Cockpit beenden", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "")
        for e in m.items where e.action != #selector(NSApplication.terminate(_:)) { e.target = self }
        symbol?.menu = m
        symbol?.button?.title = wartet > 0 ? " \(wartet)" : ""
    }

    // ---------- Takt: Zähler, Limit, Mitteilungen ----------

    private func nachsehen() {
        Task { @MainActor in
            if let a = await dienstJSON("/api/auftraege") {
                wartet = a["wartet"] as? Int ?? 0
                laeuft = a["laeuft"] as? Int ?? 0
                for auftrag in (a["auftraege"] as? [[String: Any]] ?? []) {
                    let id = auftrag["id"] as? String ?? "", titel = auftrag["titel"] as? String ?? "", ordner = auftrag["ordner"] as? String ?? ""
                    for karte in (auftrag["offeneFreigaben"] as? [[String: Any]] ?? []) {
                        let k = karte["id"] as? String ?? ""
                        if !bekannteKarten.contains(k) {
                            bekannteKarten.insert(k)
                            if !ersterTakt { melden("Wartet auf dein Ja – \(ordner)", "\(karte["werkzeug"] as? String ?? ""): \(karte["kurz"] as? String ?? "")", weg: "/a/" + id) }
                        }
                    }
                    let st = auftrag["status"] as? String ?? ""
                    if let alt = bekannteStati[id], alt != st, !ersterTakt {
                        if st == "fertig" { melden("Auftrag fertig – \(ordner)", titel, weg: "/a/" + id) }
                        if st == "fehler" { melden("Auftrag mit Fehler – \(ordner)", titel, weg: "/a/" + id) }
                    }
                    bekannteStati[id] = st
                }
                ersterTakt = false
            }
            if let l = await dienstJSON("/api/limit"), let f = l["fenster"] as? [String: Any] {
                let namen = ["five_hour": "5 h", "seven_day": "Woche", "seven_day_opus": "Woche Opus", "seven_day_sonnet": "Woche Sonnet"]
                let teile = f.compactMap { (k, v) -> String? in
                    guard let w = v as? [String: Any], let a = w["auslastung"] as? Double else { return nil }
                    return "\(namen[k] ?? k) \(Int((a * 100).rounded())) %"
                }.sorted()
                limitText = teile.isEmpty ? "" : "Limit: " + teile.joined(separator: " · ")
            }
            NSApp.dockTile.badgeLabel = wartet > 0 ? String(wartet) : nil
            symbolMenue()
        }
    }

    private func melden(_ titel: String, _ text: String, weg: String) {
        let c = UNMutableNotificationContent()
        c.title = titel
        c.body = String(text.prefix(180))
        c.sound = .default
        c.userInfo = ["weg": weg]
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: UUID().uuidString, content: c, trigger: nil))
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                                withCompletionHandler fertig: @escaping () -> Void) {
        let weg = response.notification.request.content.userInfo["weg"] as? String
        DispatchQueue.main.async { Hauptfenster.shared.zeigen(weg) }
        fertig()
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                withCompletionHandler fertig: @escaping (UNNotificationPresentationOptions) -> Void) {
        fertig([.banner, .sound])
    }

    // ---------- Aktionen ----------

    @objc func einrichtung() { Task { @MainActor in EinrichtungFenster.shared.zeigen() } }
    @objc func zeigeUebersicht() { Hauptfenster.shared.zeigen("/") }
    @objc func zeigeTodos() { Hauptfenster.shared.zeigen("/todos") }
    @objc func zeigeAuftraege() { Hauptfenster.shared.zeigen("/auftraege") }
    @objc func zeigeNetz() { Hauptfenster.shared.zeigen("/netz") }
    @objc func zeigeEinstellungen() { Hauptfenster.shared.zeigen("/einstellungen") }
    @objc func neuLaden() { Hauptfenster.shared.neuLaden() }
}
