#!/bin/bash
# (c) 2026 Fabian Hammer - Alle Rechte vorbehalten.
# Baut FAH-Cockpit.app: Swift-Hülle + offizielles Node (nodejs.org, SHA-256 geprüft) + Cockpit-Code aus ../src und ../public,
# signiert mit dem Apple-Development-Zertifikat, ersetzt /Applications/FAH-Cockpit.app und legt das ZIP in NEUE ZIPs.
#   mac/FAH-Cockpit.app        = Bau-Stand im Git: nur die Swift-Hülle (ohne Node, ohne Cockpit-Code)
#   mac/build/FAH-Cockpit.app  = komplette App (nicht im Git)
# Aufruf: ./bauen.sh            (ERSETZEN=1 ./bauen.sh ersetzt auch eine laufende App – Aufträge brechen dann ab)
set -euo pipefail
cd "$(dirname "$0")"
NODE_VERSION="v26.13.1"
NODE_PAKET="node-$NODE_VERSION-darwin-arm64"
CACHE="$HOME/Library/Caches/fah-cockpit-bau"
APP="build/FAH-Cockpit.app"
mkdir -p "$CACHE"

# 1. Node holen und prüfen (einmal, dann aus dem Zwischenspeicher)
if [ ! -x "$CACHE/$NODE_PAKET/bin/node" ]; then
  echo "→ Node $NODE_VERSION laden …"
  curl -fsSL -o "$CACHE/$NODE_PAKET.tar.gz" "https://nodejs.org/dist/$NODE_VERSION/$NODE_PAKET.tar.gz"
  curl -fsSL -o "$CACHE/SHASUMS256.txt" "https://nodejs.org/dist/$NODE_VERSION/SHASUMS256.txt"
  soll="$(grep " $NODE_PAKET.tar.gz\$" "$CACHE/SHASUMS256.txt" | cut -d' ' -f1)"
  ist="$(shasum -a 256 "$CACHE/$NODE_PAKET.tar.gz" | cut -d' ' -f1)"
  [ -n "$soll" ] && [ "$soll" = "$ist" ] || { echo "✖ Prüfsumme von Node stimmt nicht"; exit 1; }
  tar -xzf "$CACHE/$NODE_PAKET.tar.gz" -C "$CACHE"
  rm -f "$CACHE/$NODE_PAKET.tar.gz"
fi

# 2. Swift-Hülle bauen
echo "→ Swift-Hülle bauen …"
swift build -c release 2>&1 | grep -E "error|warning: unre|Compiling|Build complete" | grep -v "^$" | tail -5
BIN="$(swift build -c release --show-bin-path)"

# 3. App zusammensetzen
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/cockpit" "$APP/Contents/Resources/node/bin"
cp "$BIN/FAHCockpit" "$APP/Contents/MacOS/FAHCockpit"
cp Resources/Info.plist "$APP/Contents/Info.plist"
cp Resources/AppIcon.icns "$APP/Contents/Resources/"
cp -R ../src ../public ../package.json "$APP/Contents/Resources/cockpit/"
# Kopfkommentar ohne Wohnadresse: die ZIP kann als GitHub-Release öffentlich werden, und dort greift die Text-Bereinigung
# des Spiegels nicht (27.11.2026). „Erdacht und programmiert von …“ bleibt, nur der Rest der Zeile fällt weg.
find "$APP/Contents/Resources/cockpit" -type f \( -name '*.js' -o -name '*.mjs' -o -name '*.css' -o -name '*.html' \) \
  -exec perl -pi -e 's/(Erdacht und programmiert von [^,\n]+),[^\n]*/$1./' {} +
if grep -rIqE "Erdacht und programmiert von [^,]+," "$APP/Contents/Resources/cockpit"; then echo "✖ Adresse im Kopfkommentar übrig"; exit 1; fi
cp "$CACHE/$NODE_PAKET/bin/node" "$APP/Contents/Resources/node/bin/node"
cp "$CACHE/$NODE_PAKET/LICENSE" "$APP/Contents/Resources/node/LICENSE"
VERSION="$(python3 -c 'import json;print(json.load(open("../package.json"))["version"])')"
BAU="$(git -C .. rev-list --count HEAD)"
/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $VERSION" -c "Set :CFBundleVersion $BAU" "$APP/Contents/Info.plist"

# 4. Signieren (wie im Multitool: erstes funktionierendes Apple-Development-Zertifikat)
find_identity() {
  local probe; probe="$(mktemp -d)/p"; cp /usr/bin/true "$probe"
  while read -r _ hash _; do
    [ -n "$hash" ] || continue
    if codesign --force --sign "$hash" "$probe" >/dev/null 2>&1; then echo "$hash"; return 0; fi
  done < <(security find-identity -v -p codesigning 2>/dev/null | grep '"Apple Development: ')
  return 1
}
IDENT="${FAH_SIGN_IDENTITY:-$(find_identity || echo -)}"
[ "$IDENT" = "-" ] && echo "⚠️  Kein Apple-Development-Zertifikat – signiere ad-hoc."
codesign --force --options runtime --entitlements Resources/node.entitlements --sign "$IDENT" "$APP/Contents/Resources/node/bin/node"
codesign --force --options runtime --sign "$IDENT" "$APP"
codesign --verify --strict --deep "$APP"
echo "✅ $APP ($VERSION, Bau $BAU)"

# 5. Bau-Stand fürs Git: nur die Hülle
rm -rf FAH-Cockpit.app
mkdir -p FAH-Cockpit.app/Contents/MacOS FAH-Cockpit.app/Contents/Resources
cp "$APP/Contents/MacOS/FAHCockpit" FAH-Cockpit.app/Contents/MacOS/
cp "$APP/Contents/Info.plist" FAH-Cockpit.app/Contents/
cp Resources/AppIcon.icns FAH-Cockpit.app/Contents/Resources/

# 6. Installieren (eine laufende App nur mit ERSETZEN=1 – sonst brächen Aufträge ab).
#    -a: auch Elternprozesse zählen – aus einem Cockpit-Auftrag ist die App selbst Elternprozess und blieb sonst unsichtbar
if pgrep -a -x FAHCockpit >/dev/null && [ "${ERSETZEN:-0}" != "1" ]; then
  echo "ℹ️  FAH-Cockpit läuft – nicht ersetzt. Beenden und ./bauen.sh erneut, oder ERSETZEN=1 ./bauen.sh"
else
  if pgrep -a -x FAHCockpit >/dev/null; then
    osascript -e 'tell application id "de.fah.cockpit" to quit' >/dev/null 2>&1 || pkill -a -x FAHCockpit || true
    for i in $(seq 1 20); do pgrep -a -x FAHCockpit >/dev/null || break; sleep 0.5; done
  fi
  rm -rf "/Applications/FAH-Cockpit.app"
  ditto "$APP" "/Applications/FAH-Cockpit.app"
  echo "✅ Installiert: /Applications/FAH-Cockpit.app"
fi

# 7. ZIP in NEUE ZIPs (Ablage-Struktur wie bei den anderen Mac-Apps)
ZIPS="$HOME/claude/NEUE ZIPs/Eigene Apps/Mac-Apps"
if [ -d "$ZIPS" ]; then
  rm -f "$ZIPS/fah-cockpit_release.zip"
  ditto -c -k --keepParent "$APP" "$ZIPS/fah-cockpit_release.zip"
  echo "✅ Abgelegt: $ZIPS/fah-cockpit_release.zip"
fi
