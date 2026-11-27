#!/usr/bin/env node
// ============================================================================
// Erdacht und programmiert von Fabian Hammer, Deutschland.
// (c) 2026 Fabian Hammer - Alle Rechte vorbehalten. Geistiges Eigentum.
// ============================================================================
// PreToolUse-Haken für Hintergrund-Aufträge des FAH-Cockpits. Claude Code ruft ihn vor jedem Werkzeugaufruf auf
// (Eingabe als JSON auf stdin). Er fragt das Cockpit, ob der Aufruf laufen darf, und wartet bei Bedarf auf das Ja
// des Betreibers. Ist das Cockpit nicht erreichbar, wird abgelehnt – nie stillschweigend erlaubt.

import http from 'node:http';

const { COCKPIT_AUFTRAG: auftrag, COCKPIT_TOKEN: token, COCKPIT_PORT: port } = process.env;

function antworten(erlauben, grund) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: erlauben ? 'allow' : 'deny', permissionDecisionReason: grund },
  }) + '\n');
  process.exit(0);
}

function anfrage(methode, pfad, daten) {
  return new Promise((resolve, reject) => {
    const koerper = daten ? JSON.stringify(daten) : null;
    const req = http.request({ host: '127.0.0.1', port: Number(port), path: pfad, method: methode,
      headers: koerper ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(koerper) } : {} }, res => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', s => { text += s; });
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error('Status ' + res.statusCode));
        try { resolve(JSON.parse(text)); } catch (e) { reject(e); }
      });
    });
    req.setTimeout(30_000, () => req.destroy(new Error('Zeitüberschreitung')));
    req.on('error', reject);
    if (koerper) req.write(koerper);
    req.end();
  });
}

async function eingabeLesen() {
  let text = '';
  process.stdin.setEncoding('utf8');
  for await (const s of process.stdin) text += s;
  return JSON.parse(text || '{}');
}

const warten = ms => new Promise(r => setTimeout(r, ms));

try {
  if (!auftrag || !token || !port) antworten(false, 'FAH-Cockpit: Auftrag unbekannt – abgelehnt.');
  const e = await eingabeLesen();
  let r = await anfrage('POST', '/api/haken', {
    auftrag, token, werkzeug: e.tool_name, eingabe: e.tool_input, toolUseId: e.tool_use_id || null, cwd: e.cwd || null,
  });
  if (r.warte) {
    const pfad = `/api/haken?auftrag=${encodeURIComponent(auftrag)}&token=${encodeURIComponent(token)}&freigabe=${encodeURIComponent(r.warte)}`;
    let fehlschlaege = 0;
    // Eigene Frist knapp unter der Haken-Frist in Claude Code (6 h): lieber selbst ablehnen als von Claude Code
    // abgebrochen werden (das wäre ein „nicht blockierender Fehler“).
    const frist = Date.now() + 5.75 * 3600 * 1000;
    for (;;) {
      if (Date.now() > frist) antworten(false, 'Keine Entscheidung im FAH-Cockpit innerhalb der Frist – abgelehnt.');
      await warten(1000);
      try { r = await anfrage('GET', pfad); fehlschlaege = 0; } catch {
        if (++fehlschlaege >= 30) antworten(false, 'FAH-Cockpit nicht mehr erreichbar – abgelehnt.');
        continue;
      }
      if (!r.offen) break;
    }
  }
  // „durch“: keine Entscheidung ausgeben – dann entscheidet Claude Codes eigenes Rechtesystem (wie im Terminal).
  if (r.entscheidung === 'durch') process.exit(0);
  antworten(r.entscheidung === 'allow', r.grund || '');
} catch (fehler) {
  antworten(false, `FAH-Cockpit nicht erreichbar (${fehler.message}) – abgelehnt.`);
}
