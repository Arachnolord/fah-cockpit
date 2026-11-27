// ============================================================================
// Erdacht und programmiert von Fabian Hammer, Deutschland.
// (c) 2026 Fabian Hammer - Alle Rechte vorbehalten. Geistiges Eigentum.
// ============================================================================
// Hauptfenster: die Cockpit-Oberfläche in einem eigenen Fenster (kein Browser). Fremde Links (Webseiten, andere Apps)
// gehen an die passende App; Rückfragen der Seite (confirm/alert) kommen als echte Mac-Dialoge.

import AppKit
import WebKit
import UniformTypeIdentifiers

final class Hauptfenster: NSObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
    static let shared = Hauptfenster()
    private var fenster: NSWindow?
    private var web: WKWebView?
    private var warteTimer: Timer?

    func zeigen(_ weg: String? = nil) {
        if fenster == nil { bauen() }
        if let weg { laden(weg) }
        NSApp.activate(ignoringOtherApps: true)
        fenster?.makeKeyAndOrderFront(nil)
    }

    func neuLaden() { web?.reload() }

    private func bauen() {
        let konf = WKWebViewConfiguration()
        konf.websiteDataStore = .default()
        konf.userContentController.add(self, name: "cockpit")    // Seite → App (z. B. Ordner-Dialog)
        let w = WKWebView(frame: .zero, configuration: konf)
        w.navigationDelegate = self
        w.uiDelegate = self
        w.setValue(false, forKey: "drawsBackground")      // kein weißes Aufblitzen vor dem dunklen Cockpit
        let f = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1320, height: 880),
                         styleMask: [.titled, .closable, .miniaturizable, .resizable],      // ohne fullSizeContentView: die Webseite schluckt sonst das Ziehen
                         backing: .buffered, defer: false)
        f.title = "FAH-Cockpit"
        f.appearance = NSAppearance(named: .darkAqua)             // dunkle Titelleiste wie im Terminal, auch im hellen Modus
        f.titlebarSeparatorStyle = .line                          // klar abgesetzt vom Inhalt
        f.backgroundColor = NSColor(white: 0.118, alpha: 1)       // #1e1e1e wie der Terminal-Hintergrund
        f.isReleasedWhenClosed = false
        f.minSize = NSSize(width: 720, height: 520)
        f.contentView = w
        f.center()
        f.setFrameAutosaveName("FAH-Cockpit-Hauptfenster")
        fenster = f
        web = w
        laden(nil)
    }

    private func laden(_ weg: String?) {
        guard let w = web else { return }
        var url = Einstellung.basis.absoluteString + "/"
        if let weg, !weg.isEmpty { url += weg.hasPrefix("#") ? weg : "#" + weg }
        Task {
            if await Dienst.shared.antwortet() {
                await MainActor.run { w.load(URLRequest(url: URL(string: url)!)) }
            } else {
                await MainActor.run {
                    w.loadHTMLString("<html><body style='background:#1e1e1e;color:#8d9199;font:14px -apple-system;display:flex;align-items:center;justify-content:center;height:90vh'>Cockpit startet …</body></html>", baseURL: nil)
                    self.warteTimer?.invalidate()
                    self.warteTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: false) { [weak self] _ in self?.laden(weg) }
                }
            }
        }
    }

    /// Nachrichten der Seite: { ordnerWaehlen: "wissen" } → Mac-Dialog, dann Einstellung speichern und Seite neu laden.
    func userContentController(_ uc: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let d = message.body as? [String: Any], d["ordnerWaehlen"] as? String == "wissen" else { return }
        let p = NSOpenPanel()
        p.canChooseDirectories = true; p.canChooseFiles = false; p.canCreateDirectories = true; p.allowsMultipleSelection = false
        p.message = "Ordner für das Claude-Wissen wählen (z. B. ~/claude, iCloud oder eine NAS-Freigabe)"
        p.prompt = "Wählen"
        guard p.runModal() == .OK, let u = p.url else { return }
        Task {
            _ = await dienstSenden("/api/einstellungen", ["wissenZiel": "ordner", "wissenOrdner": u.path])
            await MainActor.run { self.web?.reload() }
        }
    }

    // Nur das eigene Cockpit im Fenster; alles andere öffnet die zuständige App.
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { return decisionHandler(.cancel) }
        let eigen = (url.host == "localhost" || url.host == "127.0.0.1") && url.port == Einstellung.port
        if url.scheme == "about" || eigen { return decisionHandler(.allow) }
        NSWorkspace.shared.open(url)
        decisionHandler(.cancel)
    }

    // Neue Fenster (target=_blank) → im Standardbrowser
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url { NSWorkspace.shared.open(url) }
        return nil
    }

    // <input type="file"> (Knopf „Bild …“ an der Chatzeile): ohne diesen Dialog passiert in einer WKWebView nichts
    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        let p = NSOpenPanel()
        p.canChooseFiles = true; p.canChooseDirectories = false
        p.allowsMultipleSelection = parameters.allowsMultipleSelection
        p.allowedContentTypes = [.image]
        p.message = "Bilder für Claude wählen"
        p.prompt = "Anhängen"
        guard let f = fenster else { return completionHandler(p.runModal() == .OK ? p.urls : nil) }
        p.beginSheetModal(for: f) { antwort in completionHandler(antwort == .OK ? p.urls : nil) }
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let a = NSAlert()
        a.messageText = "FAH-Cockpit"
        a.informativeText = message
        a.addButton(withTitle: "OK")
        a.addButton(withTitle: "Abbrechen")
        completionHandler(a.runModal() == .alertFirstButtonReturn)
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let a = NSAlert()
        a.messageText = "FAH-Cockpit"
        a.informativeText = message
        a.runModal()
        completionHandler()
    }
}
