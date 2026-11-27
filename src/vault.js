// ============================================================================
// Erdacht und programmiert von Fabian Hammer, Deutschland.
// (c) 2026 Fabian Hammer - Alle Rechte vorbehalten. Geistiges Eigentum.
// ============================================================================
// Vault lesen und bearbeiten: Markdown-Dateien im Vault auflisten, lesen, speichern
// (mit Versionsprüfung – nie eine inzwischen geänderte Datei überschreiben), neue Notizen anlegen, in den Papierkorb
// legen (.trash/). Geänderte Dateien werden gebündelt committet und nach FAH-Git gepusht (Haupt, sonst übernommener Ersatz).

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rename, stat, writeFile, realpath } from 'node:fs/promises';
import path from 'node:path';

export class VaultFehler extends Error { constructor(code, text) { super(text); this.code = code; } }

const version = text => createHash('sha1').update(text).digest('hex').slice(0, 16);
const AUSGESCHLOSSEN = /^(\.obsidian|\.git|\.trash|claude-wissen)(\/|$)/;

function git(ordner, args, ms = 60_000) {
  return new Promise(resolve => execFile('git', ['-C', ordner, ...args], { timeout: ms, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
    (f, aus, err) => resolve({ ok: !f, aus: String(aus || ''), err: String(err || '') })));
}

export class Vault {
  /** @param {{vault: string, commitNachMs?: number, pushen?: boolean, einstellungen?: object}} o */
  constructor({ vault, commitNachMs = 30_000, pushen = true, einstellungen = null }) {
    this.wurzel = vault;
    this.einstellungen = einstellungen;
    this.commitNachMs = commitNachMs;
    this.pushen = pushen;
    this.offen = new Set();         // geänderte Pfade, die noch committet werden
    this.timer = null;
    this.kette = Promise.resolve();
  }

  /** Relativen Pfad prüfen und absolut machen: nur .md im Vault, nichts Verstecktes, kein Ausbrechen. */
  async sicher(rel, { mussExistieren = true } = {}) {
    const r = String(rel || '').replace(/\\/g, '/').replace(/^\/+/, '');
    const norm = path.posix.normalize(r);
    if (!r || norm.startsWith('..') || norm.split('/').some(t => t === '..' || t === '') || !norm.endsWith('.md') || AUSGESCHLOSSEN.test(norm)
      || norm.split('/').some(t => t.startsWith('.'))) throw new VaultFehler(400, 'Ungültiger Pfad');
    const abs = path.join(this.wurzel, norm);
    const echteWurzel = await realpath(this.wurzel);
    const eltern = await realpath(path.dirname(abs)).catch(() => null);
    if (!eltern || !(eltern === echteWurzel || eltern.startsWith(echteWurzel + path.sep))) throw new VaultFehler(400, 'Pfad außerhalb des Vaults');
    if (mussExistieren && !(await stat(abs).then(s => s.isFile(), () => false))) throw new VaultFehler(404, 'Datei nicht gefunden');
    return { rel: norm, abs };
  }

  /** Alle Markdown-Dateien (ohne versteckte Ordner), mit Titel und Änderungszeit. */
  async liste() {
    const aus = [];
    const gehe = async (ordner, rel) => {
      for (const e of await readdir(ordner, { withFileTypes: true }).catch(() => [])) {
        if (e.name.startsWith('.')) continue;
        const r = rel ? rel + '/' + e.name : e.name;
        if (AUSGESCHLOSSEN.test(r)) continue;
        if (e.isDirectory()) { await gehe(path.join(ordner, e.name), r); continue; }
        if (!e.name.endsWith('.md')) continue;
        const abs = path.join(ordner, e.name);
        const [s, text] = await Promise.all([stat(abs), readFile(abs, 'utf8').catch(() => '')]);
        const h1 = /^#\s+(.+)$/m.exec(text)?.[1];
        const anfang = text.replace(/^---\n[\s\S]*?\n---\n/, '').replace(/^#.*$/m, '').replace(/\s+/g, ' ').trim().slice(0, 160);
        aus.push({ pfad: r, titel: (h1 || e.name.replace(/\.md$/, '')).trim(), geaendert: s.mtime.toISOString(), groesse: s.size, anfang });
      }
    };
    await gehe(this.wurzel, '');
    return aus.sort((a, b) => b.geaendert.localeCompare(a.geaendert));
  }

  /** Unterordner (für „Neue Notiz in …“). */
  async ordner() {
    const aus = [];
    const gehe = async (o, rel) => {
      for (const e of await readdir(o, { withFileTypes: true }).catch(() => [])) {
        if (!e.isDirectory() || e.name.startsWith('.')) continue;
        const r = rel ? rel + '/' + e.name : e.name;
        if (AUSGESCHLOSSEN.test(r)) continue;
        aus.push(r);
        await gehe(path.join(o, e.name), r);
      }
    };
    await gehe(this.wurzel, '');
    return aus.sort();
  }

  async lesen(rel) {
    const { rel: r, abs } = await this.sicher(rel);
    const [text, s] = await Promise.all([readFile(abs, 'utf8'), stat(abs)]);
    return { pfad: r, text, geaendert: s.mtime.toISOString(), version: version(text) };
  }

  /** Speichern nur, wenn die Datei seit dem Laden unverändert ist (sonst 409 – z. B. weil Claude sie gerade gepflegt hat). */
  async schreiben(rel, text, alteVersion) {
    const { rel: r, abs } = await this.sicher(rel);
    const jetzt = await readFile(abs, 'utf8');
    if (alteVersion && version(jetzt) !== alteVersion) throw new VaultFehler(409, 'Die Datei wurde inzwischen geändert (z. B. von Claude). Neu laden und deine Änderung erneut einfügen.');
    if (typeof text !== 'string' || text.length > 2_000_000) throw new VaultFehler(400, 'Kein gültiger Text');
    await this.atomar(abs, text);
    this.vormerken(r);
    return this.lesen(r);
  }

  /** Neue Notiz: Ordner muss im Vault existieren, Datei darf es noch nicht geben. */
  async neu(ordner, titel) {
    const o = String(ordner || '').replace(/^\/+|\/+$/g, '');
    if (!(await this.ordner()).includes(o)) throw new VaultFehler(400, 'Ordner gibt es im Vault nicht');
    const name = String(titel || '').trim().replace(/[\/\\:*?"<>|#^[\]]/g, '-').replace(/\s+/g, ' ').slice(0, 120);
    if (!name) throw new VaultFehler(400, 'Bitte einen Titel angeben');
    const { rel, abs } = await this.sicher(`${o}/${name}.md`, { mussExistieren: false });
    if (await stat(abs).then(() => true, () => false)) throw new VaultFehler(409, 'Eine Notiz mit diesem Titel gibt es dort schon');
    await this.atomar(abs, `# ${String(titel).trim()}\n\n`);
    this.vormerken(rel);
    return this.lesen(rel);
  }

  /** In den Papierkorb des Vaults (.trash/) – wiederherstellbar. */
  async papierkorb(rel) {
    const { rel: r, abs } = await this.sicher(rel);
    const ziel = path.join(this.wurzel, '.trash', r.replace(/\//g, ' – '));
    await mkdir(path.dirname(ziel), { recursive: true });
    const frei = await stat(ziel).then(() => ziel.replace(/\.md$/, ` (${Date.now()}).md`), () => ziel);
    await rename(abs, frei);
    this.vormerken(r);
    return { pfad: r, papierkorb: path.relative(this.wurzel, frei) };
  }

  async atomar(abs, text) {
    const zwischen = abs + '.cockpit-' + process.pid + '.tmp';
    await writeFile(zwischen, text, 'utf8');
    await rename(zwischen, abs);
  }

  // ---------- Git: gebündelt committen und pushen ----------

  vormerken(rel) {
    this.offen.add(rel);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.kette = this.kette.then(() => this.einchecken()).catch(() => {}); }, this.commitNachMs);
  }

  async einchecken() {
    const pfade = [...this.offen];
    this.offen.clear();
    if (!pfade.length || !(await stat(path.join(this.wurzel, '.git')).then(() => true, () => false))) return { status: 'ohne Git' };
    if (await stat(path.join(this.wurzel, '.git', 'index.lock')).then(() => true, () => false)) { pfade.forEach(p => this.offen.add(p)); this.vormerken(pfade[0]); return { status: 'später' }; }
    await git(this.wurzel, ['add', '-A', '--', ...pfade]);
    const geaendert = (await git(this.wurzel, ['diff', '--cached', '--name-only', '--', ...pfade])).aus.trim();
    if (!geaendert) return { status: 'aktuell' };
    const titel = pfade.length === 1 ? pfade[0] : `${pfade.length} Dateien`;
    const c = await git(this.wurzel, ['commit', '--no-verify', '-q', '-m', `Cockpit: ${titel} bearbeitet`, '--', ...pfade]);
    if (!c.ok) return { status: 'fehler', grund: c.err.slice(0, 200) };
    if (!this.pushen) return { status: 'committet' };
    // Im Vault geht jeder Commit nach FAH-Git (Regel in CLAUDE.md) – also alles Ungepushte mitnehmen.
    // Haupt weg? Dann an den übernommenen Ersatz, sonst lokal lassen (geht mit dem nächsten Speichern zum Haupt).
    const schreib = this.einstellungen?.aktuell().fahgitAdresse ? await this.einstellungen.fahgitZiel() : { art: 'haupt' };
    if (!schreib.art) return { status: 'committet', grund: schreib.grund + ' – bleibt lokal' };
    const ziel = (await git(this.wurzel, ['rev-parse', '--abbrev-ref', '@{u}'])).aus.trim();
    if (!ziel) return { status: 'committet', grund: 'Zweig folgt keinem Remote' };
    const [remote, ...zweig] = ziel.split('/');
    let wohin = remote;
    if (schreib.art === 'ersatz') {
      wohin = this.einstellungen.aufErsatz((await git(this.wurzel, ['remote', 'get-url', remote])).aus.trim());
      if (!wohin) return { status: 'committet', grund: 'Haupt nicht erreichbar, Remote gehört nicht zum Haupt – bleibt lokal' };
    }
    const p = await git(this.wurzel, ['push', '-q', wohin, `HEAD:${zweig.join('/')}`], 120_000);
    return p.ok ? { status: 'gepusht', ...(schreib.art === 'ersatz' ? { grund: 'auf den Ersatz' } : {}) } : { status: 'committet', grund: 'Push fehlgeschlagen' };
  }
}
