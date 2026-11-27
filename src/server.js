// ============================================================================
// Erdacht und programmiert von Fabian Hammer, Deutschland.
// (c) 2026 Fabian Hammer - Alle Rechte vorbehalten. Geistiges Eigentum.
// ============================================================================
// FAH-Cockpit: zeigt Stand und offene To-dos aller Projekte unter ~/claude und lässt Claude Aufträge im Hintergrund
// erledigen (Freigabe riskanter Schritte per Karte). Ein Prozess, keine Datenbank, nur 127.0.0.1. Gemessenes (Git,
// Version) kommt frisch aus den Projektordnern, Geschriebenes aus den Stand-Dateien im Vault.

import http from 'node:http';
import { execFile } from 'node:child_process';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { alleMessen, projektDetail, ordnerListe, standLesen, AUSNAHMEN } from './projekte.js';
import { umschalten, todoHinzufuegen, StandFehler } from './stand.js';
import { Vault, VaultFehler } from './vault.js';
import { projektAnlegen, fahgitOrdner, NeuFehler } from './neu.js';
import { Auftraege } from './auftraege.js';
import { Einstellungen, MODELLE, AUFWAENDE } from './einstellungen.js';
import { WissenSpiegel, gedaechtnisPfad } from './wissen.js';
import { netzBauen, netzDatei } from './netz.js';
import { Limit } from './limit.js';
import { bilderPruefen, BildFehler, KOERPER_GRENZE } from './bilder.js';

const VERSION = (() => { try { return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version; } catch { return ''; } })();

const HIER = path.dirname(fileURLToPath(import.meta.url));
const OEFFENTLICH = path.join(HIER, '..', 'public');
const DATEIEN = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
  '/favicon.svg': ['favicon.svg', 'image/svg+xml'],
  '/netz.js': ['netz.js', 'text/javascript; charset=utf-8'],
};
const SICHER = {
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
};

class HttpFehler extends Error { constructor(code, text) { super(text); this.code = code; } }

function json(res, code, daten) {
  res.writeHead(code, { ...SICHER, 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(daten));
}

async function koerper(req, grenze = 64 * 1024) {
  let n = 0; const teile = [];
  for await (const t of req) { n += t.length; if (n > grenze) throw new HttpFehler(413, 'Anfrage zu groß'); teile.push(t); }
  try { return JSON.parse(Buffer.concat(teile).toString('utf8') || '{}'); } catch { throw new HttpFehler(400, 'Kein gültiges JSON'); }
}

/** macOS-Mitteilung (ohne Fenster, ohne Fokus). */
function mitteilung(titel, text) {
  if (process.env.COCKPIT_MITTEILUNGEN === 'app') return;       // in der Mac-App meldet die App selbst (anklickbar)
  const q = s => String(s).replace(/[\\"]/g, '\\$&').slice(0, 200);
  execFile('osascript', ['-e', `display notification "${q(text)}" with title "FAH-Cockpit" subtitle "${q(titel)}"`], () => {});
}

/**
 * @param {object} o
 * @param {string} o.wurzel  ~/claude
 * @param {string} o.vault   ~/claude/Arbeit
 * @param {number} o.port
 * @param {Auftraege} [o.auftraege]  fertige Auftragsverwaltung (sonst ohne Aufträge)
 */
export function cockpit({ wurzel, vault, port, ausnahmen = AUSNAHMEN, zwischenspeicherMs = 20_000, auftraege = null, einstellungen = null, wissen = null, gedaechtnis = null, limit = null }) {
  const erlaubteHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  const vaultDateien = new Vault({ vault, einstellungen });
  let speicher = null;   // { zeit, daten }
  let netz = null;       // { zeit, daten: {knoten, kanten, pfade} }
  async function netzHolen(frisch) {
    if (frisch || !netz || Date.now() - netz.zeit > 60_000) {
      netz = { zeit: Date.now(), daten: await netzBauen({ wurzel, vault, gedaechtnis: gedaechtnis || gedaechtnisPfad(), ausnahmen }) };
    }
    return netz.daten;
  }

  async function uebersicht(frisch) {
    if (frisch || !speicher || Date.now() - speicher.zeit >= zwischenspeicherMs) {
      const projekte = await alleMessen(wurzel, vault, ausnahmen);
      const aktiv = projekte.filter(p => p.status === 'aktiv');
      speicher = { zeit: Date.now(), daten: {
        erzeugt: new Date().toISOString(),
        vaultName: path.basename(vault),
        summen: {
          projekte: aktiv.length,
          ruhend: projekte.length - aktiv.length,
          offen: aktiv.reduce((s, p) => s + p.offen, 0),
          betreiber: aktiv.reduce((s, p) => s + (p.arten?.betreiber || 0), 0),
          praxistest: aktiv.reduce((s, p) => s + (p.arten?.praxistest || 0), 0),
          optional: aktiv.reduce((s, p) => s + (p.arten?.optional || 0), 0),
          geaendert: aktiv.filter(p => p.git && p.git.geaendert > 0).length,
          ungepusht: aktiv.filter(p => p.git && p.git.voraus > 0).length,
          ohneStand: aktiv.filter(p => !p.hatStand).length,
        },
        projekte,
      } };
    }
    const z = auftraege ? auftraege.zahlen() : { wartet: 0, laeuft: 0, schlange: 0 };
    return { ...speicher.daten, summen: { ...speicher.daten.summen, ...z }, auftraegeAn: !!auftraege };
  }

  async function bekannt(name) {
    const namen = await ordnerListe(wurzel, ausnahmen);
    if (typeof name !== 'string' || !namen.includes(name)) throw new HttpFehler(404, 'Projekt nicht gefunden');
    return name;
  }

  async function abhaken(b) {
    const name = await bekannt(b.ordner);
    const datei = path.join(vault, 'maschine', 'projekte', name + '.md');
    let alt;
    try { alt = await readFile(datei, 'utf8'); } catch { throw new HttpFehler(404, 'Keine Stand-Datei für dieses Projekt'); }
    let neu;
    try { neu = umschalten(alt, b.zeile, b.text, !!b.erledigt); } catch (e) {
      if (e instanceof StandFehler) throw new HttpFehler(409, e.message);
      throw e;
    }
    const zwischen = datei + '.cockpit-' + process.pid + '.tmp';
    await writeFile(zwischen, neu, 'utf8');
    await rename(zwischen, datei);
    vaultDateien.vormerken(path.join('maschine', 'projekte', name + '.md'));   // Haken gebündelt committen und pushen
    speicher = null;
    return projektDetail(wurzel, vault, name);
  }

  async function todoNeu(b) {
    const name = await bekannt(b.ordner);
    const datei = path.join(vault, 'maschine', 'projekte', name + '.md');
    let alt;
    try { alt = await readFile(datei, 'utf8'); } catch { throw new HttpFehler(404, 'Keine Stand-Datei für dieses Projekt'); }
    let neu;
    try { neu = todoHinzufuegen(alt, b.text, ['arbeit', 'betreiber', 'praxistest', 'optional'].includes(b.art) ? b.art : 'arbeit'); } catch (e) { throw new HttpFehler(400, e.message); }
    const zwischen = datei + '.cockpit-' + process.pid + '.tmp';
    await writeFile(zwischen, neu, 'utf8');
    await rename(zwischen, datei);
    vaultDateien.vormerken(path.join('maschine', 'projekte', name + '.md'));
    speicher = null; netz = null;
    return projektDetail(wurzel, vault, name);
  }

  /** Vault-Aufrufe: Fehler der Vault-Schicht in HTTP-Fehler übersetzen. */
  async function imVault(fn) {
    try { const r = await fn(); speicher = null; netz = null; return r; }
    catch (e) { if (e instanceof VaultFehler) throw new HttpFehler(e.code, e.message); throw e; }
  }

  async function auftragStarten(b) {
    const ordner = await bekannt(b.ordner);
    const text = String(b.text || '').trim().slice(0, 8000);
    const bilder = bilderLesen(b.bilder);
    let todo = null;
    if (b.todo) {
      // Nur To-dos, die wirklich so in der Stand-Datei stehen.
      const s = await standLesen(vault, ordner);
      const t = s?.offen.find(x => x.zeile === b.todo.zeile && x.text === b.todo.text);
      if (!t) throw new HttpFehler(409, 'Das To-do steht so nicht mehr in der Stand-Datei – Seite neu laden.');
      todo = { zeile: t.zeile, text: t.text };
    } else if (!text && !bilder.length) throw new HttpFehler(400, 'Bitte schreib, was Claude tun soll.');
    try { return await auftraege.starten({ ordner, text, todo, modell: String(b.modell || ''), aufwand: String(b.aufwand || ''), allesErlaubt: b.allesErlaubt === true, bilder }); }
    catch (e) { throw new HttpFehler(400, e.message); }
  }

  function bilderLesen(liste) {
    try { return bilderPruefen(liste); } catch (e) { if (e instanceof BildFehler) throw new HttpFehler(400, e.message); throw e; }
  }

  function nurMitKopf(req) {
    // Eigener Kopf + JSON: Fremde Seiten können das nicht ohne Vorabanfrage schicken, und die beantworten wir nicht.
    if (req.headers['x-cockpit'] !== '1' || !/^application\/json/.test(String(req.headers['content-type'] || ''))) {
      throw new HttpFehler(403, 'Nicht erlaubt');
    }
  }

  async function bearbeiten(req, res) {
    if (!erlaubteHosts.has(String(req.headers.host || ''))) throw new HttpFehler(403, 'Nur lokal erreichbar');
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    const weg = url.pathname, m = req.method, q = url.searchParams;

    if (m === 'GET' && DATEIEN[weg]) {
      const [datei, typ] = DATEIEN[weg];
      const inhalt = await readFile(path.join(OEFFENTLICH, datei));
      res.writeHead(200, { ...SICHER, 'Content-Type': typ });
      return res.end(inhalt);
    }
    if (m === 'GET' && weg === '/api/uebersicht') return json(res, 200, await uebersicht(q.get('frisch') === '1'));
    if (m === 'GET' && weg === '/api/projekt') {
      const name = await bekannt(q.get('ordner'));
      const d = await projektDetail(wurzel, vault, name);
      d.auftraege = auftraege ? auftraege.liste().filter(a => a.ordner === name).slice(0, 10) : [];
      return json(res, 200, d);
    }
    if (m === 'POST' && weg === '/api/todo') { nurMitKopf(req); return json(res, 200, await abhaken(await koerper(req))); }
    if (m === 'GET' && weg === '/api/version') return json(res, 200, { version: VERSION, pid: process.pid });
    if (m === 'GET' && weg === '/api/projekt/neu') {
      const e = einstellungen?.aktuell() || {};
      return json(res, 200, { vorsilbe: e.projektVorsilbe || '', standardOrdner: e.fahgitProjektOrdner || 'eigene-projekte',
        wurzel: wurzel.replace(os.homedir(), '~'), fahgit: await fahgitOrdner(einstellungen) });
    }
    if (m === 'POST' && weg === '/api/projekt/neu') {
      nurMitKopf(req);
      try {
        const r = await projektAnlegen({ wurzel, vault, ausnahmen, wissen, einstellungen, vaultDateien }, await koerper(req));
        speicher = null; netz = null;
        return json(res, 200, r);
      } catch (e) { if (e instanceof NeuFehler) throw new HttpFehler(e.code, e.message); throw e; }
    }
    if (m === 'POST' && weg === '/api/todo/neu') { nurMitKopf(req); return json(res, 200, await todoNeu(await koerper(req))); }

    // ---------- Vault: Notizen und Bearbeiten ----------
    if (m === 'GET' && weg === '/api/vault') return json(res, 200, { dateien: await vaultDateien.liste(), ordner: await vaultDateien.ordner(), vaultName: path.basename(vault) });
    if (m === 'GET' && weg === '/api/vault/datei') return json(res, 200, await imVault(() => vaultDateien.lesen(q.get('pfad'))));
    if (m === 'PUT' && weg === '/api/vault/datei') {
      nurMitKopf(req);
      const b = await koerper(req, 2_500_000);
      return json(res, 200, await imVault(() => vaultDateien.schreiben(b.pfad, b.text, b.version)));
    }
    if (m === 'POST' && weg === '/api/vault/neu') { nurMitKopf(req); const b = await koerper(req); return json(res, 200, await imVault(() => vaultDateien.neu(b.ordner, b.titel))); }
    if (m === 'POST' && weg === '/api/vault/papierkorb') { nurMitKopf(req); const b = await koerper(req); return json(res, 200, await imVault(() => vaultDateien.papierkorb(b.pfad))); }

    // ---------- Einstellungen ----------
    if (weg.startsWith('/api/einstellungen') && !einstellungen) throw new HttpFehler(404, 'Einstellungen sind nicht eingeschaltet');
    if (m === 'GET' && weg === '/api/einstellungen') {
      const [ki, fahgit] = await Promise.all([einstellungen.ki(q.get('frisch') === '1'), einstellungen.fahgitPruefen()]);
      return json(res, 200, { ...einstellungen.aktuell(), modelle: MODELLE, aufwaende: AUFWAENDE, ki, fahgit });
    }
    if (m === 'POST' && weg === '/api/einstellungen') {
      nurMitKopf(req);
      const vorher = JSON.stringify([einstellungen.aktuell().wissenZiel, einstellungen.aktuell().wissenOrdner]);
      try { await einstellungen.speichern(await koerper(req)); } catch (e) { throw new HttpFehler(400, e.message); }
      // Ziel oder Ordner des Wissens geändert → gleich abgleichen
      if (wissen && vorher !== JSON.stringify([einstellungen.aktuell().wissenZiel, einstellungen.aktuell().wissenOrdner])) wissen.lauf().catch(() => {});
      const [ki, fahgit] = await Promise.all([einstellungen.ki(true), einstellungen.fahgitPruefen()]);
      return json(res, 200, { ...einstellungen.aktuell(), modelle: MODELLE, aufwaende: AUFWAENDE, ki, fahgit });
    }

    // ---------- Nutzungslimit ----------
    if (m === 'GET' && weg === '/api/limit') return json(res, 200, limit ? limit.aktuell() : { fenster: {} });
    if (m === 'POST' && weg === '/api/limit/messen') {
      nurMitKopf(req);
      if (!limit) throw new HttpFehler(404, 'Nicht eingeschaltet');
      // Mit Live-Abfrage (Schlüsselbund) ohne Haiku-Anfrage, sonst die winzige Messung
      try { return json(res, 200, einstellungen?.aktuell().limitLive ? await limit.abfragen() : await limit.messen()); }
      catch (e) { throw new HttpFehler(502, e.message); }
    }

    // ---------- Wissensnetz ----------
    if (m === 'GET' && weg === '/api/netz') {
      const n = await netzHolen(q.get('frisch') === '1');
      return json(res, 200, { knoten: n.knoten, kanten: n.kanten, vaultName: path.basename(vault) });
    }
    if (m === 'GET' && weg === '/api/netz/datei') {
      const d = await netzDatei((await netzHolen(false)).pfade, String(q.get('id') || ''));
      if (!d) throw new HttpFehler(404, 'Datei nicht im Netz');
      return json(res, 200, d);
    }

    // ---------- Wissen in FAH-Git ----------
    if (weg.startsWith('/api/wissen') && !wissen) throw new HttpFehler(404, 'Wissens-Spiegel ist nicht eingeschaltet');
    if (m === 'GET' && weg === '/api/wissen') return json(res, 200, { laeuft: wissen.laeuft, letzter: wissen.letzter });
    if (m === 'POST' && weg === '/api/wissen/anlegen') {
      nurMitKopf(req);
      const name = await bekannt((await koerper(req)).ordner);
      try { return json(res, 200, await wissen.anlegen(name)); } catch (e) { throw new HttpFehler(400, e.message); }
    }
    if (m === 'POST' && weg === '/api/wissen/jetzt') {
      nurMitKopf(req);
      if (wissen.laeuft) throw new HttpFehler(409, 'Läuft gerade schon.');
      const bericht = await wissen.lauf();
      speicher = null;
      return json(res, 200, { laeuft: false, letzter: bericht });
    }

    // ---------- Aufträge ----------
    if (weg.startsWith('/api/auftr') || weg.startsWith('/api/freigabe') || weg.startsWith('/api/haken')) {
      if (!auftraege) throw new HttpFehler(404, 'Aufträge sind nicht eingeschaltet');
    }
    if (m === 'GET' && weg === '/api/auftraege') return json(res, 200, { auftraege: auftraege.liste(), ...auftraege.zahlen() });
    if (m === 'GET' && weg === '/api/auftrag') {
      const a = auftraege.holen(String(q.get('id') || ''));
      if (!a) throw new HttpFehler(404, 'Auftrag nicht gefunden');
      return json(res, 200, a);
    }
    if (m === 'GET' && weg === '/api/auftrag/bild') {
      const b = auftraege.bildDatei(q.get('id'), q.get('name'));
      const inhalt = b && await readFile(b.datei).catch(() => null);
      if (!inhalt) throw new HttpFehler(404, 'Bild nicht gefunden');
      // Name je Auftrag eindeutig und unveränderlich → darf im Speicher bleiben (der Verlauf wird oft neu gezeichnet)
      res.writeHead(200, { ...SICHER, 'Content-Type': b.typ, 'Cache-Control': 'private, max-age=86400, immutable',
        'Cross-Origin-Resource-Policy': 'same-origin', 'Content-Length': inhalt.length });
      return res.end(inhalt);
    }
    // Mit eingefügten Bildern (base64) darf die Anfrage größer sein.
    if (m === 'POST' && weg === '/api/auftrag') { nurMitKopf(req); return json(res, 200, await auftragStarten(await koerper(req, KOERPER_GRENZE))); }
    if (m === 'POST' && weg === '/api/auftrag/nachricht') {
      nurMitKopf(req);
      const b = await koerper(req, KOERPER_GRENZE);
      const text = String(b.text || '').trim().slice(0, 8000);
      const bilder = bilderLesen(b.bilder);
      if (!text && !bilder.length) throw new HttpFehler(400, 'Bitte schreib etwas.');
      try { return json(res, 200, await auftraege.nachschreiben(String(b.id), text, bilder)); } catch (e) { throw new HttpFehler(409, e.message); }
    }
    if (m === 'POST' && weg === '/api/auftrag/abbrechen') {
      nurMitKopf(req);
      try { return json(res, 200, await auftraege.abbrechen(String((await koerper(req)).id))); } catch (e) { throw new HttpFehler(404, e.message); }
    }
    if (m === 'POST' && weg === '/api/auftrag/alles') {
      nurMitKopf(req);
      const b = await koerper(req);
      try { return json(res, 200, await auftraege.allesErlauben(String(b.id), b.an === true)); } catch (e) { throw new HttpFehler(404, e.message); }
    }
    if (m === 'POST' && weg === '/api/freigabe') {
      nurMitKopf(req);
      const b = await koerper(req);
      try { return json(res, 200, await auftraege.entscheiden(String(b.auftrag), String(b.freigabe), b.erlauben === true, String(b.antwort || ''), b.immer === true)); }
      catch (e) { throw new HttpFehler(409, e.message); }
    }
    // Haken: weist sich mit dem Geheimnis des Auftrags aus (Umgebung von Claude), nicht mit dem Kopf der Oberfläche.
    if (m === 'POST' && weg === '/api/haken') {
      const r = auftraege.hakenAnfrage(await koerper(req));
      if (r.status === 403) throw new HttpFehler(403, 'Nicht erlaubt');
      return json(res, 200, r);
    }
    if (m === 'GET' && weg === '/api/haken') {
      const r = auftraege.hakenStand({ auftrag: q.get('auftrag'), token: q.get('token'), freigabe: q.get('freigabe') });
      if (r.status === 403) throw new HttpFehler(403, 'Nicht erlaubt');
      return json(res, 200, r);
    }
    throw new HttpFehler(404, 'Nicht gefunden');
  }

  const server = http.createServer((req, res) => {
    bearbeiten(req, res).catch(e => {
      const code = e instanceof HttpFehler ? e.code : 500;
      if (code === 500) console.error(new Date().toISOString(), e);
      if (!res.headersSent) json(res, code, { fehler: code === 500 ? 'Interner Fehler' : e.message });
      else res.end();
    });
  });
  server.uebersichtVergessen = () => { speicher = null; };
  return server;
}

const istHaupt = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (istHaupt) {
  const port = Number(process.env.COCKPIT_PORT || 8130);
  const wurzel = process.env.COCKPIT_WURZEL || path.join(os.homedir(), 'claude');
  const vault = process.env.COCKPIT_VAULT || path.join(wurzel, 'Arbeit');
  const ablage = process.env.COCKPIT_ABLAGE || path.join(os.homedir(), 'Library', 'Application Support', 'FAH-Cockpit');
  let server;
  const claude = process.env.COCKPIT_CLAUDE || 'claude';
  const einstellungen = new Einstellungen({ ablage, claude });
  await einstellungen.laden();
  const limit = new Limit({ ablage, claude, einstellungen });
  await limit.laden();
  const auftraege = new Auftraege({
    ablage, wurzel, vault, port, claude, einstellungen, limit: info => limit.merken(info, 'auftrag'),
    melden: mitteilung, geaendert: () => server?.uebersichtVergessen(),
  });
  await auftraege.laden();
  const wissen = new WissenSpiegel({ wurzel, vault, einstellungen, auftraege: path.join(ablage, 'auftraege'),
    gedaechtnis: process.env.COCKPIT_GEDAECHTNIS || gedaechtnisPfad(), berichtDatei: path.join(ablage, 'wissen.json') });
  await wissen.laden();
  server = cockpit({ wurzel, vault, port, auftraege, einstellungen, wissen, limit, gedaechtnis: process.env.COCKPIT_GEDAECHTNIS || null });
  // Wissen alle 30 Minuten nach FAH-Git spiegeln (erster Lauf 3 Minuten nach dem Start)
  const spiegeln = () => wissen.lauf().then(b => { server.uebersichtVergessen();
    const z = b.projekte.reduce((m, p) => (m[p.status] = (m[p.status] || 0) + 1, m), {});
    console.log(new Date().toISOString(), 'Wissen gespiegelt:', JSON.stringify(z), 'allgemein:', b.allgemein?.status, b.fehler || ''); })
    .catch(e => console.error('Wissen-Spiegel:', e));
  setTimeout(spiegeln, 3 * 60_000);
  setInterval(spiegeln, 30 * 60_000);
  // Nutzungslimit live (nur wenn in den Einstellungen erlaubt): jede Minute wie /usage
  const limitTakt = () => { if (einstellungen.aktuell().limitLive) limit.abfragen().catch(e => { limit.werte.fehler = e.message; }); };
  limitTakt();
  setInterval(limitTakt, 60_000);
  server.listen(port, '127.0.0.1', () => console.log(`FAH-Cockpit läuft: http://localhost:${port} (Projekte: ${wurzel})`));
  for (const s of ['SIGTERM', 'SIGINT']) process.on(s, () => { auftraege.beenden(); process.exit(0); });
}
