# FAH-Cockpit – Design (27.11.2026)

## Wozu

Der Betreiber will morgens auf einen Blick sehen, wo jedes Projekt unter `~/claude` steht und was dort offen ist.
Das Cockpit zeigt den Projektstand und die offenen To-dos. Mehr soll es vorerst nicht können.

## Ziele

- Alle Projekte unter `~/claude` in einer Liste: Version, letzte Änderung, Git-Zustand, Anzahl offener To-dos.
- Je Projekt: Stand in Sätzen, To-do-Liste zum Abhaken, Git-Fakten, letzte Commits, Sprung nach Obsidian.
- Alle offenen To-dos über alle Projekte in einer Ansicht.
- Aussehen wie das Dashboard aus dem Video „Bau dir ein Obsidian-System“: dunkel, Seitenleiste, Karten.

## Nicht-Ziele

- Kein Zugriff von außen (nur `127.0.0.1`), kein Konto, keine Anmeldung.
- Keine Netzwerkzugriffe (kein `git fetch`), kein Deploy, kein Versand.
- Kein Bearbeiten von Stand-Texten im Cockpit – das passiert in Obsidian oder durch Claude.

## Daten

- **Gemessen** (bei jedem Aufruf frisch, 20 s zwischengespeichert): je Unterordner von `~/claude` Git-Zweig, Upstream,
  voraus/zurück, nicht eingecheckte Dateien, letzter Commit, Version aus `package.json`, `VERSION` oder `version.txt`.
  Git läuft mit `GIT_OPTIONAL_LOCKS=0`, damit das Cockpit anderen Sitzungen keine `index.lock` in den Weg legt.
- **Geschrieben** (von Claude nach jeder Projektarbeit, oder von Hand in Obsidian): eine Stand-Datei je Projekt im Vault,
  `~/claude/Arbeit/maschine/projekte/<Ordnername>.md`:

  ```
  ---
  ordner: <Ordnername>
  status: aktiv | ruht
  aktualisiert: JJJJ-MM-TT
  quelle: …
  ---
  # <Name>

  ## Stand
  <2–4 Sätze>

  ## Offen
  - [ ] <To-do>
  - [ ] (optional) <To-do>

  ## Erledigt
  - [x] JJJJ-MM-TT <…>
  ```

## Ansatz (gewählt: 1)

1. **Kleine Web-App auf dem Mac (gewählt).** Node ≥ 22 ohne Fremdpakete wie FAH-Git, startet per LaunchAgent mit der
   Anmeldung, `http://localhost:8130`. Immer aktuell, Abhaken schreibt direkt in die Markdown-Datei.
2. Nur Obsidian-Bordmittel (Bases-Tabelle): kein Dienst, aber Git-Stand nur so frisch wie der letzte Skriptlauf, Look kaum gestaltbar.
3. Eigenes Obsidian-Plugin: immer aktuell, aber deutlich aufwendiger und nur in Obsidian.

Option B des Betreibers (auf dem FAH-NAS aus dem 30-min-Spiegel, nur lesen, auch vom Handy) bleibt als optionales To-do offen.

## Sicherheit

- Lauscht nur auf `127.0.0.1`; `Host`-Kopf muss `localhost`/`127.0.0.1` mit dem Port sein (gegen DNS-Rebinding).
- Schreibende Aufrufe nur mit Kopf `X-Cockpit: 1` und JSON (fremde Seiten bekommen so keine einfache Anfrage durch).
- Abhaken prüft, dass in der Zeile noch genau dieses To-do steht; geschrieben wird über Zwischendatei + Umbenennen.
- Ordnernamen werden nur aus der eigenen Projektliste angenommen (kein Pfad von außen).

## Aktuell halten

Regel in `~/.claude/CLAUDE.md` (gilt in jeder Claude-Sitzung, egal aus welchem Ordner): nach jeder Arbeit an einem
Projekt dessen Stand-Datei pflegen. Ohne Auftrag passiert nichts automatisch – das Cockpit misst nur den Git-Teil selbst.

## Aufträge an Claude (0.2.0, 27.11.2026)

Betreiber: „im cockpit fehlt mir die ki anbindung zum erledigen von aufgaben oder anweisungen“ – gewählt: **Claude arbeitet
im Hintergrund, der Betreiber gibt nur frei** (statt eines Claude-Terminals im Cockpit).

- **Start:** Knopf „Erledigen“ an jedem To-do oder Anweisungsfeld auf der Projektseite (Modell wählbar, Standard wie in Claude Code).
- **Lauf:** `claude -p <Auftrag> --output-format stream-json --verbose --settings <Haken> --append-system-prompt <Regeln>`,
  Arbeitsordner = Home (dort liegen Gedächtnis und Regeln des Betreibers), Projektordner steht im Auftrag. Immer nur ein
  Auftrag gleichzeitig, weitere in der Schlange (Mac-Last, Nutzungslimit). Nachschreiben = `--resume <Sitzung>`.
- **Freigabe:** PreToolUse-Haken `src/haken.js` fragt `/api/haken` (Geheimnis je Auftrag in der Umgebung). `src/freigabe.js`
  ist eine strenge Erlaubnisliste: ohne Rückfrage nur Lesen (außer sensible Orte wie `~/.ssh`, `.env`, Schlüssel, Ablage des
  Cockpits), Suchen in `~/claude`, Dateien im Projektordner (echter Pfad, ohne `.git`, ohne Code und Ablage des Cockpits),
  die eigene Stand-Datei, lesende Befehle mit geprüften Optionen und `git add/commit`. Alles andere – auch Tests, Bauen,
  WebFetch/WebSearch, push, deploy, ssh, löschen, fremde Dienste – wird eine Karte „Wartet auf dein Ja“ mit der **vollen**
  Eingabe (Befehl, Dateiinhalt, Änderung; Steuerzeichen sichtbar) und Claudes Begründung. Knöpfe: Ablehnen (mit Begründung,
  die Claude als Entscheidung des Betreibers zurückbekommt), Erlauben, „Immer in diesem Auftrag“ (exakt derselbe Aufruf).
- **Ausfallsicher:** `--permission-mode dontAsk` (was weder Haken noch Regel erlaubt, wird abgelehnt – kein Rückfall auf
  den auto-Modus), `--setting-sources user` (die lokalen Erlaubnisse aus settings.local.json gelten nicht), stabiler
  node-Pfad, eigene Frist im Haken (5 h 45 min → ablehnen), jeder Fehler im Haken = ablehnen.
- **Mitteilung:** macOS-Mitteilung bei neuer Karte und bei Ende des Auftrags; Zähler in Seitenleiste und Fenstertitel.
- **Ablage:** `~/Library/Application Support/FAH-Cockpit/auftraege/<id>.json` (Rechte 600), die letzten 200 Aufträge.
- **Verworfen:** eigenes MCP-Freigabewerkzeug (mehr Code, gleiches Ergebnis), Claude Agent SDK (Fremdpakete, Abo-Anmeldung unklar).

### Sicherheitsprüfung 27.11.2026

Unabhängige Prüfung fand u. a. Umgehungen über Optionen erlaubter Befehle (git --output/-O, sed w, sort -o, rg --pre,
Umgebungsvariablen vorne, maskierte Anführungszeichen), freie Codeausführung über selbst geschriebene Tests, `.GIT`
(APFS ohne Groß/klein), Selbstabschaltung über den eigenen Code, Datenabfluss über WebFetch und den Rückfall auf den
auto-Modus bei Haken-Ausfall. Alles behoben, jede Umgehung steht als Fall in `tests/cockpit.test.js`.

**Bewusst offen (angenommenes Restrisiko):** Die Oberflächen-API hat kein eigenes Geheimnis – ein anderer lokaler Prozess
des Betreibers könnte Freigaben erteilen. Aufträge selbst kommen ohne Karte nicht an Netz oder Shell, um das auszunutzen.
Lesen an nicht-sensiblen Orten (auch außerhalb des Projekts) bleibt frei; was gelesen wurde, kann nur über eine Karte hinaus.

## 0.3.0 – Freigabe wie im Multitool, Einstellungen (27.11.2026)

Betreiber nach dem ersten echten Auftrag: „ich bin hier ständig am erlauben … Immer für diesen Auftrag soll dann auch
Immer gelten“ und „du brauchst … nur die gleiche Logik wie im Multitool verwenden“. Befund aus dem echten Auftrag:
10 von 11 Karten waren reine Lesebefehle.

- **Wie im Multitool:** Claude Code läuft mit seinem normalen Rechtesystem (`--permission-mode auto`, die Regeln des
  Betreibers aus seinen Einstellungen – wie im Terminal). Der Haken gibt für normale Arbeit **keine** Entscheidung zurück
  („durch“). Eine Karte gibt es nur für Schritte nach außen oder nicht rückholbar: `git push`, ssh/scp/rsync zu anderen
  Geräten, Uploads per curl, rekursives Löschen oder Löschen außerhalb des Projekts, launchctl, brew/npm-Installationen,
  osascript/open, kill, `defaults write`, Systemeinstellungen, gh, Deploy-/Release-/Upload-Skripte, sendende Anbindungen.
  Lässt sich eine Zeile nicht sicher zerlegen ($(…), Schleifen), sucht eine grobe Prüfung nach denselben Mustern.
- **„Alles erlauben (dieser Auftrag)“** (wie „Für diese Verbindung erlauben“): danach keine Karten mehr, offene gehen
  mit durch. **Fragt immer:** sudo, Force-Push, `rm -rf` außerhalb des Projekts, Neustart/Herunterfahren, Änderungen an
  Programm oder Ablage des Cockpits. Auf der Auftragsseite: „Alles erlauben“ / „Wieder fragen“, beim Start „ohne Rückfrage“.
- **Einstellungen** (`#/einstellungen`, `src/einstellungen.js`): Anzeige, welche KI läuft (Claude Code Version, Anmeldung,
  Konto, Abo, Anbieter, gültig bis – aus `claude auth status --json`), Standard-Modell (`--model`: fable/opus/sonnet/haiku)
  und -Aufwand (`--effort`: low…max) für alle Aufträge inkl. „Erledigen“, je Auftrag überschreibbar. Anmeldung: wie
  Claude Code (empfohlen), Abo-Token aus `claude setup-token` (`CLAUDE_CODE_OAUTH_TOKEN`) oder API-Schlüssel
  (`ANTHROPIC_API_KEY`); beide im macOS-Schlüsselbund (Dienst „FAH-Cockpit“), nie in Dateien, nie zurück an die Oberfläche.
- **Abgelöst:** die strenge Erlaubnisliste und `dontAsk` aus 0.2.0 (zu viele Karten im Alltag). Der Schutz vor
  Selbstabschaltung (eigener Code, Ablage) bleibt und fragt immer.

## 0.4.0 – Wissen in FAH-Git (27.11.2026)

Betreiber: „wäre es … nicht als zentrales wissen sinnvoller fah-git zu nutzen … zu jedem projekt dann das claude wissen
in fah-git mit synchronisiert … und für github in die ausschluss regel“ → „leg los“.

- `src/wissen.js` spiegelt alle 30 Minuten (erster Lauf 3 min nach dem Start, Knopf „Jetzt spiegeln“ unter Einstellungen)
  je Projekt `STAND.md` (aus dem Vault) und die zugehörigen Gedächtnis-Notizen nach `<Projekt>/claude-wissen/`, das ganze
  Gedächtnis plus `~/.claude/CLAUDE.md` nach `~/claude/claude-gedaechtnis` (FAH-Git `eigene-projekte/mac/claude-gedaechtnis`).
- Zuordnung Notiz → Projekt: Dateiname (Liste `NAMEN`) plus Pfade `~/claude/<Projekt>` im Text; ohne Treffer nur im allgemeinen Repo.
- Commit nur mit Pfad `claude-wissen/` (`--no-verify`), fremde offene Arbeit bleibt liegen. Push nur, wenn vorher nichts
  anderes ungepusht war und FAH-Git nicht weiter ist; kein Pull, kein Rebase. Übersprungen: kein Git, kein FAH-Git-Remote,
  Zweig folgt nicht FAH-Git, Git beschäftigt (index.lock, Merge, Rebase …), **FX-Git/frederix (nie)**.
- GitHub: `**/claude-wissen/**` steht in FAH-Git → Einstellungen → GitHub → Bereinigung → Weglassen (eingetragen 27.11.).
  Alle GitHub-Spiegel sind „Öffentlicher Stand (bereinigt)“, weggelassen wird vor der Geheimnis-Prüfung, und ein unveränderter
  bereinigter Stand erzeugt auf GitHub keinen Commit. Bau-Skripte der Projekte packen nur ausdrücklich genannte Dateien.

## 0.5.0 – Wissensnetz (27.11.2026)

Betreiber: „die obsidian ansicht für dateien – knotenpunkt je projekt … als separaten tab und bei klick auf eine datei
wird dieser herausgezoomt und kann diese ansehen“.

- Reiter **Wissensnetz** (`#/netz`, `public/netz.js`, `src/netz.js`): Projekte als Knotenpunkte (grün, ruhend grau),
  daran Stand-Datei (blau), Claudes Notizen (lila, Zuordnung wie beim Wissens-Spiegel), Doku im Projekt (gelb: README,
  CLAUDE.md, memory.md, AGENTS.md, LIESMICH.md, CHANGELOG.md, docs/*.md, höchstens 20). Notizen ohne Projekt hängen an
  „Allgemeines Wissen“. `[[Verweise]]` und `(datei.md)`-Links zwischen Notizen werden Kanten.
- Eigene Kräfte-Simulation auf Canvas (Gitter für die Abstoßung), Ziehen = verschieben, Mausrad = zoomen, Suche, Filter.
  Klick auf eine Datei: weicher Zoom dorthin (mittig im freien Bereich) und Lesefenster mit gerendertem Markdown
  (YAML-Kopf als Eigenschaften, Tabellen, Code, Aufgaben, `[[Verweise]]` anklickbar). Klick auf ein Projekt: Dateiliste.
- Direktlinks `#/netz/<id>`, auf jeder Projektseite der Knopf „Im Wissensnetz“.
- Lesen nur über die id aus dem Netz (`/api/netz/datei`), der Pfad bleibt auf dem Server.

## 0.6.0 – Schreiben während der Arbeit, Live-Ansicht, Nutzungslimit (27.11.2026)

Betreiber: „ich kann hier zwischenzeitlich nichts schreiben und senden – nicht so wie hier wenn claude arbeitet“,
„eine live ansicht was er hier gerade tut wäre auch nice“, „mein usage limit live sehen“.

- **Streaming-Eingabe:** `claude -p --input-format stream-json --include-partial-messages`; der Auftrag kommt als erste Zeile
  über stdin, Nachrichten des Betreibers während des Laufs sofort hinterher (Claude nimmt sie im selben Durchgang auf –
  im Probelauf belegt). Nach dem Ergebnis 2 s Luft, dann stdin zu → Claude beendet sich. Fertig = wie bisher `--resume`.
- **Live-Ansicht:** Jetzt-Leiste (denkt nach / schreibt / führt aus <Befehl> / wartet auf dein Ja, mit laufender Uhr),
  Live-Text beim Schreiben, je Befehl Dauer, Sanduhr solange er läuft und die Ausgabe zum Aufklappen, Schritte von
  Helfern (Unteragenten, `parent_tool_use_id`) eingerückt. Neu gezeichnet wird nur bei neuer Version des Auftrags,
  aufgeklappte Ausgaben und die Scroll-Lage bleiben; auf der Auftragsseite 1-s-Takt.
- **Nutzungslimit** (`src/limit.js`): `rate_limit_event` aus jedem Lauf (Auslastung je Fenster, Rücksetzzeit, Zusatzkontingent)
  → Zeile in der Seitenleiste, Karte in Einstellungen mit Balken. „Jetzt messen“ = winzige Haiku-Anfrage mit
  `--no-session-persistence`. Kein Zugriff auf Schlüsselbund/Anmeldedaten (eine echte Daueranzeige ginge nur darüber).

## 0.7.0 – Mac-App FAH-Cockpit.app (27.11.2026)

Betreiber: „kann man das denn nicht als eigenständige app bauen wo darin alles liegt was zur app gehört?!“ → „Ja, App
bauen“; „bau doch einfach wie in friday so einen einrichtungsassistenten ein für die notwendigen freigaben“.

- `mac/` (Swift, AppKit + SwiftUI + WKWebView, keine Fremdpakete): Hauptfenster mit der Oberfläche (fremde Links → zuständige
  App, confirm/alert als Mac-Dialog, Bearbeiten-Menü für ⌘C/⌘V), Menüleisten-Symbol (Zähler „wartet auf dich“, Limit,
  Einrichtung), Dock-Badge, Mitteilungen über UNUserNotificationCenter (Klick öffnet den Auftrag). Der Dienst meldet in der
  App nichts selbst (`COCKPIT_MITTEILUNGEN=app`).
- Dienst als Kind der App: `Contents/Resources/node/bin/node` (offizielles Node v26.13.1 darwin-arm64, SHA-256 geprüft, mit
  JIT-Berechtigung signiert) startet `Contents/Resources/cockpit/src/server.js`; Absturz → Neustart (höchstens 5/min).
  Fenster zu = App bleibt; Beenden fragt, wenn ein Auftrag läuft.
- Einrichtungs-Assistent nach Friday-Muster: Claude Code (installieren über claude.ai/install.sh), angemeldet (`claude auth
  login` im Terminal), git (`xcode-select --install`), Projektordner, Vault (anlegen/wählen), Dienst (alten LaunchAgent
  übernehmen – nur wenn kein Auftrag läuft), Mitteilungen, Beim Anmelden starten (SMAppService); optional Obsidian,
  Limit live, Wissen in FAH-Git. Bildprobe beim Bauen: `FAHCockpit --probe-einrichtung <png>` (ohne Fenster).
- `mac/bauen.sh`: Hülle bauen, Paket zusammensetzen, signieren, /Applications ersetzen (laufende App nur mit ERSETZEN=1),
  ZIP nach NEUE ZIPs; Bau-Stand im Git = nur die Hülle `mac/FAH-Cockpit.app` (ohne Node und Code).

## 0.8.0 – FAH-Git-Verbindung, alles von und zu Claude ins FAH-Git (27.11.2026)

Betreiber: „das cockpit braucht auch eine fah-git verbindungseinstellung um bei neuinstallation ohne dich fah-git
hinterlegen zu können“ und „alles von und zu claude auch in fah-git im jeweiligen projektordner … ganz gleich ob docker
oder mac/win app“.

- Einstellungen → **FAH-Git-Verbindung**: Adresse, Benutzer, Zugangsschlüssel (Schlüsselbund, Dienst „FAH-Cockpit“, und per
  `git credential approve` auch für git). Ohne eigenen Schlüssel nimmt das Cockpit den git-Zugang des Macs (`git credential fill`).
  Prüfung über `/api/konto`. Auch im Einrichtungs-Assistenten der App.
- Wissens-Spiegel: erkennt FAH-Git an der eingestellten Adresse, wählt bei mehreren FAH-Remotes das des Upstreams (webshop),
  spiegelt zusätzlich die Verläufe beendeter Cockpit-Aufträge nach `claude-wissen/auftraege/<id>.md`.
- „In FAH-Git anlegen“ für Git-Projekte ohne FAH-Remote (eigene-projekte/<name>, Remote fahgit, push) – so vaultwarden und
  npm-backup am 27.11. Ohne Git, FX-Git/frederix und Zweige, die woanders hin folgen, bleiben außen vor.
- Feste Regel in `~/.claude/CLAUDE.md` („Claude-Wissen gehört ins FAH-Git“).

## 0.9.0 – Notizen und Bearbeiten (27.11.2026)

Betreiber: „bau bearbeiten und notizen-reiter ins cockpit ein“ (statt Obsidian).

- Reiter **Notizen** (`#/notizen`, `#/notizen/<pfad>`): Liste der Markdown-Dateien im Vault (Bereiche: alle eigenen,
  Ideen, Notizen, Aufnahmen, ganzer Vault), Suche, Lesen (gerendert, `[[Verweise]]` anklickbar), Bearbeiten, „Neue Notiz“
  (Ordner + Titel), Papierkorb (`.trash/` wie Obsidian, wiederherstellbar).
- **Editor** (`#/bearbeiten/<pfad>`, auch in den Notizen): Textfeld in Monospace, Vorschau, Speichern mit ⌘S, Warnung bei
  ungespeicherten Änderungen (Seitenwechsel/Schließen); Selbstaktualisierung und Takt zeichnen Editor-Seiten nie neu.
- Projektseite: „Stand bearbeiten“ und Feld „Neues To-do“ (am Ende von „## Offen“). Wissensnetz: eigene Notizen aus
  `mensch/` als Knoten (orange, Knotenpunkt „Meine Notizen“, Verweise auf Notizen/Projekte) und „Bearbeiten“ im Lesefenster.
- `src/vault.js`: nur `.md` im Vault, keine versteckten Ordner, kein Ausbrechen (echte Pfade), Speichern nur mit passender
  Version (sonst 409 – z. B. wenn Claude die Datei inzwischen gepflegt hat), atomar. Änderungen werden nach 30 s gebündelt
  committet (nur diese Pfade) und gepusht, wenn sonst nichts ungepusht ist.

## 0.10.0 – Wissen auch ohne FAH-Git sichern (27.11.2026)

Betreiber: Wenn FAH-Cockpit verteilt wird und jemand kein FAH-Git hat, soll auch ein Ordner (z. B. `~/claude`) als
Wissensordner gehen – nach der Ordnerwahl startet der Abgleich sofort.

- Einstellung „Wissen sichern“ mit drei Zielen: **FAH-Git** (wie bisher, Standard sobald eine FAH-Git-Adresse hinterlegt
  ist), **Ordner** (ohne Git, z. B. iCloud, NAS-Freigabe, Dropbox) und **Aus** (Standard auf einem frischen Mac ohne
  FAH-Git – nichts passiert von allein).
- Ordner-Ziel: je Projekt `<Ordner>/<Projekt>/` (STAND.md, gedaechtnis/, auftraege/) und `<Ordner>/_gedaechtnis/`.
  Ist der Ordner der Projektordner selbst, landet es in `<Projekt>/claude-wissen/` (ohne Commit; in Git-Projekten wird
  `/claude-wissen/` in `.git/info/exclude` eingetragen, damit es nie mitcommittet wird; wird es dort schon in Git
  verfolgt, bleibt das Projekt unberührt – das ist Sache von FAH-Git).
- Schutz: Das Cockpit schreibt (und räumt auf) nur in Ordnern, die es noch nicht gibt oder die seine Marke
  `.fah-cockpit-wissen` tragen. Ordner im Projektordner oder über ihm werden abgelehnt. FX-Git/frederix nie.
- Nach dem Speichern eines neuen Ziels oder Ordners startet der Abgleich sofort, danach alle 30 Minuten.
- Mac-App: „Ordner wählen …“ als echter Mac-Dialog (in den Einstellungen und im Einrichtungs-Assistenten, Punkt
  „Wissen sichern“); FAH-Git-Verbindung ist dort jetzt optional.
- Claudes Gedächtnis-Ordner wird aus dem Home-Ordner abgeleitet (`gedaechtnisPfad()`), nicht mehr fest verdrahtet.

## 0.10.1 – ohne Obsidian (27.11.2026)

Betreiber: „dann kann obsidian weg“. Obsidian ist deinstalliert, `.obsidian/` aus dem Vault entfernt. Im Cockpit fällt
„In Obsidian öffnen“ weg, im Einrichtungs-Assistenten der Punkt „Obsidian“. Notizen und Bearbeiten übernimmt das Cockpit.
`.obsidian` bleibt in `src/vault.js` ausgeschlossen, damit ein Vault anderer Nutzer mit Obsidian-Ordner sauber bleibt.

## 0.10.2 – „Wissen sichern“ verständlicher (27.11.2026)

Betreiber fragte, was „Wissen sichern“ in der Einrichtung meint (grau, Knopf „Ordner wählen …“, obwohl FAH-Git läuft).
Ursache: nach jedem Neustart war der letzte Bericht leer, bis 3 min später der erste Lauf kam. Jetzt bleibt der Bericht in
`wissen.json` (Ablage) über Neustarts erhalten; mit Ziel FAH-Git heißt der Knopf „Jetzt abgleichen“, der Text erklärt, was
gespiegelt wird, und zeigt „läuft gerade …“. „Ordner wählen …“ nur noch ohne FAH-Git (und im Rechtsklick-Menü).
Neustart des Dienstes seit der Übernahme durch die App: `ERSETZEN=1 mac/bauen.sh` und App öffnen – nicht mehr
`werkzeuge/installieren.sh` (das würde den alten LaunchAgent zurückholen).

## 0.10.3 – kein verwaister Dienst mehr (27.11.2026)

Befund: `pkill` beim Ersetzen der App beendete die App hart, ihr Node-Dienst lief verwaist mit altem Code weiter, und die neue
App hängte sich an ihn. Jetzt: (1) SIGTERM wird in der App wie „Beenden“ behandelt (Dienst wird mit beendet); (2) beim Start
löst die App einen Dienst ohne App ab (`/api/version` liefert Version und PID; ältere Dienste über den Prozesspfad), aber nur,
wenn kein Auftrag läuft – sonst eine Minute später erneut; (3) `bauen.sh` beendet die App mit „quit“ statt `pkill`.

## 0.11.0 – FAH-Git-Ersatz (Fail-over) (27.11.2026)

Betreiber: „wäre schön wenn ich eine failover fah-git instanz in den einstellungen hinterlegen könnte wenn die
hauptinstanz mal wegfallen sollte“ (Ersatz auf dem UGREEN-NAS, FAH-Git 1.14.0 mit `ROLLE=ersatz`).

- Einstellung „Ersatz“ neben der Haupt-Adresse. Status beider in der FAH-Git-Karte und im Einrichtungs-Assistenten:
  Ersatz „bereit“ (gleicht sich vom Haupt ab, nur lesen), „übernommen“ (nach „Zum Haupt machen“, nimmt Pushes an) oder
  „nicht erreichbar“. Rolle kommt aus `/api/status` → `failover.rolle`.
- Schreibziel (`fahgitZiel()`, 30 s zwischengespeichert, je Spiegel-Lauf einmal frisch): Haupt erreichbar → Haupt;
  sonst übernommener Ersatz → Pushes gehen an dieselbe Adresse am Ersatz (`aufErsatz()` tauscht nur Host/Port);
  sonst bleibt alles lokal und geht beim nächsten Lauf zum Haupt. Kein Warten auf Zeitüberschreitungen je Projekt.
- Spiegel: ungepushte eigene `claude-wissen:`-Commits blockieren den Push nicht mehr (sonst blieb nach einem Ausfall
  alles für immer liegen); fremde ungepushte Commits weiterhin schon.
- Vault: jeder Commit geht nach FAH-Git (Regel), daher pusht das Cockpit alles Ungepushte mit – Haupt oder Ersatz.
- „In FAH-Git anlegen“ nur am Haupt (ein Projekt nur am Ersatz fehlte sonst später am Haupt).
- Der git-Zugang wird für beide Hosts hinterlegt (der Ersatz übernimmt Konten und Zugangsschlüssel vom Haupt).

## 0.11.1 – Fenster verschiebbar (27.11.2026)

Betreiber: „ich kann das fenster auch nicht verschieben“. Ursache: `.fullSizeContentView` ließ die WKWebView bis in die
Titelleiste reichen, die Webseite schluckte dort das Ziehen. Jetzt eigene (dunkle, transparente) Titelleiste über der Seite.

## 0.11.2 – Farben wie das Terminal (27.11.2026)

Betreiber: „die titelleiste lässt sich kaum vom fenster unterscheiden. kannst du die fensterfarbe nicht wie das terminal
gestalten?“ Jetzt neutrale Grautöne wie das macOS-Terminal (Grund #1e1e1e, Seitenleiste #181818, Karten #262626, Ränder
#383838) statt Fast-Schwarz; Titelleiste in der App immer dunkel (darkAqua) und mit Trennlinie abgesetzt.

## 0.12.0 – Neues Projekt, auf Wunsch gleich von Claude gebaut (27.11.2026)

Betreiber: „wie kann ich denn nun neue projekte darin erstellen? es gibt keinen plus button“ und „ich würde auch gerne über
das cockpit genauso wie hier neue projekte per KI bauen lassen“.

- Übersicht: Knopf „+ Neues Projekt“ → `#/neu`. Formular: Name, Ordner (Vorsilbe aus den Einstellungen + Kurzname, z. B.
  `fah-…`; von Hand änderbar), „Worum geht's“, erste To-dos, FAH-Git an/aus mit Ordnerwahl aus `/api/baum` (ohne
  FX-Git/frederix).
- `src/neu.js` `projektAnlegen()`: Ordner + README.md, CLAUDE.md, .gitignore, `git init -b main`, erster Commit (bei
  Fehler wird der neue Ordner wieder entfernt) → in FAH-Git anlegen, Remote fahgit, Push (geht das nicht: lokal + Hinweis)
  → Stand-Datei im Vault (Stand, Offen, Erledigt „Projekt angelegt …“), gebündelt committet.
- „Von Claude bauen lassen“: Beschreibung wie im Chat + Modell/Aufwand/„ohne Rückfrage“. Nach dem Anlegen startet ein
  Auftrag im neuen Projekt (Kontext: was schon angelegt ist), Weiterleitung in die Live-Ansicht. Unklares fragt Claude am
  Ende nach; die Antwort setzt das Gespräch fort (`--resume`).
- Einstellungen, Karte „Neue Projekte“: Vorsilbe und FAH-Git-Standardordner.

## 0.12.1 – ein Schlüssel für Haupt und Ersatz, sichtbar gemacht (27.11.2026)

Betreiber fragte, warum es bei zwei FAH-Git-Verbindungen nur einen Schlüssel gibt. Antwort: Der gekoppelte Ersatz
übernimmt Konten und Zugangsschlüssel laufend vom Haupt – derselbe Schlüssel gilt dort. Die Karte sagt das jetzt und zeigt
beim Ersatz „derselbe Schlüssel wird angenommen“ (geprüft über `/api/konto` am Ersatz) oder den Fehler.

## 0.13.0 – To-dos nach Art (27.11.2026)

Betreiber: „außer bei friday ist soweit alles abgeschlossen … warum dennoch so viele todos als offen?“ Befund: Die 129
To-dos stammen aus den Gedächtnis-Notizen (Einrichtung 27.11.). Laut Git sind sie nicht erledigt, aber großteils keine
offene Arbeit: ~38 Praxistests am echten Gerät, ~31 Schritte/Entscheidungen des Betreibers, 22 optional.

- Kennzeichnung am Anfang des To-dos (wie „(optional)“): `(Betreiber)` = dein Schritt/deine Entscheidung,
  `(Praxistest)` = am echten Gerät/im Browser prüfen; ohne Kennzeichnung = echte Arbeit. `stand.js` liefert je To-do
  `art` und `anzeige`, `offeneZahl()` zählt nur echte Arbeit, `offeneArten()` alle Arten.
- Übersicht: Kachel „Offene Arbeit“ mit „+ N deine Schritte · M Praxistests“; Projektzeile zählt Arbeit (Tooltip mit
  Aufteilung), sonst graue Zahl. „Offene To-dos“ gruppiert nach Art (Sprungmarken), Pillen „du“/„Praxistest“/„optional“;
  „Erledigen“ (Auftrag an Claude) nur bei Arbeit und optional. Neues To-do mit Art-Auswahl. Wissensnetz zählt wie oben.
- Abhaken im Cockpit wird jetzt wie Bearbeiten gebündelt committet und gepusht (vorher blieb es uncommittet).
- 70 vorhandene To-dos gekennzeichnet (nur Kennzeichen davor, Text und Haken des Betreibers unverändert).
- Fehler behoben (Betreiber 27.11.: „wenn ich auf ausklappen klicke, scrollt das fenster weit nach oben“): Bei laufendem
  Auftrag wurde die ganze Seite je Schritt neu aufgebaut; war man nach dem Aufklappen nicht mehr ganz unten, stand der
  Verlauf danach oben. Jetzt tauscht das Cockpit bei gleichem Auftrag und Zustand nur Verlauf, „Jetzt“ und Kopfzeile und
  behält die Scrollposition (unten = folgt, sonst genau dort); Fenster-Scroll bleibt auch beim vollen Neuaufbau. Geprüft
  im Headless-Browser mit nachgestelltem Auftrag (aufgeklappt unten, Mitte, unten folgt).

## 0.13.1 – Inhalt wächst mit dem Fenster (27.11.2026)

Betreiber: „wenn ich das fenster in die breite ziehe, wandert der fensterinhalt in seiner breite nicht mit“. Befund
(gemessen in WebKit headless): `.haupt` hatte `max-width: 1320px` – ab 1552 px Fensterbreite blieb der Hauptbereich
stehen, bei 2200 px waren rechts 648 px leer. Die Swift-Hülle war in Ordnung (WKWebView ist `contentView`, wächst mit).

- `.haupt` ohne Breitendeckel; alle Seiten (Übersicht, To-dos, Aufträge, Notizen, Wissensnetz, Einstellungen) füllen
  jetzt die Breite, auch beim Ziehen (Wissensnetz-Fläche zieht über `resize` mit). Geprüft bei 800/1320/2200/2560 px,
  kein waagrechtes Scrollen. Test `Oberfläche: der Hauptbereich wächst mit dem Fenster` hält das fest.
- Stand-Zeile in der Übersicht: Server kürzt auf 600 statt 220 Zeichen (mit „ …“), sichtbar kürzt das CSS passend zur
  Breite – vorher endete der Text im breiten Fenster mitten in der Zeile.
- Bauskript: `pgrep`/`pkill` am Mac blenden die eigenen Elternprozesse aus. Aus einem Cockpit-Auftrag ist die App selbst
  Elternprozess – `bauen.sh` hielt sie für beendet und tauschte das Paket unter der laufenden App aus (lief weiter mit
  altem Code im Speicher). Jetzt `pgrep -a`/`pkill -a`: die laufende App wird erkannt und ohne `ERSETZEN=1` nicht ersetzt.

## 0.14.0 – Bilder in die Chatzeile, Bilder der App im Repo (27.11.2026)

Betreiber: „zu fah-cockpit fehlen mir noch bilder in fah-git um sehen zu können wie die app aussieht. das sollte als feste
regel für alle projekte gelten.“ Nachtrag: „Zudem kann ich hier in die chat zeile fotos per copy&paste wie im terminal
einfügen um genauer zeigen zu können was ich meine“.

- **Einfügen wie im Terminal:** In der Anweisung auf der Projektseite, beim Nachschreiben im Auftrag und bei „Von Claude
  bauen lassen“ (Neues Projekt) nimmt das Textfeld Bilder an: ⌘V (Bildschirmfoto, kopiertes Bild, im Finder kopierte
  Bilddatei – reiner Text wird wie immer eingefügt), Hineinziehen (das Feld leuchtet blau) oder Knopf „Bild …“. Vorschau
  unter dem Feld, × entfernt, Klick = groß. Bis zu 10 Bilder je Nachricht; auch nur ein Bild ohne Text geht.
- **Im Browser vorbereitet:** Lange Kante über 2000 px wird verkleinert (mehr nutzt Claude nicht), fremde Formate (HEIC,
  TIFF …) werden PNG, sehr bunte Fotos über 3,6 MB JPEG. Die Vorschau überlebt das Neuzeichnen der Seite (je Formular gemerkt).
- **Server** (`src/bilder.js`): Art an den ersten Bytes (PNG, JPEG, GIF, WebP – kein SVG), höchstens 3,75 MB je Bild
  (≈ 5 MB base64, Grenze der Claude-API), Anfrage mit Bildern bis 52 MB. Ablage `<Ablage>/auftraege/bilder/<Auftrag>/bild-NN.<endung>`
  (Ordner 700, Dateien 600), wird mit dem Auftrag aufgeräumt. Ausgeliefert nur über `/api/auftrag/bild?id=&name=` für Namen,
  die im Verlauf dieses Auftrags stehen (`nosniff`, `Cross-Origin-Resource-Policy: same-origin`, im Speicher behaltbar).
- **An Claude:** wie beim Einfügen im Terminal als Bild-Block der Streaming-Eingabe (`content: [{type:'text'}, {type:'image',
  source:{type:'base64'}}]`) – im Probelauf mit haiku belegt (rotes Testbild → „Rot“). Der Text nennt zusätzlich die Dateipfade,
  damit Claude ein Bild bei Bedarf ins Projekt kopieren kann. Ohne Bild bleibt der Inhalt ein einfacher Text wie bisher.
- **Spiegel:** `claude-wissen/auftraege/<id>.md` verweist mit `![Bild 1](<id>/bild-01.png)` auf die Bilder, die daneben liegen
  (Regel „alles von und zu Claude ins FAH-Git“).
- **Mac-App:** `<input type=file>` braucht in einer WKWebView einen eigenen Öffnen-Dialog (`runOpenPanelWith`, nur Bilder,
  als Blatt am Fenster). ⌘V und Hineinziehen gehen über WebKit selbst.
- **Bilder der App:** `docs/screenshots/*.png` + README-Abschnitt „So sieht es aus“. `werkzeuge/bildschirmfotos.mjs` baut
  eine Wegwerf-Instanz mit erfundenen Daten (Max Mustermann, 192.168.1.x, sechs Demo-Projekte, Platzhalter statt Claude,
  Schlüsselbund aus), bedient sie in Chromium headless über das DevTools-Protokoll (Einfügen, Ziehen, „Bild …“, Entfernen,
  großes Bild, Senden, Großansicht, Nachschreiben, 720/2200 px ohne Überlauf – 20 Prüfungen) und fotografiert neun Seiten.
  `--nur-probe` = nur bedienen. Feste Regel für alle Projekte in `~/.claude/CLAUDE.md` („Bilder der App ins FAH-Git“).
- Nebenbei: Platzhalter der FAH-Git-Verbindung neutral (`192.168.1.20`, „Benutzername in FAH-Git“ statt eigener Adressen
  und Vorname – das Cockpit ist zum Verteilen gedacht); `server.js` gibt `COCKPIT_GEDAECHTNIS` auch an das Wissensnetz.
- Nach unabhängiger Prüfung: höchstens 12 MB Bilder je Nachricht und 20 MB je Auftrag (`--resume` schickt den ganzen
  Verlauf mit, die Claude-API nimmt höchstens 32 MB je Anfrage), die Oberfläche macht jedes Bild auf höchstens 1,5 MB klein.
  ⌘V mit echtem Text (Excel, Numbers, Word legen Text und Bild ab) fügt wie immer Text ein. Kein doppeltes Senden per
  Enter, Bilder, die noch vorbereitet werden, gehen nicht verloren. Nachschreiben prüft nach dem Ablegen erneut, ob es
  den Auftrag und sein Gespräch noch gibt. Bekannt (schon vor 0.14.0): Läuft ein Auftrag gerade beim Spiegeln, fehlen
  sein Verlauf und seine Bilder in `claude-wissen/` bis zum nächsten Lauf.
