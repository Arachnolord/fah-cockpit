// ============================================================================
// Erdacht und programmiert von Fabian Hammer, Deutschland.
// (c) 2026 Fabian Hammer - Alle Rechte vorbehalten. Geistiges Eigentum.
// ============================================================================
// Projekte unter ~/claude finden und messen: Git-Zustand (nur lokal, kein fetch), Version, Stand-Datei im Vault.

import { execFile } from 'node:child_process';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { lesen, offeneZahl, offeneArten } from './stand.js';

/** Unterordner, die keine Projekte sind. */
export const AUSNAHMEN = new Set(['NEUE ZIPs', 'Unifi-Controller-Backups']);

// GIT_OPTIONAL_LOCKS=0: „git status“ schreibt den Index nicht → keine index.lock neben laufenden Sitzungen.
// Kein Netz, keine Rückfragen: GIT_TERMINAL_PROMPT=0, credential.helper leer.
const GIT_UMGEBUNG = { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' };

function git(ordner, args, ms = 8000) {
  return new Promise(resolve => {
    execFile('git', ['-c', 'credential.helper=', '-C', ordner, ...args],
      { env: GIT_UMGEBUNG, timeout: ms, maxBuffer: 4 * 1024 * 1024 },
      (fehler, aus) => resolve(fehler ? null : String(aus)));
  });
}

/** Liest „git status --porcelain=v2 --branch“: Zweig, Upstream, voraus/zurück, geänderte Dateien. */
export function statusLesen(aus) {
  const s = { zweig: null, upstream: null, voraus: 0, zurueck: 0, geaendert: 0 };
  for (const z of String(aus || '').split('\n')) {
    if (!z) continue;
    if (z.startsWith('# branch.head ')) s.zweig = z.slice(14);
    else if (z.startsWith('# branch.upstream ')) s.upstream = z.slice(18);
    else if (z.startsWith('# branch.ab ')) {
      const m = /\+(\d+) -(\d+)/.exec(z);
      if (m) { s.voraus = Number(m[1]); s.zurueck = Number(m[2]); }
    } else if (!z.startsWith('#')) s.geaendert++;
  }
  if (s.zweig === '(detached)') s.zweig = null;
  return s;
}

async function gitFakten(ordner) {
  try { await stat(path.join(ordner, '.git')); } catch { return null; }
  const [st, log, urls] = await Promise.all([
    git(ordner, ['status', '--porcelain=v2', '--branch', '--untracked-files=normal']),
    git(ordner, ['log', '-1', '--format=%cI%x1f%s']),
    git(ordner, ['config', '--get-regexp', '^remote\\..*\\.url$']),
  ]);
  if (st === null) return { fehler: true };
  const s = statusLesen(st);
  const [datum, betreff] = (log || '').trim().split('\x1f');
  const remotes = (urls || '').trim().split('\n').filter(Boolean).map(z => {
    const [schluessel, url] = z.split(/\s+/, 2);
    return { name: schluessel.replace(/^remote\.|\.url$/g, ''), url: url || '' };
  });
  return {
    ...s,
    letzterCommit: datum ? { datum, betreff: betreff || '' } : null,
    remotes: remotes.map(r => r.name),
    fahGit: remotes.some(r => /:3300\/|fah-git\./.test(r.url)),
  };
}

/** Version aus package.json, VERSION oder version.txt – sonst null. */
async function version(ordner) {
  try {
    const p = JSON.parse(await readFile(path.join(ordner, 'package.json'), 'utf8'));
    if (p && typeof p.version === 'string' && p.version) return p.version;
  } catch { /* weiter */ }
  for (const name of ['VERSION', 'version.txt']) {
    try {
      const t = (await readFile(path.join(ordner, name), 'utf8')).split('\n')[0].trim();
      if (t && t.length <= 40) return t;
    } catch { /* weiter */ }
  }
  return null;
}

/** Stand-Datei des Projekts im Vault lesen – null, wenn es keine gibt. */
export async function standLesen(vault, ordnerName) {
  const datei = path.join(vault, 'maschine', 'projekte', ordnerName + '.md');
  try { return { datei, ...lesen(await readFile(datei, 'utf8')) }; } catch { return null; }
}

/** Alle Projektordner (sortiert, ohne Ausnahmen, ohne versteckte). */
export async function ordnerListe(wurzel, ausnahmen = AUSNAHMEN) {
  const eintraege = await readdir(wurzel, { withFileTypes: true });
  return eintraege
    .filter(e => e.isDirectory() && !e.name.startsWith('.') && !ausnahmen.has(e.name))
    .map(e => e.name)
    .sort((a, b) => a.localeCompare(b, 'de', { sensitivity: 'base' }));
}

/** Hilfsfunktion: höchstens n Aufgaben gleichzeitig. */
async function begrenzt(liste, n, fn) {
  const ergebnis = new Array(liste.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, liste.length) }, async () => {
    while (i < liste.length) { const k = i++; ergebnis[k] = await fn(liste[k]); }
  }));
  return ergebnis;
}

const kuerzen = (t, n) => t.length > n ? t.slice(0, n).trimEnd() + ' …' : t;

/** Zusammenfassung eines Projekts für die Übersicht. */
export async function projektMessen(wurzel, vault, name) {
  const ordner = path.join(wurzel, name);
  const [g, v, s] = await Promise.all([gitFakten(ordner), version(ordner), standLesen(vault, name)]);
  return {
    ordner: name,
    titel: s?.titel || name,
    status: (s?.kopf.status || 'aktiv').toLowerCase() === 'ruht' ? 'ruht' : 'aktiv',
    aktualisiert: s?.kopf.aktualisiert || null,
    hatStand: !!s,
    standKurz: s ? kuerzen(s.stand.split('\n')[0], 600) : '',   // lang genug fürs breite Fenster; sichtbar kürzt das CSS (…)
    offen: offeneZahl(s),
    arten: offeneArten(s),
    version: v,
    git: g,
  };
}

export async function alleMessen(wurzel, vault, ausnahmen = AUSNAHMEN) {
  const namen = await ordnerListe(wurzel, ausnahmen);
  return begrenzt(namen, 8, n => projektMessen(wurzel, vault, n));
}

/** Volle Ansicht eines Projekts: Stand, To-dos, Git, letzte Commits. */
export async function projektDetail(wurzel, vault, name) {
  const kurz = await projektMessen(wurzel, vault, name);
  const s = await standLesen(vault, name);
  let commits = [];
  if (kurz.git && !kurz.git.fehler) {
    const log = await git(path.join(wurzel, name), ['log', '-8', '--format=%cI%x1f%s']);
    commits = (log || '').trim().split('\n').filter(Boolean).map(z => {
      const [datum, betreff] = z.split('\x1f');
      return { datum, betreff: betreff || '' };
    });
  }
  return {
    ...kurz,
    stand: s?.stand || '',
    todos: s?.offen || [],
    erledigt: s?.erledigt || [],
    quelle: s?.kopf.quelle || null,
    standDatei: s ? path.relative(vault, s.datei) : path.join('maschine', 'projekte', name + '.md'),
    commits,
  };
}
