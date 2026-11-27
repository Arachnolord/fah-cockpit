// ============================================================================
// Erdacht und programmiert von Fabian Hammer, Deutschland.
// (c) 2026 Fabian Hammer - Alle Rechte vorbehalten. Geistiges Eigentum.
// ============================================================================
// Neues Projekt aus dem Cockpit: Ordner unter dem Projektordner, Git mit erstem Commit (README.md, CLAUDE.md),
// Stand-Datei im Vault und – wenn verbunden – gleich in FAH-Git anlegen, Remote fahgit setzen und pushen.

import { execFile } from 'node:child_process';
import { mkdir, stat, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';

export class NeuFehler extends Error { constructor(code, text) { super(text); this.code = code; } }

const ORDNERNAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

function git(ordner, args) {
  return new Promise(resolve => execFile('git', ['-C', ordner, ...args], { timeout: 30_000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
    (f, aus, err) => resolve({ ok: !f, aus: String(aus || '').trim(), err: String(err || '').trim() })));
}

const gibtEs = p => stat(p).then(() => true, () => false);
const zeile = t => String(t || '').replace(/[\r\n]+/g, ' ').trim();

/**
 * @param {{wurzel: string, vault: string, ausnahmen?: Set<string>, wissen?: object, einstellungen?: object, vaultDateien?: object}} umgebung
 * @param {{titel: string, ordner: string, beschreibung?: string, todos?: string|string[], inFahgit?: boolean, fahgitOrdner?: string}} b
 */
export async function projektAnlegen(umgebung, b) {
  const { wurzel, vault, ausnahmen = new Set(), wissen = null, einstellungen = null, vaultDateien = null } = umgebung;
  const titel = zeile(b.titel).slice(0, 120);
  const ordner = String(b.ordner || '').trim();
  const beschreibung = String(b.beschreibung || '').trim().slice(0, 4000);
  const todos = (Array.isArray(b.todos) ? b.todos : String(b.todos || '').split(/\r?\n/)).map(zeile).filter(Boolean).slice(0, 50);
  if (!titel) throw new NeuFehler(400, 'Bitte einen Namen für das Projekt angeben.');
  if (!ORDNERNAME.test(ordner) || ordner.includes('..')) throw new NeuFehler(400, 'Ordnername nur mit Buchstaben, Ziffern, „-“, „_“ und „.“ (ohne Leerzeichen).');
  if (ausnahmen.has(ordner)) throw new NeuFehler(400, 'Diesen Ordnernamen nutzt das Cockpit nicht als Projekt.');
  const dir = path.join(wurzel, ordner);
  if (await gibtEs(dir)) throw new NeuFehler(409, `Den Ordner ${ordner} gibt es schon.`);
  const standDatei = path.join(vault, 'maschine', 'projekte', ordner + '.md');
  if (await gibtEs(standDatei)) throw new NeuFehler(409, `Eine Stand-Datei ${ordner}.md gibt es schon im Vault.`);

  const fahgitDa = !!einstellungen?.aktuell().fahgitAdresse;
  const heute = new Date();
  const datum = heute.toISOString().slice(0, 10);
  const deutsch = heute.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });

  // 1) Ordner + Git mit erstem Commit
  await mkdir(dir, { recursive: true });
  try {
    await writeFile(path.join(dir, 'README.md'), `# ${titel}\n\n${beschreibung || 'Noch ohne Beschreibung.'}\n`);
    await writeFile(path.join(dir, 'CLAUDE.md'), `# ${titel}\n\n${beschreibung || 'Noch ohne Beschreibung.'}\n\n## Für Claude\n\n`
      + `- Stand und offene To-dos pflegt das FAH-Cockpit im Vault: \`maschine/projekte/${ordner}.md\`.\n`
      + (fahgitDa ? '- Alles Claude-Bezogene (CLAUDE.md, memory.md, Pläne) gehört in dieses Repo und nach FAH-Git – nie zu GitHub.\n' : ''));
    await writeFile(path.join(dir, '.gitignore'), '.DS_Store\nnode_modules/\n');
    const init = await git(dir, ['init', '-q', '-b', 'main']);
    if (!init.ok) throw new NeuFehler(500, 'git init: ' + init.err.slice(0, 160));
    const ohneName = !(await git(dir, ['config', 'user.email'])).aus;
    const wer = ohneName ? ['-c', 'user.name=FAH-Cockpit', '-c', 'user.email=cockpit@localhost'] : [];
    await git(dir, ['add', '-A']);
    const c = await git(dir, [...wer, 'commit', '-q', '--no-verify', '-m', `${titel}: Projekt angelegt (FAH-Cockpit)`]);
    if (!c.ok) throw new NeuFehler(500, 'git commit: ' + c.err.slice(0, 160));
  } catch (e) {
    await rm(dir, { recursive: true, force: true });       // halb Angelegtes wieder weg – der Ordner war neu
    throw e;
  }

  // 2) In FAH-Git anlegen (Remote fahgit, Push) – geht das nicht, bleibt das Projekt lokal und es gibt einen Hinweis
  const aus = { ordner, fahgit: null, warnung: null };
  if (b.inFahgit !== false && fahgitDa && wissen) {
    try { aus.fahgit = await wissen.anlegen(ordner, { fahgitOrdner: b.fahgitOrdner, beschreibung: beschreibung || titel }); }
    catch (e) { aus.warnung = 'Lokal angelegt, aber nicht in FAH-Git: ' + e.message + ' – später unter Einstellungen → Wissen „In FAH-Git anlegen“.'; }
  }

  // 3) Stand-Datei im Vault (nur wenn es den Vault mit maschine/projekte gibt)
  if (await gibtEs(path.dirname(standDatei))) {
    const erledigt = `- [x] ${datum} Projekt angelegt: Ordner \`~/${path.basename(wurzel)}/${ordner}\`, Git${aus.fahgit ? `, FAH-Git \`${aus.fahgit.pfad}\`` : ''}`;
    const text = `---\nordner: ${ordner}\nstatus: aktiv\naktualisiert: ${datum}\nquelle: Angelegt im FAH-Cockpit am ${deutsch}\n---\n# ${titel}\n\n## Stand\n\n`
      + `${beschreibung ? beschreibung.replace(/\s+/g, ' ') + ' ' : ''}Angelegt am ${deutsch} im FAH-Cockpit, noch ohne Version.\n\n## Offen\n\n`
      + (todos.length ? todos.map(t => `- [ ] ${t}`).join('\n') + '\n' : '') + `\n## Erledigt\n\n${erledigt}\n`;
    await writeFile(standDatei, text);
    vaultDateien?.vormerken(path.join('maschine', 'projekte', ordner + '.md'));
    aus.stand = true;
  }
  return aus;
}

/** Ordnerbaum von FAH-Git (nur Ordner, ohne FX-Git/frederix) für die Auswahl „In FAH-Git unter …“. */
export async function fahgitOrdner(einstellungen) {
  const w = einstellungen?.aktuell();
  if (!w?.fahgitAdresse) return { verbunden: false, ordner: [] };
  const { schluessel } = await einstellungen.fahgitSchluessel();
  if (!schluessel) return { verbunden: false, ordner: [] };
  try {
    const r = await fetch(w.fahgitAdresse + '/api/baum', { headers: { Authorization: 'Bearer ' + schluessel }, signal: AbortSignal.timeout(6000) });
    if (!r.ok) return { verbunden: false, ordner: [] };
    const liste = [];
    const gehe = k => { for (const o of k.ordner || []) { const p = o.pfad || o.name; if (p && !/fx-git|frederix/i.test(p)) { liste.push(p); gehe(o); } } };
    gehe(await r.json());
    return { verbunden: true, ordner: liste };
  } catch { return { verbunden: false, ordner: [] }; }
}
