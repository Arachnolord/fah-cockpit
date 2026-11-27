// ============================================================================
// Erdacht und programmiert von Fabian Hammer, Deutschland.
// (c) 2026 Fabian Hammer - Alle Rechte vorbehalten. Geistiges Eigentum.
// ============================================================================
// Wissen in FAH-Git: spiegelt je Projekt die Stand-Datei aus dem Vault und die zugehörigen Notizen aus Claudes
// Gedächtnis nach <Projekt>/claude-wissen/ und pusht nach FAH-Git; das ganze Gedächtnis zusätzlich ins eigene Repo
// ~/claude/claude-gedaechtnis. Geschrieben wird weiter im Gedächtnis und im Vault – das hier ist nur ein Spiegel.
//
// Sicherheit (27.11.2026):
// - GitHub: FAH-Git lässt **/claude-wissen/** zentral weg (Einstellungen → GitHub → Bereinigung). Alle GitHub-Spiegel
//   sind „Öffentlicher Stand (bereinigt)“; ein bereinigter Stand ohne Änderung erzeugt dort keinen Commit.
// - frederix: Projekte unter eigene-projekte/fx-git oder mit frederix-Remote werden NIE angefasst (Weiterleitung!).
// - Fremde Arbeit: Commit nur mit Pfad claude-wissen/ (andere Änderungen bleiben, wie sie sind), kein Pull, kein Rebase.
//   Gepusht wird nur, wenn vorher nichts anderes ungepusht war und der Server nicht weiter ist.

import { execFile } from 'node:child_process';
import { mkdir, readdir, readFile, writeFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { BILDNAME } from './bilder.js';

const ORDNER = 'claude-wissen';

/** Claudes Gedächtnis-Ordner für Sitzungen aus dem Home-Ordner (Claude Code ersetzt / und . durch -). */
export function gedaechtnisPfad(heim = os.homedir()) {
  return path.join(heim, '.claude', 'projects', heim.replace(/[^A-Za-z0-9]/g, '-'), 'memory');
}

const tilde = p => (p === '~' || String(p).startsWith('~/')) ? path.join(os.homedir(), String(p).slice(1)) : String(p);
const AUSLASSEN = new Set(['Arbeit', 'claude-gedaechtnis', 'NEUE ZIPs', 'Unifi-Controller-Backups']);

/** Notizen nach Dateinamen einem Projekt zuordnen (Anfang des Dateinamens). Ergänzt die Zuordnung über Pfade im Text. */
export const NAMEN = {
  allinone: ['allinone', 'localeye-griff', 'localeye-sicherheit', 'localeye-kamera', 'localeye-pakete', 'lizenz-999', 'knowsora'],
  Ausleuchtung: ['ausleuchter', 'fah-ausleuchter', 'swissnet', 'funksichta', 'erkennung-', 'tueren-', 'hochgeladener-plan'],
  'FAH-Musik': ['fah-musik', 'keine-hoertests', 'ki-logo-videos'],
  'FAH-NAS': ['fah-nas'],
  'FAH-Adblock': ['fah-adblock'],
  'fah-multitool': ['fah-multitool', 'multitool-', 'in-app-statt'],
  'FAH-Jarvis': ['fah-jarvis'],
  'fah-git': ['fah-git', 'github-'],
  Mikrotik: ['mikrotik'],
  'mikrotik-reiserouter': ['reiserouter'],
  streamdeck: ['streamdeck'],
  FlowSpeech: ['flowspeech', 'windows-hook'],
  'Eigene Infrastruktur': ['unifi-heimnetz', 'unifi-konsole', 'claude-ordner-auf-fah-nas', 'nas-schnappschuesse', 'nas-ssh'],
  'war-lions': ['war-lions'], 'fah-command': ['fah-command'], 'fah-berserk': ['fah-berserk'], 'fah-bollwerk': ['fah-bollwerk'],
  'fah-battleship': ['fah-battleship'], webshop: ['webshop'], 'kinder-pc-streaming': ['apollo'], 'Samsung Tizen TV': ['samsung'],
  vaultwarden: ['vaultwarden'], 'unifi-extraktor': ['unifi-backup-explorer', 'unifi-extraktor'], downloader: ['fah-downloader'],
  homepage: ['fah-homepage'], mediaconverter: ['medienconverter'], 'FAH-Passwortwechsel': ['fah-passwortwechsel'],
  'FAH-Sicherung': ['fah-sicherung'], 'fah-proxy': ['fah-proxy'], 'fah-ablage': ['fah-ablage'], 'fah-kopfhoerer': ['fah-kopfhoerer'],
  'FAH-Networking': ['fah-networking'], 'localeye-remote': ['localeye-remote'], 'Langdock Agent - FAHs Netzwerkdokumentation': ['langdock'],
  'EDEKA Projekt': ['edeka'], 'FAH-Cockpit': ['arbeit-vault'], Dockwart: ['dockwart'], FlowState: ['flowstate'],
  'Mac-Sperrbildschirm': ['mac-sperrbildschirm'], 'RustDesk-Sicherung': ['rustdesk'], 'mac-standardapps': ['mac-standardapps'],
  'menueleiste-sicherung': ['menueleiste', 'macos27-menueleiste'],
};

const MARKE = '.fah-cockpit-wissen';
const MARKE_TEXT = 'Dieser Ordner wird vom FAH-Cockpit gespiegelt. Dateien hier werden beim nächsten Abgleich überschrieben oder entfernt.\n';

const README_GEDAECHTNIS = '# claude-gedaechtnis\n\nSpiegel von Claudes Gedächtnis (`~/.claude/projects/…/memory/`) und den globalen Regeln (`~/.claude/CLAUDE.md`), alle 30 Minuten vom FAH-Cockpit. Privat – nie zu GitHub. Hier nichts von Hand ändern.\n';

const LIESMICH_AUFTRAEGE = '- `auftraege/` – Verläufe der Cockpit-Aufträge zu diesem Projekt, eingefügte Bilder in `auftraege/<id>/` (Quelle: ~/Library/Application Support/FAH-Cockpit/auftraege)\n';

const LIESMICH = `# claude-wissen

Spiegel aus dem FAH-Cockpit – **hier nichts von Hand ändern**, der nächste Lauf überschreibt es.

- \`STAND.md\` – Stand und offene To-dos des Projekts (Quelle: Obsidian-Vault \`~/claude/Arbeit/maschine/projekte/\`)
- \`gedaechtnis/\` – Claudes Notizen zu diesem Projekt (Quelle: Claudes Gedächtnis unter \`~/.claude/projects/…/memory/\`)

Geht nie zu GitHub: FAH-Git lässt \`**/claude-wissen/**\` zentral weg.
`;

function git(ordner, args, { ms = 60_000, mitZugang = false } = {}) {
  return new Promise(resolve => {
    const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' };
    const a = mitZugang ? ['-C', ordner, ...args] : ['-c', 'credential.helper=', '-C', ordner, ...args];
    execFile('git', a, { env, timeout: ms, maxBuffer: 8 * 1024 * 1024 },
      (fehler, aus, err) => resolve({ ok: !fehler, aus: String(aus || ''), err: String(err || '').trim() }));
  });
}

const gibtEs = p => stat(p).then(() => true, () => false);

/** Gedächtnis-Notiz → Projekte (Dateiname aus NAMEN, dazu Pfade ~/claude/<Projekt> im Text, die häufigsten). */
export function zuordnen(dateiname, text, projekte) {
  const name = dateiname.replace(/\.md$/, '').toLowerCase();
  const treffer = new Set();
  for (const [p, praefixe] of Object.entries(NAMEN)) if (projekte.includes(p) && praefixe.some(x => name.startsWith(x))) treffer.add(p);
  const zahl = new Map();
  for (const p of projekte) {
    const re = new RegExp('(?:~|/Users/[^/\\s]+)/claude/' + p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\w-])', 'g');
    const n = (text.match(re) || []).length;
    if (n) zahl.set(p, n);
  }
  if (zahl.size) { const max = Math.max(...zahl.values()); for (const [p, n] of zahl) if (n === max) treffer.add(p); }
  return [...treffer];
}

/** Ein Cockpit-Auftrag als lesbares Markdown (ohne Befehlsausgaben – die bleiben im Cockpit). */
export function auftragAlsText(a) {
  const z = [`# ${a.titel || a.id}`, '', `Auftrag ${a.id} · ${a.status} · erstellt ${a.erstellt || '–'} · beendet ${a.beendet || '–'}` +
    `${a.modellEcht ? ' · ' + a.modellEcht : ''}${a.kosten ? ` · ≈ ${a.kosten} $ (API-Preis)` : ''}`, ''];
  const freigaben = Object.fromEntries((a.freigaben || []).map(f => [f.id, f]));
  for (const v of a.verlauf || []) {
    if (v.art === 'nutzer') {
      z.push(`**Du:** ${v.text}`, '');
      // eingefügte Bilder liegen neben dem Verlauf: auftraege/<id>/bild-NN.png
      if (v.bilder?.length) z.push(v.bilder.map((b, i) => `![Bild ${i + 1}](${a.id}/${b})`).join(' '), '');
    }
    else if (v.art === 'text') z.push(`${v.unter ? '> (Helfer) ' : ''}${v.text}`, '');
    else if (v.art === 'werkzeug') z.push(`- \`${v.name}\` ${String(v.kurz || '').split('\n')[0].slice(0, 200)}${v.fehler ? ' – Fehler' : ''}`);
    else if (v.art === 'freigabe' && freigaben[v.freigabe]) { const f = freigaben[v.freigabe]; z.push(`- Freigabe ${f.status}: \`${String(f.kurz).split('\n')[0].slice(0, 160)}\`${f.antwort ? ' – „' + f.antwort + '“' : ''}`); }
    else if (v.art === 'ergebnis') z.push('', '## Ergebnis', '', v.text, '');
    else if (v.art === 'hinweis') z.push(`_${v.text}_`);
  }
  return z.join('\n') + '\n';
}

export class WissenSpiegel {
  /**
   * @param {object} o
   * @param {string} o.wurzel       ~/claude
   * @param {string} o.vault        ~/claude/Arbeit
   * @param {string} [o.gedaechtnis]  Claudes Gedächtnis (Standard: gedaechtnisPfad())
   * @param {string} [o.globalRegeln]  ~/.claude/CLAUDE.md
   * @param {boolean} [o.pushen]    nach FAH-Git pushen (Tests: aus)
   * @param {string} [o.auftraege]  Ordner mit den Auftrags-Dateien des Cockpits (Verläufe kommen mit ins Projekt)
   * @param {import('./einstellungen.js').Einstellungen} [o.einstellungen]  FAH-Git-Verbindung (Adresse, Schlüssel)
   */
  constructor(o) {
    this.o = { pushen: true, globalRegeln: path.join(os.homedir(), '.claude', 'CLAUDE.md'), gedaechtnis: gedaechtnisPfad(), ...o };
    this.letzter = null;
    this.laeuft = false;
  }

  /** Letzten Bericht von der Platte holen (sonst wäre er nach jedem Neustart bis zum ersten Lauf leer). */
  async laden() {
    if (!this.o.berichtDatei) return;
    try { this.letzter = JSON.parse(await readFile(this.o.berichtDatei, 'utf8')); } catch { /* noch keiner */ }
  }

  /** Prüft, ob in einem Repo gespiegelt werden darf. Gibt {remote, zweig} oder {grund} zurück. */
  async pruefen(ordner) {
    if (!(await gibtEs(path.join(ordner, '.git')))) return { grund: 'kein Git' };
    const urls = (await git(ordner, ['config', '--get-regexp', '^remote\\..*\\.url$'])).aus.trim().split('\n').filter(Boolean)
      .map(z => { const [k, u] = z.split(/\s+/, 2); return { name: k.replace(/^remote\.|\.url$/g, ''), url: u || '' }; });
    if (urls.some(r => /frederix/i.test(r.url) || r.name === 'frederix' || /\/fx-git\//.test(r.url))) return { grund: 'FX-Git/frederix – nie anfassen' };
    for (const datei of ['index.lock', 'MERGE_HEAD', 'rebase-merge', 'rebase-apply', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'BISECT_LOG']) {
      if (await gibtEs(path.join(ordner, '.git', datei))) return { grund: 'Git ist gerade beschäftigt (' + datei + ')' };
    }
    const host = this.o.einstellungen?.aktuell().fahgitAdresse ? new URL(this.o.einstellungen.aktuell().fahgitAdresse).host : null;
    const istFah = u => (host && u.includes(host)) || /:3300\/|fah-git\./.test(u);
    const fahRemotes = urls.filter(r => istFah(r.url));
    if (!fahRemotes.length) return { grund: 'kein FAH-Git-Remote', anlegbar: true };
    const st = (await git(ordner, ['status', '--porcelain=v2', '--branch', '--untracked-files=no'])).aus;
    const kopf = /# branch\.head (\S+)/.exec(st)?.[1];
    const upstream = /# branch\.upstream (\S+)/.exec(st)?.[1];
    const ab = /# branch\.ab \+(\d+) -(\d+)/.exec(st);
    if (!kopf || kopf === '(detached)') return { grund: 'kein Zweig ausgecheckt' };
    const fah = fahRemotes.find(r => upstream?.startsWith(r.name + '/'));
    if (!fah) return { grund: `Zweig ${kopf} folgt nicht FAH-Git` };
    return { remote: fah.name, zweig: upstream.slice(fah.name.length + 1), voraus: Number(ab?.[1] || 0), zurueck: Number(ab?.[2] || 0) };
  }

  /** Inhalt von <ziel>/ an die gewünschten Dateien angleichen. Gibt die Zahl der Änderungen zurück. */
  async angleichen(ziel, soll) {
    let n = 0;
    for (const [rel, inhalt] of Object.entries(soll)) {
      const datei = path.join(ziel, rel);
      if (Buffer.isBuffer(inhalt)) {                   // Bilder: Byte für Byte vergleichen
        const alt = await readFile(datei).catch(() => null);
        if (alt && alt.equals(inhalt)) continue;
      } else {
        const alt = await readFile(datei, 'utf8').catch(() => null);
        if (alt === inhalt) continue;
      }
      await mkdir(path.dirname(datei), { recursive: true });
      await writeFile(datei, inhalt);
      n++;
    }
    // Überzählige Dateien im Spiegel entfernen (nur innerhalb von <ziel>)
    const gehe = async (ordner, rel = '') => {
      for (const e of await readdir(ordner, { withFileTypes: true }).catch(() => [])) {
        const r = rel ? rel + '/' + e.name : e.name;
        if (e.isDirectory()) await gehe(path.join(ordner, e.name), r);
        else if (!(r in soll)) { await rm(path.join(ordner, e.name), { force: true }); n++; }
      }
    };
    await gehe(ziel);
    return n;
  }

  /** Nur den Pfad <pfad> committen (fremde Änderungen bleiben liegen) und ggf. pushen. */
  async einchecken(ordner, pfad, info, nachricht) {
    const geaendert = (await git(ordner, ['status', '--porcelain', '--', pfad])).aus.trim();
    if (!geaendert) return { status: 'aktuell' };
    const add = await git(ordner, ['add', '-A', '--', pfad]);
    if (!add.ok) return { status: 'fehler', grund: 'git add: ' + add.err.slice(0, 200) };
    const c = await git(ordner, ['commit', '--no-verify', '-q', '-m', nachricht, '--', pfad]);
    if (!c.ok) return { status: 'fehler', grund: 'git commit: ' + c.err.slice(0, 200) };
    if (!this.o.pushen) return { status: 'gespiegelt', grund: 'nur lokal (Pushen aus)' };
    if (info.voraus > 0) {
      // Ungepusht sind nur eigene Spiegel-Commits (z. B. weil FAH-Git weg war)? Dann dürfen sie mit.
      const fremd = (await git(ordner, ['log', '--format=%s', '@{u}..HEAD~1'])).aus.split('\n').filter(z => z && !z.startsWith('claude-wissen:')).length;
      if (fremd) return { status: 'gespiegelt', grund: `nicht gepusht: ${fremd} andere Commits sind noch ungepusht` };
    }
    if (info.zurueck > 0) return { status: 'gespiegelt', grund: 'nicht gepusht: FAH-Git ist weiter (erst holen)' };
    // Haupt weg? Dann an den übernommenen Ersatz – oder lokal lassen (geht beim nächsten Lauf zum Haupt).
    const ziel = this.schreibZiel || { art: 'haupt' };
    if (!ziel.art) return { status: 'gespiegelt', grund: ziel.grund + ' – bleibt lokal, geht später zum Haupt' };
    let wohin = info.remote;
    if (ziel.art === 'ersatz') {
      wohin = this.o.einstellungen.aufErsatz((await git(ordner, ['remote', 'get-url', info.remote])).aus.trim());
      if (!wohin) return { status: 'gespiegelt', grund: 'Haupt nicht erreichbar, Remote gehört nicht zum Haupt – bleibt lokal' };
    }
    const p = await git(ordner, ['push', '-q', wohin, `HEAD:${info.zweig}`], { ms: 120_000, mitZugang: true });
    if (p.ok) return ziel.art === 'ersatz' ? { status: 'gepusht', grund: 'auf den Ersatz (Haupt nicht erreichbar)' } : { status: 'gepusht' };
    return { status: 'gespiegelt', grund: 'Push fehlgeschlagen: ' + p.err.split('\n').pop().slice(0, 160) };
  }

  /** Beendete Cockpit-Aufträge (laufende ändern sich noch – die kommen beim nächsten Lauf). */
  async auftraegeLesen() {
    if (!this.o.auftraege) return [];
    if (this._auftraege && Date.now() - this._auftraege.zeit < 5000) return this._auftraege.liste;
    const liste = [];
    for (const f of await readdir(this.o.auftraege).catch(() => [])) {
      if (!f.endsWith('.json')) continue;
      try {
        const a = JSON.parse(await readFile(path.join(this.o.auftraege, f), 'utf8'));
        if (a.status !== 'laeuft' && a.status !== 'wartend') liste.push(a);
      } catch { /* kaputte Datei überspringen */ }
    }
    this._auftraege = { zeit: Date.now(), liste };
    return liste;
  }

  /** Projekt mit Git, aber ohne FAH-Git: dort anlegen (<fahgitOrdner>/<name>, Standard eigene-projekte), Remote fahgit setzen, pushen. */
  async anlegen(name, { fahgitOrdner = '', beschreibung = '' } = {}) {
    const e = this.o.einstellungen;
    if (!e?.aktuell().fahgitAdresse) throw new Error('Erst die FAH-Git-Verbindung in den Einstellungen hinterlegen.');
    const ordner = path.join(this.o.wurzel, name);
    const info = await this.pruefen(ordner);
    if (!info.anlegbar) throw new Error(info.grund ? 'Geht hier nicht: ' + info.grund : 'Projekt ist schon in FAH-Git.');
    const { schluessel } = await e.fahgitSchluessel();
    if (!schluessel) throw new Error('Kein FAH-Git-Zugangsschlüssel – in den Einstellungen hinterlegen.');
    const ziel = await e.fahgitZiel(true);
    if (ziel.art !== 'haupt') throw new Error('Neue Projekte nur am Haupt anlegen – ' + (ziel.art === 'ersatz' ? 'der Haupt ist gerade nicht erreichbar.' : ziel.grund));
    const adresse = e.aktuell().fahgitAdresse;
    const kurz = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const zielOrdner = String(fahgitOrdner || e.aktuell().fahgitProjektOrdner || 'eigene-projekte').replace(/^\/+|\/+$/g, '');
    if (!/^[a-z0-9][a-z0-9/_-]*$/i.test(zielOrdner) || /fx-git|frederix/i.test(zielOrdner)) throw new Error('Diesen FAH-Git-Ordner nimmt das Cockpit nicht (FX-Git/frederix nie).');
    const r = await fetch(adresse + '/api/projekte', { method: 'POST', signal: AbortSignal.timeout(15_000),
      headers: { Authorization: 'Bearer ' + schluessel, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ordner: zielOrdner, name: kurz, beschreibung: beschreibung || `${name} (angelegt vom FAH-Cockpit)`, standard: 'main' }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.pfad) throw new Error('FAH-Git: ' + (j.fehler || r.status));
    const url = `${adresse}/${j.pfad}.git`;
    const kopf = (await git(ordner, ['rev-parse', '--abbrev-ref', 'HEAD'])).aus.trim();
    const add = await git(ordner, ['remote', 'add', 'fahgit', url]);
    if (!add.ok) throw new Error('git remote: ' + add.err.slice(0, 160));
    const p = await git(ordner, ['push', '-u', 'fahgit', `HEAD:${kopf === 'master' ? 'main' : kopf}`], { ms: 300_000, mitZugang: true });
    if (!p.ok) throw new Error('Push: ' + p.err.split('\n').pop().slice(0, 160));
    if (kopf === 'master') await git(ordner, ['branch', '--set-upstream-to=fahgit/main']);
    return { pfad: j.pfad, url };
  }

  async gedaechtnisLesen() {
    const notizen = {};
    for (const f of await readdir(this.o.gedaechtnis).catch(() => [])) {
      if (!f.endsWith('.md')) continue;
      notizen[f] = await readFile(path.join(this.o.gedaechtnis, f), 'utf8').catch(() => null);
    }
    return notizen;
  }

  /** Wohin gespiegelt wird: FAH-Git (Standard, wenn eine Verbindung hinterlegt ist), ein Ordner oder gar nicht. */
  ziel() {
    const st = this.o.einstellungen?.aktuell() || {};
    const art = st.wissenZiel || this.o.ziel || (st.fahgitAdresse || !this.o.einstellungen ? 'fahgit' : 'aus');
    return { art, ordner: st.wissenOrdner ? tilde(st.wissenOrdner) : (this.o.wissenOrdner || null) };
  }

  /** Was je Projekt im Spiegel liegen soll. */
  async projektSoll(name, notizenDesProjekts, notizen) {
    const soll = { 'LIESMICH.md': LIESMICH };
    const stand = await readFile(path.join(this.o.vault, 'maschine', 'projekte', name + '.md'), 'utf8').catch(() => null);
    if (stand !== null) soll['STAND.md'] = stand;
    for (const f of notizenDesProjekts) soll['gedaechtnis/' + f] = notizen[f];
    const auftraege = (await this.auftraegeLesen()).filter(a => a.ordner === name);
    for (const a of auftraege) {
      soll['auftraege/' + a.id + '.md'] = auftragAlsText(a);
      for (const v of a.verlauf || []) for (const b of v.bilder || []) {
        if (!BILDNAME.test(b)) continue;
        const inhalt = await readFile(path.join(this.o.auftraege, 'bilder', a.id, b)).catch(() => null);
        if (inhalt) soll[`auftraege/${a.id}/${b}`] = inhalt;
      }
    }
    if (auftraege.length) soll['LIESMICH.md'] = LIESMICH + LIESMICH_AUFTRAEGE;
    return { soll, stand: stand !== null };
  }

  /** Ein kompletter Lauf über alle Projekte plus das allgemeine Gedächtnis – je nach Ziel nach FAH-Git oder in einen Ordner. */
  async lauf() {
    if (this.laeuft) return this.letzter;
    this.laeuft = true;
    const start = Date.now();
    const ziel = this.ziel();
    const bericht = { zeit: new Date().toISOString(), ziel: ziel.art, zielOrdner: ziel.ordner, projekte: [], allgemein: null };
    try {
      if (ziel.art === 'aus') { bericht.allgemein = { status: 'aus' }; return bericht; }
      if (ziel.art === 'ordner' && !ziel.ordner) throw new Error('Kein Wissensordner gewählt');
      const notizen = await this.gedaechtnisLesen();
      const namen = (await readdir(this.o.wurzel, { withFileTypes: true }))
        .filter(e => e.isDirectory() && !e.name.startsWith('.') && !AUSLASSEN.has(e.name)).map(e => e.name).sort();
      const jeProjekt = new Map(namen.map(n => [n, []]));
      for (const [f, text] of Object.entries(notizen)) {
        if (f === 'MEMORY.md' || text === null) continue;
        for (const p of zuordnen(f, text, namen)) jeProjekt.get(p).push(f);
      }
      // Ordner = Projektordner selbst → direkt in <Projekt>/claude-wissen/ (ohne Commit), sonst <Ordner>/<Projekt>/
      const imProjekt = ziel.art === 'ordner' && path.resolve(ziel.ordner) === path.resolve(this.o.wurzel);
      // Einmal je Lauf prüfen, wohin gepusht werden kann (Haupt, übernommener Ersatz oder nirgends) – kein Warten je Projekt
      this.schreibZiel = ziel.art === 'fahgit' && this.o.einstellungen?.aktuell().fahgitAdresse ? await this.o.einstellungen.fahgitZiel(true) : null;
      bericht.schreibZiel = this.schreibZiel;
      if (ziel.art === 'ordner' && !imProjekt) {
        const unter = (a, b) => { const r = path.relative(path.resolve(a), path.resolve(b)); return r && !r.startsWith('..') && !path.isAbsolute(r); };
        if (unter(this.o.wurzel, ziel.ordner)) throw new Error('Den Wissensordner bitte außerhalb des Projektordners wählen – oder den Projektordner selbst.');
        if (unter(ziel.ordner, this.o.wurzel)) throw new Error('Der Wissensordner darf den Projektordner nicht enthalten – bitte einen eigenen Ordner wählen.');
        await mkdir(ziel.ordner, { recursive: true });
      }
      for (const name of namen) {
        const ordner = path.join(this.o.wurzel, name);
        if (ziel.art === 'ordner') {
          if (imProjekt) {
            const info = await this.pruefen(ordner);
            if (info.grund && /frederix/.test(info.grund)) { bericht.projekte.push({ ordner: name, status: 'übersprungen', grund: info.grund }); continue; }
          }
          const { soll, stand } = await this.projektSoll(name, jeProjekt.get(name), notizen);
          try {
            const dahin = imProjekt ? path.join(ordner, ORDNER) : path.join(ziel.ordner, name);
            const frei = await this.ordnerFrei(dahin, imProjekt ? ordner : null);
            if (frei) { bericht.projekte.push({ ordner: name, status: 'übersprungen', grund: frei }); continue; }
            soll[MARKE] = MARKE_TEXT;
            const n = await this.angleichen(dahin, soll);
            bericht.projekte.push({ ordner: name, status: n ? 'gespiegelt' : 'aktuell', notizen: jeProjekt.get(name).length, stand });
          } catch (e) { bericht.projekte.push({ ordner: name, status: 'fehler', grund: e.message }); }
          continue;
        }
        const info = await this.pruefen(ordner);
        if (info.grund) { bericht.projekte.push({ ordner: name, status: 'übersprungen', grund: info.grund, anlegbar: !!info.anlegbar }); continue; }
        const { soll, stand } = await this.projektSoll(name, jeProjekt.get(name), notizen);
        try {
          await this.angleichen(path.join(ordner, ORDNER), soll);
          const r = await this.einchecken(ordner, ORDNER, info, 'claude-wissen: Stand und Wissen gespiegelt (FAH-Cockpit)');
          bericht.projekte.push({ ordner: name, ...r, notizen: jeProjekt.get(name).length, stand });
        } catch (e) {
          bericht.projekte.push({ ordner: name, status: 'fehler', grund: e.message });
        }
      }
      bericht.allgemein = ziel.art === 'ordner'
        ? await this.allgemeinOrdner(notizen, imProjekt ? path.join(this.o.wurzel, 'claude-gedaechtnis') : path.join(ziel.ordner, '_gedaechtnis'))
        : await this.allgemein(notizen);
    } catch (e) {
      bericht.fehler = e.message;
    } finally {
      bericht.dauerMs = Date.now() - start;
      this.letzter = bericht;
      this.laeuft = false;
      if (this.o.berichtDatei) await writeFile(this.o.berichtDatei, JSON.stringify(bericht), { mode: 0o600 }).catch(() => {});
    }
    return bericht;
  }

  /**
   * Darf das Cockpit in <dahin> spiegeln (und dort Überzähliges löschen)? Nur in Ordner, die es noch nicht gibt oder die
   * schon seine Marke tragen. Im Projekt selbst: nie, wenn claude-wissen/ dort in Git verfolgt wird (das ist Sache von
   * FAH-Git); sonst wird claude-wissen/ lokal von Git ausgenommen, damit es nie versehentlich mitcommittet wird.
   * @returns {Promise<string|null>} Grund zum Überspringen oder null
   */
  async ordnerFrei(dahin, projekt) {
    if (projekt && await stat(path.join(projekt, '.git')).then(() => true, () => false)) {
      if ((await git(projekt, ['ls-files', '--', ORDNER])).aus.trim()) return 'claude-wissen/ ist dort in Git – dafür Ziel FAH-Git nehmen';
      const datei = path.join(projekt, '.git', 'info', 'exclude');
      const alt = await readFile(datei, 'utf8').catch(() => '');
      if (!alt.split(/\r?\n/).includes('/' + ORDNER + '/')) {
        await mkdir(path.dirname(datei), { recursive: true });
        await writeFile(datei, alt + (alt && !alt.endsWith('\n') ? '\n' : '') + '/' + ORDNER + '/\n');
      }
    }
    const da = await readdir(dahin).catch(() => null);
    if (da === null || da.length === 0 || da.includes(MARKE)) return null;
    return 'Ordner gibt es dort schon mit fremden Dateien – nichts angefasst';
  }

  /** Das ganze Gedächtnis plus die globalen Regeln in einen Ordner (ohne Git). */
  async allgemeinOrdner(notizen, ordner) {
    const frei = await this.ordnerFrei(ordner, null);
    if (frei) return { status: 'übersprungen', grund: frei };
    const soll = { 'README.md': README_GEDAECHTNIS, [MARKE]: MARKE_TEXT };
    for (const [f, t] of Object.entries(notizen)) if (t !== null) soll['gedaechtnis/' + f] = t;
    const regeln = await readFile(this.o.globalRegeln, 'utf8').catch(() => null);
    if (regeln !== null) soll['CLAUDE-global.md'] = regeln;
    await mkdir(ordner, { recursive: true });
    const n = await this.angleichen(ordner, soll);
    return { status: n ? 'gespiegelt' : 'aktuell', notizen: Object.keys(notizen).length, ordner };
  }

  /** Das ganze Gedächtnis plus die globalen Regeln ins Repo ~/claude/claude-gedaechtnis. */
  async allgemein(notizen) {
    const ordner = path.join(this.o.wurzel, 'claude-gedaechtnis');
    const info = await this.pruefen(ordner);
    if (info.grund) return { status: 'übersprungen', grund: info.grund };
    const soll = { 'README.md': README_GEDAECHTNIS };
    for (const [f, t] of Object.entries(notizen)) if (t !== null) soll['gedaechtnis/' + f] = t;
    const regeln = await readFile(this.o.globalRegeln, 'utf8').catch(() => null);
    if (regeln !== null) soll['CLAUDE-global.md'] = regeln;
    // Nur bekannte Pfade angleichen, .git bleibt unberührt
    let n = 0;
    for (const [rel, inhalt] of Object.entries(soll)) {
      const datei = path.join(ordner, rel);
      if ((await readFile(datei, 'utf8').catch(() => null)) === inhalt) continue;
      await mkdir(path.dirname(datei), { recursive: true }); await writeFile(datei, inhalt); n++;
    }
    n += await this.angleichen(path.join(ordner, 'gedaechtnis'), Object.fromEntries(Object.entries(soll)
      .filter(([k]) => k.startsWith('gedaechtnis/')).map(([k, v]) => [k.slice('gedaechtnis/'.length), v])));
    const r = await this.einchecken(ordner, '.', info, 'Gedächtnis gespiegelt (FAH-Cockpit)');
    return { ...r, notizen: Object.keys(notizen).length };
  }
}
