#!/bin/bash
# (c) 2026 Fabian Hammer - Alle Rechte vorbehalten.
# Installiert FAH-Cockpit als LaunchAgent (startet mit der Anmeldung, läuft weiter, nur 127.0.0.1:8130).
# Erneut aufrufen = neu starten (z. B. nach einem Update).
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="de.fah.cockpit"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
NODE="$(command -v node || true)"
[ -n "$NODE" ] || { echo "node nicht gefunden" >&2; exit 1; }
PATH="$HOME/.local/bin:$PATH" command -v claude >/dev/null || echo "Hinweis: claude nicht gefunden – Aufträge an Claude gehen dann nicht." >&2
mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<!-- (c) 2026 Fabian Hammer. FAH-Cockpit – erzeugt von werkzeuge/installieren.sh -->
<plist version="1.0">
<dict>
	<key>Label</key><string>$LABEL</string>
	<key>ProgramArguments</key>
	<array><string>$NODE</string><string>$REPO/src/server.js</string></array>
	<key>EnvironmentVariables</key>
	<dict><key>PATH</key><string>$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string><key>HOME</key><string>$HOME</string></dict>
	<key>RunAtLoad</key><true/>
	<key>KeepAlive</key><true/>
	<key>ThrottleInterval</key><integer>10</integer>
	<key>Nice</key><integer>5</integer>
	<key>LowPriorityIO</key><true/>
	<key>StandardOutPath</key><string>$HOME/Library/Logs/fah-cockpit.log</string>
	<key>StandardErrorPath</key><string>$HOME/Library/Logs/fah-cockpit.log</string>
</dict>
</plist>
PLIST
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
# bootout arbeitet nachlaufend – warten, bis der alte Dienst wirklich weg ist
for i in $(seq 1 40); do launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || break; sleep 0.25; done
launchctl bootstrap "gui/$(id -u)" "$PLIST"
for i in $(seq 1 20); do curl -fsS -o /dev/null http://localhost:8130/ 2>/dev/null && { echo "FAH-Cockpit läuft: http://localhost:8130"; exit 0; }; sleep 0.5; done
echo "FAH-Cockpit startet nicht – siehe ~/Library/Logs/fah-cockpit.log" >&2; exit 1
