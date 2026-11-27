// ============================================================================
// Erdacht und programmiert von Fabian Hammer, Deutschland.
// (c) 2026 Fabian Hammer - Alle Rechte vorbehalten. Geistiges Eigentum.
// ============================================================================
// Welche Werkzeugaufrufe eines Hintergrund-Auftrags auf das Ja des Betreibers warten – nach dem Vorbild des Multitools:
// Claude Code arbeitet mit seinem normalen Rechtesystem (auto-Modus und die Regeln des Betreibers, wie im Terminal).
// Das Cockpit fängt nur ab, was nach außen geht oder sich nicht zurückholen lässt (push, ssh, Deploy, Uploads,
// rekursives Löschen, Dienste, Apps steuern, sendende Anbindungen). „Alles erlauben (dieser Auftrag)“ lässt auch das
// durch – außer einer kleinen Liste, die immer fragt (sudo, Force-Push, rm -rf außerhalb des Projekts, Neustart).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Programmordner des Cockpits: nie ohne Ja beschreibbar, egal was der Aufrufer übergibt (sonst könnte ein Auftrag
 *  den eigenen Wächter umschreiben). */
const EIGENER_CODE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const heim = () => os.homedir();
const klein = s => (process.platform === 'darwin' || process.platform === 'win32') ? s.toLowerCase() : s;

/** Absoluter, echter Pfad (Symlinks des tiefsten vorhandenen Elternordners aufgelöst, ~ ausgeschrieben). */
export function echterPfad(p) {
  let roh = String(p || '');
  if (roh === '~' || roh.startsWith('~/')) roh = path.join(heim(), roh.slice(1));
  let rest = [], aktuell = path.resolve(roh);
  for (;;) {
    try { return path.join(fs.realpathSync.native(aktuell), ...rest.reverse()); } catch { /* weiter oben */ }
    const oben = path.dirname(aktuell);
    if (oben === aktuell) return path.resolve(roh);
    rest.push(path.basename(aktuell)); aktuell = oben;
  }
}

/** Liegt datei (echt) in ordner (echt)? Auf macOS ohne Rücksicht auf Groß-/Kleinschreibung. */
export function innerhalb(datei, ordner) {
  if (!datei || !ordner) return false;
  const rel = path.relative(klein(echterPfad(ordner)), klein(echterPfad(datei)));
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

const gleicherPfad = (a, b) => klein(echterPfad(a)) === klein(echterPfad(b));

/**
 * Zerlegt eine Befehlszeile wie die Shell in Teilbefehle aus Wörtern (Anführungszeichen und Backslashes aufgelöst).
 * Gibt null zurück bei allem, was die Prüfung unsicher macht: $ und ` außerhalb einfacher Anführungszeichen, <, Klammern,
 * Umleitungen in Dateien. Erlaubt sind nur die Umleitungen 2>&1, >/dev/null, 2>/dev/null und &>/dev/null.
 */
export function zerlegen(befehl) {
  const s = String(befehl);
  const teile = []; let woerter = [], wort = null, q = null, umleitung = null;
  const wortEnde = () => {
    if (wort === null) return true;
    if (umleitung) {
      const ok = wort === '/dev/null' || (umleitung.endsWith('&') && /^[12]$/.test(wort));
      umleitung = null; wort = null; return ok;
    }
    woerter.push(wort); wort = null; return true;
  };
  const teilEnde = () => {
    if (!wortEnde() || umleitung) return false;
    if (woerter.length) teile.push(woerter);
    woerter = []; return true;
  };
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q === "'") { if (c === "'") q = null; else wort += c; continue; }
    if (q === '"') {
      if (c === '"') { q = null; continue; }
      if (c === '$' || c === '`') return null;
      if (c === '\\' && i + 1 < s.length && '$`"\\\n'.includes(s[i + 1])) { if (s[i + 1] !== '\n') wort += s[i + 1]; i++; continue; }
      wort += c; continue;
    }
    if (c === "'" || c === '"') { q = c; if (wort === null) wort = ''; continue; }
    if (c === '\\') { if (i + 1 < s.length) { if (s[i + 1] !== '\n') wort = (wort ?? '') + s[i + 1]; i++; } continue; }
    if (c === '$' || c === '`' || c === '<' || c === '(' || c === ')') return null;
    if (c === '#' && wort === null) { while (i + 1 < s.length && s[i + 1] !== '\n') i++; continue; }
    if (c === ' ' || c === '\t') { if (!wortEnde()) return null; continue; }
    if (c === '>' || (c === '&' && s[i + 1] === '>')) {
      if (c === '>' && wort !== null && /^\d$/.test(wort)) wort = null;       // „2>“: Dateinummer
      else if (!wortEnde()) return null;
      if (umleitung) return null;
      if (c === '&') i++;
      let op = '>';
      if (s[i + 1] === '>') { op = '>>'; i++; }
      if (s[i + 1] === '&') { op += '&'; i++; }
      umleitung = op; continue;
    }
    if (c === ';' || c === '\n' || c === '|' || c === '&') {
      if ((c === '|' || c === '&') && s[i + 1] === c) i++;
      if (!teilEnde()) return null;
      continue;
    }
    wort = (wort ?? '') + c;
  }
  if (q) return null;
  if (!teilEnde()) return null;
  return teile;
}

// ---------------------------------------------------------------------------------------------------------------

/** Hüllen und Umgebungsvariablen vorne abschälen, /bin/… /usr/bin/… auf den Befehlsnamen kürzen. */
function kern(woerter) {
  let w = woerter.slice();
  for (;;) {
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w[0] || '')) { w = w.slice(1); continue; }
    if (w[0] === 'nice') { w = w.slice(1); if (w[0] === '-n') w = w.slice(2); else if (/^-n?-?\d+$/.test(w[0] || '')) w = w.slice(1); continue; }
    if (w[0] === 'timeout' && /^\d+[smh]?$/.test(w[1] || '')) { w = w.slice(2); continue; }
    if (w[0] === 'taskpolicy' && w[1] === '-b') { w = w.slice(2); continue; }
    if (w[0] === 'command' || w[0] === 'exec' || w[0] === 'time') { w = w.slice(1); continue; }
    break;
  }
  const sys = /^\/(usr\/)?(local\/)?s?bin\/([A-Za-z0-9_.+-]+)$/.exec(w[0] || '');
  if (sys) w[0] = sys[3];
  return w;
}

const SKRIPT_NACH_AUSSEN = /(deploy|release|publish|push|manage\.sh|install|einspielen|verteilen|zips_auf_sticks|auf_nas|hochladen|upload)/i;
const STUFE = { durch: 0, karte: 1, immer: 2 };
const hoeher = (a, b) => (STUFE[b.stufe] > STUFE[a.stufe] ? b : a);

/** Ein Teilbefehl → Stufe. */
function teilStufe(woerter, orte, zustand) {
  const w = kern(woerter);
  const [b, ...a] = w;
  if (!b) return { stufe: 'durch' };
  const flag = re => a.some(x => re.test(x));
  if (b === 'cd') { if (a[0]) zustand.cwd = a[0].startsWith('~') ? echterPfad(a[0]) : path.resolve(zustand.cwd, a[0]); return { stufe: 'durch' }; }
  if (b === 'sudo' || b === 'doas') return { stufe: 'immer', grund: 'mit Administratorrechten (sudo)' };
  if (['shutdown', 'reboot', 'halt'].includes(b)) return { stufe: 'immer', grund: 'startet den Mac neu oder fährt ihn herunter' };
  if (b === 'git') {
    let r = a.slice(); while (r[0] === '-C' || r[0] === '-c') r = r.slice(2);
    while (r[0] && r[0].startsWith('-')) r = r.slice(1);
    if (r[0] === 'push') {
      return r.some(x => /^(-f|--force|--force-with-lease|--mirror|--delete|-d)$/.test(x) || /^\+/.test(x))
        ? { stufe: 'immer', grund: 'überschreibt oder löscht auf dem Server (Force-Push)' } : { stufe: 'karte', grund: 'schickt Commits auf den Server (push)' };
    }
    return { stufe: 'durch' };
  }
  if (['ssh', 'scp', 'sftp', 'mosh', 'telnet', 'nc', 'ncat', 'socat', 'ftp'].includes(b)) return { stufe: 'karte', grund: 'Verbindung zu einem anderen Gerät' };
  if (b === 'rsync') return a.some(x => /^[^/~.-][^/]*:/.test(x) || /^[a-z]+:\/\//.test(x)) ? { stufe: 'karte', grund: 'kopiert zu einem anderen Gerät' } : { stufe: 'durch' };
  if (b === 'curl' || b === 'wget' || b === 'http' || b === 'https') {
    const hoch = flag(/^(-d|--data.*|-F|--form.*|-T|--upload-file|--json|--post-data|--post-file|--method=.*|--body-.*)$/) ||
      a.some((x, i) => (x === '-X' || x === '--request') && /^(POST|PUT|PATCH|DELETE)$/i.test(a[i + 1] || '')) || flag(/^-X(POST|PUT|PATCH|DELETE)$/i);
    return hoch ? { stufe: 'karte', grund: 'schickt Daten an einen Server' } : { stufe: 'durch' };
  }
  if (b === 'rm' || b === 'rmdir' || b === 'unlink' || b === 'trash') {
    const rekursiv = flag(/^-[a-zA-Z]*[rR]/) || flag(/^--recursive$/);
    const ziele = a.filter(x => !x.startsWith('-')).map(x => x.startsWith('~') ? echterPfad(x) : path.resolve(zustand.cwd, x));
    const aussen = ziele.some(z => !orte.projekt || !(gleicherPfad(z, orte.projekt) || innerhalb(z, orte.projekt)) || gleicherPfad(z, orte.projekt));
    if (rekursiv && aussen) return { stufe: 'immer', grund: 'löscht rekursiv außerhalb des Projekts' };
    if (rekursiv || aussen) return { stufe: 'karte', grund: rekursiv ? 'löscht einen ganzen Ordner' : 'löscht außerhalb des Projekts' };
    return { stufe: 'durch' };
  }
  if (b === 'launchctl' && /^(bootstrap|bootout|load|unload|kickstart|enable|disable|remove|submit|kill)$/.test(a[0] || '')) return { stufe: 'karte', grund: 'startet oder stoppt einen Dienst' };
  if (b === 'brew' && /^(install|uninstall|remove|rm|upgrade|reinstall|tap|untap|services|link|unlink|cleanup|autoremove)$/.test(a[0] || '')) return { stufe: 'karte', grund: 'installiert oder entfernt Software' };
  if (['pip', 'pip3', 'gem', 'cargo'].includes(b) && /^(install|uninstall)$/.test(a[0] || '')) return { stufe: 'karte', grund: 'installiert Software' };
  if ((b === 'npm' || b === 'pnpm' || b === 'yarn') && /^(publish|unpublish|install|i|add|uninstall|remove|link)$/.test(a[0] || '') && !(a[0] === 'install' && a.length === 1) && !(a[0] === 'i' && a.length === 1)) return { stufe: 'karte', grund: 'installiert oder veröffentlicht Pakete' };
  if (b === 'docker' && /^(push|login|rm|rmi|stop|kill|system|volume|network|compose|run|exec)$/.test(a[0] || '')) return { stufe: 'karte', grund: 'Docker ändern' };
  if (b === 'gh' || b === 'glab') return { stufe: 'karte', grund: 'GitHub/GitLab' };
  if (b === 'osascript' || b === 'open' || b === 'shortcuts' || b === 'automator') return { stufe: 'karte', grund: 'steuert Apps oder öffnet Fenster auf dem Mac' };
  if (['kill', 'killall', 'pkill'].includes(b)) return { stufe: 'karte', grund: 'beendet Programme' };
  if (b === 'defaults' && /^(write|delete|import|rename)$/.test(a[0] || '')) return { stufe: 'karte', grund: 'ändert Mac-Einstellungen' };
  if (['security', 'networksetup', 'scutil', 'pmset', 'systemsetup', 'diskutil', 'tmutil', 'csrutil', 'spctl', 'dscl', 'mount', 'umount'].includes(b)) {
    const lesend = { security: /^(find-|dump-|list-|show-)/, networksetup: /^-(list|get|show)/, scutil: /^--(dns|nwi|proxy|get)$|^-r$/,
      pmset: /^-g/, systemsetup: /^-get/, diskutil: /^(list|info|apfs)$/, tmutil: /^(isexcluded|listbackups|latestbackup|destinationinfo|status|machinedirectory|listlocalsnapshots|version)$/,
      csrutil: /^status$/, spctl: /^(--status|-a|--assess)$/, dscl: /^\.$|^-read|^-list/, mount: /^$/, umount: /^$/ }[b];
    return lesend.test(a[0] || '') ? { stufe: 'durch' } : { stufe: 'karte', grund: 'ändert Systemeinstellungen' };
  }
  // Skripte, die nach Deploy, Release, Upload … klingen
  const skript = ['bash', 'sh', 'zsh', 'node', 'python3', 'python'].includes(b) ? a.find(x => !x.startsWith('-')) : b;
  if (skript && /[/.]/.test(skript) && SKRIPT_NACH_AUSSEN.test(path.basename(skript))) return { stufe: 'karte', grund: 'Skript für Deploy, Release oder Upload' };
  return { stufe: 'durch' };
}

/** Grobe Suche, wenn sich die Zeile nicht zerlegen lässt ($(…), Schleifen …): dann lieber eine Karte zu viel. */
const GROB = [
  [/\bsudo\b/, 'immer', 'mit Administratorrechten (sudo)'],
  [/\bgit\b[^;&|]*\bpush\b[^;&|]*(--force|\s-f\b)/, 'immer', 'Force-Push'],
  [/\bgit\b[^;&|]*\bpush\b/, 'karte', 'schickt Commits auf den Server (push)'],
  [/\b(ssh|scp|sftp|rsync|mosh|telnet)\b/, 'karte', 'Verbindung zu einem anderen Gerät'],
  [/\bcurl\b[^;&|]*(\s-d\b|--data|\s-F\b|--form|\s-T\b|--upload|-X\s*(POST|PUT|PATCH|DELETE))/i, 'karte', 'schickt Daten an einen Server'],
  [/\brm\s+-[a-zA-Z]*[rR]/, 'karte', 'löscht einen ganzen Ordner'],
  [/\b(launchctl|osascript|open|brew\s+(install|uninstall|upgrade)|killall|pkill|gh|shutdown|reboot)\b/, 'karte', 'Dienste, Apps oder Software'],
  [/(deploy|release|publish|push|manage|install|einspielen|verteilen|upload|hochladen)[\w-]*\.(sh|js|mjs|py)\b/i, 'karte', 'Skript für Deploy, Release oder Upload'],
];

/**
 * Entscheidet über einen Werkzeugaufruf.
 * @param {{projekt: string, gesperrt?: string[], cwd?: string}} orte
 * @returns {{stufe: 'durch'|'karte'|'immer', grund: string}}
 *   durch = Claude Codes eigenes Rechtesystem entscheidet (wie im Terminal), karte = wartet auf dein Ja,
 *   immer = wartet auch dann auf dein Ja, wenn für den Auftrag alles erlaubt ist
 */
export function pruefen(werkzeug, eingabe = {}, orte = {}) {
  const DURCH = { stufe: 'durch', grund: 'Claude Code entscheidet wie im Terminal' };
  if (['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(werkzeug)) {
    const datei = eingabe.file_path || eingabe.notebook_path || '';
    if (datei && [EIGENER_CODE, ...(orte.gesperrt || [])].some(g => gleicherPfad(datei, g) || innerhalb(datei, g))) {
      return { stufe: 'immer', grund: 'Programm oder Ablage des Cockpits' };
    }
    return DURCH;
  }
  if (werkzeug === 'Bash') {
    const befehl = String(eingabe.command || '');
    const teile = zerlegen(befehl);
    if (!teile) {
      let r = DURCH;
      for (const [re, stufe, grund] of GROB) if (re.test(befehl)) r = hoeher(r, { stufe, grund });
      return r;
    }
    const zustand = { cwd: orte.cwd ? echterPfad(orte.cwd) : heim() };
    return teile.reduce((r, t) => hoeher(r, teilStufe(t, orte, zustand)), DURCH);
  }
  if (werkzeug.startsWith('mcp__')) {
    return /(send|create|post|delete|remove|update|write|publish|reply|forward|draft|upload|move|archive|label|invite|share)/i.test(werkzeug)
      ? { stufe: 'karte', grund: 'Anbindung, die etwas sendet oder ändert' } : DURCH;
  }
  return DURCH;
}

// ---------------------------------------------------------------------------------------------------------------

const KURZ = 400, VOLL = 8000;

/** Unsichtbare und Richtungs-Steuerzeichen sichtbar machen (gegen Täuschung auf der Karte). */
export function sichtbar(s) {
  return String(s ?? '').replace(/[\u0000-\u0008\u000B-\u001F\u007F­​-‏‪-‮⁠-⁩﻿]/g,
    c => `⟦U+${c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}⟧`);
}

function abschneiden(s, n) {
  s = sichtbar(s);
  return s.length > n ? s.slice(0, n) + `\n… (gekürzt, insgesamt ${s.length} Zeichen)` : s;
}

/** Kurze Beschreibung eines Werkzeugaufrufs für den Verlauf. */
export function kurzfassung(werkzeug, e = {}) {
  const k = s => abschneiden(s, KURZ);
  if (werkzeug === 'Bash') return k(e.command);
  if (e.file_path) return k(e.file_path);
  if (e.notebook_path) return k(e.notebook_path);
  if (e.pattern) return k(e.pattern + (e.path ? '  in ' + e.path : ''));
  if (e.url) return k(e.url);
  if (e.query) return k(e.query);
  if (e.description) return k(e.description);
  if (e.prompt) return k(e.prompt);
  try { return k(JSON.stringify(e)); } catch { return ''; }
}

/** Vollständige Eingabe für die Freigabe-Karte: was wirklich passiert. */
export function volltext(werkzeug, e = {}) {
  if (werkzeug === 'Bash') return abschneiden(e.command, VOLL);
  if (werkzeug === 'Write') return abschneiden(`Datei: ${e.file_path}\n\n${e.content ?? ''}`, VOLL);
  if (werkzeug === 'Edit') return abschneiden(`Datei: ${e.file_path}\n\n— alt —\n${e.old_string ?? ''}\n\n— neu —\n${e.new_string ?? ''}`, VOLL);
  if (werkzeug === 'MultiEdit') return abschneiden(`Datei: ${e.file_path}\n\n` + (e.edits || []).map((x, i) =>
    `— Änderung ${i + 1}: alt —\n${x.old_string ?? ''}\n— neu —\n${x.new_string ?? ''}`).join('\n\n'), VOLL);
  try { return abschneiden(JSON.stringify(e, null, 2), VOLL); } catch { return ''; }
}

/** Schlüssel für „gleichen Aufruf in diesem Auftrag immer erlauben“ – exakt dieselbe Eingabe. */
export function aufrufSchluessel(werkzeug, e = {}) {
  try { return werkzeug + '\u0000' + JSON.stringify(e); } catch { return werkzeug; }
}
