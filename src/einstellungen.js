// ============================================================================
// Erdacht und programmiert von Fabian Hammer, Deutschland.
// (c) 2026 Fabian Hammer - Alle Rechte vorbehalten. Geistiges Eigentum.
// ============================================================================
// Einstellungen für Aufträge: Standard-Modell, Standard-Aufwand und Anmeldung (wie Claude Code auf dem Mac, eigenes
// Abo-Token aus `claude setup-token` oder API-Schlüssel). Token und Schlüssel liegen im macOS-Schlüsselbund, nie in
// einer Datei und nie in der Oberfläche.

import { execFile } from 'node:child_process';
import { readFile, writeFile, rename } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const MODELLE = ['', 'fable', 'opus', 'sonnet', 'haiku'];
export const AUFWAENDE = ['', 'low', 'medium', 'high', 'xhigh', 'max'];
export const ANMELDUNGEN = ['claude-code', 'token', 'schluessel'];

const DIENST = 'FAH-Cockpit';
const KONTO = { token: 'claude-oauth-token', schluessel: 'anthropic-api-key', fahgit: 'fahgit-zugangsschluessel' };

function aufruf(befehl, args, { env, ms = 15_000 } = {}) {
  return new Promise(resolve => {
    execFile(befehl, args, { env: env || process.env, timeout: ms, maxBuffer: 1024 * 1024 },
      (fehler, aus, err) => resolve({ ok: !fehler, aus: String(aus || ''), err: String(err || ''), code: fehler?.code }));
  });
}

export class Einstellungen {
  constructor({ ablage, claude = 'claude', schluesselbund = true }) {
    this.datei = path.join(ablage, 'einstellungen.json');
    this.claude = claude;
    this.schluesselbund = schluesselbund;   // in Tests aus
    this.werte = { modell: '', aufwand: '', anmeldung: 'claude-code', limitLive: false, fahgitAdresse: '', fahgitErsatz: '', fahgitBenutzer: '', wissenZiel: '', wissenOrdner: '', projektVorsilbe: '', fahgitProjektOrdner: '' };
    this.speicher = new Map();               // Geheimnisse, wenn kein Schlüsselbund (Tests)
    this.kiZwischen = null;
  }

  async laden() {
    try { Object.assign(this.werte, JSON.parse(await readFile(this.datei, 'utf8'))); } catch { /* Standard */ }
    return this.werte;
  }

  aktuell() { return { ...this.werte }; }

  async speichern(neu) {
    const w = { ...this.werte };
    if (neu.modell !== undefined) { if (!MODELLE.includes(neu.modell)) throw new Error('Unbekanntes Modell'); w.modell = neu.modell; }
    if (neu.aufwand !== undefined) { if (!AUFWAENDE.includes(neu.aufwand)) throw new Error('Unbekannter Aufwand'); w.aufwand = neu.aufwand; }
    if (neu.limitLive !== undefined) w.limitLive = neu.limitLive === true;
    // FAH-Git-Verbindung (für den Wissens-Spiegel und neue Projekte – auch auf einem frischen Mac ohne Claude)
    if (neu.fahgitAdresse !== undefined) {
      const a = String(neu.fahgitAdresse).trim().replace(/\/+$/, '');
      if (a && !/^https?:\/\/[^\s/]+(:\d+)?$/.test(a)) throw new Error('FAH-Git-Adresse bitte wie http://192.168.1.20:3300 angeben.');
      w.fahgitAdresse = a;
    }
    if (neu.fahgitErsatz !== undefined) {
      const a = String(neu.fahgitErsatz).trim().replace(/\/+$/, '');
      if (a && !/^https?:\/\/[^\s/]+(:\d+)?$/.test(a)) throw new Error('Ersatz-Adresse bitte wie http://192.168.1.21:3300 angeben.');
      if (a && a === w.fahgitAdresse) throw new Error('Der Ersatz braucht eine andere Adresse als der Haupt.');
      w.fahgitErsatz = a;
    }
    if (neu.projektVorsilbe !== undefined) {
      const v = String(neu.projektVorsilbe).trim();
      if (v && !/^[A-Za-z0-9][A-Za-z0-9_-]{0,19}$/.test(v)) throw new Error('Vorsilbe nur mit Buchstaben, Ziffern, „-“ und „_“ (z. B. fah-).');
      w.projektVorsilbe = v;
    }
    if (neu.fahgitProjektOrdner !== undefined) {
      const o = String(neu.fahgitProjektOrdner).trim().replace(/^\/+|\/+$/g, '');
      if (o && (!/^[a-z0-9][a-z0-9/_-]*$/i.test(o) || /fx-git|frederix/i.test(o))) throw new Error('Ungültiger FAH-Git-Ordner (FX-Git/frederix nie).');
      w.fahgitProjektOrdner = o;
    }
    if (neu.wissenZiel !== undefined) {
      if (!['', 'fahgit', 'ordner', 'aus'].includes(neu.wissenZiel)) throw new Error('Unbekanntes Ziel für das Wissen');
      w.wissenZiel = neu.wissenZiel;
    }
    if (neu.wissenOrdner !== undefined) {
      const o = String(neu.wissenOrdner).trim();
      if (o && !(o.startsWith('/') || o === '~' || o.startsWith('~/'))) throw new Error('Wissensordner bitte als vollständigen Pfad angeben (z. B. ~/claude oder /Volumes/…).');
      w.wissenOrdner = o;
    }
    if (w.wissenZiel === 'ordner' && !w.wissenOrdner) throw new Error('Für „Ordner“ bitte einen Wissensordner angeben.');
    if (w.wissenZiel === 'fahgit' && !w.fahgitAdresse) {
      if (neu.wissenZiel === 'fahgit') throw new Error('Für FAH-Git erst oben die FAH-Git-Verbindung hinterlegen.');
      w.wissenZiel = '';                              // Verbindung entfernt → Wissen ruht, bis ein Ziel gewählt ist
    }
    if (neu.fahgitBenutzer !== undefined) w.fahgitBenutzer = String(neu.fahgitBenutzer).trim().slice(0, 80);
    const fg = typeof neu.fahgitSchluessel === 'string' ? neu.fahgitSchluessel.trim() : '';
    if (fg) {
      if (fg.length > 400 || /\s/.test(fg)) throw new Error('Der FAH-Git-Zugangsschlüssel sieht nicht richtig aus.');
      await this.geheimnisSetzen('fahgit', fg);
    }
    if (neu.fahgitSchluesselLoeschen === true) await this.geheimnisLoeschen('fahgit');
    if (neu.anmeldung !== undefined) { if (!ANMELDUNGEN.includes(neu.anmeldung)) throw new Error('Unbekannte Anmeldung'); w.anmeldung = neu.anmeldung; }
    for (const art of ['token', 'schluessel']) {   // (fahgit oben)
      const wert = typeof neu[art] === 'string' ? neu[art].trim() : '';
      if (wert) {
        if (wert.length > 400 || /\s/.test(wert)) throw new Error(art === 'token' ? 'Das Token sieht nicht richtig aus.' : 'Der Schlüssel sieht nicht richtig aus.');
        await this.geheimnisSetzen(art, wert);
      }
      if (neu[art + 'Loeschen'] === true) await this.geheimnisLoeschen(art);
    }
    if (w.anmeldung !== 'claude-code' && !(await this.geheimnisHolen(w.anmeldung))) {
      throw new Error(w.anmeldung === 'token' ? 'Für diese Anmeldung fehlt noch das Token.' : 'Für diese Anmeldung fehlt noch der API-Schlüssel.');
    }
    const zwischen = this.datei + '.' + process.pid + '.tmp';
    await writeFile(zwischen, JSON.stringify(w, null, 2), { mode: 0o600 });
    await rename(zwischen, this.datei);
    this.werte = w;
    this.kiZwischen = null;
    this._ziel = null;
    if (fg && w.fahgitAdresse) await this.gitZugangHinterlegen(fg).catch(() => {});
    // Neuer Ersatz ohne neuen Schlüssel: den vorhandenen Schlüssel auch für den Ersatz bei git hinterlegen
    else if (neu.fahgitErsatz && w.fahgitErsatz && w.fahgitAdresse) {
      const { schluessel } = await this.fahgitSchluessel();
      if (schluessel) await this.gitZugangHinterlegen(schluessel).catch(() => {});
    }
    return this.werte;
  }

  // ---------- FAH-Git ----------

  /** Zugangsschlüssel für FAH-Git: aus dem Cockpit, sonst der git-Zugang dieses Macs (git credential fill). */
  async fahgitSchluessel() {
    const eigen = await this.geheimnisHolen('fahgit');
    if (eigen) return { schluessel: eigen, quelle: 'cockpit' };
    if (!this.werte.fahgitAdresse || !this.schluesselbund) return { schluessel: null, quelle: null };
    const u = new URL(this.werte.fahgitAdresse);
    const r = await new Promise(resolve => {
      const k = execFile('git', ['credential', 'fill'], { timeout: 10_000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
        (f, aus) => resolve(f ? '' : String(aus)));
      k.stdin.end(`protocol=${u.protocol.replace(':', '')}\nhost=${u.host}\n${this.werte.fahgitBenutzer ? 'username=' + this.werte.fahgitBenutzer + '\n' : ''}\n`);
    });
    const pw = /^password=(.*)$/m.exec(r)?.[1];
    return pw ? { schluessel: pw, quelle: 'git' } : { schluessel: null, quelle: null };
  }

  /** Den Schlüssel auch für git hinterlegen (Schlüsselbund über git credential), damit Push/Pull ohne Rückfrage gehen –
   *  für Haupt und Ersatz (der Ersatz übernimmt Konten und Zugangsschlüssel vom Haupt). */
  async gitZugangHinterlegen(schluessel) {
    for (const adresse of [this.werte.fahgitAdresse, this.werte.fahgitErsatz].filter(Boolean)) {
      const u = new URL(adresse);
      await new Promise(resolve => {
        const k = execFile('git', ['credential', 'approve'], { timeout: 10_000 }, () => resolve());
        k.stdin.end(`protocol=${u.protocol.replace(':', '')}\nhost=${u.host}\nusername=${this.werte.fahgitBenutzer || 'fabian'}\npassword=${schluessel}\n\n`);
      });
    }
  }

  /** /api/status einer FAH-Git-Instanz (Version, Fail-over-Rolle) – null, wenn nicht erreichbar. */
  async fahgitStatus(adresse, ms = 5000) {
    try {
      const r = await fetch(adresse + '/api/status', { signal: AbortSignal.timeout(ms) });
      return r.ok ? await r.json() : null;
    } catch { return null; }
  }

  /**
   * Wohin gerade geschrieben werden kann: der Haupt; ist er weg, ein Ersatz, der übernommen hat („Zum Haupt machen“).
   * Ein Ersatz in Rolle „ersatz“ lässt nur lesen – dann bleibt alles lokal und geht später zum Haupt. 30 s zwischengespeichert.
   * @returns {Promise<{art: 'haupt'|'ersatz'|null, adresse: string|null, grund: string|null}>}
   */
  async fahgitZiel(frisch = false) {
    if (!frisch && this._ziel && Date.now() - this._ziel.zeit < 30_000) return this._ziel.wert;
    const w = this.werte;
    let wert;
    if (!w.fahgitAdresse) wert = { art: null, adresse: null, grund: 'keine FAH-Git-Verbindung hinterlegt' };
    else if (await this.fahgitStatus(w.fahgitAdresse)) wert = { art: 'haupt', adresse: w.fahgitAdresse, grund: null };
    else if (!w.fahgitErsatz) wert = { art: null, adresse: null, grund: 'FAH-Git nicht erreichbar' };
    else {
      const s = await this.fahgitStatus(w.fahgitErsatz);
      wert = !s ? { art: null, adresse: null, grund: 'Haupt und Ersatz nicht erreichbar' }
        : s.failover?.rolle === 'ersatz' ? { art: null, adresse: null, grund: 'Haupt nicht erreichbar, Ersatz lässt nur lesen (dort „Zum Haupt machen“)' }
        : { art: 'ersatz', adresse: w.fahgitErsatz, grund: null };
    }
    this._ziel = { zeit: Date.now(), wert };
    return wert;
  }

  /** Remote-Adresse des Haupts auf den Ersatz umschreiben (gleicher Pfad); null, wenn sie nicht zum Haupt gehört. */
  aufErsatz(url) {
    const w = this.werte;
    if (!w.fahgitAdresse || !w.fahgitErsatz) return null;
    try {
      const u = new URL(url), haupt = new URL(w.fahgitAdresse), ersatz = new URL(w.fahgitErsatz);
      if (u.host !== haupt.host) return null;
      u.protocol = ersatz.protocol; u.host = ersatz.host;
      return u.toString();
    } catch { return null; }
  }

  /** Verbindung prüfen: /api/konto mit dem Schlüssel – am Haupt und (falls hinterlegt) am Ersatz samt Fail-over-Rolle. */
  async fahgitPruefen() {
    const w = this.werte;
    const aus = { adresse: w.fahgitAdresse, benutzer: w.fahgitBenutzer, schluesselDa: false, quelle: null, verbunden: false, name: null, fehler: null, ersatz: null };
    if (!w.fahgitAdresse) { aus.fehler = 'Noch keine Adresse hinterlegt'; return aus; }
    const { schluessel, quelle } = await this.fahgitSchluessel();
    aus.schluesselDa = !!schluessel; aus.quelle = quelle;
    const konto = async adresse => {
      if (!schluessel) return { verbunden: false, fehler: 'Kein Zugangsschlüssel' };
      try {
        const r = await fetch(adresse + '/api/konto', { headers: { Authorization: 'Bearer ' + schluessel }, signal: AbortSignal.timeout(8000) });
        if (r.status === 401 || r.status === 403) return { verbunden: false, fehler: 'Schlüssel wird abgelehnt' };
        if (!r.ok) return { verbunden: false, fehler: 'FAH-Git antwortet mit ' + r.status };
        const k = await r.json();
        return { verbunden: true, name: k.anzeige || k.name || null, fehler: null };
      } catch (e) { return { verbunden: false, fehler: 'Nicht erreichbar (' + (e.name === 'TimeoutError' ? 'Zeitüberschreitung' : e.message) + ')' }; }
    };
    const [h, e, s] = await Promise.all([konto(w.fahgitAdresse), w.fahgitErsatz ? konto(w.fahgitErsatz) : null,
      w.fahgitErsatz ? this.fahgitStatus(w.fahgitErsatz) : null]);
    Object.assign(aus, h);
    if (w.fahgitErsatz) {
      const rolle = s?.failover?.rolle || (s ? 'haupt' : null);
      aus.ersatz = { adresse: w.fahgitErsatz, erreichbar: !!s, version: s?.version || null, rolle,
        nurLesen: rolle === 'ersatz', gekoppelt: s?.failover?.gekoppelt ?? null, ...e };
    }
    aus.ziel = await this.fahgitZiel(true);
    return aus;
  }

  // ---------- Schlüsselbund ----------

  async geheimnisSetzen(art, wert) {
    if (!this.schluesselbund) { this.speicher.set(art, wert); return; }
    const r = await aufruf('security', ['add-generic-password', '-U', '-s', DIENST, '-a', KONTO[art], '-w', wert]);
    if (!r.ok) throw new Error('Konnte nicht im Schlüsselbund speichern.');
  }

  async geheimnisHolen(art) {
    if (!KONTO[art]) return null;
    if (!this.schluesselbund) return this.speicher.get(art) || null;
    const r = await aufruf('security', ['find-generic-password', '-s', DIENST, '-a', KONTO[art], '-w']);
    return r.ok ? r.aus.trim() || null : null;
  }

  async geheimnisLoeschen(art) {
    if (!this.schluesselbund) { this.speicher.delete(art); return; }
    await aufruf('security', ['delete-generic-password', '-s', DIENST, '-a', KONTO[art]]);
  }

  /**
   * Umgebung für einen Claude-Lauf nach gewählter Anmeldung. Bei Token/Schlüssel werden die jeweils anderen
   * Anmeldewege entfernt, damit wirklich das Gewählte gilt.
   */
  async umgebung(anmeldung = this.werte.anmeldung) {
    const env = { ...process.env };
    delete env.ANTHROPIC_API_KEY; delete env.CLAUDE_CODE_OAUTH_TOKEN; delete env.ANTHROPIC_AUTH_TOKEN;
    if (anmeldung === 'token') {
      const t = await this.geheimnisHolen('token');
      if (!t) throw new Error('Anmeldung „Abo-Token“ gewählt, aber kein Token gespeichert (Einstellungen).');
      env.CLAUDE_CODE_OAUTH_TOKEN = t;
    } else if (anmeldung === 'schluessel') {
      const k = await this.geheimnisHolen('schluessel');
      if (!k) throw new Error('Anmeldung „API-Schlüssel“ gewählt, aber kein Schlüssel gespeichert (Einstellungen).');
      env.ANTHROPIC_API_KEY = k;
    }
    return env;
  }

  /** Was läuft hier? Version und Anmeldestatus von Claude Code (60 s zwischengespeichert). */
  async ki(frisch = false) {
    if (!frisch && this.kiZwischen && Date.now() - this.kiZwischen.zeit < 60_000) return this.kiZwischen.daten;
    const [version, standard] = await Promise.all([
      aufruf(this.claude, ['--version']),
      readFile(path.join(os.homedir(), '.claude', 'settings.json'), 'utf8').then(t => JSON.parse(t)).catch(() => ({})),
    ]);
    let status = null, fehler = null;
    try {
      const r = await aufruf(this.claude, ['auth', 'status', '--json'], { env: await this.umgebung() });
      status = JSON.parse(r.aus);
    } catch (e) { fehler = e.message; }
    const daten = {
      version: version.ok ? version.aus.trim() : null,
      standardModell: typeof standard.model === 'string' ? standard.model : null,
      standardAufwand: typeof standard.effortLevel === 'string' ? standard.effortLevel : null,
      angemeldet: !!status?.loggedIn,
      methode: status?.authMethod || null,
      anbieter: status?.apiProvider || null,
      abo: status?.planTier || status?.subscriptionType || null,
      email: status?.email || null,
      organisation: status?.orgName || null,
      gueltigBis: status?.loginExpiresAt || null,
      fehler,
      tokenDa: !!(await this.geheimnisHolen('token')),
      schluesselDa: !!(await this.geheimnisHolen('schluessel')),
    };
    this.kiZwischen = { zeit: Date.now(), daten };
    return daten;
  }
}
