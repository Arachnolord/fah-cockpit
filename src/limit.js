// ============================================================================
// Erdacht und programmiert von Fabian Hammer, Deutschland.
// (c) 2026 Fabian Hammer - Alle Rechte vorbehalten. Geistiges Eigentum.
// ============================================================================
// Nutzungslimit des Claude-Abos. Drei Quellen, alle als Anteil 0…1 gespeichert:
// - live (Betreiber 27.11.: „Ja, Schlüsselbund lesen“): jede Minute wie `/usage` – Zugangstoken von Claude Code aus dem
//   Schlüsselbund (nur im Speicher, nie gespeichert, nie ausgegeben, nie erneuert) → api.anthropic.com/api/oauth/usage
// - aus jedem Auftrag: `rate_limit_event` von Claude Code
// - „Jetzt messen“: winzige Haiku-Anfrage ohne gespeicherte Sitzung

import { spawn, execFile } from 'node:child_process';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';

export class Limit {
  constructor({ ablage, claude = 'claude', einstellungen = null }) {
    this.datei = path.join(ablage, 'limit.json');
    this.ablage = ablage;
    this.claude = claude;
    this.einstellungen = einstellungen;
    this.werte = { fenster: {}, stand: null, quelle: null, ueberzug: null, wichtigstes: null };
    this.misst = false;
  }

  async laden() {
    try { Object.assign(this.werte, JSON.parse(await readFile(this.datei, 'utf8'))); } catch { /* noch nichts */ }
  }

  aktuell() { return { ...this.werte, misst: this.misst }; }

  /** Live wie /usage. Wirft bei fehlender Anmeldung oder abgelaufenem Token (Claude Code erneuert es beim nächsten Lauf). */
  async abfragen() {
    const roh = await new Promise((resolve, reject) => execFile('security', ['find-generic-password', '-s', 'Claude Code-credentials', '-w'],
      { timeout: 15_000 }, (f, aus) => (f ? reject(new Error('Claude-Anmeldung im Schlüsselbund nicht lesbar')) : resolve(String(aus)))));
    let token;
    try { token = JSON.parse(roh).claudeAiOauth?.accessToken; } catch { /* unten */ }
    if (!token) throw new Error('Keine Claude-Anmeldung gefunden');
    const r = await fetch('https://api.anthropic.com/api/oauth/usage', {
      headers: { Authorization: 'Bearer ' + token, 'anthropic-beta': 'oauth-2025-04-20', 'User-Agent': 'fah-cockpit' },
      signal: AbortSignal.timeout(20_000),
    });
    token = null;
    if (r.status === 401) throw new Error('Anmeldung abgelaufen – erneuert sich beim nächsten Claude-Lauf');
    if (!r.ok) throw new Error('Abfrage fehlgeschlagen (' + r.status + ')');
    const d = await r.json();
    const fenster = {};
    for (const [name, w] of Object.entries(d || {})) {
      if (!w || typeof w !== 'object' || !Number.isFinite(Number(w.utilization))) continue;
      fenster[name] = { auslastung: Number(w.utilization) / 100, zurueck: w.resets_at || null, status: w.locked_reason ? 'gesperrt' : 'allowed' };
    }
    const extra = d?.extra_usage;
    this.werte = { ...this.werte, fenster, stand: new Date().toISOString(), quelle: 'live', fehler: null,
      ueberzug: extra ? { status: extra.is_enabled ? 'an' : 'aus', grund: null, aktiv: !!extra.is_enabled } : this.werte.ueberzug };
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.sichern().catch(() => {}), 500);
    return this.aktuell();
  }

  /** rate_limit_info aus Claude Code übernehmen. */
  merken(info, quelle = 'auftrag') {
    if (!info || typeof info !== 'object') return;
    const fenster = { ...this.werte.fenster };
    const uw = info.unifiedWindows && typeof info.unifiedWindows === 'object' ? info.unifiedWindows : null;
    if (uw) {
      for (const [name, f] of Object.entries(uw)) {
        if (!f || typeof f !== 'object') continue;
        fenster[name] = { auslastung: Number(f.utilization), zurueck: f.resetsAt ? new Date(f.resetsAt * 1000).toISOString() : null, status: f.status || null };
      }
    } else if (info.rateLimitType) {
      fenster[info.rateLimitType] = { ...(fenster[info.rateLimitType] || {}), zurueck: info.resetsAt ? new Date(info.resetsAt * 1000).toISOString() : null, status: info.status || null };
    }
    // Live-Werte nicht von einem Auftrag überschreiben lassen, der nur ein Fenster meldet – nur ergänzen
    this.werte = {
      ...this.werte,
      fenster, stand: this.werte.quelle === 'live' && Date.now() - Date.parse(this.werte.stand || 0) < 120_000 ? this.werte.stand : new Date().toISOString(),
      quelle: this.werte.quelle === 'live' && Date.now() - Date.parse(this.werte.stand || 0) < 120_000 ? 'live' : quelle,
      wichtigstes: info.rateLimitType || this.werte.wichtigstes,
      ueberzug: { status: info.overageStatus || null, grund: info.overageDisabledReason || null, aktiv: !!info.isUsingOverage },
    };
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.sichern().catch(() => {}), 500);
  }

  async sichern() {
    await mkdir(path.dirname(this.datei), { recursive: true });
    const zwischen = this.datei + '.' + process.pid + '.tmp';
    await writeFile(zwischen, JSON.stringify(this.werte, null, 2));
    await rename(zwischen, this.datei);
  }

  /** Winzige Haiku-Anfrage ohne gespeicherte Sitzung, nur um den aktuellen Stand zu bekommen. */
  async messen() {
    if (this.misst) return this.aktuell();
    this.misst = true;
    try {
      const env = this.einstellungen ? await this.einstellungen.umgebung() : process.env;
      await new Promise((resolve, reject) => {
        const kind = spawn(this.claude, ['-p', 'Antworte nur mit: OK', '--model', 'haiku', '--output-format', 'stream-json', '--verbose',
          '--no-session-persistence', '--disallowedTools', 'Bash Edit Write Read WebFetch WebSearch Agent Task'],
        { cwd: this.ablage, env, stdio: ['ignore', 'pipe', 'ignore'] });
        let puffer = '', gefunden = false;
        const zeit = setTimeout(() => { kind.kill('SIGTERM'); reject(new Error('Messung dauerte zu lange')); }, 90_000);
        kind.stdout.setEncoding('utf8');
        kind.stdout.on('data', s => {
          puffer += s; let n;
          while ((n = puffer.indexOf('\n')) >= 0) {
            const z = puffer.slice(0, n); puffer = puffer.slice(n + 1);
            try { const e = JSON.parse(z); if (e.type === 'rate_limit_event') { gefunden = true; this.merken(e.rate_limit_info, 'messung'); } } catch { /* weiter */ }
          }
        });
        kind.on('error', e => { clearTimeout(zeit); reject(e); });
        kind.on('close', () => { clearTimeout(zeit); gefunden ? resolve() : reject(new Error('Claude Code hat keinen Limit-Stand gemeldet')); });
      });
    } finally {
      this.misst = false;
    }
    return this.aktuell();
  }
}
