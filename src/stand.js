// ============================================================================
// Erdacht und programmiert von Fabian Hammer, Deutschland.
// (c) 2026 Fabian Hammer - Alle Rechte vorbehalten. Geistiges Eigentum.
// ============================================================================
// Stand-Dateien lesen und To-dos abhaken. Eine Stand-Datei liegt je Projekt im Vault unter
// maschine/projekte/<Ordner>.md: YAML-Kopf (ordner, status, aktualisiert, quelle), dann „## Stand“, „## Offen“, „## Erledigt“.

const AUFGABE = /^(\s*[-*] \[)( |x|X)(\] )(.*)$/;

/**
 * Art eines To-dos aus der Kennzeichnung am Anfang: „(optional)“, „(Betreiber)“ = dein Schritt/deine Entscheidung,
 * „(Praxistest)“ = Prüfung am echten Gerät oder im Browser; ohne Kennzeichnung = echte Arbeit (zählt im Cockpit oben).
 */
export const ARTEN = ['arbeit', 'betreiber', 'praxistest', 'optional'];
const KENNZEICHEN = [['optional', /^\(optional\)\s*/i], ['praxistest', /^\(praxistest\)\s*/i], ['betreiber', /^\(betreiber\)\s*/i]];
export function artLesen(text) {
  for (const [art, re] of KENNZEICHEN) if (re.test(text)) return { art, anzeige: text.replace(re, '') };
  return { art: 'arbeit', anzeige: text };
}
export const kennzeichen = art => ({ optional: '(optional) ', praxistest: '(Praxistest) ', betreiber: '(Betreiber) ' }[art] || '');

/** Kopf zwischen den ersten beiden „---“-Zeilen als einfache Schlüssel/Wert-Paare. */
function kopfLesen(zeilen) {
  const kopf = {};
  if ((zeilen[0] || '').trim() !== '---') return { kopf, ende: 0 };
  for (let i = 1; i < zeilen.length; i++) {
    if (zeilen[i].trim() === '---') return { kopf, ende: i + 1 };
    const m = /^([A-Za-zÄÖÜäöüß_-]+):\s*(.*)$/.exec(zeilen[i]);
    if (m) kopf[m[1].toLowerCase()] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return { kopf: {}, ende: 0 };   // kein schließendes „---“: kein Kopf
}

/**
 * Liest eine Stand-Datei.
 * @returns {{kopf: object, titel: string, stand: string, offen: Array, erledigt: Array}}
 *   offen/erledigt: {zeile (0-basiert in der Datei), text, erledigt, optional, art, anzeige}
 */
export function lesen(text) {
  const zeilen = String(text ?? '').split(/\r?\n/);
  const { kopf, ende } = kopfLesen(zeilen);
  let titel = '', abschnitt = '';
  const standZeilen = [], offen = [], erledigt = [];
  for (let i = ende; i < zeilen.length; i++) {
    const z = zeilen[i];
    const h1 = /^#\s+(.*)$/.exec(z);
    if (h1 && !titel) { titel = h1[1].trim(); continue; }
    const h2 = /^##\s+(.*)$/.exec(z);
    if (h2) { abschnitt = h2[1].trim().toLowerCase(); continue; }
    if (abschnitt === 'stand') { standZeilen.push(z); continue; }
    if (abschnitt === 'offen' || abschnitt === 'erledigt') {
      const m = AUFGABE.exec(z);
      if (!m) continue;
      const t = m[4].trim();
      const { art, anzeige } = artLesen(t);
      const eintrag = { zeile: i, text: t, erledigt: m[2] !== ' ', optional: art === 'optional', art, anzeige };
      (abschnitt === 'offen' ? offen : erledigt).push(eintrag);
    }
  }
  const stand = standZeilen.join('\n').replace(/^\s+|\s+$/g, '').replace(/\n{3,}/g, '\n\n');
  return { kopf, titel: titel || kopf.ordner || '', stand, offen, erledigt };
}

export class StandFehler extends Error {}

/**
 * Setzt oder entfernt den Haken eines To-dos. `text` muss dem To-do in dieser Zeile entsprechen –
 * hat jemand die Datei inzwischen geändert, bricht es ab statt die falsche Zeile zu treffen.
 */
export function umschalten(dateitext, zeile, text, erledigt) {
  const nl = /\r\n/.test(dateitext) ? '\r\n' : '\n';
  const zeilen = String(dateitext).split(/\r?\n/);
  if (!Number.isInteger(zeile) || zeile < 0 || zeile >= zeilen.length) throw new StandFehler('Zeile gibt es nicht (Datei geändert?)');
  const m = AUFGABE.exec(zeilen[zeile]);
  if (!m || m[4].trim() !== String(text).trim()) throw new StandFehler('Das To-do steht nicht mehr in dieser Zeile – Seite neu laden.');
  zeilen[zeile] = m[1] + (erledigt ? 'x' : ' ') + m[3] + m[4];
  return zeilen.join(nl);
}

/** Anzahl der noch offenen ECHTEN Arbeit (ohne optional, Betreiber-Schritte und Praxistests). */
export function offeneZahl(s) {
  return s ? s.offen.filter(t => !t.erledigt && t.art === 'arbeit').length : 0;
}

/** Offene To-dos je Art: {arbeit, betreiber, praxistest, optional}. */
export function offeneArten(s) {
  const z = { arbeit: 0, betreiber: 0, praxistest: 0, optional: 0 };
  for (const t of s?.offen || []) if (!t.erledigt) z[t.art]++;
  return z;
}

/** Neues To-do am Ende von „## Offen“ einfügen (gibt es den Abschnitt nicht, wird er angelegt). */
export function todoHinzufuegen(dateitext, aufgabe, art = 'arbeit') {
  const roh = String(aufgabe || '').replace(/[\r\n]+/g, ' ').trim();
  const t = roh && artLesen(roh).art === 'arbeit' ? kennzeichen(art) + roh : roh;
  if (!t) throw new StandFehler('Bitte das To-do eingeben.');
  const nl = /\r\n/.test(dateitext) ? '\r\n' : '\n';
  const zeilen = String(dateitext).split(/\r?\n/);
  const start = zeilen.findIndex(z => /^##\s+Offen\s*$/i.test(z));
  if (start < 0) {
    while (zeilen.length && zeilen[zeilen.length - 1] === '') zeilen.pop();
    zeilen.push('', '## Offen', '', `- [ ] ${t}`, '');
    return zeilen.join(nl);
  }
  let ende = zeilen.findIndex((z, i) => i > start && /^##\s+/.test(z));
  if (ende < 0) ende = zeilen.length;
  let ziel = ende;                                    // hinter das letzte nicht-leere Element des Abschnitts
  while (ziel - 1 > start && zeilen[ziel - 1].trim() === '') ziel--;
  zeilen.splice(ziel, 0, `- [ ] ${t}`);
  if (ziel === start + 1) zeilen.splice(start + 1, 0, '');      // Leerzeile nach der Überschrift
  return zeilen.join(nl);
}
