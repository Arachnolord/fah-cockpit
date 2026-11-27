// ============================================================================
// Erdacht und programmiert von Fabian Hammer, Deutschland.
// (c) 2026 Fabian Hammer - Alle Rechte vorbehalten. Geistiges Eigentum.
// ============================================================================
// Aufträge an Claude: Claude Code läuft im Hintergrund (`claude -p`, Verlauf als stream-json), immer nur einer
// gleichzeitig, weitere warten in der Schlange. Vor jedem Werkzeugaufruf fragt ein PreToolUse-Haken (src/haken.js)
// beim Cockpit nach: Harmloses läuft durch (src/freigabe.js), alles andere wartet als Karte auf das Ja des Betreibers.

import { spawn } from 'node:child_process';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { pruefen, kurzfassung, volltext, aufrufSchluessel } from './freigabe.js';
import { MODELLE, AUFWAENDE } from './einstellungen.js';
import { BILDNAME, TYP_VON_ENDUNG, MAX_AUFTRAG } from './bilder.js';

export { MODELLE, AUFWAENDE };
const MAX_VERLAUF = 3000;
const MAX_TEXT = 20_000;
const BEHALTEN = 200;

const kurz = (s, n = MAX_TEXT) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n) + ' …' : s; };
const jetzt = () => new Date().toISOString();

/** Regeln, die jeder Hintergrund-Auftrag zusätzlich bekommt. */
export function auftragsRegeln(ordner) {
  return [
    `Du arbeitest im Hintergrund an einem Auftrag aus dem FAH-Cockpit. Projekt: ~/claude/${ordner}.`,
    'Niemand sieht dir live zu, und du kannst keine Rückfragen stellen. Fehlt dir eine Entscheidung, hör an dieser Stelle auf',
    'und stelle die Frage klar am Ende deiner Antwort – der Betreiber kann im Cockpit nachschreiben.',
    'Befehle, die etwas außerhalb des Projekts ändern, löschen oder nach außen gehen (push, deploy, ssh, Mails), legt das',
    'Cockpit dem Betreiber zur Freigabe vor. Eine Ablehnung ist seine Entscheidung: nicht umgehen, sondern melden.',
    `Nach der Arbeit: Stand-Datei ~/claude/Arbeit/maschine/projekte/${ordner}.md pflegen (Regel in ~/.claude/CLAUDE.md)`,
    'und ein erledigtes To-do dort abhaken. Antworte am Ende kurz auf Deutsch: was gemacht, was offen.',
  ].join(' ');
}

/** Zeile für Claude: welche Bilder angehängt sind und wo sie als Datei liegen (z. B. um eins ins Projekt zu kopieren). */
export function bildHinweis(pfade) {
  if (!pfade?.length) return '';
  return `\n\n[${pfade.length === 1 ? 'Ein Bild' : pfade.length + ' Bilder'} vom Betreiber im Cockpit eingefügt (siehe unten), auch als Datei: `
    + pfade.join(', ') + ']';
}

export function auftragsText({ ordner, text, todo }) {
  const kopf = `Auftrag aus dem FAH-Cockpit für das Projekt ~/claude/${ordner}:`;
  if (!todo) return `${kopf}\n${text}`;
  return `${kopf}\nErledige dieses offene To-do aus der Stand-Datei ~/claude/Arbeit/maschine/projekte/${ordner}.md:\n„${todo.text}“`
    + (text ? `\n\nZusatz des Betreibers: ${text}` : '');
}

function gleich(a, b) {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length === y.length && timingSafeEqual(x, y);
}

export class Auftraege {
  /**
   * @param {object} o
   * @param {string} o.ablage    Ordner für Aufträge und Haken-Einstellungen
   * @param {string} o.wurzel    ~/claude
   * @param {string} o.vault     ~/claude/Arbeit
   * @param {number} o.port      Port des Cockpits (für den Haken)
   * @param {string} [o.claude]  Befehl für Claude Code (Standard „claude“ aus PATH)
   * @param {string} [o.arbeitsordner]  Startordner (Standard: Home – dort liegt das Gedächtnis)
   * @param {(titel: string, text: string) => void} [o.melden]  Hinweis an den Betreiber (Mitteilung)
   * @param {() => void} [o.geaendert]  wird nach jedem Lauf aufgerufen (Übersicht neu messen)
   * @param {import('./einstellungen.js').Einstellungen} [o.einstellungen]  Standard-Modell/-Aufwand und Anmeldung
   */
  constructor(o) {
    this.o = { claude: 'claude', arbeitsordner: os.homedir(), melden: () => {}, geaendert: () => {}, ...o };
    this.auftraege = new Map();
    this.schlange = [];       // [{ id, text, fortsetzen }]
    this.laufend = null;      // { id, kind, abbruch }
    this.speichernTimer = new Map();
  }

  get ordnerAuftraege() { return path.join(this.o.ablage, 'auftraege'); }
  get einstellungsDatei() { return path.join(this.o.ablage, 'haken-einstellungen.json'); }

  async laden() {
    await mkdir(this.ordnerAuftraege, { recursive: true });
    const haken = path.join(path.dirname(fileURLToPath(import.meta.url)), 'haken.js');
    // Stabiler node-Pfad (der Cellar-Pfad verschwindet beim nächsten brew upgrade).
    const node = ['/opt/homebrew/bin/node', '/usr/local/bin/node'].find(existsSync) || process.execPath;
    const einst = { hooks: { PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: `"${node}" "${haken}"`, timeout: 21_600 }] }] } };
    await writeFile(this.einstellungsDatei, JSON.stringify(einst, null, 2));
    for (const name of await readdir(this.ordnerAuftraege)) {
      if (!name.endsWith('.json')) continue;
      try {
        const a = JSON.parse(await readFile(path.join(this.ordnerAuftraege, name), 'utf8'));
        if (a.status === 'laeuft' || a.status === 'wartend') {
          a.status = 'abgebrochen';
          a.beendet = jetzt();
          a.verlauf.push({ zeit: jetzt(), art: 'hinweis', text: 'Abgebrochen: Das Cockpit wurde neu gestartet.' });
          for (const f of a.freigaben) if (f.status === 'offen') f.status = 'verfallen';
          await this.speichernJetzt(a);
        }
        this.auftraege.set(a.id, a);
      } catch { /* kaputte Datei überspringen */ }
    }
  }

  // ---------- Lesen ----------

  zusammenfassung(a) {
    return {
      id: a.id, ordner: a.ordner, titel: a.titel, status: a.status, modell: a.modell, erstellt: a.erstellt,
      gestartet: a.gestartet, beendet: a.beendet, kosten: a.kosten, runden: a.runden, allesErlaubt: !!a.allesErlaubt,
      offeneFreigaben: a.freigaben.filter(f => f.status === 'offen').map(f => ({ ...f })),
      ergebnis: a.ergebnis ? kurz(a.ergebnis, 400) : '',
      inSchlange: this.schlange.findIndex(s => s.id === a.id) + 1 || 0,
    };
  }

  liste() {
    return [...this.auftraege.values()].sort((x, y) => y.erstellt.localeCompare(x.erstellt)).map(a => this.zusammenfassung(a));
  }

  holen(id) {
    const a = this.auftraege.get(id);
    if (!a) return null;
    const { token, ...ohneToken } = a;
    return { ...ohneToken, inSchlange: this.schlange.findIndex(s => s.id === a.id) + 1 || 0 };
  }

  zahlen() {
    let wartet = 0, laeuft = 0, schlange = 0;
    for (const a of this.auftraege.values()) {
      wartet += a.freigaben.filter(f => f.status === 'offen').length;
      if (a.status === 'laeuft') laeuft++;
      if (a.status === 'wartend') schlange++;
    }
    return { wartet, laeuft, schlange };
  }

  // ---------- Starten / Nachschreiben / Abbrechen ----------

  get ordnerBilder() { return path.join(this.ordnerAuftraege, 'bilder'); }

  /** Geprüfte Bilder (src/bilder.js) zum Auftrag ablegen → { namen, bloecke (für Claude), pfade }. */
  async bilderAblegen(a, bilder) {
    if (!bilder?.length) return { namen: [], bloecke: [], pfade: [] };
    const neu = bilder.reduce((n, b) => n + b.puffer.length, 0);
    if ((a.bilderBytes || 0) + neu > MAX_AUFTRAG) {
      throw new Error('Dieser Auftrag hat schon so viele Bilder, dass Claude das Gespräch nicht mehr annähme (höchstens 20 MB). Bitte einen neuen Auftrag starten.');
    }
    a.bilderBytes = (a.bilderBytes || 0) + neu;
    const ordner = path.join(this.ordnerBilder, a.id);
    await mkdir(ordner, { recursive: true, mode: 0o700 });
    const namen = [], bloecke = [], pfade = [];
    for (const b of bilder) {
      a.bilderZahl = (a.bilderZahl || 0) + 1;
      const name = `bild-${String(a.bilderZahl).padStart(2, '0')}.${b.endung}`;
      await writeFile(path.join(ordner, name), b.puffer, { mode: 0o600 });
      namen.push(name);
      pfade.push(path.join(ordner, name));
      bloecke.push({ type: 'image', source: { type: 'base64', media_type: b.typ, data: b.puffer.toString('base64') } });
    }
    return { namen, bloecke, pfade };
  }

  /** Pfad und Art eines abgelegten Bildes – nur für Namen, die zu diesem Auftrag gehören. */
  bildDatei(id, name) {
    const a = this.auftraege.get(String(id || ''));
    name = String(name || '');
    if (!a || !BILDNAME.test(name) || !a.verlauf.some(v => v.bilder?.includes(name))) return null;
    return { datei: path.join(this.ordnerBilder, a.id, name), typ: TYP_VON_ENDUNG[name.split('.').pop()] };
  }

  async starten({ ordner, text = '', todo = null, modell = '', aufwand = '', allesErlaubt = false, bilder = [] }) {
    if (!MODELLE.includes(modell)) throw new Error('Unbekanntes Modell');
    if (!AUFWAENDE.includes(aufwand)) throw new Error('Unbekannter Aufwand');
    const id = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14) + '-' + randomBytes(3).toString('hex');
    const titel = kurz((todo?.text || text).split('\n')[0].replace(/^\((optional|praxistest|betreiber)\)\s*/i, ''), 90)
      || (bilder.length ? 'Auftrag mit Bild' : '');
    const a = {
      id, ordner, titel, todo, modell, aufwand, status: 'wartend', erstellt: jetzt(), gestartet: null, beendet: null,
      sitzung: null, runden: 0, kosten: 0, token: randomBytes(24).toString('hex'),
      verlauf: [{ zeit: jetzt(), art: 'nutzer', text: kurz(todo ? `To-do erledigen: „${todo.text}“${text ? '\n' + text : ''}` : text) }],
      freigaben: [], entscheidungen: {}, immer: [], allesErlaubt: !!allesErlaubt, ergebnis: '',
    };
    const b = await this.bilderAblegen(a, bilder);
    if (b.namen.length) a.verlauf[0].bilder = b.namen;
    this.auftraege.set(id, a);
    this.schlange.push({ id, text: auftragsText({ ordner, text: text || (b.namen.length ? 'Siehe Bild.' : ''), todo }) + bildHinweis(b.pfade), bilder: b.bloecke, fortsetzen: false });
    await this.speichernJetzt(a);
    await this.aufraeumen();
    this.weiter();
    return this.holen(id);
  }

  async nachschreiben(id, text, bilder = []) {
    const a = this.auftraege.get(id);
    if (!a) throw new Error('Auftrag nicht gefunden');
    if (this.laufend?.id !== id && !this.schlange.some(x => x.id === id) && !a.sitzung) throw new Error('Zu diesem Auftrag gibt es kein Gespräch zum Fortsetzen.');
    const b = await this.bilderAblegen(a, bilder);
    // erst nach dem Ablegen nachsehen, wie es dem Auftrag geht (das Ablegen wartet auf die Platte)
    const laeuftJetzt = this.laufend?.id === id && this.laufend.kind && this.laufend.kind.stdin.writable && !this.laufend.kind.stdin.writableEnded;
    const wartend = this.schlange.find(x => x.id === id);
    const eintrag = { zeit: jetzt(), art: 'nutzer', text: kurz(text) };
    if (b.namen.length) eintrag.bilder = b.namen;
    const fuerClaude = (text || (b.namen.length ? 'Siehe Bild.' : '')) + bildHinweis(b.pfade);
    // Läuft Claude gerade: sofort hineinreichen (Streaming-Eingabe) – wie Schreiben in Claude Code während der Arbeit.
    if (laeuftJetzt) {
      a.verlauf.push(eintrag);
      this.nachrichtSenden(this.laufend, fuerClaude, b.bloecke);
      await this.speichernJetzt(a);
      return this.holen(id);
    }
    // Wartet in der Schlange oder startet gerade: an den Auftrag anhängen
    if (wartend || this.laufend?.id === id) {
      a.verlauf.push(eintrag);
      if (wartend) { wartend.text += '\n\nNachtrag des Betreibers: ' + fuerClaude; wartend.bilder = [...(wartend.bilder || []), ...b.bloecke]; }
      else this.schlange.unshift({ id, text: fuerClaude, bilder: b.bloecke, fortsetzen: true });
      await this.speichernJetzt(a);
      return this.holen(id);
    }
    // Während des Ablegens abgebrochen, aufgeräumt oder ohne Gespräch: nicht still ein neues Gespräch beginnen
    if (!this.auftraege.has(id)) throw new Error('Auftrag nicht gefunden');
    if (!a.sitzung) throw new Error('Zu diesem Auftrag gibt es kein Gespräch zum Fortsetzen.');
    a.status = 'wartend';
    a.beendet = null;
    a.verlauf.push(eintrag);
    this.schlange.push({ id, text: fuerClaude, bilder: b.bloecke, fortsetzen: true });
    await this.speichernJetzt(a);
    this.weiter();
    return this.holen(id);
  }

  async abbrechen(id) {
    const a = this.auftraege.get(id);
    if (!a) throw new Error('Auftrag nicht gefunden');
    if (a.status === 'wartend') {
      this.schlange = this.schlange.filter(s => s.id !== id);
      a.status = 'abgebrochen'; a.beendet = jetzt();
      a.verlauf.push({ zeit: jetzt(), art: 'hinweis', text: 'Abgebrochen, bevor er gestartet ist.' });
      await this.speichernJetzt(a);
    } else if (this.laufend?.id === id) {
      this.laufend.abbruch = true;
      for (const f of a.freigaben) if (f.status === 'offen') f.status = 'verfallen';
      const kind = this.laufend.kind;
      if (kind) { try { process.kill(-kind.pid, 'SIGTERM'); } catch { try { kind.kill('SIGTERM'); } catch { /* weg */ } } }
    }
    return this.holen(id);
  }

  /** Beim Beenden des Cockpits: laufenden Claude mitnehmen. */
  beenden() {
    if (this.laufend?.kind) { try { process.kill(-this.laufend.kind.pid, 'SIGTERM'); } catch { /* weg */ } }
  }

  weiter() {
    if (this.laufend || !this.schlange.length) return;
    const naechster = this.schlange.shift();
    const a = this.auftraege.get(naechster.id);
    if (!a) return this.weiter();
    this.laufend = { id: a.id, kind: null, abbruch: false };   // sofort belegen: die Vorbereitung ist asynchron
    this.lauf(a, naechster).catch(e => { this.laufend = null; this.ende(a, 'fehler', `Claude ließ sich nicht starten: ${e.message}`); });
  }

  async lauf(a, { text, bilder = [], fortsetzen }) {
    const st = this.o.einstellungen?.aktuell() || {};
    const modell = a.modell || st.modell || '';
    const aufwand = a.aufwand || st.aufwand || '';
    const anmeldung = st.anmeldung || 'claude-code';
    const umgebung = this.o.einstellungen ? await this.o.einstellungen.umgebung(anmeldung) : { ...process.env };
    if (this.laufend?.abbruch) { this.laufend = null; return this.ende(a, 'abgebrochen', 'Abgebrochen.'); }
    // Wie im Multitool: Claude Code arbeitet mit seinem normalen Rechtesystem (auto-Modus und die Regeln des
    // Betreibers). Der Haken fängt nur ab, was nach außen geht oder sich nicht zurückholen lässt (src/freigabe.js).
    // Streaming-Eingabe: Der Auftrag kommt als erste Zeile über stdin, weitere Nachrichten des Betreibers jederzeit
    // hinterher. Nach dem Ergebnis wird stdin geschlossen (2 s Luft), dann beendet sich Claude.
    const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--settings', this.einstellungsDatei,
      '--permission-mode', 'auto', '--append-system-prompt', auftragsRegeln(a.ordner)];
    if (modell) args.push('--model', modell);
    if (aufwand) args.push('--effort', aufwand);
    if (fortsetzen && a.sitzung) args.push('--resume', a.sitzung);
    a.status = 'laeuft';
    a.runden++;
    if (!a.gestartet) a.gestartet = jetzt();
    const anmeldeText = { 'claude-code': 'Anmeldung wie Claude Code', token: 'Abo-Token', schluessel: 'API-Schlüssel' }[anmeldung];
    a.verlauf.push({ zeit: jetzt(), art: 'hinweis', text: `${fortsetzen ? 'Claude macht weiter' : 'Claude startet'} · Modell ${modell || 'Standard'} · Aufwand ${aufwand || 'Standard'} · ${anmeldeText}` });
    let kind;
    try {
      kind = spawn(this.o.claude, args, {
        cwd: this.o.arbeitsordner, detached: true, stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...umgebung, COCKPIT_AUFTRAG: a.id, COCKPIT_TOKEN: a.token, COCKPIT_PORT: String(this.o.port) },
      });
    } catch (e) {
      this.laufend = null;
      return this.ende(a, null, `Claude ließ sich nicht starten: ${e.message}`);
    }
    const abbruchVorher = this.laufend?.abbruch;
    const lauf = this.laufend = { id: a.id, kind, abbruch: !!abbruchVorher, schliessen: null, neuNachErgebnis: false };
    if (abbruchVorher) { try { process.kill(-kind.pid, 'SIGTERM'); } catch { /* weg */ } }
    kind.stdin.on('error', () => {});
    this.nachrichtSenden(lauf, text, bilder);
    let puffer = '', fehlerText = '', ergebnisGesehen = false;
    kind.stdout.setEncoding('utf8');
    kind.stdout.on('data', stueck => {
      puffer += stueck;
      let n;
      while ((n = puffer.indexOf('\n')) >= 0) {
        const zeile = puffer.slice(0, n).trim(); puffer = puffer.slice(n + 1);
        if (!zeile) continue;
        let e; try { e = JSON.parse(zeile); } catch { continue; }
        if (e.type === 'result') {
          ergebnisGesehen = true;
          // Kommt binnen 2 s keine neue Nachricht, ist der Auftrag fertig: stdin schließen → Claude beendet sich.
          lauf.neuNachErgebnis = false;
          clearTimeout(lauf.schliessen);
          lauf.schliessen = setTimeout(() => { if (!lauf.neuNachErgebnis) { try { kind.stdin.end(); } catch { /* weg */ } } }, 2000);
        }
        this.ereignis(a, e);
      }
    });
    kind.stderr.setEncoding('utf8');
    kind.stderr.on('data', s => { fehlerText = (fehlerText + s).slice(-4000); });
    kind.on('error', e => { fehlerText += '\n' + e.message; });
    kind.on('close', code => {
      const abbruch = this.laufend?.abbruch;
      this.laufend = null;
      if (abbruch) this.ende(a, 'abgebrochen', 'Abgebrochen.');
      else if (code === 0 && ergebnisGesehen && !a.letzterLaufFehler) this.ende(a, 'fertig');
      else this.ende(a, 'fehler', `Claude endete mit Fehler (Code ${code}).${fehlerText.trim() ? '\n' + fehlerText.trim().split('\n').slice(-6).join('\n') : ''}`);
    });
    this.speichern(a);
  }

  /** Eine Nachricht (Auftrag oder Nachtrag) über die Streaming-Eingabe an den laufenden Claude geben – Bilder als Bild-Blöcke
   *  wie beim Einfügen im Terminal. */
  nachrichtSenden(lauf, text, bilder = []) {
    const a = this.auftraege.get(lauf.id); if (a) a.version = (a.version || 0) + 1;
    lauf.neuNachErgebnis = true;
    clearTimeout(lauf.schliessen);
    const content = bilder.length ? [{ type: 'text', text }, ...bilder] : text;
    lauf.kind.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content } }) + '\n');
  }

  ende(a, status, hinweis) {
    a.live = null; a.liveText = ''; a.version = (a.version || 0) + 1;
    for (const w of a.verlauf) if (w.art === 'werkzeug' && !w.ende) w.ende = jetzt();
    a.status = status || 'fehler';
    a.beendet = jetzt();
    delete a.letzterLaufFehler;
    for (const f of a.freigaben) if (f.status === 'offen') f.status = 'verfallen';
    if (hinweis) a.verlauf.push({ zeit: jetzt(), art: 'hinweis', text: hinweis });
    this.speichernJetzt(a).catch(() => {});
    if (status === 'fertig') this.o.melden('Auftrag fertig', `${a.ordner}: ${a.titel}`);
    else if (status === 'fehler') this.o.melden('Auftrag mit Fehler beendet', `${a.ordner}: ${a.titel}`);
    this.o.geaendert();
    this.weiter();
  }

  /** Eine Zeile aus Claudes stream-json in den Verlauf übernehmen (mit Live-Zustand: was läuft gerade). */
  ereignis(a, e) {
    const v = a.verlauf;
    const unter = !!e.parent_tool_use_id;             // Schritt eines Helfers (Unteragent)
    a.version = (a.version || 0) + 1;
    if (e.type === 'system' && e.subtype === 'init') {
      if (!unter) { a.sitzung = e.session_id || a.sitzung; if (e.model) a.modellEcht = e.model; }
      a.live = { art: 'denkt', seit: jetzt() };
    } else if (e.type === 'stream_event') {
      const ev = e.event || {};
      if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
        a.liveText = kurz((a.liveText || '') + ev.delta.text, 6000);
        a.live = { art: 'schreibt', seit: a.live?.art === 'schreibt' ? a.live.seit : jetzt(), unter };
      } else if (ev.type === 'content_block_start' && ev.content_block?.type === 'thinking') {
        a.live = { art: 'denkt', seit: jetzt(), unter };
      } else if (ev.type === 'content_block_start' && ev.content_block?.type === 'tool_use') {
        a.live = { art: 'plant', name: ev.content_block.name, seit: jetzt(), unter };
      }
      return this.speichern(a, true);
    } else if (e.type === 'system' && e.subtype === 'thinking_tokens') {
      if (a.live?.art !== 'werkzeug') a.live = { art: 'denkt', seit: a.live?.art === 'denkt' ? a.live.seit : jetzt(), unter };
      return this.speichern(a, true);
    } else if (e.type === 'assistant' && Array.isArray(e.message?.content)) {
      for (const c of e.message.content) {
        if (c.type === 'text' && c.text?.trim()) { v.push({ zeit: jetzt(), art: 'text', text: kurz(c.text), unter }); a.liveText = ''; }
        else if (c.type === 'tool_use') {
          v.push({ zeit: jetzt(), art: 'werkzeug', id: c.id, name: c.name, kurz: kurzfassung(c.name, c.input), unter, start: jetzt() });
          a.live = { art: 'werkzeug', id: c.id, name: c.name, kurz: kurzfassung(c.name, c.input), seit: jetzt(), unter };
          a.liveText = '';
        }
      }
    } else if (e.type === 'user' && Array.isArray(e.message?.content)) {
      for (const c of e.message.content) {
        if (c?.type !== 'tool_result') continue;
        const w = [...v].reverse().find(x => x.art === 'werkzeug' && x.id === c.tool_use_id);
        const inhalt = Array.isArray(c.content) ? c.content.map(x => x.text || (x.type === 'image' ? '[Bild]' : '')).join('\n') : String(c.content ?? '');
        if (w) {
          w.ende = jetzt();
          w.ausgabe = inhalt.length > 4000 ? inhalt.slice(0, 1500) + '\n…\n' + inhalt.slice(-2400) : inhalt;
          if (c.is_error) { w.fehler = true; w.fehlerText = kurz(inhalt, 500); }
        }
        if (a.live?.id === c.tool_use_id) a.live = { art: 'denkt', seit: jetzt(), unter };
      }
    } else if (e.type === 'rate_limit_event' && e.rate_limit_info) {
      this.o.limit?.(e.rate_limit_info);
      return;
    } else if (e.type === 'result') {
      a.kosten = Math.round(((a.kosten || 0) + (Number(e.total_cost_usd) || 0)) * 10000) / 10000;
      a.sitzung = e.session_id || a.sitzung;
      if (e.is_error) a.letzterLaufFehler = true;
      a.ergebnis = kurz(e.result || '');
      a.live = null; a.liveText = '';
      v.push({ zeit: jetzt(), art: 'ergebnis', text: kurz(e.result || ''), fehler: !!e.is_error,
        dauerMs: e.duration_ms || null, kosten: Number(e.total_cost_usd) || 0 });
    }
    if (v.length > MAX_VERLAUF) v.splice(1, v.length - MAX_VERLAUF);
    this.speichern(a);
  }

  // ---------- Haken (PreToolUse) ----------

  /** Anfrage des Hakens: sofort entscheiden oder Karte anlegen. */
  hakenAnfrage({ auftrag, token, werkzeug, eingabe, toolUseId, cwd }) {
    const a = this.auftraege.get(auftrag);
    if (!a || !gleich(token, a.token)) return { status: 403 };
    if (a.status !== 'laeuft') return { entscheidung: 'deny', grund: 'Der Auftrag läuft nicht mehr.' };
    werkzeug = String(werkzeug || ''); eingabe = eingabe && typeof eingabe === 'object' ? eingabe : {};
    const schluessel = aufrufSchluessel(werkzeug, eingabe);
    if ((a.immer || []).includes(schluessel)) {
      if (toolUseId) a.entscheidungen[toolUseId] = 'erlaubt';
      return { entscheidung: 'allow', grund: 'FAH-Cockpit: in diesem Auftrag vom Betreiber immer erlaubt.' };
    }
    const orte = {
      projekt: path.join(this.o.wurzel, a.ordner), cwd: typeof cwd === 'string' ? cwd : this.o.arbeitsordner,
      gesperrt: [this.o.ablage],
    };
    const urteil = pruefen(werkzeug, eingabe, orte);
    if (urteil.stufe === 'durch') return { entscheidung: 'durch' };            // Claude Code entscheidet selbst
    if (urteil.stufe === 'karte' && a.allesErlaubt) {
      if (toolUseId) a.entscheidungen[toolUseId] = 'alles';
      return { entscheidung: 'allow', grund: 'FAH-Cockpit: in diesem Auftrag hat der Betreiber alles erlaubt.' };
    }
    const f = {
      id: randomBytes(6).toString('hex'), zeit: jetzt(), werkzeug, kurz: kurzfassung(werkzeug, eingabe),
      voll: volltext(werkzeug, eingabe), schluessel,
      begruendung: kurz(eingabe?.description || '', 400), warum: urteil.grund, immerFragen: urteil.stufe === 'immer', toolUseId: toolUseId || null,
      status: 'offen', antwort: '',
    };
    a.freigaben.push(f);
    a.version = (a.version || 0) + 1;
    a.live = { art: 'wartet', name: werkzeug, kurz: f.kurz, seit: jetzt() };
    a.verlauf.push({ zeit: jetzt(), art: 'freigabe', freigabe: f.id });
    this.speichern(a);
    this.o.melden('Wartet auf dein Ja', `${a.ordner}: ${f.werkzeug} – ${f.kurz.slice(0, 80)}`);
    return { warte: f.id };
  }

  /** Abfrage des Hakens, ob schon entschieden ist. */
  hakenStand({ auftrag, token, freigabe }) {
    const a = this.auftraege.get(auftrag);
    if (!a || !gleich(token, a.token)) return { status: 403 };
    const f = a.freigaben.find(x => x.id === freigabe);
    if (!f) return { entscheidung: 'deny', grund: 'Freigabe unbekannt.' };
    if (f.status === 'offen') return { offen: true };
    if (f.status === 'erlaubt') return { entscheidung: 'allow', grund: 'Vom Betreiber im FAH-Cockpit erlaubt.' };
    return { entscheidung: 'deny', grund: f.status === 'abgelehnt'
      ? `Vom Betreiber im FAH-Cockpit abgelehnt${f.antwort ? ': ' + f.antwort : '.'} Nicht umgehen – melde es in deiner Antwort.`
      : 'Die Freigabe ist verfallen (Auftrag beendet).' };
  }

  /** Der Betreiber entscheidet über eine Karte. */
  async entscheiden(auftrag, freigabe, erlauben, antwort = '', immer = false) {
    const a = this.auftraege.get(auftrag);
    const f = a?.freigaben.find(x => x.id === freigabe);
    if (!f) throw new Error('Freigabe nicht gefunden');
    if (f.status !== 'offen') throw new Error('Darüber ist schon entschieden.');
    f.status = erlauben ? 'erlaubt' : 'abgelehnt';
    f.antwort = kurz(antwort, 500);
    f.entschieden = jetzt();
    a.version = (a.version || 0) + 1;
    if (a.live?.art === 'wartet') a.live = { art: 'werkzeug', name: f.werkzeug, kurz: f.kurz, seit: jetzt() };
    if (f.toolUseId) a.entscheidungen[f.toolUseId] = f.status;
    // „Alles erlauben (dieser Auftrag)“: ab jetzt keine Karten mehr in diesem Auftrag – auch offene werden erlaubt.
    if (erlauben && immer) {
      a.allesErlaubt = true; f.immer = true;
      for (const g of a.freigaben) if (g.status === 'offen' && !g.immerFragen) { g.status = 'erlaubt'; g.entschieden = jetzt(); if (g.toolUseId) a.entscheidungen[g.toolUseId] = 'erlaubt'; }
    }
    await this.speichernJetzt(a);
    return this.holen(auftrag);
  }

  /** „Alles erlauben“ für einen Auftrag ein- oder ausschalten. */
  async allesErlauben(id, an) {
    const a = this.auftraege.get(id);
    if (!a) throw new Error('Auftrag nicht gefunden');
    a.allesErlaubt = !!an;
    if (an) for (const g of a.freigaben) if (g.status === 'offen' && !g.immerFragen) { g.status = 'erlaubt'; g.entschieden = jetzt(); if (g.toolUseId) a.entscheidungen[g.toolUseId] = 'erlaubt'; }
    a.verlauf.push({ zeit: jetzt(), art: 'hinweis', text: an ? 'Du hast für diesen Auftrag alles erlaubt.' : 'Ab jetzt wird wieder gefragt.' });
    await this.speichernJetzt(a);
    return this.holen(id);
  }

  // ---------- Ablage ----------

  speichern(a, nurLive = false) {
    if (nurLive) return;                                // Live-Zustand lebt im Speicher, die Platte bekommt ihn beim nächsten Schritt
    if (this.speichernTimer.has(a.id)) return;
    this.speichernTimer.set(a.id, setTimeout(() => {
      this.speichernTimer.delete(a.id);
      this.speichernJetzt(a).catch(() => {});
    }, 500));
  }

  async speichernJetzt(a) {
    const t = this.speichernTimer.get(a.id);
    if (t) { clearTimeout(t); this.speichernTimer.delete(a.id); }
    const datei = path.join(this.ordnerAuftraege, a.id + '.json');
    const zwischen = datei + '.' + process.pid + '.tmp';
    await writeFile(zwischen, JSON.stringify(a), { mode: 0o600 });
    await rename(zwischen, datei);
  }

  /** Nur die letzten BEHALTEN Aufträge aufheben. */
  async aufraeumen() {
    const alle = [...this.auftraege.values()].sort((x, y) => y.erstellt.localeCompare(x.erstellt));
    const { unlink } = await import('node:fs/promises');
    for (const a of alle.slice(BEHALTEN)) {
      if (a.status === 'laeuft' || a.status === 'wartend') continue;
      this.auftraege.delete(a.id);
      await unlink(path.join(this.ordnerAuftraege, a.id + '.json')).catch(() => {});
      await rm(path.join(this.ordnerBilder, a.id), { recursive: true, force: true }).catch(() => {});
    }
  }
}
