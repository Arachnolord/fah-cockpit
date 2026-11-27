// ============================================================================
// Erdacht und programmiert von Fabian Hammer, Deutschland.
// (c) 2026 Fabian Hammer - Alle Rechte vorbehalten. Geistiges Eigentum.
// ============================================================================
// Bildschirmfotos für docs/screenshots/ (README „So sieht es aus“) – und dabei eine Bedienprobe der Oberfläche.
//
//   node werkzeuge/bildschirmfotos.mjs            Fotos neu machen (nach jeder sichtbaren Änderung)
//   node werkzeuge/bildschirmfotos.mjs --nur-probe  nur bedienen und prüfen, keine Fotos schreiben
//
// Nie die echte Instanz: Eine Wegwerf-Instanz mit ERFUNDENEN Daten (Max Mustermann, 192.168.1.x, Demo-Projekte) läuft
// auf einem freien Port, „Claude“ ist ein Platzhalter-Skript (kein echtes Modell, keine Kosten), Schlüsselbund aus.
// Der Browser ist Chromium headless (Playwright-Zwischenspeicher, sonst COCKPIT_CHROME), gedrosselt mit taskpolicy -b.
// Bedient wird über das DevTools-Protokoll (Node ≥ 22 hat WebSocket eingebaut): Einfügen (⌘V), Hineinziehen,
// „Bild …“, Entfernen, Senden, Großansicht – jede Stufe wird geprüft; dazu schmal (720 px) und breit (2200 px).

import { spawn, execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile, readFile, rm, chmod } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cockpit } from '../src/server.js';
import { Auftraege } from '../src/auftraege.js';
import { Einstellungen } from '../src/einstellungen.js';
import { WissenSpiegel } from '../src/wissen.js';
import { Limit } from '../src/limit.js';

const HIER = path.dirname(fileURLToPath(import.meta.url));
const ZIEL = path.join(HIER, '..', 'docs', 'screenshots');
const NUR_PROBE = process.argv.includes('--nur-probe');
const BREITE = 1440, HOEHE = 900, SKALA = 2;
const warte = ms => new Promise(r => setTimeout(r, ms));
let fehler = 0;
const pruefe = (ok, was) => { console.log((ok ? '  ✔ ' : '  ✖ ') + was); if (!ok) fehler++; };

// ---------------------------------------------------------------------------------------------------------------
// 1. Demo-Daten (alles erfunden)

const TAG = n => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString(); };
const PROJEKTE = [
  { ordner: 'fah-wetterstation', datei: ['package.json', JSON.stringify({ name: 'fah-wetterstation', version: '1.4.2' }, null, 2)], git: 'gesichert',
    commits: ['Erster Stand: Sensoren auslesen', 'Verlauf über 30 Tage', '1.3.0: Frostwarnung per Mitteilung', '1.4.0: Regenmesser eingebunden', '1.4.2: CSV-Export mit Datum'],
    stand: `---\nordner: fah-wetterstation\nstatus: aktiv\naktualisiert: 2026-11-25\nquelle: Demo\n---\n# FAH-Wetterstation\n\n## Stand\n\nWetterstation 1.4.2 vom 25.11.2026 auf dem Raspberry Pi im Garten (192.168.1.40:8080): Temperatur, Luftfeuchte, Wind und Regen, Verlauf über 30 Tage, Frostwarnung per Mitteilung. Neu in 1.4: Regenmesser und Export als CSV.\n\n## Offen\n\n- [ ] Diagramm für den Luftdruck ergänzen\n- [ ] Spalte „Letzter Deploy“ in der Übersicht\n- [ ] (Praxistest) Frostwarnung bei unter 0 °C am Gerät prüfen\n- [ ] (Betreiber) Entscheiden: Messwerte länger als 30 Tage aufheben?\n- [ ] (optional) Helles Design für das Handy\n\n## Erledigt\n\n- [x] 2026-11-25 Regenmesser eingebunden (1.4.0)\n- [x] 2026-11-20 Frostwarnung (1.3.0)\n` },
  { ordner: 'fah-haushaltsbuch', datei: ['VERSION', '0.9.0\n'], git: 'geaendert',
    commits: ['Kontoauszüge als CSV einlesen', 'Kategorien automatisch zuordnen', '0.9.0: Monatsbericht als PDF'],
    stand: `---\nordner: fah-haushaltsbuch\nstatus: aktiv\naktualisiert: 2026-11-22\nquelle: Demo\n---\n# FAH-Haushaltsbuch\n\n## Stand\n\nHaushaltsbuch 0.9.0 vom 22.11.2026: Kontoauszüge als CSV einlesen, Buchungen automatisch nach Kategorie sortieren, Monatsbericht als PDF.\n\n## Offen\n\n- [ ] Import für das neue CSV-Format der Bank\n- [ ] Kategorien selbst anlegen und umbenennen\n- [ ] (Praxistest) Monatsbericht November ausdrucken\n` },
  { ordner: 'fah-fotorahmen', datei: ['version.txt', '2.1.0\n'], git: 'ungepusht',
    commits: ['Fotos aus dem Album zeigen', 'Nachts dunkel', '2.0.0: Wetter am Morgen', '2.1.0: Übergänge überblenden'],
    stand: `---\nordner: fah-fotorahmen\nstatus: aktiv\naktualisiert: 2026-11-26\nquelle: Demo\n---\n# FAH-Fotorahmen\n\n## Stand\n\nDigitaler Bilderrahmen 2.1.0 vom 26.11.2026 auf dem alten Tablet in der Küche: Fotos aus dem Familienalbum, nachts dunkel, morgens mit Wetter.\n\n## Offen\n\n- [ ] Übergänge weicher machen\n- [ ] (Betreiber) Album für Dezember auswählen\n` },
  { ordner: 'fah-vokabeltrainer', datei: ['package.json', JSON.stringify({ name: 'fah-vokabeltrainer', version: '0.3.1' }, null, 2)], git: 'gesichert',
    commits: ['Karteikasten mit fünf Fächern', '0.3.0: Französisch dazu', '0.3.1: Tippfehler zählen halb'],
    stand: `---\nordner: fah-vokabeltrainer\nstatus: aktiv\naktualisiert: 2026-11-18\nquelle: Demo\n---\n# FAH-Vokabeltrainer\n\n## Stand\n\nVokabeltrainer 0.3.1 vom 18.11.2026 für Englisch und Französisch: Karteikasten mit fünf Fächern, läuft im Browser.\n\n## Offen\n\n- [ ] Aussprache per Sprachausgabe\n- [ ] (optional) Statistik je Woche\n` },
  { ordner: 'fah-gartenwasser', datei: ['VERSION', '0.6.0\n'], git: 'gesichert',
    commits: ['Ventile über ESP32 schalten', '0.6.0: Feuchtesensor je Beet'],
    stand: `---\nordner: fah-gartenwasser\nstatus: ruht\naktualisiert: 2026-10-30\nquelle: Demo\n---\n# FAH-Gartenwasser\n\n## Stand\n\nBewässerung für die Hochbeete (ESP32 und vier Ventile), ruht über den Winter.\n\n## Offen\n\n- [ ] (Praxistest) Im Frühjahr Ventile und Schläuche prüfen\n` },
  { ordner: 'fah-rezeptbuch', datei: ['README.md', '# Rezeptbuch\n'], git: 'ohne-upstream', commits: ['Erster Entwurf'] },
];

const NOTIZEN = {
  'mensch/ideen/2026-11-26 Zweiter Sensor am Balkon.md': '# Zweiter Sensor am Balkon\n\nFür die Wetterstation einen zweiten Fühler auf dem Balkon – dann sieht man, wie viel wärmer es an der Hauswand ist.\n\n- Funk oder Kabel?\n- Batterie hält wie lange?\n',
  'mensch/ideen/2026-11-20 Einkaufsliste per Sprache.md': '# Einkaufsliste per Sprache\n\n„Milch auf die Liste“ in der Küche sagen, die Liste landet auf dem Handy.\n',
  'mensch/notizen/2026-11-24 Router im Flur.md': '# Router im Flur\n\nRouter vom Arbeitszimmer in den Flur umgezogen, Adresse bleibt 192.168.1.1. Fotorahmen und Wetterstation danach neu verbunden.\n',
  'mensch/aufnahmen/2026-11-27 Sprachnotiz Fotorahmen.md': '# Sprachnotiz Fotorahmen\n\nDie Übergänge wirken noch hart, lieber zwei Sekunden überblenden. Und abends ab neun dunkler.\n',
};

const GEDAECHTNIS = {
  'MEMORY.md': '- [Wetterstation](wetterstation-pi.md)\n- [Haushaltsbuch](haushaltsbuch-csv.md)\n- [Fotorahmen](fotorahmen-tablet.md)\n- [Antworten kurz](antworten-kurz.md)\n',
  'wetterstation-pi.md': '---\nname: wetterstation-pi\ndescription: Wetterstation läuft auf dem Pi im Garten\nmetadata:\n  type: project\n---\n\n~/claude/fah-wetterstation läuft auf dem Raspberry Pi (192.168.1.40). Deploy über `manage.sh update`. Siehe [[antworten-kurz]].\n',
  'haushaltsbuch-csv.md': '---\nname: haushaltsbuch-csv\ndescription: CSV-Formate der Bank\nmetadata:\n  type: reference\n---\n\n~/claude/fah-haushaltsbuch liest zwei CSV-Formate: alt (Semikolon) und neu ab Dezember (Komma, UTF-8).\n',
  'fotorahmen-tablet.md': '---\nname: fotorahmen-tablet\ndescription: Fotorahmen auf dem alten Tablet\nmetadata:\n  type: project\n---\n\n~/claude/fah-fotorahmen läuft im Vollbild-Browser auf dem Küchen-Tablet, Album „Familie“.\n',
  'antworten-kurz.md': '---\nname: antworten-kurz\ndescription: Kurz antworten\nmetadata:\n  type: feedback\n---\n\nKurz antworten, keine Textwände.\n',
};

// „Claude“ für die Probe: antwortet mit erfundenen Schritten; „Release/Push“ wartet auf eine Freigabe-Karte.
const FAKE_CLAUDE = `#!/usr/bin/env node
const fs = require('node:fs'); const readline = require('node:readline'); const { execSync } = require('node:child_process');
const a = process.argv.slice(2);
if (a[0] === '--version') { console.log('2.1.30 (Claude Code)'); process.exit(0); }
if (a[0] === 'auth') { console.log(JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty', email: 'max@example.com', orgName: 'Max Mustermann', subscriptionType: 'max', loginExpiresAt: '2027-02-01T10:00:00Z' })); process.exit(0); }
const einst = JSON.parse(fs.readFileSync(a[a.indexOf('--settings') + 1], 'utf8'));
const haken = einst.hooks.PreToolUse[0].hooks[0].command;
const aus = e => process.stdout.write(JSON.stringify(e) + '\\n');
const eingang = []; let zu = false;
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', l => { try { eingang.push(JSON.parse(l).message.content); } catch {} });
rl.on('close', () => { zu = true; });
const w = ms => new Promise(r => setTimeout(r, ms));
let n = 0;
async function schritt(name, input, ausgabe, mitHaken) {
  const id = 'toolu_' + (++n);
  aus({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input }] } });
  if (mitHaken) execSync(haken, { input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: name, tool_input: input, tool_use_id: id }), shell: '/bin/sh' });
  await w(350);
  aus({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: ausgabe }] } });
}
(async () => {
  while (!eingang.length) await w(10);
  const c = eingang.shift();
  const text = typeof c === 'string' ? c : (c.find(b => b.type === 'text') || {}).text || '';
  const bilder = typeof c === 'string' ? 0 : c.filter(b => b.type === 'image').length;
  aus({ type: 'system', subtype: 'init', session_id: 'demo-' + Date.now(), model: 'claude-opus-5-5' });
  const jetzt = Math.floor(Date.now() / 1000);
  aus({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed', unifiedWindows: { five_hour: { utilization: 0.23, resetsAt: jetzt + 7200, status: 'allowed' }, seven_day: { utilization: 0.41, resetsAt: jetzt + 86400 * 3, status: 'allowed' } } } });
  if (/Raspberry Pi bringen/.test(text)) {
    aus({ type: 'assistant', message: { content: [{ type: 'text', text: 'Ich baue das Release 1.4.3 und bringe es danach auf den Pi.' }] } });
    await schritt('Bash', { command: 'npm test', description: 'Tests vor dem Release' }, '✔ 24 Tests bestanden (1,8 s)');
    await schritt('Bash', { command: 'git tag v1.4.3', description: 'Version markieren' }, '');
    await schritt('Bash', { command: 'git push fahgit HEAD:main --tags', description: 'Release 1.4.3 nach FAH-Git, danach holt der Pi es per manage.sh update' }, 'To http://192.168.1.20:3300/eigene-projekte/fah-wetterstation.git', true);
    aus({ type: 'result', subtype: 'success', is_error: false, result: 'Release 1.4.3 ist in FAH-Git.', session_id: 'demo', total_cost_usd: 0.21, duration_ms: 64000 });
  } else {
    aus({ type: 'assistant', message: { content: [{ type: 'text', text: bilder ? 'Danke für das Bild – ich sehe die Übersicht mit Version und Git-Stand, die Spalte fehlt dort. Ich sehe mir die Tabelle an.' : 'Ich sehe mir das an.' }] } });
    await schritt('Read', { file_path: '/Users/max/claude/fah-wetterstation/public/app.js' }, '… 412 Zeilen');
    await schritt('Grep', { pattern: 'spalten', path: '/Users/max/claude/fah-wetterstation/public' }, 'public/app.js:88: const spalten = [');
    await schritt('Edit', { file_path: '/Users/max/claude/fah-wetterstation/public/app.js', old_string: 'x', new_string: 'y' }, 'Datei geändert');
    await schritt('Bash', { command: 'npm test', description: 'Tests laufen lassen' }, '✔ 24 Tests bestanden (1,7 s)');
    await schritt('Bash', { command: 'git commit -am "1.4.3: Spalte Letzter Deploy in der Übersicht"', description: 'Änderung sichern' }, '[main 4f2a9c1] 1.4.3: Spalte Letzter Deploy in der Übersicht');
    const erg = bilder && /Siehe Bild|ausgegraut/.test(text)
      ? 'Erledigt: Das Datum in der neuen Spalte ist jetzt nicht mehr ausgegraut, sondern so hell wie die Version. Tests grün (24/24).'
      : 'Erledigt: In der Übersicht steht jetzt die Spalte **Letzter Deploy** rechts neben der Version, sortierbar. Tests grün (24/24), committet als 1.4.3. Offen: Push nach FAH-Git und Deploy auf den Pi – sag Bescheid, dann starte ich es.';
    aus({ type: 'assistant', message: { content: [{ type: 'text', text: erg }] } });
    aus({ type: 'result', subtype: 'success', is_error: false, result: erg, session_id: 'demo', total_cost_usd: 0.34, duration_ms: 95000 });
  }
  while (!zu) await w(10);
  process.exit(0);
})();
`;

function git(ordner, args, datum) {
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_AUTHOR_NAME: 'Max Mustermann', GIT_AUTHOR_EMAIL: 'max@example.com',
    GIT_COMMITTER_NAME: 'Max Mustermann', GIT_COMMITTER_EMAIL: 'max@example.com', ...(datum ? { GIT_AUTHOR_DATE: datum, GIT_COMMITTER_DATE: datum } : {}) };
  return execFileSync('git', ['-c', 'credential.helper=', '-c', 'init.defaultBranch=main', '-c', 'commit.gpgsign=false', '-C', ordner, ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
}

async function demoBauen(basis) {
  const wurzel = path.join(basis, 'claude'), vault = path.join(basis, 'Arbeit'), mem = path.join(basis, 'gedaechtnis'), ablage = path.join(basis, 'ablage');
  for (const d of [wurzel, path.join(vault, 'maschine', 'projekte'), mem, ablage, path.join(basis, 'remotes')]) await mkdir(d, { recursive: true });
  for (const [i, p] of PROJEKTE.entries()) {
    const ordner = path.join(wurzel, p.ordner);
    await mkdir(ordner);
    git(ordner, ['init', '-q']);
    await writeFile(path.join(ordner, p.datei[0]), p.datei[1]);
    p.commits.forEach((m, k) => {
      execFileSync('/bin/sh', ['-c', `echo "${k}" >> "${path.join(ordner, 'verlauf.txt')}"`]);
      git(ordner, ['add', '-A']);
      git(ordner, ['commit', '-q', '-m', m], TAG((p.commits.length - k) * 2 + i));
    });
    if (p.git !== 'ohne-upstream') {
      const nackt = path.join(basis, 'remotes', p.ordner + '.git');
      execFileSync('git', ['init', '-q', '--bare', nackt]);
      git(ordner, ['remote', 'add', 'fahgit', nackt]);
      git(ordner, ['push', '-q', '-u', 'fahgit', 'main']);
      // Adresse wie ein FAH-Git im Heimnetz (erfunden) – der Cockpit-Teil misst nur lokal, kein fetch
      git(ordner, ['remote', 'set-url', 'fahgit', `http://192.168.1.20:3300/eigene-projekte/${p.ordner}.git`]);
    }
    if (p.git === 'ungepusht') { await writeFile(path.join(ordner, 'neu.txt'), 'x'); git(ordner, ['add', '-A']); git(ordner, ['commit', '-q', '-m', '2.1.1: nachts ab 21 Uhr dunkler'], TAG(0)); }
    if (p.git === 'geaendert') { await writeFile(path.join(ordner, 'import.js'), '// neues CSV-Format\n'); }
    if (p.stand) await writeFile(path.join(vault, 'maschine', 'projekte', p.ordner + '.md'), p.stand);
  }
  for (const [rel, text] of Object.entries(NOTIZEN)) { await mkdir(path.dirname(path.join(vault, rel)), { recursive: true }); await writeFile(path.join(vault, rel), text); }
  for (const [rel, text] of Object.entries(GEDAECHTNIS)) await writeFile(path.join(mem, rel), text);
  const claude = path.join(basis, 'fake-claude.cjs');
  await writeFile(claude, FAKE_CLAUDE); await chmod(claude, 0o755);
  return { wurzel, vault, mem, ablage, claude };
}

// ---------------------------------------------------------------------------------------------------------------
// 2. Browser (Chromium headless über das DevTools-Protokoll)

function chromeFinden() {
  if (process.env.COCKPIT_CHROME) return { bin: process.env.COCKPIT_CHROME, args: ['--headless=new'] };
  const cache = path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright');
  const ordner = existsSync(cache) ? readdirSync(cache).sort().reverse() : [];
  for (const d of ordner.filter(n => n.startsWith('chromium_headless_shell-'))) {
    const p = path.join(cache, d, 'chrome-headless-shell-mac-arm64', 'chrome-headless-shell');
    if (existsSync(p)) return { bin: p, args: [] };
  }
  for (const d of ordner.filter(n => n.startsWith('chromium-'))) {
    const p = path.join(cache, d, 'chrome-mac-arm64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing');
    if (existsSync(p)) return { bin: p, args: ['--headless=new'] };
  }
  throw new Error('Kein Chromium gefunden – COCKPIT_CHROME=<Pfad zu einem Chrome> setzen');
}

async function browserStarten(profil) {
  const { bin, args } = chromeFinden();
  const kind = spawn('/usr/sbin/taskpolicy', ['-b', bin, ...args, '--remote-debugging-port=0', `--user-data-dir=${profil}`,
    '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--mute-audio', '--disable-gpu', 'about:blank'],
  { stdio: ['ignore', 'ignore', 'pipe'] });
  const adresse = await new Promise((ok, nein) => {
    let puffer = '';
    const zeit = setTimeout(() => nein(new Error('Chromium meldet sich nicht')), 20_000);
    kind.stderr.on('data', d => { puffer += d; const m = puffer.match(/DevTools listening on (ws:\/\/\S+)/); if (m) { clearTimeout(zeit); ok(m[1]); } });
    kind.on('exit', c => nein(new Error('Chromium beendet: ' + c)));
  });
  const ws = new WebSocket(adresse);
  await new Promise((ok, nein) => { ws.onopen = ok; ws.onerror = nein; });
  let n = 0; const offen = new Map();
  ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && offen.has(d.id)) { const p = offen.get(d.id); offen.delete(d.id); d.error ? p.nein(new Error(d.error.message)) : p.ok(d.result); } };
  const senden = (method, params = {}, sessionId) => { const id = ++n; ws.send(JSON.stringify({ id, method, params, sessionId })); return new Promise((ok, nein) => offen.set(id, { ok, nein })); };
  const { targetId } = await senden('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await senden('Target.attachToTarget', { targetId, flatten: true });
  const s = (method, params) => senden(method, params, sessionId);
  await s('Page.enable'); await s('Runtime.enable'); await s('DOM.enable');
  const seite = {
    s,
    async js(ausdruck) {
      const r = await s('Runtime.evaluate', { expression: ausdruck, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error('JS: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
      return r.result.value;
    },
    async bis(ausdruck, was, ms = 15_000) {
      const ende = Date.now() + ms;
      for (;;) { if (await seite.js(ausdruck).catch(() => false)) return true; if (Date.now() > ende) throw new Error('Zeitüberschreitung: ' + was); await warte(100); }
    },
    async groesse(w, h = HOEHE) { await s('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: SKALA, mobile: false }); await warte(150); },
    async gehe(url, bereit, was) { await s('Page.navigate', { url }); await seite.bis(bereit, was); await warte(300); },
    async foto(name) {
      if (NUR_PROBE) return;
      await seite.js('document.activeElement && document.activeElement.blur && document.activeElement.blur(), true');
      await warte(250);
      const { data } = await s('Page.captureScreenshot', { format: 'png' });
      await writeFile(path.join(ZIEL, name), Buffer.from(data, 'base64'));
      console.log('  📷 docs/screenshots/' + name);
    },
  };
  return { seite, ende: async () => { try { ws.close(); } catch { /* weg */ } kind.kill('SIGTERM'); await new Promise(r => { kind.once('exit', r); setTimeout(r, 3000); }); } };
}

// Im Browser: Datei bauen und als Einfügen (⌘V) bzw. Hineinziehen auslösen
const JS_HILFEN = `
window.__datei = (b64, name, typ) => { const roh = atob(b64); const u = new Uint8Array(roh.length); for (let i = 0; i < roh.length; i++) u[i] = roh.charCodeAt(i); return new File([u], name, { type: typ }); };
window.__einfuegen = (ziel, dateien, text) => { const dt = new DataTransfer(); for (const d of dateien) dt.items.add(d); if (text) dt.setData('text/plain', text);
  const e = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }); document.querySelector(ziel).dispatchEvent(e); return e.defaultPrevented; };
window.__ziehen = (ziel, dateien) => { const dt = new DataTransfer(); for (const d of dateien) dt.items.add(d); const el = document.querySelector(ziel);
  el.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true })); const hell = el.closest('form').classList.contains('zieht');
  el.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); return hell; };
window.__grossesBild = () => new Promise(ok => { const c = document.createElement('canvas'); c.width = 3400; c.height = 2200; const g = c.getContext('2d');
  const d = g.createImageData(c.width, c.height); for (let i = 0; i < d.data.length; i++) d.data[i] = (i * 2654435761 >>> 13) & 255; g.putImageData(d, 0, 0);
  c.toBlob(b => ok(new File([b], 'riesig.png', { type: 'image/png' })), 'image/png'); });
window.__anzahl = () => document.querySelectorAll('.anhaenge .anhang').length;
window.__ueberlauf = () => document.documentElement.scrollWidth > window.innerWidth + 1;
true`;

// ---------------------------------------------------------------------------------------------------------------
// 3. Ablauf

async function hauptlauf() {
  const basis = await mkdtemp(path.join(os.tmpdir(), 'fah-cockpit-demo-'));
  const profil = await mkdtemp(path.join(os.tmpdir(), 'fah-cockpit-chrome-'));
  let server, auftraege, browser;
  try {
    console.log('→ Demo-Daten in ' + basis);
    const d = await demoBauen(basis);
    if (!NUR_PROBE) await mkdir(ZIEL, { recursive: true });

    // freien Port finden, Cockpit wie in server.js zusammenstecken – nur mit Platzhalter-Claude und ohne Schlüsselbund
    const probe = cockpit({ wurzel: d.wurzel, vault: d.vault, port: 0 });
    await new Promise(r => probe.listen(0, '127.0.0.1', r));
    const port = probe.address().port; probe.close();
    const einstellungen = new Einstellungen({ ablage: d.ablage, claude: d.claude, schluesselbund: false });
    await einstellungen.laden();
    const limit = new Limit({ ablage: d.ablage, claude: d.claude, einstellungen });
    await limit.laden();
    auftraege = new Auftraege({ ablage: d.ablage, wurzel: d.wurzel, vault: d.vault, port, claude: d.claude, einstellungen, arbeitsordner: basis,
      limit: info => limit.merken(info, 'auftrag'), geaendert: () => server?.uebersichtVergessen() });
    await auftraege.laden();
    const wissen = new WissenSpiegel({ wurzel: d.wurzel, vault: d.vault, einstellungen, auftraege: path.join(d.ablage, 'auftraege'), gedaechtnis: d.mem });
    server = cockpit({ wurzel: d.wurzel, vault: d.vault, port, auftraege, einstellungen, wissen, limit, gedaechtnis: d.mem, zwischenspeicherMs: 0 });
    await new Promise(r => server.listen(port, '127.0.0.1', r));
    const url = `http://127.0.0.1:${port}/`;
    console.log('→ Probe-Cockpit ' + url);

    browser = await browserStarten(profil);
    const p = browser.seite;
    await p.groesse(BREITE);

    // Übersicht
    console.log('Übersicht');
    await p.gehe(url + '#/', "document.querySelectorAll('.zeile, .projekt-zeile, a[href^=\"#/p/\"]').length > 3", 'Übersicht');
    await p.foto('uebersicht.png');
    const { data: uebersichtBild } = await p.s('Page.captureScreenshot', { format: 'png', clip: { x: 232, y: 0, width: BREITE - 232, height: 560, scale: 0.6 } });

    // Projektseite: Bild einfügen, ziehen, wählen, entfernen
    console.log('Projektseite: Bilder an die Chatzeile');
    await p.gehe(url + '#/p/fah-wetterstation', "!!document.querySelector('form.auftrag-form textarea[data-bilder]')", 'Projektseite');
    await p.js(JS_HILFEN);
    const ta = "form.auftrag-form textarea[data-bilder]";
    pruefe(await p.js(`__einfuegen(${JSON.stringify(ta)}, [__datei(${JSON.stringify(uebersichtBild)}, 'Bildschirmfoto.png', 'image/png')])`), '⌘V mit Bild: Einfügen abgefangen');
    await p.bis('__anzahl() === 1', 'Vorschau nach ⌘V');
    pruefe(true, '⌘V: Vorschau erscheint');
    pruefe(!(await p.js(`__einfuegen(${JSON.stringify(ta)}, [], 'nur Text')`)) && await p.js('__anzahl() === 1'), '⌘V mit Text: läuft normal, kein Bild');
    pruefe(await p.js(`__ziehen(${JSON.stringify(ta)}, [__datei(${JSON.stringify(uebersichtBild)}, 'gezogen.png', 'image/png')])`), 'Hineinziehen: Feld leuchtet');
    await p.bis('__anzahl() === 2', 'Vorschau nach Ziehen');
    pruefe(true, 'Hineinziehen: zweites Bild');
    await p.js('(async () => { const f = await __grossesBild(); __einfuegen(' + JSON.stringify(ta) + ', [f]); return true; })()');
    await p.bis('__anzahl() === 3', 'großes Bild');
    const gross = await p.js("new Promise(ok => { const i = new Image(); i.onload = () => ok([i.naturalWidth, i.naturalHeight, document.querySelectorAll('.anhang img')[2].src.length]); i.src = document.querySelectorAll('.anhang img')[2].src; })");
    pruefe(Math.max(gross[0], gross[1]) <= 2000 && gross[2] < 3_600_000 * 1.4, `großes Bild verkleinert: 3400×2200 → ${gross[0]}×${gross[1]}`);
    // „Bild …“ (Dateiauswahl)
    const datei = path.join(basis, 'auswahl.png');
    await writeFile(datei, Buffer.from(uebersichtBild, 'base64'));
    const { root } = await p.s('DOM.getDocument', {});
    const { nodeId } = await p.s('DOM.querySelector', { nodeId: root.nodeId, selector: 'form.auftrag-form input[data-bild-wahl]' });
    await p.s('DOM.setFileInputFiles', { nodeId, files: [datei] });
    await p.bis('__anzahl() === 4', 'Bild über Dateiauswahl');
    pruefe(true, '„Bild …“: Datei gewählt → viertes Bild');
    for (let i = 0; i < 3; i++) await p.js("document.querySelectorAll('.anhang-weg')[1].click(), true");
    pruefe(await p.js('__anzahl() === 1'), '× entfernt Bilder (bleibt eins)');
    await p.js(`document.querySelector(${JSON.stringify(ta)}).value = 'In der Übersicht fehlt mir die Spalte „Letzter Deploy“ – siehe Bild. Bitte rechts neben die Version.'`);
    for (const w of [720, 2200]) {
      await p.groesse(w);
      const lage = await p.js("(() => { const f = document.querySelector('form.auftrag-form').getBoundingClientRect(); const b = document.querySelector('.anhang').getBoundingClientRect(); return [__ueberlauf(), b.left >= f.left - 1 && b.right <= f.right + 8]; })()");
      pruefe(!lage[0] && lage[1], `Projektseite ${w} px: kein Überlauf, Vorschau in der Karte`);
    }
    // ganze Seite von oben bis zur Chatzeile mit dem eingefügten Bild (etwas höheres Fenster)
    await p.groesse(BREITE, 900);
    const hoch = await p.js('Math.min(1300, document.documentElement.scrollHeight)');
    await p.groesse(BREITE, hoch);
    await p.js('window.scrollTo(0, 0), true');
    await p.foto('projekt-bild-einfuegen.png');
    await p.groesse(BREITE);

    // Senden → Auftrag mit Bild, Verlauf zeigt das Bild
    console.log('Auftrag mit Bild');
    await p.js("document.querySelector('form.auftrag-form').requestSubmit(), true");
    await p.bis("location.hash.startsWith('#/a/')", 'Weiterleitung zum Auftrag');
    const id = decodeURIComponent(await p.js("location.hash.slice(4)"));
    await p.bis("[...document.querySelectorAll('.v-ergebnis')].length > 0", 'Auftrag fertig', 30_000);
    await p.bis("[...document.querySelectorAll('.v-bilder img')].every(i => i.complete && i.naturalWidth > 0) && document.querySelectorAll('.v-bilder img').length === 1", 'Bild im Verlauf geladen');
    pruefe(true, 'Bild in der Blase des Betreibers (aus der Ablage geladen)');
    const a1 = auftraege.holen(id);
    pruefe(a1.verlauf[0].bilder?.length === 1, 'Auftrag hat das Bild abgelegt');
    await p.js("document.getElementById('verlauf').scrollTop = 0, true");
    await p.foto('auftrag-mit-bild.png');
    await p.js("document.querySelector('.v-bilder img').click(), true");
    pruefe(await p.js("!!document.querySelector('.bildansicht img')"), 'Klick aufs Bild: Großansicht');
    await p.s('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await p.s('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    pruefe(await p.js("!document.querySelector('.bildansicht')"), 'Esc schließt die Großansicht');

    // Nachschreiben mit Bild (Antwort im selben Gespräch)
    const tn = 'form.nachricht-form textarea[data-bilder]';
    await p.js(JS_HILFEN);
    await p.js(`__einfuegen(${JSON.stringify(tn)}, [__datei(${JSON.stringify(uebersichtBild)}, 'Bildschirmfoto 2.png', 'image/png')])`);
    await p.bis('__anzahl() === 1', 'Vorschau in der Nachrichtenzeile');
    await p.js(`document.querySelector(${JSON.stringify(tn)}).value = 'Das Datum ist noch ausgegraut, bitte so hell wie die Version.'`);
    for (const w of [720, 2200]) { await p.groesse(w); pruefe(!(await p.js('__ueberlauf()')), `Auftragsseite ${w} px: kein Überlauf`); }
    await p.groesse(BREITE);
    await p.js("document.querySelector('form.nachricht-form').requestSubmit(), true");
    await p.bis("document.querySelectorAll('.v-bilder img').length === 2 && __anzahl() === 0", 'Nachricht mit Bild gesendet');
    pruefe(true, 'Nachschreiben mit Bild: Vorschau geleert, zweites Bild im Verlauf');
    await p.bis("document.querySelectorAll('.v-ergebnis').length === 2", 'zweite Runde fertig', 30_000);
    pruefe(auftraege.holen(id).runden === 2, 'zweite Runde im selben Gespräch');

    // Zweiter Auftrag: wartet auf eine Freigabe (Push)
    console.log('Freigabe-Karte');
    await auftraege.starten({ ordner: 'fah-wetterstation', text: 'Neue Version 1.4.3 auf den Raspberry Pi bringen', modell: '', aufwand: '' });
    const id2 = auftraege.liste()[0].id;
    for (let i = 0; i < 300 && !auftraege.zahlen().wartet; i++) await warte(100);
    if (!auftraege.zahlen().wartet) {
      const b = auftraege.holen(id2);
      throw new Error('Keine Freigabe-Karte: ' + JSON.stringify({ status: b.status, verlauf: b.verlauf.slice(-4) }));
    }
    await p.gehe(url + '#/a/' + encodeURIComponent(id2), "!!document.querySelector('.freigabe')", 'Freigabe-Karte', 30_000);
    await p.foto('freigabe.png');

    // Restliche Seiten
    console.log('Weitere Seiten');
    await p.gehe(url + '#/auftraege', "document.querySelectorAll('.auftrag-zeile').length >= 1 && !!document.querySelector('.freigabe')", 'Aufträge');
    await p.foto('auftraege.png');
    await p.gehe(url + '#/todos', "document.querySelectorAll('.todo').length > 5", 'To-dos');
    await p.foto('todos.png');
    await p.gehe(url + '#/notizen', "document.querySelectorAll('.notiz-karte, [href^=\"#/notizen/\"]').length >= 3", 'Notizen');
    await p.foto('notizen.png');
    await p.gehe(url + '#/netz', "!!document.querySelector('canvas')", 'Wissensnetz');
    await warte(4500);                                      // Kräfte-Simulation kommt zur Ruhe
    await p.foto('wissensnetz.png');
    await p.gehe(url + '#/einstellungen', "document.body.innerText.includes('2.1.30')", 'Einstellungen');
    await p.foto('einstellungen.png');
    await p.gehe(url + '#/neu', "!!document.querySelector('form.projekt-neu-form')", 'Neues Projekt');
    pruefe(!!(await p.js("document.querySelector('form.projekt-neu-form textarea[name=bauen][data-bilder]')")), 'Neues Projekt: Bauen-Feld nimmt Bilder');
  } finally {
    if (browser) await browser.ende();
    auftraege?.beenden();
    server?.close();
    await warte(300);
    await rm(basis, { recursive: true, force: true });
    await rm(profil, { recursive: true, force: true });
  }
}

hauptlauf().then(() => {
  console.log(fehler ? `\n✖ ${fehler} Prüfung(en) fehlgeschlagen` : '\n✔ Bedienprobe bestanden' + (NUR_PROBE ? '' : ', Fotos in docs/screenshots/'));
  process.exit(fehler ? 1 : 0);
}).catch(e => { console.error('\n✖ ' + e.message); process.exit(1); });
