// (c) 2026 Fabian Hammer - Alle Rechte vorbehalten. Tests für FAH-Cockpit (eine Datei, node --test).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { lesen, umschalten, offeneZahl } from '../src/stand.js';
import { statusLesen } from '../src/projekte.js';
import { cockpit } from '../src/server.js';
import { pruefen, zerlegen, sichtbar } from '../src/freigabe.js';
import { Einstellungen } from '../src/einstellungen.js';
import { Auftraege } from '../src/auftraege.js';
import { chmod } from 'node:fs/promises';

const BEISPIEL = `---
ordner: Demo
status: aktiv
aktualisiert: 2026-11-27
quelle: Test
---
# Demo-Projekt

## Stand

Läuft auf dem Mac. Version 1.2.

## Offen

- [ ] Erstes To-do mit \`code\`
- [x] Schon abgehakt
- [ ] (optional) Später vielleicht

## Erledigt

- [x] 2026-11-20 Altes Ding
`;

test('Stand-Datei lesen', () => {
  const s = lesen(BEISPIEL);
  assert.equal(s.kopf.ordner, 'Demo');
  assert.equal(s.kopf.status, 'aktiv');
  assert.equal(s.titel, 'Demo-Projekt');
  assert.equal(s.stand, 'Läuft auf dem Mac. Version 1.2.');
  assert.equal(s.offen.length, 3);
  assert.equal(s.offen[1].erledigt, true);
  assert.equal(s.offen[2].optional, true);
  assert.equal(s.erledigt.length, 1);
  assert.equal(offeneZahl(s), 1);                     // nur echte Arbeit – „(optional)“ zählt nicht
});

test('Datei ohne Kopf und mit CRLF', () => {
  const s = lesen('# X\r\n\r\n## Offen\r\n\r\n- [ ] a\r\n');
  assert.deepEqual(s.kopf, {});
  assert.equal(s.titel, 'X');
  assert.equal(s.offen[0].text, 'a');
  const neu = umschalten('# X\r\n\r\n## Offen\r\n\r\n- [ ] a\r\n', 4, 'a', true);
  assert.equal(neu, '# X\r\n\r\n## Offen\r\n\r\n- [x] a\r\n');
});

test('Abhaken ändert genau eine Zeile, falsches To-do bricht ab', () => {
  const s = lesen(BEISPIEL);
  const t = s.offen[0];
  const neu = umschalten(BEISPIEL, t.zeile, t.text, true);
  assert.equal(neu.split('\n').filter((z, i) => z !== BEISPIEL.split('\n')[i]).length, 1);
  assert.equal(lesen(neu).offen[0].erledigt, true);
  assert.equal(umschalten(neu, t.zeile, t.text, false), BEISPIEL);
  assert.throws(() => umschalten(BEISPIEL, t.zeile, 'anderer Text', true), /nicht mehr in dieser Zeile/);
  assert.throws(() => umschalten(BEISPIEL, 999, t.text, true), /Zeile gibt es nicht/);
});

test('git status --porcelain=v2 auswerten', () => {
  const s = statusLesen('# branch.oid abc\n# branch.head main\n# branch.upstream fahgit/main\n# branch.ab +2 -1\n1 .M N... 1 2 3 4 5 a.js\n? neu.txt\n');
  assert.deepEqual(s, { zweig: 'main', upstream: 'fahgit/main', voraus: 2, zurueck: 1, geaendert: 2 });
});

async function aufbauen() {
  const wurzel = await mkdtemp(path.join(os.tmpdir(), 'cockpit-'));
  const vault = path.join(wurzel, 'Arbeit');
  await mkdir(path.join(vault, 'maschine', 'projekte'), { recursive: true });
  await mkdir(path.join(wurzel, 'Demo'));
  await mkdir(path.join(wurzel, 'NEUE ZIPs'));
  await writeFile(path.join(wurzel, 'Demo', 'package.json'), '{"version":"1.2.3"}');
  const g = (...a) => execFileSync('git', ['-C', path.join(wurzel, 'Demo'), ...a], { env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' } });
  g('init', '-q', '-b', 'main');
  g('-c', 'user.name=T', '-c', 'user.email=t@example.org', 'add', '-A');
  g('-c', 'user.name=T', '-c', 'user.email=t@example.org', 'commit', '-q', '-m', 'Erster Stand');
  await writeFile(path.join(wurzel, 'Demo', 'neu.txt'), 'x');
  await writeFile(path.join(vault, 'maschine', 'projekte', 'Demo.md'), BEISPIEL);
  const server = cockpit({ wurzel, vault, port: 0, zwischenspeicherMs: 0 });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  // Port erst nach dem Lauschen bekannt: Server mit echtem Port neu anlegen, damit die Host-Prüfung stimmt.
  server.close();
  const s2 = cockpit({ wurzel, vault, port, zwischenspeicherMs: 0 });
  await new Promise(r => s2.listen(port, '127.0.0.1', r));
  return { wurzel, vault, port, server: s2 };
}

test('Server: Übersicht, Detail, Abhaken, Schutz', async t => {
  const u = await aufbauen();
  t.after(async () => { u.server.close(); await rm(u.wurzel, { recursive: true, force: true }); });
  const basis = `http://127.0.0.1:${u.port}`;

  const ue = await (await fetch(basis + '/api/uebersicht')).json();
  const namen = ue.projekte.map(p => p.ordner);
  assert.ok(namen.includes('Demo') && namen.includes('Arbeit'));
  assert.ok(!namen.includes('NEUE ZIPs'));
  const demo = ue.projekte.find(p => p.ordner === 'Demo');
  assert.equal(demo.version, '1.2.3');
  assert.equal(demo.offen, 1);
  assert.deepEqual(demo.arten, { arbeit: 1, betreiber: 0, praxistest: 0, optional: 1 });
  assert.equal(demo.git.geaendert, 1);
  assert.equal(demo.git.letzterCommit.betreff, 'Erster Stand');
  assert.equal(ue.summen.offen, 1); assert.equal(ue.summen.optional, 1);

  const d = await (await fetch(basis + '/api/projekt?ordner=Demo')).json();
  assert.equal(d.todos.length, 3);
  assert.equal(d.commits[0].betreff, 'Erster Stand');
  assert.equal(d.standDatei, path.join('maschine', 'projekte', 'Demo.md'));

  assert.equal((await fetch(basis + '/api/projekt?ordner=..%2F..%2Fetc')).status, 404);

  const todo = d.todos[0];
  const body = JSON.stringify({ ordner: 'Demo', zeile: todo.zeile, text: todo.text, erledigt: true });
  // ohne eigenen Kopf: abgelehnt
  assert.equal((await fetch(basis + '/api/todo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })).status, 403);
  // als Formular: abgelehnt
  assert.equal((await fetch(basis + '/api/todo', { method: 'POST', headers: { 'X-Cockpit': '1', 'Content-Type': 'text/plain' }, body })).status, 403);
  const ok = await fetch(basis + '/api/todo', { method: 'POST', headers: { 'X-Cockpit': '1', 'Content-Type': 'application/json' }, body });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).offen, 0);
  assert.match(await readFile(path.join(u.vault, 'maschine', 'projekte', 'Demo.md'), 'utf8'), /- \[x\] Erstes To-do/);
  // gleiche Zeile, falscher Text → 409
  const falsch = await fetch(basis + '/api/todo', { method: 'POST', headers: { 'X-Cockpit': '1', 'Content-Type': 'application/json' },
    body: JSON.stringify({ ordner: 'Demo', zeile: todo.zeile, text: 'gibt es nicht', erledigt: false }) });
  assert.equal(falsch.status, 409);

  // fremder Host (DNS-Rebinding): abgelehnt
  const fremd = await new Promise(resolve => {
    import('node:http').then(({ default: http }) => {
      http.get({ host: '127.0.0.1', port: u.port, path: '/api/uebersicht', headers: { Host: 'boese.example:' + u.port } }, r => { r.resume(); resolve(r.statusCode); });
    });
  });
  assert.equal(fremd, 403);

  const seite = await fetch(basis + '/');
  assert.equal(seite.status, 200);
  assert.match(seite.headers.get('content-security-policy'), /default-src 'self'/);
});

test('Freigabe wie im Multitool: nur Schritte nach außen fragen', () => {
  const orte = { projekt: '/p/projekt', cwd: '/p/projekt', gesperrt: ['/ablage'] };
  const stufe = (w, e) => pruefen(w, e, orte).stufe;
  const bash = c => stufe('Bash', { command: c });
  // läuft durch (Claude Code entscheidet selbst, wie im Terminal)
  for (const c of [
    'git status && git log -5 --oneline | head -3', 'npm test', 'node --test 2>&1 | tail -20', 'swift build',
    'cd ~/claude/Arbeit && grep -n "^## \\|^aktualisiert" datei; git status --short | head',
    'for f in *.md; do head -3 "$f"; done', 'git add -A && git commit -m "x"', 'rm src/alt.js', 'curl -s https://example.org',
    'echo a > datei.txt', 'mount | grep smb', 'defaults read de.fah.multitool', 'rsync -a src/ build/', 'npm install',
    'grep -n "open" datei', 'cat ~/.ssh/config',
  ]) assert.equal(bash(c), 'durch', 'müsste durchlaufen: ' + c);
  assert.equal(stufe('Edit', { file_path: '/p/projekt/src/a.js' }), 'durch');
  assert.equal(stufe('Write', { file_path: '/irgendwo/datei' }), 'durch');
  assert.equal(stufe('Read', { file_path: '/etc/hosts' }), 'durch');
  assert.equal(stufe('WebFetch', { url: 'https://example.org' }), 'durch');
  assert.equal(stufe('mcp__gmail__search_threads', {}), 'durch');
  // Karte (bei „Alles erlauben“ ohne Rückfrage)
  for (const c of [
    'git push fahgit main', 'git -C /p/projekt push', 'cd x && git push', 'ssh nas uptime', 'scp a nas:/tmp/', 'rsync -a dist/ nas:/srv/',
    'curl -X POST -d @a https://x', 'curl -F f=@zip https://nas/api', 'rm -r build', 'rm /tmp/datei', 'launchctl kickstart gui/501/x',
    'brew install jq', 'osascript -e "beep"', 'open -a Safari', 'killall Dock', 'defaults write x y z', 'gh pr create',
    './releases_push.sh', 'bash werkzeuge/installieren.sh', 'npm publish', 'npm install lodash',
    'for h in a b; do ssh "$h" uptime; done', 'x=$(git push 2>&1)', '/usr/bin/ssh nas',
  ]) assert.equal(bash(c), 'karte', 'müsste eine Karte sein: ' + c);
  assert.equal(stufe('mcp__gmail__send_message', {}), 'karte');
  // fragt immer – auch bei „Alles erlauben“
  for (const c of ['sudo ls', 'git push --force fahgit main', 'git push -f', 'rm -rf ~/Documents', 'rm -rf /p/anderes', 'shutdown -h now',
    'echo $(sudo id)']) assert.equal(bash(c), 'immer', 'müsste immer fragen: ' + c);
  assert.equal(stufe('Edit', { file_path: '/ablage/einstellungen.json' }), 'immer', 'Ablage des Cockpits');
  assert.deepEqual(zerlegen('a && b || c; d | e 2>&1'), [['a'], ['b'], ['c'], ['d'], ['e']]);
  assert.match(sichtbar('a‮b'), /U\+202E/);
});

// Ein nachgebautes „claude“: spielt drei Werkzeugaufrufe über den echten Haken und schreibt die Entscheidungen mit.
const FAKE_CLAUDE = `#!/usr/bin/env node
const { execSync } = require('node:child_process');
const fs = require('node:fs');
const readline = require('node:readline');
const a = process.argv.slice(2);
const einst = JSON.parse(fs.readFileSync(a[a.indexOf('--settings') + 1], 'utf8'));
const haken = einst.hooks.PreToolUse[0].hooks[0].command;
const aus = e => process.stdout.write(JSON.stringify(e) + '\\n');
const protokoll = process.env.FAKE_PROTOKOLL;
fs.appendFileSync(protokoll + '.args', JSON.stringify(a) + '\\n');
const eingang = []; let zu = false;
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', l => { try { eingang.push(JSON.parse(l).message.content); } catch {} });
rl.on('close', () => { zu = true; });
const warte = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  while (!eingang.length) await warte(10);
  eingang.shift();
  aus({ type: 'system', subtype: 'init', session_id: 'sitzung-1', model: 'fake' });
  aus({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed', rateLimitType: 'seven_day', unifiedWindows: { seven_day: { utilization: 0.42, resetsAt: 1796036400, status: 'allowed' } } } });
  const befehle = a.includes('--resume') ? ['git log -1', 'ssh nas uptime'] : ['git status', 'git push fahgit main', 'ssh nas uptime', 'sudo reboot'];
  let n = 0;
  for (const befehl of befehle) {
    const id = 'toolu_' + (++n);
    aus({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name: 'Bash', input: { command: befehl, description: 'Test ' + n } }] } });
    const ein = JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: befehl, description: 'Test ' + n }, tool_use_id: id });
    const roh = execSync(haken, { input: ein, encoding: 'utf8', shell: '/bin/sh' }).trim();
    const entscheidung = roh ? JSON.parse(roh).hookSpecificOutput.permissionDecision : 'durch';
    fs.appendFileSync(protokoll, befehl + ' => ' + entscheidung + '\\n');
    aus({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: entscheidung === 'deny', content: 'Ausgabe von ' + befehl }] } });
    await warte(20);
  }
  await warte(100);
  const zusatz = eingang.splice(0);
  aus({ type: 'assistant', message: { content: [{ type: 'text', text: 'Fertig mit ' + n + ' Schritten.' + (zusatz.length ? ' Nachtrag erhalten: ' + zusatz.join(' | ') : '') }] } });
  aus({ type: 'result', subtype: 'success', is_error: false, result: 'Erledigt.', session_id: 'sitzung-1', total_cost_usd: 0.01, duration_ms: 5 });
  while (!zu) await warte(10);
  process.exit(0);
})();
`;

test('Auftrag: Haken, Freigabe erlauben/ablehnen, Nachschreiben', async t => {
  const wurzel = await mkdtemp(path.join(os.tmpdir(), 'cockpit-auftrag-'));
  const vault = path.join(wurzel, 'Arbeit');
  await mkdir(path.join(vault, 'maschine', 'projekte'), { recursive: true });
  await mkdir(path.join(wurzel, 'Demo'));
  await writeFile(path.join(vault, 'maschine', 'projekte', 'Demo.md'), BEISPIEL);
  const fake = path.join(wurzel, 'fake-claude.cjs');
  await writeFile(fake, FAKE_CLAUDE); await chmod(fake, 0o755);
  const protokoll = path.join(wurzel, 'entscheidungen.txt');
  process.env.FAKE_PROTOKOLL = protokoll;

  // freien Port finden
  const probe = cockpit({ wurzel, vault, port: 0 });
  await new Promise(r => probe.listen(0, '127.0.0.1', r));
  const port = probe.address().port; probe.close();

  const meldungen = [];
  await mkdir(path.join(wurzel, 'ablage'), { recursive: true });
  const einstellungen = new Einstellungen({ ablage: path.join(wurzel, 'ablage'), claude: fake, schluesselbund: false });
  const limits = [];
  const auftraege = new Auftraege({ ablage: path.join(wurzel, 'ablage'), wurzel, vault, port, claude: fake, einstellungen,
    arbeitsordner: wurzel, melden: (titel) => meldungen.push(titel), limit: info => limits.push(info) });
  await auftraege.laden();
  const server = cockpit({ wurzel, vault, port, auftraege, einstellungen, zwischenspeicherMs: 0 });
  await new Promise(r => server.listen(port, '127.0.0.1', r));
  t.after(async () => { auftraege.beenden(); server.close(); await rm(wurzel, { recursive: true, force: true }); });
  const basis = `http://127.0.0.1:${port}`;
  const post = (weg, daten) => fetch(basis + weg, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Cockpit': '1' }, body: JSON.stringify(daten) });
  const holen = async id => (await fetch(basis + '/api/auftrag?id=' + id)).json();
  async function warteBis(id, bedingung, ms = 15000) {
    const ende = Date.now() + ms;
    for (;;) {
      const a = await holen(id);
      if (bedingung(a)) return a;
      if (Date.now() > ende) throw new Error('Zeitüberschreitung, Stand: ' + JSON.stringify({ status: a.status, freigaben: a.freigaben }));
      await new Promise(r => setTimeout(r, 100));
    }
  }

  // ohne Text und ohne To-do: abgelehnt; unbekanntes To-do: abgelehnt
  assert.equal((await post('/api/auftrag', { ordner: 'Demo' })).status, 400);
  assert.equal((await post('/api/auftrag', { ordner: 'Demo', todo: { zeile: 1, text: 'gibt es nicht' } })).status, 409);

  const d = await (await fetch(basis + '/api/projekt?ordner=Demo')).json();
  const r = await post('/api/auftrag', { ordner: 'Demo', todo: { zeile: d.todos[0].zeile, text: d.todos[0].text } });
  assert.equal(r.status, 200);
  const { id } = await r.json();

  // 1. Freigabe: git push → erlauben
  let a = await warteBis(id, x => x.freigaben.some(f => f.status === 'offen'));
  let f = a.freigaben.find(x => x.status === 'offen');
  assert.equal(f.kurz, 'git push fahgit main');
  assert.equal(f.begruendung, 'Test 2');
  assert.equal((await (await fetch(basis + '/api/uebersicht')).json()).summen.wartet, 1);
  // Haken ohne gültiges Geheimnis: abgelehnt
  assert.equal((await fetch(basis + `/api/haken?auftrag=${id}&token=falsch&freigabe=${f.id}`)).status, 403);
  assert.equal((await post('/api/freigabe', { auftrag: id, freigabe: f.id, erlauben: true, immer: true })).status, 200);
  assert.match(f.voll, /git push fahgit main/);
  // „Alles erlauben (dieser Auftrag)“

  // „Alles erlauben“ → ssh läuft ohne Karte, sudo fragt trotzdem
  a = await warteBis(id, x => x.freigaben.some(g => g.status === 'offen'));
  f = a.freigaben.find(x => x.status === 'offen');
  assert.equal(f.kurz, 'sudo reboot');
  assert.equal(f.immerFragen, true);
  // Nachricht, während Claude arbeitet: geht über die Streaming-Eingabe direkt an den laufenden Claude
  assert.equal((await post('/api/auftrag/nachricht', { id, text: 'Bitte auch die Doku anpassen' })).status, 200);
  assert.equal((await holen(id)).live.art, 'wartet', 'Jetzt-Zustand: wartet auf dein Ja');
  assert.equal((await post('/api/freigabe', { auftrag: id, freigabe: f.id, erlauben: false, antwort: 'auf keinen Fall' })).status, 200);
  a = await warteBis(id, x => x.status === 'fertig');
  assert.equal(a.allesErlaubt, true);
  assert.equal(a.sitzung, 'sitzung-1');
  assert.deepEqual(Object.values(a.entscheidungen), ['erlaubt', 'alles', 'abgelehnt']);
  assert.ok(a.verlauf.some(v => v.art === 'text' && v.text.includes('Nachtrag erhalten: Bitte auch die Doku anpassen')), 'Nachricht kam während des Laufs an');
  const w1 = a.verlauf.find(v => v.art === 'werkzeug' && v.kurz === 'git status');
  assert.ok(w1.start && w1.ende && w1.ausgabe === 'Ausgabe von git status', 'Dauer und Ausgabe je Befehl');
  assert.equal(a.live, null);
  assert.equal(limits[0].unifiedWindows.seven_day.utilization, 0.42, 'Limit-Stand aus dem Lauf gemerkt');
  assert.ok(!('token' in a), 'Geheimnis darf nicht an die Oberfläche');
  assert.ok(meldungen.includes('Wartet auf dein Ja') && meldungen.includes('Auftrag fertig'));

  // Einstellungen: Modell und Aufwand als Standard, Anmeldung per API-Schlüssel
  assert.equal((await post('/api/einstellungen', { modell: 'sonnet', aufwand: 'high', anmeldung: 'schluessel' })).status, 400, 'ohne Schlüssel');
  const e = await post('/api/einstellungen', { modell: 'sonnet', aufwand: 'high', anmeldung: 'schluessel', schluessel: 'sk-test-123' });
  assert.equal(e.status, 200);
  const ej = await e.json();
  assert.equal(ej.ki.schluesselDa, true);
  assert.ok(!JSON.stringify(ej).includes('sk-test-123'), 'Schlüssel darf nie zurückkommen');
  assert.equal((await post('/api/einstellungen', { modell: 'gpt' })).status, 400);

  // Wieder fragen, nachschreiben: dieselbe Sitzung, ssh kommt wieder als Karte → ablehnen
  assert.equal((await post('/api/auftrag/alles', { id, an: false })).status, 200);
  assert.equal((await post('/api/auftrag/nachricht', { id, text: 'Und noch der letzte Commit?' })).status, 200);
  a = await warteBis(id, x => x.freigaben.some(g => g.status === 'offen'));
  f = a.freigaben.find(x => x.status === 'offen');
  assert.equal(f.kurz, 'ssh nas uptime');
  assert.equal((await post('/api/freigabe', { auftrag: id, freigabe: f.id, erlauben: false, antwort: 'nicht jetzt' })).status, 200);
  a = await warteBis(id, x => x.status === 'fertig' && x.runden === 2);
  assert.equal(a.verlauf.filter(v => v.art === 'nutzer').length, 3, 'Auftrag, Nachricht während des Laufs, Nachschreiben');
  assert.equal(await readFile(protokoll, 'utf8'),
    'git status => durch\ngit push fahgit main => allow\nssh nas uptime => allow\nsudo reboot => deny\ngit log -1 => durch\nssh nas uptime => deny\n');
  const laeufe = (await readFile(protokoll + '.args', 'utf8')).trim().split('\n').map(z => JSON.parse(z));
  const zweiter = laeufe[laeufe.length - 1];
  assert.ok(zweiter.includes('--permission-mode') && zweiter[zweiter.indexOf('--permission-mode') + 1] === 'auto');
  assert.ok(zweiter[zweiter.indexOf('--input-format') + 1] === 'stream-json' && zweiter.includes('--resume'), 'Streaming-Eingabe und Fortsetzen');
  assert.ok(zweiter[zweiter.indexOf('--model') + 1] === 'sonnet' && zweiter[zweiter.indexOf('--effort') + 1] === 'high', 'Standard aus den Einstellungen');
});

test('Wissen in FAH-Git: Spiegel je Projekt, nur claude-wissen committen, frederix nie', async t => {
  const { WissenSpiegel, zuordnen } = await import('../src/wissen.js');
  const basis = await mkdtemp(path.join(os.tmpdir(), 'cockpit-wissen-'));
  t.after(() => rm(basis, { recursive: true, force: true }));
  const wurzel = path.join(basis, 'claude'), vault = path.join(wurzel, 'Arbeit'), gedaechtnis = path.join(basis, 'memory');
  const server = path.join(basis, 'fah:3300');                     // „FAH-Git“: Pfad mit :3300/
  await mkdir(path.join(vault, 'maschine', 'projekte'), { recursive: true });
  await mkdir(gedaechtnis, { recursive: true }); await mkdir(server, { recursive: true });
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@example.org', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@example.org' };
  const g = (dir, ...a) => execFileSync('git', ['-C', dir, ...a], { env, encoding: 'utf8' });
  async function projekt(name, remoteUrl) {
    const dir = path.join(wurzel, name);
    await mkdir(dir, { recursive: true });
    const nackt = path.join(server, name + '.git');
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', nackt], { env });
    g(dir, 'init', '-q', '-b', 'main'); g(dir, 'config', 'user.name', 'T'); g(dir, 'config', 'user.email', 't@example.org');
    await writeFile(path.join(dir, 'a.txt'), 'a\n'); g(dir, 'add', '-A'); g(dir, 'commit', '-q', '-m', 'start');
    g(dir, 'remote', 'add', 'fahgit', remoteUrl || nackt); g(dir, 'push', '-q', '-u', 'fahgit', 'main');
    return { dir, nackt };
  }
  const a = await projekt('alpha');
  const fx = await projekt('fxprojekt');
  g(fx.dir, 'remote', 'add', 'frederix', 'https://gitlab.frederix.cloud/x/y.git');
  const c = await projekt('gamma');
  await writeFile(path.join(c.dir, 'b.txt'), 'b\n'); g(c.dir, 'add', '-A'); g(c.dir, 'commit', '-q', '-m', 'eigene Arbeit, ungepusht');
  await mkdir(path.join(wurzel, 'ohnegit'));
  // Repo ohne FAH-Git-Remote → anlegbar; Repo mit zwei FAH-Remotes, Upstream am zweiten → trotzdem gepusht
  const ohne = path.join(wurzel, 'ohneremote'); await mkdir(ohne);
  g(ohne, 'init', '-q', '-b', 'main'); await writeFile(path.join(ohne, 'x.txt'), 'x'); g(ohne, 'add', '-A'); g(ohne, 'commit', '-q', '-m', 'x');
  const zwei = await projekt('zwei');
  g(zwei.dir, 'remote', 'rename', 'fahgit', 'zweiter');
  g(zwei.dir, 'remote', 'add', 'aaa-erster', path.join(server, 'anderes.git'));
  g(zwei.dir, 'branch', '--set-upstream-to=zweiter/main');
  // ein beendeter Cockpit-Auftrag zu alpha
  const auftraegeOrdner = path.join(basis, 'auftraege'); await mkdir(auftraegeOrdner);
  await writeFile(path.join(auftraegeOrdner, 'a1.json'), JSON.stringify({ id: 'a1', ordner: 'alpha', titel: 'Probe', status: 'fertig',
    verlauf: [{ art: 'nutzer', text: 'Mach X' }, { art: 'werkzeug', name: 'Bash', kurz: 'git status' }, { art: 'ergebnis', text: 'Erledigt.' }], freigaben: [] }));
  await writeFile(path.join(auftraegeOrdner, 'a2.json'), JSON.stringify({ id: 'a2', ordner: 'alpha', titel: 'läuft noch', status: 'laeuft', verlauf: [], freigaben: [] }));
  // fremde, offene Arbeit in alpha: eine geänderte und eine vorgemerkte Datei
  await writeFile(path.join(a.dir, 'a.txt'), 'geändert\n');
  await writeFile(path.join(a.dir, 'vorgemerkt.txt'), 'x\n'); g(a.dir, 'add', 'vorgemerkt.txt');
  await writeFile(path.join(vault, 'maschine', 'projekte', 'alpha.md'), '# Alpha\n\n## Stand\n\nläuft\n');
  await writeFile(path.join(gedaechtnis, 'MEMORY.md'), '- index\n');
  await writeFile(path.join(gedaechtnis, 'alpha-notiz.md'), 'Projekt ~/claude/alpha: wichtig\n');
  await writeFile(path.join(gedaechtnis, 'fx-notiz.md'), 'Projekt ~/claude/fxprojekt\n');
  await writeFile(path.join(gedaechtnis, 'gamma-notiz.md'), 'siehe ~/claude/gamma\n');
  await writeFile(path.join(gedaechtnis, 'allgemein.md'), 'Antworten kurz\n');
  assert.deepEqual(zuordnen('alpha-notiz.md', 'Projekt ~/claude/alpha: wichtig', ['alpha', 'gamma']), ['alpha']);

  const w = new WissenSpiegel({ wurzel, vault, gedaechtnis, globalRegeln: path.join(basis, 'fehlt.md'), auftraege: auftraegeOrdner });
  const b1 = await w.lauf();
  const st = Object.fromEntries(b1.projekte.map(p => [p.ordner, p]));
  assert.equal(st.alpha.status, 'gepusht', JSON.stringify(st.alpha));
  assert.equal(st.alpha.notizen, 1);
  assert.equal(st.fxprojekt.status, 'übersprungen');
  assert.match(st.fxprojekt.grund, /frederix/);
  assert.equal(st.gamma.status, 'gespiegelt');
  assert.match(st.gamma.grund, /andere Commits/);
  assert.equal(st.ohnegit.status, 'übersprungen');
  assert.equal(st.ohneremote.anlegbar, true);
  assert.equal(st.zwei.status, 'gepusht', 'Upstream am zweiten FAH-Remote');
  // Spiegel liegt im Server, fremde Arbeit nicht
  const imServer = execFileSync('git', ['--git-dir', a.nackt, 'ls-tree', '-r', '--name-only', 'main'], { encoding: 'utf8' });
  assert.match(imServer, /claude-wissen\/STAND\.md/);
  assert.match(imServer, /claude-wissen\/gedaechtnis\/alpha-notiz\.md/);
  assert.doesNotMatch(imServer, /vorgemerkt|fx-notiz|allgemein/);
  assert.match(imServer, /claude-wissen\/auftraege\/a1\.md/, 'beendeter Auftrag kommt mit');
  assert.doesNotMatch(imServer, /a2\.md/, 'laufender Auftrag noch nicht');
  const verlauf = execFileSync('git', ['--git-dir', a.nackt, 'show', 'main:claude-wissen/auftraege/a1.md'], { encoding: 'utf8' });
  assert.match(verlauf, /\*\*Du:\*\* Mach X/); assert.match(verlauf, /## Ergebnis/);
  const offen = g(a.dir, 'status', '--porcelain');
  assert.match(offen, /^ M a\.txt$/m); assert.match(offen, /^A  vorgemerkt\.txt$/m);
  // fx-Projekt völlig unberührt
  assert.equal(g(fx.dir, 'status', '--porcelain').trim(), '');
  await assert.rejects(stat(path.join(fx.dir, 'claude-wissen')));
  // allgemeines Repo fehlt hier → übersprungen
  assert.equal(b1.allgemein.status, 'übersprungen');
  // zweiter Lauf: nichts zu tun
  const b2 = await w.lauf();
  assert.equal(b2.projekte.find(p => p.ordner === 'alpha').status, 'aktuell');
  // Notiz gelöscht → verschwindet aus dem Spiegel
  await rm(path.join(gedaechtnis, 'alpha-notiz.md'));
  const b3 = await w.lauf();
  assert.equal(b3.projekte.find(p => p.ordner === 'alpha').status, 'gepusht');
  await assert.rejects(stat(path.join(a.dir, 'claude-wissen', 'gedaechtnis', 'alpha-notiz.md')));
});

test('Nutzungslimit: Stand aus rate_limit_event', async t => {
  const { Limit } = await import('../src/limit.js');
  const ablage = await mkdtemp(path.join(os.tmpdir(), 'cockpit-limit-'));
  t.after(() => rm(ablage, { recursive: true, force: true }));
  const l = new Limit({ ablage });
  l.merken({ status: 'allowed', rateLimitType: 'seven_day', overageStatus: 'rejected', overageDisabledReason: 'out_of_credits',
    unifiedWindows: { seven_day: { utilization: 0.3, resetsAt: 1796036400, status: 'allowed' }, five_hour: { utilization: 0.71, resetsAt: 1796000000, status: 'allowed' } } });
  const a = l.aktuell();
  assert.equal(a.fenster.seven_day.auslastung, 0.3);
  assert.equal(a.fenster.five_hour.auslastung, 0.71);
  assert.equal(a.fenster.seven_day.zurueck, new Date(1796036400 * 1000).toISOString());
  assert.equal(a.ueberzug.grund, 'out_of_credits');
  await l.sichern();
  const l2 = new Limit({ ablage }); await l2.laden();
  assert.equal(l2.aktuell().fenster.five_hour.auslastung, 0.71);
});

test('Vault: lesen, speichern mit Versionsprüfung, neue Notiz, Papierkorb, kein Ausbrechen', async t => {
  const { Vault } = await import('../src/vault.js');
  const { todoHinzufuegen } = await import('../src/stand.js');
  const vault = await mkdtemp(path.join(os.tmpdir(), 'cockpit-vault-'));
  t.after(() => rm(vault, { recursive: true, force: true }));
  await mkdir(path.join(vault, 'mensch', 'notizen'), { recursive: true });
  await mkdir(path.join(vault, '.obsidian'), { recursive: true });
  await writeFile(path.join(vault, 'mensch', 'notizen', 'Idee.md'), '# Idee\n\nText');
  await writeFile(path.join(vault, '.obsidian', 'app.md'), 'geheim');
  await writeFile(path.join(os.tmpdir(), 'cockpit-draussen.md'), 'draußen');
  const v = new Vault({ vault, commitNachMs: 60_000 });
  const liste = await v.liste();
  assert.deepEqual(liste.map(d => d.pfad), ['mensch/notizen/Idee.md']);
  assert.equal(liste[0].titel, 'Idee');
  const d = await v.lesen('mensch/notizen/Idee.md');
  const neu = await v.schreiben(d.pfad, '# Idee\n\nNeu', d.version);
  assert.notEqual(neu.version, d.version);
  await assert.rejects(v.schreiben(d.pfad, 'alt überschrieben', d.version), /inzwischen geändert/);
  for (const boese of ['../cockpit-draussen.md', 'mensch/../../x.md', '.obsidian/app.md', '/etc/passwd', 'mensch/notizen/Idee.txt'])
    await assert.rejects(v.lesen(boese), /Ungültiger Pfad|außerhalb/, boese);
  const n = await v.neu('mensch/notizen', 'Neue: Gedanke/Test');
  assert.equal(n.pfad, 'mensch/notizen/Neue- Gedanke-Test.md');
  await assert.rejects(v.neu('mensch/notizen', 'Neue: Gedanke/Test'), /gibt es dort schon/);
  await assert.rejects(v.neu('../../tmp', 'x'), /Ordner gibt es im Vault nicht/);
  const k = await v.papierkorb(n.pfad);
  assert.match(k.papierkorb, /^\.trash\//);
  assert.deepEqual((await v.liste()).map(x => x.pfad), ['mensch/notizen/Idee.md']);
  clearTimeout(v.timer);
  // To-do am Ende von „Offen“
  assert.equal(todoHinzufuegen('# X\n\n## Offen\n\n- [ ] a\n\n## Erledigt\n', 'b'), '# X\n\n## Offen\n\n- [ ] a\n- [ ] b\n\n## Erledigt\n');
  assert.match(todoHinzufuegen('# X\n\n## Offen\n\n', 'b'), /^# X\n\n## Offen\n\n- \[ \] b\n+$/);
  assert.equal(todoHinzufuegen('# X\n', 'b'), '# X\n\n## Offen\n\n- [ ] b\n');
});

test('Wissen in einen Ordner (ohne FAH-Git): eigener Ordner, Projektordner selbst, fremde Ordner bleiben unberührt', async t => {
  const { WissenSpiegel, gedaechtnisPfad } = await import('../src/wissen.js');
  assert.equal(gedaechtnisPfad('/Users/max.muster'), '/Users/max.muster/.claude/projects/-Users-max-muster/memory');
  const basis = await mkdtemp(path.join(os.tmpdir(), 'cockpit-wordner-'));
  t.after(() => rm(basis, { recursive: true, force: true }));
  const wurzel = path.join(basis, 'claude'), vault = path.join(basis, 'vault'), gedaechtnis = path.join(basis, 'mem'), ziel = path.join(basis, 'Wissen');
  for (const d of ['alpha', 'beta', 'gamma/claude-wissen', 'vault/maschine/projekte', 'mem'].map(x => x.startsWith('vault') || x === 'mem' ? path.join(basis, x) : path.join(wurzel, x))) await mkdir(d, { recursive: true });
  execFileSync('git', ['init', '-q', path.join(wurzel, 'alpha')]);
  await writeFile(path.join(vault, 'maschine', 'projekte', 'alpha.md'), '# alpha\n\n## Stand\n\nläuft\n');
  await writeFile(path.join(gedaechtnis, 'alpha-notiz.md'), '---\nname: alpha-notiz\n---\nZu ~/claude/alpha');
  await writeFile(path.join(wurzel, 'gamma', 'claude-wissen', 'eigenes.md'), 'nicht von uns');
  await mkdir(path.join(ziel, 'beta'), { recursive: true });
  await writeFile(path.join(ziel, 'beta', 'fremd.txt'), 'fremd');
  const opt = { wurzel, vault, gedaechtnis, globalRegeln: path.join(basis, 'fehlt.md') };

  // 1) eigener Ordner
  const w = new WissenSpiegel({ ...opt, ziel: 'ordner', wissenOrdner: ziel });
  const b = await w.lauf();
  const st = Object.fromEntries(b.projekte.map(p => [p.ordner, p]));
  assert.equal(b.ziel, 'ordner');
  assert.equal(st.alpha.status, 'gespiegelt', JSON.stringify(st.alpha));
  assert.match(await readFile(path.join(ziel, 'alpha', 'STAND.md'), 'utf8'), /läuft/);
  assert.match(await readFile(path.join(ziel, 'alpha', 'gedaechtnis', 'alpha-notiz.md'), 'utf8'), /alpha/);
  assert.equal(st.beta.status, 'übersprungen');                                   // fremder Ordner gleichen Namens
  assert.equal(await readFile(path.join(ziel, 'beta', 'fremd.txt'), 'utf8'), 'fremd');
  assert.equal(b.allgemein.status, 'gespiegelt');
  assert.equal((await w.lauf()).projekte.find(p => p.ordner === 'alpha').status, 'aktuell');
  assert.equal(execFileSync('git', ['-C', path.join(wurzel, 'alpha'), 'status', '--porcelain']).toString(), '');   // Projekt unberührt

  // 2) Projektordner selbst → <Projekt>/claude-wissen/, lokal von Git ausgenommen, fremdes claude-wissen bleibt
  const w2 = new WissenSpiegel({ ...opt, ziel: 'ordner', wissenOrdner: wurzel });
  const b2 = await w2.lauf();
  const st2 = Object.fromEntries(b2.projekte.map(p => [p.ordner, p]));
  assert.equal(st2.alpha.status, 'gespiegelt', JSON.stringify(st2.alpha));
  assert.match(await readFile(path.join(wurzel, 'alpha', 'claude-wissen', 'STAND.md'), 'utf8'), /läuft/);
  assert.match(await readFile(path.join(wurzel, 'alpha', '.git', 'info', 'exclude'), 'utf8'), /^\/claude-wissen\/$/m);
  assert.equal(execFileSync('git', ['-C', path.join(wurzel, 'alpha'), 'status', '--porcelain']).toString(), '');
  assert.equal(st2.gamma.status, 'übersprungen');
  assert.equal(await readFile(path.join(wurzel, 'gamma', 'claude-wissen', 'eigenes.md'), 'utf8'), 'nicht von uns');

  // 3) Ordner im Projektordner oder darüber: abgelehnt; „aus“: nichts
  assert.match((await new WissenSpiegel({ ...opt, ziel: 'ordner', wissenOrdner: path.join(wurzel, 'alpha') }).lauf()).fehler, /außerhalb des Projektordners/);
  assert.match((await new WissenSpiegel({ ...opt, ziel: 'ordner', wissenOrdner: basis }).lauf()).fehler, /nicht enthalten/);
  assert.equal((await new WissenSpiegel({ ...opt, ziel: 'aus' }).lauf()).projekte.length, 0);
});

test('FAH-Git-Ersatz (Fail-over): Haupt weg → übernommener Ersatz, Ersatz nur lesen → lokal, später zum Haupt', async t => {
  const http = await import('node:http');
  const { WissenSpiegel } = await import('../src/wissen.js');
  const basis = await mkdtemp(path.join(os.tmpdir(), 'cockpit-ersatz-'));
  t.after(() => rm(basis, { recursive: true, force: true }));
  let rolle = 'ersatz';
  const ersatz = http.createServer((req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(req.url === '/api/status' ? { version: '1.14.0', failover: { rolle } } : {})); });
  await new Promise(r => ersatz.listen(0, '127.0.0.1', r));
  t.after(() => ersatz.close());
  const tot = http.createServer(); await new Promise(r => tot.listen(0, '127.0.0.1', r));
  const totPort = tot.address().port; await new Promise(r => tot.close(r));               // Haupt: Port ohne Dienst
  const haupt = `http://127.0.0.1:${totPort}`, ersatzAdr = `http://127.0.0.1:${ersatz.address().port}`;

  const e = new Einstellungen({ ablage: path.join(basis, 'ablage'), schluesselbund: false });
  await mkdir(path.join(basis, 'ablage'), { recursive: true });
  await assert.rejects(e.speichern({ fahgitAdresse: haupt, fahgitErsatz: haupt }), /andere Adresse/);
  await e.speichern({ fahgitAdresse: haupt, fahgitErsatz: ersatzAdr });
  let z = await e.fahgitZiel(true);
  assert.equal(z.art, null); assert.match(z.grund, /nur lesen/);
  rolle = 'haupt';
  z = await e.fahgitZiel(true);
  assert.equal(z.art, 'ersatz'); assert.equal(z.adresse, ersatzAdr);
  assert.equal(e.aufErsatz(`http://benutzer@127.0.0.1:${totPort}/eigene-projekte/x.git`), `http://benutzer@127.0.0.1:${ersatz.address().port}/eigene-projekte/x.git`);
  assert.equal(e.aufErsatz('https://anderswo.example/x.git'), null);
  const p = await e.fahgitPruefen();
  assert.equal(p.ersatz.erreichbar, true); assert.equal(p.ersatz.rolle, 'haupt'); assert.equal(p.ziel.art, 'ersatz');

  // Spiegel: Ersatz nur lesend → Commit bleibt lokal; danach (Haupt wieder da) geht er mit dem nächsten Commit mit
  rolle = 'ersatz';
  const wurzel = path.join(basis, 'claude'), vault = path.join(basis, 'vault'), gedaechtnis = path.join(basis, 'mem');
  const nackt = path.join(basis, 'fah:3300', 'alpha.git'), dir = path.join(wurzel, 'alpha');
  await mkdir(path.join(vault, 'maschine', 'projekte'), { recursive: true }); await mkdir(gedaechtnis, { recursive: true });
  const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
  const g = (...a) => execFileSync('git', ['-C', dir, ...a], { env }).toString();
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', nackt], { env });
  execFileSync('git', ['init', '-q', '-b', 'main', dir], { env });
  await writeFile(path.join(dir, 'README.md'), 'x'); g('add', '.'); g('commit', '-q', '-m', 'start');
  g('remote', 'add', 'fahgit', nackt); g('push', '-q', '-u', 'fahgit', 'main');
  await writeFile(path.join(vault, 'maschine', 'projekte', 'alpha.md'), '# alpha\n\n## Stand\n\neins\n');
  const opt = { wurzel, vault, gedaechtnis, globalRegeln: path.join(basis, 'fehlt.md') };
  const b1 = await new WissenSpiegel({ ...opt, einstellungen: e }).lauf();
  const a1 = b1.projekte.find(x => x.ordner === 'alpha');
  assert.equal(a1.status, 'gespiegelt', JSON.stringify(a1)); assert.match(a1.grund, /bleibt lokal/);
  assert.equal(execFileSync('git', ['-C', nackt, 'rev-list', '--count', 'main']).toString().trim(), '1');
  await writeFile(path.join(vault, 'maschine', 'projekte', 'alpha.md'), '# alpha\n\n## Stand\n\nzwei\n');
  const a2 = (await new WissenSpiegel(opt).lauf()).projekte.find(x => x.ordner === 'alpha');      // Haupt wieder da
  assert.equal(a2.status, 'gepusht', JSON.stringify(a2));
  assert.equal(execFileSync('git', ['-C', nackt, 'rev-list', '--count', 'main']).toString().trim(), '3');
});

test('Neues Projekt: Ordner + Git + Stand-Datei, Schutz vor Doppelten und bösen Namen, FAH-Git weg → lokal mit Hinweis', async t => {
  const { projektAnlegen } = await import('../src/neu.js');
  const { WissenSpiegel } = await import('../src/wissen.js');
  const basis = await mkdtemp(path.join(os.tmpdir(), 'cockpit-neu-'));
  t.after(() => rm(basis, { recursive: true, force: true }));
  const wurzel = path.join(basis, 'claude'), vault = path.join(basis, 'vault');
  await mkdir(wurzel, { recursive: true }); await mkdir(path.join(vault, 'maschine', 'projekte'), { recursive: true });
  const r = await projektAnlegen({ wurzel, vault }, { titel: 'Kopfhörer-Wächter', ordner: 'fah-kopfhoerer-waechter',
    beschreibung: 'Warnt, wenn der Akku leer wird.', todos: 'Ersten Entwurf\n\nIcon bauen' });
  assert.equal(r.ordner, 'fah-kopfhoerer-waechter'); assert.equal(r.fahgit, null); assert.equal(r.warnung, null);
  const dir = path.join(wurzel, 'fah-kopfhoerer-waechter');
  assert.match(await readFile(path.join(dir, 'CLAUDE.md'), 'utf8'), /Warnt, wenn der Akku leer wird/);
  assert.equal(execFileSync('git', ['-C', dir, 'rev-list', '--count', 'HEAD']).toString().trim(), '1');
  assert.equal(execFileSync('git', ['-C', dir, 'status', '--porcelain']).toString(), '');
  const st = lesen(await readFile(path.join(vault, 'maschine', 'projekte', 'fah-kopfhoerer-waechter.md'), 'utf8'));
  assert.equal(st.titel, 'Kopfhörer-Wächter'); assert.equal(st.kopf.status, 'aktiv');
  assert.deepEqual(st.offen.map(x => x.text), ['Ersten Entwurf', 'Icon bauen']);
  assert.match(st.stand, /Warnt, wenn der Akku leer wird/);
  await assert.rejects(projektAnlegen({ wurzel, vault }, { titel: 'x', ordner: 'fah-kopfhoerer-waechter' }), /gibt es schon/);
  for (const boese of ['../raus', 'a/b', '.versteckt', 'mit leerzeichen', ''])
    await assert.rejects(projektAnlegen({ wurzel, vault }, { titel: 'x', ordner: boese }), /Ordnername/, boese);
  await assert.rejects(projektAnlegen({ wurzel, vault }, { titel: '', ordner: 'ok' }), /Namen/);

  // FAH-Git hinterlegt, aber nicht erreichbar: Projekt bleibt lokal, Hinweis statt Fehler
  const e = new Einstellungen({ ablage: path.join(basis, 'ablage'), schluesselbund: false });
  await mkdir(path.join(basis, 'ablage'), { recursive: true });
  await e.speichern({ fahgitAdresse: 'http://127.0.0.1:9', fahgitSchluessel: 'probe-schluessel' });
  const w = new WissenSpiegel({ wurzel, vault, gedaechtnis: path.join(basis, 'mem'), einstellungen: e });
  const r2 = await projektAnlegen({ wurzel, vault, einstellungen: e, wissen: w }, { titel: 'Zwei', ordner: 'fah-zwei', fahgitOrdner: 'eigene-projekte/mac' });
  assert.equal(r2.fahgit, null); assert.match(r2.warnung, /Lokal angelegt, aber nicht in FAH-Git/);
  assert.equal(execFileSync('git', ['-C', path.join(wurzel, 'fah-zwei'), 'rev-list', '--count', 'HEAD']).toString().trim(), '1');
  await assert.rejects(w.anlegen('fah-zwei', { fahgitOrdner: 'eigene-projekte/fx-git' }), /FX-Git|nicht erreichbar|Haupt/);
});

test('To-do-Arten: (Betreiber), (Praxistest), (optional), sonst Arbeit – nur Arbeit zählt oben', async () => {
  const { offeneArten, artLesen } = await import('../src/stand.js');
  const s = lesen('# X\n\n## Offen\n\n- [ ] Bug beheben\n- [ ] (Betreiber) Freigabe geben\n- [ ] (praxistest) Am Gerät prüfen\n- [ ] (optional) Idee\n- [x] Fertig\n');
  assert.deepEqual(s.offen.map(t => t.art), ['arbeit', 'betreiber', 'praxistest', 'optional', 'arbeit']);
  assert.equal(s.offen[1].anzeige, 'Freigabe geben');
  assert.equal(offeneZahl(s), 1);
  assert.deepEqual(offeneArten(s), { arbeit: 1, betreiber: 1, praxistest: 1, optional: 1 });
  assert.equal(artLesen('Domain anlegen (Betreiber)').art, 'arbeit');          // nur am Anfang zählt
  const { todoHinzufuegen } = await import('../src/stand.js');
  assert.match(todoHinzufuegen('# X\n\n## Offen\n\n', 'Test am iPhone', 'praxistest'), /- \[ \] \(Praxistest\) Test am iPhone/);
  assert.match(todoHinzufuegen('# X\n\n## Offen\n\n', '(Betreiber) schon markiert', 'praxistest'), /- \[ \] \(Betreiber\) schon markiert\n/);
});

test('Oberfläche: der Hauptbereich wächst mit dem Fenster (kein Breitendeckel)', async () => {
  const css = await readFile(new URL('../public/style.css', import.meta.url), 'utf8');
  // jede Regel, deren Selektor genau .haupt trifft (nicht .haupt-irgendwas)
  const regeln = [...css.matchAll(/([^{}]*)\{([^{}]*)\}/g)].filter(([, sel]) => /\.haupt(?![\w-])/.test(sel));
  assert.ok(regeln.length > 0, '.haupt-Regel gefunden');
  for (const [, sel, rumpf] of regeln) assert.doesNotMatch(rumpf, /max-width/, `.haupt ohne max-width: ${sel.trim()}`);
});

// ---------- Bilder in Aufträgen (0.14.0) ----------

/** Kleinstes gültiges PNG (1×1) – reicht für die Prüfung an den ersten Bytes. */
const PNG_1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const JPEG_KOPF = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(20)]);

// Fake-Claude für Bilder: schreibt jede Eingabezeile mit, antwortet sofort
const FAKE_BILD = `#!/usr/bin/env node
const fs = require('node:fs');
const readline = require('node:readline');
const aus = e => process.stdout.write(JSON.stringify(e) + '\\n');
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', l => {
  fs.appendFileSync(process.env.FAKE_BILD_PROTOKOLL, l + '\\n');
  aus({ type: 'system', subtype: 'init', session_id: 'bild-1', model: 'fake' });
  aus({ type: 'result', subtype: 'success', is_error: false, result: 'Bild gesehen.', session_id: 'bild-1', total_cost_usd: 0, duration_ms: 1 });
});
rl.on('close', () => process.exit(0));
`;

test('Bilder: prüfen (Art an den Bytes, Größe, Anzahl)', async () => {
  const { bilderPruefen, BildFehler, MAX_BYTES } = await import('../src/bilder.js');
  assert.deepEqual(bilderPruefen(undefined), []);
  const [b] = bilderPruefen([{ daten: PNG_1x1.toString('base64') }]);
  assert.equal(b.typ, 'image/png'); assert.equal(b.endung, 'png'); assert.ok(b.puffer.equals(PNG_1x1));
  assert.equal(bilderPruefen(['data:image/jpeg;base64,' + JPEG_KOPF.toString('base64')])[0].typ, 'image/jpeg', 'data:-URL geht auch');
  assert.equal(bilderPruefen([{ daten: Buffer.from('GIF89a......').toString('base64') }])[0].endung, 'gif');
  assert.throws(() => bilderPruefen([{ daten: Buffer.from('<svg onload=alert(1)>').toString('base64') }]), BildFehler, 'SVG/Text ist kein Bild');
  assert.throws(() => bilderPruefen([{ daten: 'kein base64 !' }]), /nicht lesbar/);
  assert.throws(() => bilderPruefen(Array(11).fill({ daten: PNG_1x1.toString('base64') })), /Höchstens 10/);
  assert.throws(() => bilderPruefen([{ daten: Buffer.concat([PNG_1x1, Buffer.alloc(MAX_BYTES)]).toString('base64') }]), /zu groß/);
  assert.throws(() => bilderPruefen('x'), /Liste/);
});

test('Bilder: Auftrag und Nachschreiben mit Bild – als Bild-Block an Claude, abgelegt, ausgeliefert, gespiegelt', async t => {
  const wurzel = await mkdtemp(path.join(os.tmpdir(), 'cockpit-bild-'));
  const vault = path.join(wurzel, 'Arbeit'), ablage = path.join(wurzel, 'ablage');
  await mkdir(path.join(vault, 'maschine', 'projekte'), { recursive: true });
  await mkdir(path.join(wurzel, 'Demo')); await mkdir(ablage);
  await writeFile(path.join(vault, 'maschine', 'projekte', 'Demo.md'), BEISPIEL);
  const fake = path.join(wurzel, 'fake-bild.cjs');
  await writeFile(fake, FAKE_BILD); await chmod(fake, 0o755);
  const protokoll = path.join(wurzel, 'eingaben.jsonl');
  process.env.FAKE_BILD_PROTOKOLL = protokoll;
  const probe = cockpit({ wurzel, vault, port: 0 });
  await new Promise(r => probe.listen(0, '127.0.0.1', r));
  const port = probe.address().port; probe.close();
  const einstellungen = new Einstellungen({ ablage, claude: fake, schluesselbund: false });
  const auftraege = new Auftraege({ ablage, wurzel, vault, port, claude: fake, einstellungen, arbeitsordner: wurzel });
  await auftraege.laden();
  const server = cockpit({ wurzel, vault, port, auftraege, einstellungen, zwischenspeicherMs: 0 });
  await new Promise(r => server.listen(port, '127.0.0.1', r));
  t.after(async () => { auftraege.beenden(); server.close(); await rm(wurzel, { recursive: true, force: true }); });
  const basis = `http://127.0.0.1:${port}`;
  const post = (weg, daten) => fetch(basis + weg, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Cockpit': '1' }, body: JSON.stringify(daten) });
  const holen = async id => (await fetch(basis + '/api/auftrag?id=' + id)).json();
  const warteBis = async (id, bed) => { for (let i = 0; i < 150; i++) { const a = await holen(id); if (bed(a)) return a; await new Promise(r => setTimeout(r, 100)); } throw new Error('Zeitüberschreitung'); };
  const eingaben = async () => (await readFile(protokoll, 'utf8')).trim().split('\n').map(z => JSON.parse(z).message.content);

  // kaputtes Bild: abgelehnt, nichts gestartet
  const kaputt = await post('/api/auftrag', { ordner: 'Demo', text: 'Schau mal', bilder: [{ daten: Buffer.from('hallo').toString('base64') }] });
  assert.equal(kaputt.status, 400);
  assert.match((await kaputt.json()).fehler, /nur PNG, JPEG, GIF oder WebP/);
  assert.equal(auftraege.liste().length, 0);

  // Auftrag mit Text und Bild
  const r = await post('/api/auftrag', { ordner: 'Demo', text: 'Die Spalte fehlt hier', bilder: [{ daten: PNG_1x1.toString('base64') }] });
  assert.equal(r.status, 200);
  const { id } = await r.json();
  let a = await warteBis(id, x => x.status === 'fertig');
  assert.deepEqual(a.verlauf[0].bilder, ['bild-01.png']);
  const datei = path.join(ablage, 'auftraege', 'bilder', id, 'bild-01.png');
  assert.ok((await readFile(datei)).equals(PNG_1x1));
  assert.equal((await stat(datei)).mode & 0o777, 0o600, 'nur für den Betreiber lesbar');
  let [erste] = await eingaben();
  assert.ok(Array.isArray(erste), 'mit Bild: Inhalt als Blöcke');
  assert.equal(erste[0].type, 'text');
  assert.match(erste[0].text, /Die Spalte fehlt hier/);
  assert.ok(erste[0].text.includes(datei), 'Pfad zur Datei steht im Text (zum Kopieren ins Projekt)');
  assert.deepEqual(erste[1], { type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG_1x1.toString('base64') } });

  // ausliefern: nur eigene Namen, mit Bildart, kein Ausbrechen
  const bild = await fetch(`${basis}/api/auftrag/bild?id=${id}&name=bild-01.png`);
  assert.equal(bild.status, 200);
  assert.equal(bild.headers.get('content-type'), 'image/png');
  assert.equal(bild.headers.get('x-content-type-options'), 'nosniff');
  assert.ok(Buffer.from(await bild.arrayBuffer()).equals(PNG_1x1));
  for (const name of ['bild-02.png', '../' + id + '.json', 'bild-01.svg', '']) {
    assert.equal((await fetch(`${basis}/api/auftrag/bild?id=${id}&name=${encodeURIComponent(name)}`)).status, 404, name);
  }
  assert.equal((await fetch(`${basis}/api/auftrag/bild?id=gibtsnicht&name=bild-01.png`)).status, 404);

  // nur ein Bild nachschreiben (ohne Text) → im selben Gespräch, als Bild-Block
  assert.equal((await post('/api/auftrag/nachricht', { id, text: '', bilder: [{ daten: JPEG_KOPF.toString('base64') }] })).status, 200);
  a = await warteBis(id, x => x.status === 'fertig' && x.runden === 2);
  const letzte = a.verlauf.filter(v => v.art === 'nutzer').pop();
  assert.deepEqual(letzte.bilder, ['bild-02.jpg']);
  assert.equal(letzte.text, '');
  const zweite = (await eingaben()).pop();
  assert.match(zweite[0].text, /^Siehe Bild\./);
  assert.equal(zweite[1].source.media_type, 'image/jpeg');
  assert.equal((await post('/api/auftrag/nachricht', { id, text: '' })).status, 400, 'weder Text noch Bild');

  // ohne Bild bleibt der Inhalt ein einfacher Text (wie bisher)
  assert.equal((await post('/api/auftrag/nachricht', { id, text: 'Danke' })).status, 200);
  await warteBis(id, x => x.status === 'fertig' && x.runden === 3);
  assert.equal((await eingaben()).pop(), 'Danke');

  // Spiegel: Verlauf verweist auf die Bilder, die Bilder liegen daneben (Byte für Byte, zweiter Lauf ändert nichts)
  const { WissenSpiegel, auftragAlsText } = await import('../src/wissen.js');
  const voll = JSON.parse(await readFile(path.join(ablage, 'auftraege', id + '.json'), 'utf8'));
  assert.match(auftragAlsText(voll), new RegExp(`!\\[Bild 1\\]\\(${id}/bild-01\\.png\\)`));
  const w = new WissenSpiegel({ wurzel, vault, auftraege: path.join(ablage, 'auftraege'), gedaechtnis: path.join(wurzel, 'mem') });
  const { soll } = await w.projektSoll('Demo', [], {});
  assert.ok(soll[`auftraege/${id}/bild-01.png`].equals(PNG_1x1));
  assert.ok(soll[`auftraege/${id}/bild-02.jpg`].equals(JPEG_KOPF));
  const ziel = path.join(wurzel, 'spiegel');
  assert.ok(await w.angleichen(ziel, soll) > 0);
  assert.ok((await readFile(path.join(ziel, 'auftraege', id, 'bild-01.png'))).equals(PNG_1x1));
  assert.equal(await w.angleichen(ziel, soll), 0, 'unverändert → nichts geschrieben');

  // Aufräumen alter Aufträge nimmt die Bilder mit
  auftraege.auftraege.get(id).erstellt = '2000-01-01T00:00:00.000Z';
  for (let i = 0; i < 200; i++) auftraege.auftraege.set('x' + i, { id: 'x' + i, erstellt: '2026-01-01T00:00:' + String(i % 60).padStart(2, '0') + '.000Z', status: 'fertig', verlauf: [], freigaben: [] });
  await auftraege.aufraeumen();
  await assert.rejects(stat(path.join(ablage, 'auftraege', 'bilder', id)));
});
