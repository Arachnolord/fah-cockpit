// ============================================================================
// Erdacht und programmiert von Fabian Hammer, Deutschland.
// (c) 2026 Fabian Hammer - Alle Rechte vorbehalten. Geistiges Eigentum.
// ============================================================================
// Wissensnetz (wie die Graph-Ansicht in Obsidian): Projekte als Knotenpunkte, daran ihre Stand-Datei, Claudes
// Gedächtnis-Notizen und die Doku-Dateien im Projekt. [[Verweise]] zwischen Notizen werden zu Kanten.
// Gelesen werden nur Dateien, die im Netz vorkommen (Zuordnung id → Pfad bleibt auf dem Server).

import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { zuordnen } from './wissen.js';
import { lesen, offeneZahl } from './stand.js';

const DOKU_WURZEL = ['README.md', 'memory.md', 'CLAUDE.md', 'AGENTS.md', 'LIESMICH.md', 'CHANGELOG.md'];
const MAX_DOKU = 20;
const MAX_LESEN = 400 * 1024;

const titelAus = (text, ersatz) => {
  const kopfName = /^---\n[\s\S]*?\nname:\s*(.+)\n[\s\S]*?\n---/.exec(text)?.[1];
  const h1 = /^#\s+(.+)$/m.exec(text)?.[1];
  return (h1 || kopfName || ersatz).trim().slice(0, 120);
};

/**
 * @returns {Promise<{knoten: object[], kanten: [string, string][], pfade: Map<string, string>}>}
 */
export async function netzBauen({ wurzel, vault, gedaechtnis, ausnahmen = new Set() }) {
  const knoten = [], kanten = [], pfade = new Map();
  const dazu = (k, pfad) => { knoten.push(k); if (pfad) pfade.set(k.id, pfad); };

  const projekte = (await readdir(wurzel, { withFileTypes: true }))
    .filter(e => e.isDirectory() && !e.name.startsWith('.') && !ausnahmen.has(e.name)).map(e => e.name).sort();

  dazu({ id: 'h:allgemein', art: 'hub', titel: 'Allgemeines Wissen' });
  dazu({ id: 'h:mensch', art: 'hub', titel: 'Meine Notizen' });

  for (const p of projekte) {
    const standPfad = path.join(vault, 'maschine', 'projekte', p + '.md');
    let status = 'aktiv', titel = p, offen = 0;
    const stand = await readFile(standPfad, 'utf8').catch(() => null);
    if (stand !== null) {
      status = /\nstatus:\s*ruht/i.test(stand) ? 'ruht' : 'aktiv';
      titel = titelAus(stand, p);
      offen = offeneZahl(lesen(stand));
    }
    dazu({ id: 'p:' + p, art: 'projekt', titel, ordner: p, status, offen });
    if (stand !== null) { dazu({ id: 's:' + p, art: 'stand', titel: 'Stand – ' + titel, ordner: p, vault: 'maschine/projekte/' + p + '.md' }, standPfad); kanten.push(['p:' + p, 's:' + p]); }

    // Doku im Projekt: bekannte Dateien im Hauptordner und docs/*.md (ohne Unterordner von docs, ohne Spiegel)
    const ordner = path.join(wurzel, p);
    const doku = [];
    for (const f of DOKU_WURZEL) if (await stat(path.join(ordner, f)).then(s => s.isFile(), () => false)) doku.push(f);
    for (const e of await readdir(path.join(ordner, 'docs'), { withFileTypes: true }).catch(() => [])) {
      if (e.isFile() && e.name.endsWith('.md')) doku.push('docs/' + e.name);
    }
    for (const rel of doku.slice(0, MAX_DOKU)) {
      const id = 'd:' + p + '/' + rel;
      dazu({ id, art: 'doku', titel: rel, ordner: p }, path.join(ordner, rel));
      kanten.push(['p:' + p, id]);
    }
  }

  // Gedächtnis-Notizen
  const notizNamen = new Map();          // name (aus dem Kopf) und Dateiname ohne .md → id
  const notizen = [];
  for (const f of (await readdir(gedaechtnis).catch(() => [])).sort()) {
    if (!f.endsWith('.md')) continue;
    const pfad = path.join(gedaechtnis, f);
    const text = await readFile(pfad, 'utf8').catch(() => null);
    if (text === null) continue;
    const id = 'n:' + f;
    const name = /^---\n[\s\S]*?\nname:\s*(.+)\n/.exec(text)?.[1]?.trim();
    notizNamen.set(f.replace(/\.md$/, ''), id);
    if (name) notizNamen.set(name, id);
    notizen.push({ f, id, text, pfad });
  }
  for (const n of notizen) {
    const istIndex = n.f === 'MEMORY.md';
    dazu({ id: n.id, art: istIndex ? 'index' : 'notiz', titel: istIndex ? 'Gedächtnis-Index' : n.f.replace(/\.md$/, '') }, n.pfad);
    const zu = istIndex ? [] : zuordnen(n.f, n.text, projekte);
    if (zu.length) for (const p of zu) kanten.push(['p:' + p, n.id]);
    else kanten.push(['h:allgemein', n.id]);
    // [[Verweise]] und Markdown-Links auf andere Notizen
    const ziele = new Set();
    for (const m of n.text.matchAll(/\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g)) ziele.add(m[1].trim());
    for (const m of n.text.matchAll(/\]\(([\w.-]+)\.md\)/g)) ziele.add(m[1]);
    for (const z of ziele) {
      const ziel = notizNamen.get(z);
      if (ziel && ziel !== n.id) kanten.push([n.id, ziel]);
    }
  }
  // Eigene Notizen aus mensch/ (Ideen, Notizen, Aufnahmen) – mit [[Verweisen]] auf Notizen, Projekte und einander
  const eigene = [];
  const gehe = async (ordner, rel) => {
    for (const e of await readdir(ordner, { withFileTypes: true }).catch(() => [])) {
      if (e.name.startsWith('.')) continue;
      const r = rel + '/' + e.name;
      if (e.isDirectory()) await gehe(path.join(ordner, e.name), r);
      else if (e.name.endsWith('.md') && !/^LIESMICH\.md$/i.test(e.name)) eigene.push(r.replace(/^\//, ''));
    }
  };
  await gehe(path.join(vault, 'mensch'), '/mensch');
  const eigenNamen = new Map(eigene.map(r => [path.basename(r, '.md').toLowerCase(), 'v:' + r]));
  for (const r of eigene) {
    const abs = path.join(vault, r);
    const text = await readFile(abs, 'utf8').catch(() => '');
    const id = 'v:' + r;
    dazu({ id, art: 'eigen', titel: titelAus(text, path.basename(r, '.md')), vault: r, bereich: r.split('/')[1] || '' }, abs);
    kanten.push(['h:mensch', id]);
    for (const m of text.matchAll(/\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g)) {
      const z = m[1].trim();
      const ziel = eigenNamen.get(z.toLowerCase()) || notizNamen.get(z) || (projekte.includes(z) ? 'p:' + z : null);
      if (ziel && ziel !== id) kanten.push([id, ziel]);
    }
  }

  // doppelte Kanten weg
  const gesehen = new Set();
  const eindeutig = kanten.filter(([a, b]) => { const k = a < b ? a + '|' + b : b + '|' + a; if (gesehen.has(k)) return false; gesehen.add(k); return true; });
  return { knoten, kanten: eindeutig, pfade };
}

/** Eine Datei des Netzes lesen (nur über ihre id). */
export async function netzDatei(pfade, id) {
  const pfad = pfade.get(id);
  if (!pfad) return null;
  const s = await stat(pfad).catch(() => null);
  if (!s || !s.isFile()) return null;
  let text = await readFile(pfad, 'utf8');
  const gekuerzt = text.length > MAX_LESEN;
  if (gekuerzt) text = text.slice(0, MAX_LESEN);
  return { id, text, gekuerzt, geaendert: s.mtime.toISOString(), groesse: s.size, pfad: pfad.replace(/^\/Users\/[^/]+/, '~') };
}
