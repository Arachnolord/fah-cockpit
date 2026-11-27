// (c) 2026 Fabian Hammer - Alle Rechte vorbehalten. FAH-Cockpit – Oberfläche ohne Fremdpakete.

const haupt = document.getElementById('haupt');
let daten = null;          // letzte Übersicht
let nurMitTodos = false;
let suchtext = '';
let auftragsZahlen = { wartet: 0, laeuft: 0, schlange: 0 };
let taktTimer = null;

// ---------- Hilfen ----------

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Etwas Markdown im Fließtext: `code`, **fett**. Erst escapen, dann ersetzen. */
const md = s => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

function wann(iso) {
  if (!iso) return '–';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return esc(iso);
  const heute = new Date(); heute.setHours(0, 0, 0, 0);
  const tag = new Date(d); tag.setHours(0, 0, 0, 0);
  const t = Math.round((heute - tag) / 86_400_000);
  if (t <= 0) return 'heute ' + d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  if (t === 1) return 'gestern';
  if (t < 7) return `vor ${t} Tagen`;
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: d.getFullYear() === heute.getFullYear() ? undefined : '2-digit' });
}

const kurzDatum = iso => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }); };
const uhr = iso => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }); };

function dauer(von, bis) {
  if (!von) return '';
  const s = Math.max(0, Math.round(((bis ? new Date(bis) : new Date()) - new Date(von)) / 1000));
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.round(s / 60)} min`;
  return `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`;
}

function hinweis(text) {
  const h = document.getElementById('hinweis');
  h.textContent = text; h.hidden = false;
  clearTimeout(hinweis.t); hinweis.t = setTimeout(() => { h.hidden = true; }, 6000);
}

async function holen(url, optionen) {
  const r = await fetch(url, optionen);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.fehler || `Fehler ${r.status}`);
  return j;
}

const senden = (url, daten) => holen(url, {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Cockpit': '1' }, body: JSON.stringify(daten),
});

/** Git-Zustand als Pille: gesichert / geändert / ungepusht / ohne Upstream / ohne Git. */
function gitPille(g) {
  if (!g) return '<span class="pille">kein Git</span>';
  if (g.fehler) return '<span class="pille rot">Git-Fehler</span>';
  const teile = [];
  if (g.geaendert) teile.push(`<span class="pille gelb" title="Dateien, die nicht eingecheckt sind">${g.geaendert} geändert</span>`);
  if (g.voraus) teile.push(`<span class="pille rot" title="Commits, die noch nicht gepusht sind">${g.voraus} ungepusht</span>`);
  if (!teile.length) {
    if (!g.upstream) return '<span class="pille" title="Zweig folgt keinem Remote">ohne Upstream</span>';
    return '<span class="pille gruen">✓ gesichert</span>';
  }
  return teile.join(' ');
}

const STATUS = {
  wartend: ['blau', 'in der Schlange'], laeuft: ['gruen', 'läuft'], fertig: ['', 'fertig'],
  fehler: ['rot', 'Fehler'], abgebrochen: ['', 'abgebrochen'],
};
function statusPille(a) {
  if (a.offeneFreigaben?.length || (a.freigaben || []).some(f => f.status === 'offen')) return '<span class="pille gelb">wartet auf dich</span>';
  const [farbe, text] = STATUS[a.status] || ['', a.status];
  return `<span class="pille ${farbe}">${a.status === 'laeuft' ? '<span class="puls"></span>' : ''}${text}</span>`;
}

function punktKlasse(p) {
  if (p.status === 'ruht') return 'grau';
  if (p.git && (p.git.geaendert || p.git.voraus)) return 'gelb';
  return '';
}

const projektTitel = ordner => daten?.projekte.find(p => p.ordner === ordner)?.titel || ordner;

// ---------- Laden ----------

function zahlenZeigen() {
  const s = daten.summen;
  document.getElementById('zahl-offen').textContent = s.offen || '';
  document.getElementById('zahl-ruhend').textContent = s.ruhend || '';
  const za = document.getElementById('zahl-auftraege');
  za.textContent = s.wartet || s.laeuft || '';
  za.classList.toggle('warn', !!s.wartet);
  document.title = (s.wartet ? `(${s.wartet}) ` : '') + 'FAH-Cockpit';
  document.getElementById('fuss-stand').textContent = 'Stand ' + new Date(daten.erzeugt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

async function uebersichtLaden(frisch = false) {
  daten = await holen('/api/uebersicht' + (frisch ? '?frisch=1' : ''));
  auftragsZahlen = { wartet: daten.summen.wartet, laeuft: daten.summen.laeuft, schlange: daten.summen.schlange };
  zahlenZeigen();
  return daten;
}

// ---------- Ansichten ----------

function kopf(pfad, titel, unter, rechts = '') {
  return `<div class="pfad">${pfad}</div>
    <div class="kopf"><div style="min-width:0"><h1>${titel}</h1><div class="unterzeile">${unter}</div></div>${rechts}</div>`;
}

const heuteText = () => new Date().toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
// Aktualisiert sich selbst (siehe selbstAktualisieren); ein Klick holt trotzdem sofort frisch.
const neuLadenKnopf = '<button class="selbst" data-aktion="neu" title="Aktualisiert sich alle 30 Sekunden selbst – Klick holt sofort frisch">'
  + '<span class="selbst-punkt"></span>aktualisiert sich selbst</button>';

/** Fingerabdruck dessen, was gezeigt wird – ohne Messzeit und Auftragszahlen (die pflegt der Takt). */
const fingerabdruck = d => (d ? JSON.stringify(d.projekte) : '');
let gezeichnet = '';   // die Messzeit zeigt die Seitenleiste („Stand …“, zahlenZeigen)

function zeileHtml(p) {
  const a = p.arten || {};
  const offen = p.status === 'ruht' ? '' : (p.offen ? `<span class="pille blau" title="Offene Arbeit: ${p.offen} · deine Schritte: ${a.betreiber || 0} · Praxistests: ${a.praxistest || 0}">${p.offen}</span>`
    : (a.betreiber || a.praxistest) ? `<span class="pille" title="Keine offene Arbeit · deine Schritte: ${a.betreiber || 0} · Praxistests: ${a.praxistest || 0}">${(a.betreiber || 0) + (a.praxistest || 0)}</span>` : '');
  const stand = p.hatStand ? md(p.standKurz) : '<em>Noch keine Stand-Datei</em>';
  return `<a class="zeile" href="#/p/${encodeURIComponent(p.ordner)}">
    <span class="punkt ${punktKlasse(p)}"></span>
    <span style="min-width:0"><div class="zeile-name">${esc(p.titel)}</div><div class="zeile-stand">${stand}</div></span>
    <span class="zeile-klein spalte-version">${p.version ? esc(p.version) : '–'}</span>
    <span class="zeile-klein spalte-zeit" title="Letzter Commit">${wann(p.git?.letzterCommit?.datum)}</span>
    <span class="spalte-git">${gitPille(p.git)}</span>
    <span class="offen-zahl">${offen}</span>
  </a>`;
}

function uebersichtZeigen() {
  const s = daten.summen;
  const kachel = (wert, name, art = '', ziel = '', unter = '') => `<${ziel ? `a href="${ziel}"` : 'div'} class="kachel ${art}"><div class="kachel-wert">${wert}</div><div class="kachel-name">${name}</div>${unter ? `<div class="kachel-unter">${unter}</div>` : ''}</${ziel ? 'a' : 'div'}>`;
  haupt.innerHTML = kopf('Cockpit / Übersicht', 'Übersicht', esc(heuteText()),
    `<div class="kopf-rechts"><a class="knopf" href="#/neu">+ Neues Projekt</a>${neuLadenKnopf}</div>`) + `
    <div class="kacheln">
      ${kachel(s.projekte, 'Projekte aktiv')}
      ${kachel(s.offen, 'Offene Arbeit', s.offen ? '' : 'gut', '#/todos', `+ ${s.betreiber || 0} deine Schritte · ${s.praxistest || 0} Praxistests`)}
      ${kachel(s.wartet, 'Wartet auf dich', s.wartet ? 'warn' : 'gut', '#/auftraege')}
      ${kachel(s.geaendert, 'Nicht eingecheckt', s.geaendert ? 'warn' : 'gut')}
      ${kachel(s.ungepusht, 'Nicht gepusht', s.ungepusht ? 'warn' : 'gut')}
    </div>
    <section class="karte">
      <div class="karte-kopf">
        <div class="karte-titel">Projekte <span class="leise">sortiert nach letzter Änderung</span></div>
        <div class="werkzeuge">
          <label class="schalter"><input type="checkbox" id="nur-todos" ${nurMitTodos ? 'checked' : ''}> nur mit To-dos</label>
          <input class="suche" id="suche" type="search" placeholder="Projekt suchen …" value="${esc(suchtext)}" aria-label="Projekt suchen">
        </div>
      </div>
      <div class="liste" id="liste"></div>
    </section>`;
  listeFuellen();
  document.getElementById('suche').addEventListener('input', e => { suchtext = e.target.value; listeFuellen(); });
  document.getElementById('nur-todos').addEventListener('change', e => { nurMitTodos = e.target.checked; listeFuellen(); });
}

function listeFuellen() {
  const q = suchtext.trim().toLowerCase();
  const liste = daten.projekte
    .filter(p => p.status === 'aktiv')
    .filter(p => !nurMitTodos || p.offen > 0 || p.arten?.betreiber > 0 || p.arten?.praxistest > 0)
    .filter(p => !q || (p.titel + ' ' + p.ordner).toLowerCase().includes(q))
    .sort((a, b) => String(b.git?.letzterCommit?.datum || '').localeCompare(String(a.git?.letzterCommit?.datum || '')));
  document.getElementById('liste').innerHTML = liste.length ? liste.map(zeileHtml).join('') : '<div class="leer">Nichts gefunden.</div>';
}

const ART_PILLE = { optional: '<span class="pille lila">optional</span>', betreiber: '<span class="pille gelb" title="Dein Schritt oder deine Entscheidung">du</span>',
  praxistest: '<span class="pille blau" title="Prüfung am echten Gerät oder im Browser">Praxistest</span>' };
const ART_TITEL = { arbeit: ['Offene Arbeit', 'Das ist noch zu bauen oder zu beheben – Claude kann es mit „Erledigen“ übernehmen.'],
  betreiber: ['Deine Schritte', 'Entscheidungen, Freigaben und Handgriffe, die nur du machen kannst.'],
  praxistest: ['Praxistests', 'Am echten Gerät oder im Browser prüfen – gebaut ist es schon. Hast du es getestet, einfach abhaken.'],
  optional: ['Optional', 'Ideen und Kür – zählen nicht mit.'] };

function todoHtml(ordner, t, mitKnopf = true) {
  const art = t.art || (t.optional ? 'optional' : 'arbeit');
  const opt = ART_PILLE[art] || '';
  const text = t.anzeige ?? t.text.replace(/^\((optional|praxistest|betreiber)\)\s*/i, '');
  const knopf = mitKnopf && !t.erledigt && (art === 'arbeit' || art === 'optional') && daten?.auftraegeAn
    ? `<button class="knopf mini" data-aktion="erledigen" data-ordner="${esc(ordner)}" data-zeile="${t.zeile}" data-text="${esc(t.text)}" title="Claude erledigt das im Hintergrund">Erledigen</button>` : '';
  return `<li class="todo ${t.erledigt ? 'erledigt' : ''}">
    <input type="checkbox" ${t.erledigt ? 'checked' : ''} data-ordner="${esc(ordner)}" data-zeile="${t.zeile}" data-text="${esc(t.text)}" aria-label="Erledigt">
    <span class="todo-text">${md(text)}${opt}</span>${knopf}</li>`;
}

async function todosZeigen() {
  const s = daten.summen;
  const mitTodos = daten.projekte.filter(p => p.status === 'aktiv' && Object.values(p.arten || {}).some(Boolean));
  haupt.innerHTML = kopf('Cockpit / Offene To-dos', 'Offene To-dos',
    `${s.offen} offene Arbeit · ${s.betreiber || 0} deine Schritte · ${s.praxistest || 0} Praxistests · ${s.optional || 0} optional`, neuLadenKnopf)
    + `<div class="netz-filter todo-sprung">${['arbeit', 'betreiber', 'praxistest', 'optional'].map(a => `<a class="pille" href="#/todos" data-sprung="art-${a}">${ART_TITEL[a][0]}</a>`).join('')}</div>`
    + '<div id="gruppen"><div class="leer">Lädt …</div></div>';
  const details = (await Promise.all(mitTodos.map(p => holen('/api/projekt?ordner=' + encodeURIComponent(p.ordner)).catch(() => null)))).filter(Boolean);
  const html = ['arbeit', 'betreiber', 'praxistest', 'optional'].map(art => {
    const gruppen = details.map(d => ({ d, todos: d.todos.filter(t => !t.erledigt && (t.art || 'arbeit') === art) })).filter(g => g.todos.length)
      .sort((a, b) => b.todos.length - a.todos.length);
    const zahl = gruppen.reduce((n, g) => n + g.todos.length, 0);
    return `<h2 class="art-titel" id="art-${art}">${ART_TITEL[art][0]} <span class="leise">${zahl}</span></h2><p class="info art-info">${ART_TITEL[art][1]}</p>`
      + (gruppen.length ? gruppen.map(({ d, todos }) => `<section class="karte gruppe">
      <div class="karte-kopf"><a class="karte-titel" href="#/p/${encodeURIComponent(d.ordner)}">${esc(d.titel)} <span class="leise">${todos.length}</span></a>${gitPille(d.git)}</div>
      <ul class="todos">${todos.map(t => todoHtml(d.ordner, t)).join('')}</ul></section>`).join('') : '<section class="karte"><div class="leer">Nichts.</div></section>');
  }).join('');
  document.getElementById('gruppen').innerHTML = html;
}

function ruhendZeigen() {
  const liste = daten.projekte.filter(p => p.status === 'ruht');
  haupt.innerHTML = kopf('Cockpit / Ruhend', 'Ruhend', 'Abgebaut, ersetzt oder pausiert – keine Erinnerungen', neuLadenKnopf) +
    `<section class="karte"><div class="liste">${liste.length ? liste.map(zeileHtml).join('') : '<div class="leer">Nichts ruht.</div>'}</div></section>`;
}

const MODELL_TEXT = {
  '': 'wie in Claude Code (empfohlen)', fable: 'Fable 5.2 – neuestes Modell', opus: 'Opus 5.5 – stark bei Code und schwierigen Aufgaben',
  sonnet: 'Sonnet 5.5 – schneller und günstiger', haiku: 'Haiku 5.5 – Kleinigkeiten, am schnellsten',
};
const AUFWAND_TEXT = {
  '': 'wie in Claude Code (empfohlen)', low: 'low – schnell, wenig Nachdenken', medium: 'medium – ausgewogen',
  high: 'high – gründlicher', xhigh: 'xhigh – sehr gründlich, langsamer', max: 'max – am gründlichsten, langsam, teuer',
};
const auswahl = (name, texte, wert = '', vorne = '') => `<select class="auswahl" name="${name}" aria-label="${name}">${Object.entries(texte)
  .map(([k, t]) => `<option value="${k}" ${k === wert ? 'selected' : ''}>${vorne}${esc(k === '' && name !== 'anmeldung' ? 'Standard aus den Einstellungen' : t)}</option>`).join('')}</select>`;
const MODELL_WAHL = () => auswahl('modell', MODELL_TEXT, '', 'Modell: ') + auswahl('aufwand', AUFWAND_TEXT, '', 'Aufwand: ');

function auftragZeileHtml(a, mitProjekt = true) {
  return `<a class="auftrag-zeile" href="#/a/${encodeURIComponent(a.id)}">
    <span style="min-width:0">
      <div class="zeile-name">${esc(a.titel || '(ohne Titel)')}</div>
      <div class="zeile-stand">${mitProjekt ? esc(projektTitel(a.ordner)) + ' · ' : ''}${wann(a.erstellt)}${a.status === 'laeuft' ? ' · ' + dauer(a.gestartet) : ''}${a.inSchlange ? ` · Platz ${a.inSchlange}` : ''}</div>
    </span>
    ${statusPille(a)}</a>`;
}

async function projektZeigen(ordner) {
  haupt.innerHTML = '<div class="leer">Lädt …</div>';
  const d = await holen('/api/projekt?ordner=' + encodeURIComponent(ordner));
  const g = d.git;
  const offen = d.todos.filter(t => !t.erledigt).length;
  const gitFakten = !g ? '<dd>kein Git-Repository</dd>' : g.fehler ? '<dd>Git-Fehler</dd>' : `
      <dt>Zustand</dt><dd>${gitPille(g)}</dd>
      <dt>Zweig</dt><dd>${esc(g.zweig || '–')}</dd>
      <dt>Folgt</dt><dd>${esc(g.upstream || '–')}</dd>
      <dt>Remotes</dt><dd>${esc(g.remotes.join(', ') || '–')}${g.fahGit ? ' <span class="pille gruen">FAH-Git</span>' : ''}</dd>
      ${g.zurueck ? `<dt>Zurück</dt><dd>${g.zurueck} Commits</dd>` : ''}`;
  const auftragKarte = daten?.auftraegeAn ? `
        <section class="karte">
          <div class="karte-kopf"><div class="karte-titel">Auftrag an Claude <span class="leise">läuft im Hintergrund, Riskantes wartet auf dein Ja</span></div></div>
          <form class="auftrag-form" data-ordner="${esc(d.ordner)}">
            <textarea name="text" rows="3" placeholder="Was soll Claude in diesem Projekt tun? Bilder: ⌘V oder hineinziehen" aria-label="Anweisung an Claude" data-bilder></textarea>
            ${anhangLeiste('a:' + d.ordner)}
            <div class="form-zeile">${MODELL_WAHL()}
              <label class="schalter" title="Claude fragt in diesem Auftrag nie nach – auch nicht bei Push, Deploy oder ssh."><input type="checkbox" name="alles"> ohne Rückfrage</label>
              <span class="knoepfe">${BILD_KNOPF}<button class="knopf" type="submit">Starten</button></span></div>
          </form>
          ${d.auftraege.length ? `<div class="liste" style="margin-top:12px">${d.auftraege.map(a => auftragZeileHtml(a, false)).join('')}</div>` : ''}
        </section>` : '';
  haupt.innerHTML = kopf(`<a href="#/">Cockpit</a> / Projekte / ${esc(d.titel)}`, esc(d.titel),
    `~/claude/${esc(d.ordner)}${d.version ? ' · Version ' + esc(d.version) : ''}${d.aktualisiert ? ' · Stand vom ' + esc(d.aktualisiert) : ''}`,
    `<div class="werkzeuge">${d.hatStand ? `<a class="knopf leise" href="#/bearbeiten/${encodeURIComponent(d.standDatei)}">Stand bearbeiten</a>` : ''}<a class="knopf leise" href="#/netz/${encodeURIComponent('p:' + d.ordner)}">Im Wissensnetz</a></div>`) + `
    <div class="raster">
      <div>
        <section class="karte">
          <div class="karte-kopf"><div class="karte-titel">Stand ${d.status === 'ruht' ? '<span class="pille">ruht</span>' : ''}</div>
            ${d.quelle ? `<span class="zeile-klein">Quelle: ${esc(d.quelle)}</span>` : ''}</div>
          ${d.hatStand ? `<p class="stand-text">${md(d.stand) || '<em>Kein Text</em>'}</p>`
            : `<p class="stand-text"><em>Für dieses Projekt gibt es noch keine Stand-Datei.</em> Claude legt sie bei der nächsten Arbeit am Projekt an.</p>`}
        </section>
        <section class="karte">
          <div class="karte-kopf"><div class="karte-titel">Offen <span class="leise">${d.offen} Arbeit · ${d.arten?.betreiber || 0} deine Schritte · ${d.arten?.praxistest || 0} Praxistests${d.arten?.optional ? ' · ' + d.arten.optional + ' optional' : ''}</span></div></div>
          ${d.todos.length ? `<ul class="todos">${d.todos.map(t => todoHtml(d.ordner, t)).join('')}</ul>` : '<div class="leer">Keine offenen To-dos.</div>'}
          ${d.hatStand ? `<form class="todo-form" data-ordner="${esc(d.ordner)}"><input class="suche" name="todo" placeholder="Neues To-do … (Enter)" aria-label="Neues To-do">
            <select class="auswahl" name="art" aria-label="Art"><option value="arbeit">Arbeit</option><option value="betreiber">Mein Schritt</option><option value="praxistest">Praxistest</option><option value="optional">optional</option></select></form>` : ''}
          ${d.erledigt.length ? `<details style="margin-top:10px"><summary>Erledigt (${d.erledigt.length})</summary>
            <ul class="todos">${d.erledigt.map(t => `<li class="todo erledigt"><span class="todo-text">${md(t.text)}</span></li>`).join('')}</ul></details>` : ''}
        </section>
        ${auftragKarte}
      </div>
      <div>
        <section class="karte">
          <div class="karte-kopf"><div class="karte-titel">Git</div></div>
          <dl class="fakten">${gitFakten}</dl>
        </section>
        <section class="karte">
          <div class="karte-kopf"><div class="karte-titel">Letzte Änderungen</div></div>
          ${d.commits.length ? `<ul class="commits">${d.commits.map(c => `<li><span class="datum">${kurzDatum(c.datum)}</span><span>${esc(c.betreff)}</span></li>`).join('')}</ul>`
            : '<div class="leer">Keine Commits.</div>'}
        </section>
      </div>
    </div>`;
}

// ---------- Aufträge ----------

function freigabeKarte(auftragId, f) {
  return `<div class="freigabe" data-auftrag="${esc(auftragId)}" data-freigabe="${esc(f.id)}">
    <div class="freigabe-kopf"><span class="pille gelb">Wartet auf dein Ja</span><span class="zeile-klein">${esc(f.werkzeug)} · ${uhr(f.zeit)}</span></div>
    <pre class="freigabe-befehl">${esc(f.voll || f.kurz)}</pre>
    ${f.begruendung ? `<div class="freigabe-grund">„${esc(f.begruendung)}“</div>` : ''}
    <div class="zeile-klein">Warum gefragt: ${esc(f.warum)}${f.immerFragen ? ' – fragt auch bei „Alles erlauben“' : ''}</div>
    <div class="freigabe-knoepfe">
      <input class="suche" name="antwort" placeholder="Begründung bei Ablehnung (optional)" aria-label="Begründung">
      <button class="knopf leise" data-aktion="ablehnen">Ablehnen</button>
      <button class="knopf leise" data-aktion="immer" title="Ab jetzt läuft in diesem Auftrag alles ohne Rückfrage – auch Push, Deploy und ssh. Zurück mit „Wieder fragen“.">Alles erlauben (dieser Auftrag)</button>
      <button class="knopf" data-aktion="erlauben">Erlauben</button>
    </div></div>`;
}

async function auftraegeZeigen() {
  const r = await holen('/api/auftraege');
  const offen = r.auftraege.filter(a => a.offeneFreigaben.length);
  const aktiv = r.auftraege.filter(a => !a.offeneFreigaben.length && (a.status === 'laeuft' || a.status === 'wartend'));
  const rest = r.auftraege.filter(a => a.status !== 'laeuft' && a.status !== 'wartend' && !a.offeneFreigaben.length);
  const unter = r.wartet ? `${r.wartet} wartet auf dein Ja` : r.laeuft ? 'Claude arbeitet' : 'Nichts läuft gerade';
  haupt.innerHTML = kopf('Cockpit / Aufträge', 'Aufträge', esc(unter), neuLadenKnopf) + `
    ${offen.map(a => `<section class="karte">
        <div class="karte-kopf"><a class="karte-titel" href="#/a/${encodeURIComponent(a.id)}">${esc(a.titel)} <span class="leise">${esc(projektTitel(a.ordner))}</span></a>${statusPille(a)}</div>
        ${a.offeneFreigaben.map(f => freigabeKarte(a.id, f)).join('')}</section>`).join('')}
    <section class="karte">
      <div class="karte-kopf"><div class="karte-titel">Läuft und in der Schlange</div></div>
      ${aktiv.length ? `<div class="liste">${aktiv.map(a => auftragZeileHtml(a)).join('')}</div>` : '<div class="leer">Nichts. Starte einen Auftrag auf einer Projektseite oder mit „Erledigen“ bei einem To-do.</div>'}
    </section>
    <section class="karte">
      <div class="karte-kopf"><div class="karte-titel">Erledigt <span class="leise">die letzten ${Math.min(rest.length, 50)}</span></div></div>
      ${rest.length ? `<div class="liste">${rest.slice(0, 50).map(a => auftragZeileHtml(a)).join('')}</div>` : '<div class="leer">Noch keine.</div>'}
    </section>`;
}

function verlaufHtml(a) {
  const freigaben = Object.fromEntries((a.freigaben || []).map(f => [f.id, f]));
  const ent = a.entscheidungen || {};
  // Claudes letzter Text ist meist wörtlich das Ergebnis – dann nur das Ergebnis zeigen.
  const doppelt = new Set();
  a.verlauf.forEach((v, i) => {
    if (v.art !== 'ergebnis') return;
    for (let k = i - 1; k >= 0 && a.verlauf[k].art !== 'nutzer'; k--) {
      if (a.verlauf[k].art === 'text' && a.verlauf[k].text.trim() === v.text.trim()) { doppelt.add(k); break; }
    }
  });
  return a.verlauf.map((v, i) => {
    if (doppelt.has(i)) return '';
    const u = v.unter ? ' unter' : '';
    if (v.art === 'nutzer') {
      const bilder = v.bilder?.length ? `<div class="v-bilder">${v.bilder.map((n, k) => `<img src="/api/auftrag/bild?id=${encodeURIComponent(a.id)}&amp;name=${encodeURIComponent(n)}" alt="Bild ${k + 1}" data-gross>`).join('')}</div>` : '';
      return `<div class="v-nutzer">${bilder}${v.text || !bilder ? `<div class="v-blase">${md(v.text)}</div>` : ''}<div class="v-zeit">${uhr(v.zeit)}</div></div>`;
    }
    if (v.art === 'text') return `<div class="v-text${u}">${md(v.text)}</div>`;
    if (v.art === 'werkzeug') {
      const e = ent[v.id];
      const laeuftNoch = !v.ende && (a.status === 'laeuft');
      const zeit = laeuftNoch ? `<span class="v-uhr" data-seit="${esc(v.start || v.zeit)}">⏳</span>`
        : (v.start && v.ende ? `<span class="v-dauer">${dauer(v.start, v.ende)}</span>` : '');
      const aus = v.ausgabe && v.ausgabe.trim() ? `<details class="v-aus" data-id="${esc(v.id)}"><summary>Ausgabe</summary><pre>${esc(v.ausgabe)}</pre></details>` : '';
      const marke = e === 'auto' ? '' : e === 'alles' ? '<span class="pille">alles erlaubt</span>' : e === 'erlaubt' ? '<span class="pille gruen">von dir erlaubt</span>'
        : e === 'abgelehnt' ? '<span class="pille rot">abgelehnt</span>' : '';
      return `<div class="v-werkzeug${u} ${v.fehler ? 'fehler' : ''} ${laeuftNoch ? 'aktiv' : ''}"><span class="v-name">${esc(v.name)}</span><code>${esc(v.kurz)}</code>${zeit}${marke}${v.fehler ? `<div class="v-fehler">${esc(v.fehlerText)}</div>` : ''}${aus}</div>`;
    }
    if (v.art === 'freigabe') {
      const f = freigaben[v.freigabe];
      if (!f) return '';
      if (f.status === 'offen') return freigabeKarte(a.id, f);
      const t = { erlaubt: 'erlaubt', abgelehnt: 'abgelehnt', verfallen: 'verfallen' }[f.status] || f.status;
      return `<div class="v-hinweis">Freigabe ${t}${f.immer ? ' – und ab da alles erlaubt' : ''}: <code>${esc(f.kurz.slice(0, 120))}</code>${f.antwort ? ' – „' + esc(f.antwort) + '“' : ''}</div>`;
    }
    if (v.art === 'ergebnis') return `<div class="v-ergebnis ${v.fehler ? 'fehler' : ''}"><div class="v-ergebnis-kopf">Ergebnis${v.dauerMs ? ' · ' + Math.round(v.dauerMs / 1000) + ' s' : ''}</div>${md(v.text) || '<em>leer</em>'}</div>`;
    return `<div class="v-hinweis">${uhr(v.zeit)} · ${esc(v.text)}</div>`;
  }).join('') + (a.liveText ? `<div class="v-text live">${md(a.liveText)}<span class="cursor">▍</span></div>` : '');
}

const LIVE_TEXT = { denkt: 'denkt nach', schreibt: 'schreibt', plant: 'bereitet einen Schritt vor', werkzeug: 'führt aus', wartet: 'wartet auf dein Ja' };
function jetztHtml(a) {
  if (a.status === 'wartend') return `<div class="jetzt"><span class="pille blau">in der Schlange${a.inSchlange ? ' · Platz ' + a.inSchlange : ''}</span></div>`;
  if (a.status !== 'laeuft') return '';
  const l = a.live || { art: 'denkt', seit: a.gestartet };
  const was = l.art === 'werkzeug' || l.art === 'wartet' || l.art === 'plant' ? `<span class="v-name">${esc(l.name || '')}</span>${l.kurz ? `<code>${esc(l.kurz)}</code>` : ''}` : '';
  return `<div class="jetzt ${l.art === 'wartet' ? 'warten' : ''}"><span class="spinner"></span><span class="jetzt-was">${l.unter ? 'Helfer ' : 'Claude '}${LIVE_TEXT[l.art] || l.art}</span>${was}<span class="v-uhr" data-seit="${esc(l.seit || a.gestartet)}"></span></div>`;
}

async function auftragZeigen(id) {
  const a = await holen('/api/auftrag?id=' + encodeURIComponent(id));
  const kennung = String(a.version || 0) + a.status + (a.freigaben || []).map(f => f.status).join();
  if (haupt.dataset.auftrag === id && haupt.dataset.version === kennung) return;
  const offen = new Set([...haupt.querySelectorAll('details.v-aus[open]')].map(d => d.dataset.id));
  const laeuft = a.status === 'laeuft' || a.status === 'wartend';
  const gleich = haupt.dataset.auftrag === id;                 // derselbe Auftrag wird nur aktualisiert
  const sicht = gleich ? document.getElementById('verlauf') : null;
  // Scrollstand merken: ganz unten → unten bleiben (neue Schritte folgen), sonst genau dort bleiben (z. B. nach „Ausgabe“ aufklappen)
  const amEnde = sicht ? sicht.scrollTop + sicht.clientHeight >= sicht.scrollHeight - 40 : true;
  const verlaufY = sicht ? sicht.scrollTop : 0, fensterY = window.scrollY;
  const verlaufNeu = ziel => {
    for (const d of ziel.querySelectorAll('details.v-aus')) if (offen.has(d.dataset.id)) d.open = true;
    ziel.scrollTop = amEnde ? ziel.scrollHeight : verlaufY;
  };
  // Derselbe Auftrag, gleicher Zustand (Status, Freigaben, „alles erlaubt“): nur Verlauf, „Jetzt“ und Kopfzeile tauschen –
  // die Seite bleibt stehen, Eingaben und Scrollstand bleiben erhalten.
  const struktur = a.status + (a.freigaben || []).map(f => f.status).join() + (a.allesErlaubt ? '1' : '0');
  const eingabe = ['TEXTAREA', 'INPUT', 'SELECT'].includes(document.activeElement?.tagName);
  const tipptDraussen = eingabe && sicht && !sicht.contains(document.activeElement);      // z. B. Nachricht an Claude: nie zerstören
  if (sicht && (haupt.dataset.struktur === struktur || tipptDraussen)) {
    if (!eingabe || tipptDraussen) {
      sicht.innerHTML = verlaufHtml(a);
      verlaufNeu(sicht);
      const j = document.getElementById('jetzt-ort'); if (j) j.innerHTML = jetztHtml(a);
      const u = haupt.querySelector('.unterzeile'); if (u) u.innerHTML = auftragUnter(a, laeuft);
      haupt.dataset.version = kennung;
      uhrenStellen();
    }
    return;
  }
  haupt.dataset.auftrag = id;
  haupt.dataset.version = kennung;
  haupt.dataset.struktur = struktur;
  haupt.innerHTML = kopf(`<a href="#/">Cockpit</a> / <a href="#/auftraege">Aufträge</a>`, `<span class="titel-lang">${esc(a.titel)}</span>`,
    auftragUnter(a, laeuft),
    `<div class="werkzeuge">${a.allesErlaubt
        ? '<span class="pille gelb" title="Claude fragt in diesem Auftrag nicht nach">alles erlaubt</span><button class="knopf leise" data-aktion="fragen">Wieder fragen</button>'
        : '<button class="knopf leise" data-aktion="alles" title="Ab jetzt läuft in diesem Auftrag alles ohne Rückfrage">Alles erlauben</button>'}
      ${laeuft ? '<button class="knopf leise" data-aktion="abbrechen">Abbrechen</button>' : ''}</div>`) + `
    <div id="jetzt-ort">${jetztHtml(a)}</div>
    <section class="karte"><div class="verlauf" id="verlauf">${verlaufHtml(a)}</div></section>
    <section class="karte">
      <form class="nachricht-form" data-id="${esc(a.id)}">
        <textarea name="text" rows="2" placeholder="${laeuft ? 'Nachricht an Claude – kommt sofort an, auch während es arbeitet …' : 'Nachschreiben: Antwort, Korrektur oder nächster Schritt …'}" ${!laeuft && !a.sitzung ? 'disabled' : ''} aria-label="Nachricht an Claude" data-bilder></textarea>
        ${anhangLeiste('n:' + a.id)}
        <div class="form-zeile"><span class="zeile-klein">${laeuft ? 'Wie in Claude Code: Claude liest deine Nachricht beim nächsten Schritt.' : a.sitzung ? 'Claude macht im selben Gespräch weiter.' : ''}${laeuft || a.sitzung ? ' Bilder: ⌘V, hineinziehen oder „Bild …“.' : ''}</span>
          <span class="knoepfe">${laeuft || a.sitzung ? BILD_KNOPF : ''}<button class="knopf" type="submit" ${!laeuft && !a.sitzung ? 'disabled' : ''}>Senden</button></span></div>
      </form>
    </section>`;
  verlaufNeu(document.getElementById('verlauf'));
  if (gleich) window.scrollTo(0, fensterY);                    // neu aufgebaut, aber das Fenster springt nicht
  uhrenStellen();
}

function auftragUnter(a, laeuft) {
  return `<a href="#/p/${encodeURIComponent(a.ordner)}">${esc(projektTitel(a.ordner))}</a> · ${statusPille(a)} · gestartet ${wann(a.gestartet || a.erstellt)}${a.beendet ? ' · Dauer ' + dauer(a.gestartet, a.beendet) : laeuft && a.gestartet ? ' · seit ' + dauer(a.gestartet) : ''}${a.kosten ? ` · ≈ ${a.kosten.toFixed(2)} $ (API-Preis)` : ''}${a.modellEcht ? ' · ' + esc(a.modellEcht) : ''}`;
}

// ---------- Bilder einfügen (wie im Terminal: ⌘V, hineinziehen oder „Bild …“) ----------

const ANHANG_MAX = 10;             // je Nachricht (wie der Server)
const ANHANG_KANTE = 2000;         // lange Kante: mehr Pixel nutzt Claude nicht, die Anfrage bleibt klein
const ANHANG_BYTES = 1_500_000;    // je Bild: der ganze Verlauf geht bei jedem Weitermachen mit (Claude-API: 32 MB je Anfrage)
const ANHANG_SUMME = 12_000_000;   // je Nachricht (wie der Server)
const anhaenge = new Map();        // Formular → [{ daten (base64), url (data:) }] – überlebt das Neuzeichnen der Seite
const inArbeit = new Map();        // Formular → Zahl der Bilder, die gerade vorbereitet werden
let neuKnopfText = () => {};

/** Schlüssel des Formulars, in dem Bilder erlaubt sind (sonst null). */
function anhangSchluessel(f) {
  if (!f?.querySelector?.('textarea[data-bilder]:not(:disabled)')) return null;
  if (f.classList.contains('nachricht-form')) return 'n:' + f.dataset.id;
  if (f.classList.contains('auftrag-form')) return 'a:' + f.dataset.ordner;
  if (f.classList.contains('projekt-neu-form')) return 'neu';
  return null;
}

const BILD_KNOPF = '<label class="knopf leise bild-knopf" title="Bilder anhängen – oder mit ⌘V einfügen bzw. hineinziehen">Bild …<input type="file" accept="image/*" multiple hidden data-bild-wahl></label>';

function anhangLeiste(schluessel) {
  const liste = anhaenge.get(schluessel) || [];
  return `<div class="anhaenge" data-anhaenge="${esc(schluessel)}">${liste.map((b, i) => `<span class="anhang"><img src="${b.url}" alt="Bild ${i + 1}" data-gross>`
    + `<button type="button" class="anhang-weg" data-anhang-weg="${i}" title="Bild entfernen" aria-label="Bild ${i + 1} entfernen">×</button></span>`).join('')}</div>`;
}

function anhangZeichnen(schluessel) {
  for (const el of document.querySelectorAll('[data-anhaenge]')) if (el.dataset.anhaenge === schluessel) el.outerHTML = anhangLeiste(schluessel);
  if (schluessel === 'neu') neuKnopfText();
}

const alsDataUrl = blob => new Promise((ok, nein) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = () => nein(r.error); r.readAsDataURL(blob); });
const ladeBild = url => new Promise((ok, nein) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => nein(new Error('Dieses Bild lässt sich nicht lesen.')); i.src = url; });

/** Große Bildschirmfotos verkleinern, fremde Formate (HEIC, TIFF …) in PNG umwandeln. */
async function bildVorbereiten(datei) {
  const roh = await alsDataUrl(datei);
  const img = await ladeBild(roh);
  const kante = Math.max(img.naturalWidth, img.naturalHeight) || 1;
  if (['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(datei.type) && kante <= ANHANG_KANTE && datei.size <= ANHANG_BYTES) {
    return { daten: roh.slice(roh.indexOf(',') + 1), url: roh };
  }
  const f = Math.min(1, ANHANG_KANTE / kante);
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.naturalWidth * f)); c.height = Math.max(1, Math.round(img.naturalHeight * f));
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0, c.width, c.height);
  let blob = await new Promise(ok => c.toBlob(ok, 'image/png'));
  if (!blob || blob.size > ANHANG_BYTES) {                     // Fotos: als JPEG (auf Weiß, ohne Transparenz)
    g.globalCompositeOperation = 'destination-over'; g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    for (const q of [0.85, 0.7, 0.55]) { blob = await new Promise(ok => c.toBlob(ok, 'image/jpeg', q)); if (blob && blob.size <= ANHANG_BYTES) break; }
  }
  if (!blob || blob.size > ANHANG_BYTES) throw new Error('Das Bild ist zu groß.');
  const url = await alsDataUrl(blob);
  return { daten: url.slice(url.indexOf(',') + 1), url };
}

async function bilderDazu(form, dateien) {
  const schluessel = anhangSchluessel(form);
  if (!schluessel) return;
  const bilder = [...dateien].filter(d => d.type.startsWith('image/') || /\.(png|jpe?g|gif|webp|heic|tiff?)$/i.test(d.name || ''));
  if (!bilder.length) { hinweis('Nur Bilder lassen sich anhängen.'); return; }
  // immer die aktuelle Liste nehmen: Nach dem Senden wird sie ersetzt, ein später fertiges Bild ginge sonst verloren
  const liste = () => { if (!anhaenge.has(schluessel)) anhaenge.set(schluessel, []); return anhaenge.get(schluessel); };
  inArbeit.set(schluessel, (inArbeit.get(schluessel) || 0) + 1);
  try {
    for (const d of bilder) {
      if (liste().length >= ANHANG_MAX) { hinweis(`Höchstens ${ANHANG_MAX} Bilder je Nachricht.`); break; }
      let b;
      try { b = await bildVorbereiten(d); } catch (err) { hinweis(err.message); continue; }
      const summe = liste().reduce((n, x) => n + x.daten.length * 0.75, 0);
      if (summe + b.daten.length * 0.75 > ANHANG_SUMME) { hinweis('Zusammen zu groß – höchstens 12 MB Bilder je Nachricht.'); break; }
      liste().push(b);
      anhangZeichnen(schluessel);
    }
  } finally {
    inArbeit.set(schluessel, inArbeit.get(schluessel) - 1);
    anhangZeichnen(schluessel);
  }
}

/** Nach dem Senden nur die gesendeten Bilder entfernen (später dazugekommene bleiben). */
function anhaengeGesendet(schluessel, gesendet) {
  const rest = (anhaenge.get(schluessel) || []).filter(b => !gesendet.includes(b));
  if (rest.length) anhaenge.set(schluessel, rest); else anhaenge.delete(schluessel);
  anhangZeichnen(schluessel);
}

/** Bild in groß über der Seite – Klick oder Esc schließt. */
function bildGross(src) {
  document.querySelector('.bildansicht')?.remove();
  const o = document.createElement('div');
  o.className = 'bildansicht';
  o.innerHTML = `<img src="${esc(src)}" alt="Bild in groß">`;
  o.addEventListener('click', () => o.remove());
  document.body.appendChild(o);
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') document.querySelector('.bildansicht')?.remove(); });

// ⌘V: Bilder aus der Zwischenablage (Bildschirmfoto, kopiertes Bild, im Finder kopierte Bilddatei) – Text wie immer
haupt.addEventListener('paste', e => {
  if (!e.target.matches?.('textarea[data-bilder]')) return;
  const dateien = [...(e.clipboardData?.files || [])];
  if (!dateien.length) for (const it of e.clipboardData?.items || []) if (it.kind === 'file') { const d = it.getAsFile(); if (d) dateien.push(d); }
  if (!dateien.some(d => d.type.startsWith('image/'))) return;
  // Echter Text dabei (Tabelle aus Excel/Numbers, Absatz aus Word …) → wie immer Text einfügen. Nur Dateinamen
  // (im Finder kopierte Bilder) zählen nicht als Text.
  const text = (e.clipboardData.getData('text/plain') || '').trim();
  const namen = new Set(dateien.map(d => d.name));
  if (text && !text.split(/\r?\n/).every(z => namen.has(z.trim()) || /\.(png|jpe?g|gif|webp|heic|tiff?)$/i.test(z.trim()))) return;
  e.preventDefault();
  bilderDazu(e.target.closest('form'), dateien);
});

// Hineinziehen: auf ein Formular mit Bildfeld; anderswo nichts tun (sonst öffnete das Fenster die Datei)
const ziehtDateien = e => [...(e.dataTransfer?.types || [])].includes('Files');
const ziehZiel = e => { const f = e.target.closest?.('form'); return anhangSchluessel(f) ? f : null; };
const ziehAus = () => { for (const x of document.querySelectorAll('form.zieht')) x.classList.remove('zieht'); };
document.addEventListener('dragover', e => {
  if (!ziehtDateien(e)) return;
  e.preventDefault();
  const f = ziehZiel(e);
  e.dataTransfer.dropEffect = f ? 'copy' : 'none';
  for (const x of document.querySelectorAll('form.zieht')) if (x !== f) x.classList.remove('zieht');
  f?.classList.add('zieht');
});
document.addEventListener('dragleave', e => { if (!e.relatedTarget) ziehAus(); });
document.addEventListener('drop', e => {
  if (!ziehtDateien(e)) return;
  e.preventDefault();
  ziehAus();
  const f = ziehZiel(e);
  if (f) bilderDazu(f, e.dataTransfer.files);
});
haupt.addEventListener('change', e => {
  if (!e.target.matches?.('[data-bild-wahl]')) return;
  bilderDazu(e.target.closest('form'), e.target.files).finally(() => { e.target.value = ''; });
});

// ---------- Neues Projekt ----------

const kurzname = t => String(t || '').toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50);

async function neuZeigen() {
  const o = await holen('/api/projekt/neu');
  const ordnerWahl = o.fahgit.ordner.map(p => `<option value="${esc(p)}" ${p === o.standardOrdner ? 'selected' : ''}>${esc(p)}</option>`).join('')
    || `<option value="${esc(o.standardOrdner)}">${esc(o.standardOrdner)}</option>`;
  haupt.innerHTML = kopf('<a href="#/">Cockpit</a> / Neues Projekt', 'Neues Projekt', `Legt den Ordner unter <code>${esc(o.wurzel)}</code> an – mit Git, Stand-Datei${o.fahgit.verbunden ? ' und gleich in FAH-Git' : ''}`) + `
    <section class="karte neu-karte">
      <form class="projekt-neu-form" data-vorsilbe="${esc(o.vorsilbe)}">
        <div class="feldzeile"><span class="feldname">Name</span><input class="suche feld" name="titel" required placeholder="z. B. Kopfhörer-Wächter" autofocus></div>
        <div class="feldzeile"><span class="feldname">Ordner</span><input class="suche feld" name="ordner" required placeholder="${esc(o.vorsilbe)}kopfhoerer-waechter" pattern="[A-Za-z0-9][A-Za-z0-9._\-]{0,63}"></div>
        <div class="feldzeile oben"><span class="feldname">Worum geht's</span><textarea name="beschreibung" rows="3" placeholder="Ein, zwei Sätze – landen in README, CLAUDE.md und im Stand"></textarea></div>
        <div class="feldzeile oben"><span class="feldname">Erste To-dos</span><textarea name="todos" rows="4" placeholder="Ein To-do je Zeile"></textarea></div>
        ${o.fahgit.verbunden ? `<div class="feldzeile"><span class="feldname">FAH-Git</span>
          <label class="schalter"><input type="checkbox" name="inFahgit" checked> anlegen unter</label>
          <select class="auswahl" name="fahgitOrdner">${ordnerWahl}</select></div>`
        : '<p class="info">FAH-Git ist nicht verbunden – das Projekt entsteht nur lokal (später unter Einstellungen → Wissen „In FAH-Git anlegen“).</p>'}
        <div class="neu-ki">
          <div class="karte-titel">Von Claude bauen lassen <span class="leise">optional – wie im Chat: beschreib, was entstehen soll</span></div>
          <textarea name="bauen" rows="6" placeholder="z. B. Eine kleine Mac-App in der Menüleiste, die den Akkustand meiner AirPods zeigt und bei 15 % warnt. Swift, ohne Fremdpakete, mit Icon … (Skizzen oder Vorbilder: ⌘V oder hineinziehen)" data-bilder></textarea>
          ${anhangLeiste('neu')}
          <div class="form-zeile">${MODELL_WAHL()}
            <label class="schalter" title="Claude fragt in diesem Auftrag nie nach – auch nicht bei Push, Deploy oder ssh."><input type="checkbox" name="alles"> ohne Rückfrage</label>${BILD_KNOPF}</div>
          <p class="info">Nach dem Anlegen startet Claude sofort im neuen Projekt; du landest in der Live-Ansicht, kannst mitschreiben, nachfragen und Schritte freigeben. Ist etwas unklar, fragt Claude am Ende nach – deine Antwort setzt das Gespräch fort.</p>
        </div>
        <div class="form-zeile"><span class="info"></span>
          <button class="knopf" type="submit">Projekt anlegen</button></div>
      </form>
    </section>`;
  const f = haupt.querySelector('.projekt-neu-form'), titel = f.querySelector('[name="titel"]'), ordner = f.querySelector('[name="ordner"]');
  const bauen = f.querySelector('[name="bauen"]'), los = f.querySelector('[type="submit"]');
  neuKnopfText = () => { los.textContent = bauen.value.trim() || anhaenge.get('neu')?.length ? 'Anlegen und von Claude bauen lassen' : 'Projekt anlegen'; };
  bauen.addEventListener('input', neuKnopfText);
  neuKnopfText();
  let vonHand = false;
  ordner.addEventListener('input', () => { vonHand = !!ordner.value; });
  titel.addEventListener('input', () => {
    if (vonHand) return;
    const k = kurzname(titel.value), v = f.dataset.vorsilbe;
    ordner.value = k ? (v && !k.startsWith(v.toLowerCase()) ? v + k : k) : '';
  });
  titel.focus();
}

// ---------- Notizen und Bearbeiten ----------

let editorSchmutzig = false;
let sofortBearbeiten = null;        // neue Notiz: gleich im Editor öffnen
let notizBereich = 'mensch';
let notizSuche = '';
const BEREICHE = { mensch: 'Alle eigenen', 'mensch/ideen': 'Ideen', 'mensch/notizen': 'Notizen', 'mensch/aufnahmen': 'Aufnahmen', '': 'Ganzer Vault' };

async function markdownHtml(text) { const { markdown } = await import('./netz.js'); return markdown(text); }

function editorHtml(d, { zurueck = '' } = {}) {
  return `<section class="karte editor" data-pfad="${esc(d.pfad)}" data-version="${esc(d.version)}">
    <div class="karte-kopf"><div class="karte-titel">${esc(d.pfad)} <span class="leise" id="editor-zustand">gespeichert</span></div>
      <div class="werkzeuge">
        <button class="knopf leise" data-aktion="vorschau">Vorschau</button>
        ${zurueck ? `<a class="knopf leise" href="${esc(zurueck)}">Fertig</a>` : ''}
        <button class="knopf" data-aktion="speichern" title="⌘S">Speichern</button>
      </div></div>
    <textarea class="editor-text" spellcheck="true" aria-label="Text bearbeiten">${esc(d.text)}</textarea>
    <div class="leser-text editor-vorschau" hidden></div>
    <p class="info">Markdown (# Überschrift, **fett**, - [ ] To-do, [[Verweis]]). Gespeichert wird direkt im Vault; das Cockpit committet gebündelt und pusht nach FAH-Git.
      Hat Claude die Datei inzwischen geändert, wird nichts überschrieben.</p>
  </section>`;
}

async function speichern() {
  const ed = haupt.querySelector('.editor');
  if (!ed) return;
  const text = ed.querySelector('.editor-text').value;
  try {
    const r = await holen('/api/vault/datei', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Cockpit': '1' },
      body: JSON.stringify({ pfad: ed.dataset.pfad, text, version: ed.dataset.version }) });
    ed.dataset.version = r.version;
    editorSchmutzig = false;
    const z = document.getElementById('editor-zustand'); if (z) z.textContent = 'gespeichert ' + uhr(r.geaendert);
  } catch (err) { hinweis(err.message); }
}

async function bearbeitenZeigen(pfad) {
  const d = await holen('/api/vault/datei?pfad=' + encodeURIComponent(pfad));
  const projekt = /^maschine\/projekte\/(.+)\.md$/.exec(d.pfad)?.[1];
  const zurueck = projekt && daten?.projekte.some(p => p.ordner === projekt) ? '#/p/' + encodeURIComponent(projekt)
    : d.pfad.startsWith('mensch/') ? '#/notizen/' + encodeURIComponent(d.pfad) : '#/notizen';
  haupt.innerHTML = kopf(`<a href="#/">Cockpit</a> / Bearbeiten`, 'Bearbeiten', esc(d.pfad)) + editorHtml(d, { zurueck });
  editorSchmutzig = false;
  haupt.querySelector('.editor-text').focus();
}

function notizKarte(n, aktiv) {
  return `<a class="notiz-karte ${aktiv ? 'aktiv' : ''}" href="#/notizen/${encodeURIComponent(n.pfad)}">
    <div class="zeile-name">${esc(n.titel)}</div>
    <div class="zeile-stand">${esc(n.pfad.split('/').slice(0, -1).join('/') || 'Vault')} · ${wann(n.geaendert)}</div>
    ${n.anfang ? `<div class="notiz-anfang">${esc(n.anfang)}</div>` : ''}</a>`;
}

async function notizenZeigen(gewaehlt) {
  const v = await holen('/api/vault');
  const q = notizSuche.trim().toLowerCase();
  const liste = v.dateien.filter(n => (notizBereich === '' ? true : n.pfad.startsWith(notizBereich + '/')) && !/(^|\/)LIESMICH\.md$/.test(n.pfad))
    .filter(n => !q || (n.titel + ' ' + n.pfad + ' ' + n.anfang).toLowerCase().includes(q));
  const ordnerWahl = v.ordner.filter(o => o.startsWith('mensch')).concat(v.ordner.filter(o => !o.startsWith('mensch')))
    .map(o => `<option value="${esc(o)}" ${o === 'mensch/notizen' ? 'selected' : ''}>${esc(o)}</option>`).join('');
  haupt.innerHTML = kopf('Cockpit / Notizen', 'Notizen', `Deine Ideen, Notizen und Aufnahmen im Vault ${esc(v.vaultName)}`) + `
    <div class="notiz-leiste">
      <div class="netz-filter">${Object.entries(BEREICHE).map(([k, t]) => `<button class="pille ${notizBereich === k ? 'gruen' : ''}" data-bereich="${esc(k)}">${esc(t)}</button>`).join('')}</div>
      <form class="neu-form"><select class="auswahl" name="ordner" aria-label="Ordner">${ordnerWahl}</select>
        <input class="suche" name="titel" placeholder="Titel der neuen Notiz" aria-label="Titel"><button class="knopf" type="submit">Neue Notiz</button></form>
    </div>
    <div class="notiz-raster">
      <section class="karte notiz-liste">
        <input class="suche voll" id="notiz-suche" type="search" placeholder="Suchen …" value="${esc(notizSuche)}" aria-label="Notizen suchen">
        ${liste.length ? liste.map(n => notizKarte(n, n.pfad === gewaehlt)).join('') : '<div class="leer">Noch nichts hier. Lege links oben eine neue Notiz an.</div>'}
      </section>
      <div id="notiz-ansicht">${gewaehlt ? '<div class="leer">Lädt …</div>' : '<section class="karte"><div class="leer">Wähle eine Notiz – oder lege eine neue an.</div></section>'}</div>
    </div>`;
  const suche = document.getElementById('notiz-suche');
  suche.addEventListener('input', () => { notizSuche = suche.value; clearTimeout(notizenZeigen.t); notizenZeigen.t = setTimeout(async () => { await notizenZeigen(gewaehlt); const s2 = document.getElementById('notiz-suche'); s2.focus(); s2.setSelectionRange(s2.value.length, s2.value.length); }, 250); });
  if (gewaehlt) {
    try {
      const d = await holen('/api/vault/datei?pfad=' + encodeURIComponent(gewaehlt));
      document.getElementById('notiz-ansicht').innerHTML = `<section class="karte">
        <div class="karte-kopf"><div class="karte-titel">${esc(d.pfad)} <span class="leise">geändert ${wann(d.geaendert)}</span></div>
          <div class="werkzeuge"><button class="knopf leise" data-aktion="papierkorb" data-pfad="${esc(d.pfad)}">Papierkorb</button>
          <button class="knopf" data-aktion="notiz-bearbeiten" data-pfad="${esc(d.pfad)}">Bearbeiten</button></div></div>
        <div class="leser-text">${await markdownHtml(d.text)}</div></section>`;
      if (sofortBearbeiten === d.pfad) { sofortBearbeiten = null; haupt.querySelector('[data-aktion="notiz-bearbeiten"]')?.click(); }
    } catch (err) { document.getElementById('notiz-ansicht').innerHTML = `<section class="karte"><div class="leer">${esc(err.message)}</div></section>`; }
  }
}

// ---------- Nutzungslimit ----------

const FENSTER = { five_hour: '5 Stunden', seven_day: 'Woche', seven_day_opus: 'Woche Opus', seven_day_sonnet: 'Woche Sonnet', overage: 'Zusatz', extra_usage: 'Zusatz' };
const prozent = x => Number.isFinite(x) ? Math.round(x * 100) : null;   // gespeichert als Anteil 0…1

async function limitLaden() {
  let l; try { l = await holen('/api/limit'); } catch { return; }
  const teile = Object.entries(l.fenster || {}).filter(([, w]) => prozent(w.auslastung) !== null).map(([n, w]) => `${FENSTER[n] || n} ${prozent(w.auslastung)} %`);
  const el = document.getElementById('fuss-limit');
  if (el) el.textContent = teile.length ? 'Limit: ' + teile.join(' · ') : '';
}

const nativ = () => !!window.webkit?.messageHandlers?.cockpit;   // in der Mac-App: echter Ordner-Dialog

function wissenEinstellung(e, w) {
  const ziel = e.wissenZiel || (e.fahgitAdresse ? 'fahgit' : 'aus');
  const wahl = (wert, titel, text) => `<label class="wahl ${ziel === wert ? 'gewaehlt' : ''}"><input type="radio" name="wissenZiel" value="${wert}" ${ziel === wert ? 'checked' : ''}>
    <span><strong>${titel}</strong><span class="info">${text}</span></span></label>`;
  return `<section class="karte">
    <div class="karte-kopf"><div class="karte-titel">Wissen sichern</div><button class="knopf leise" data-aktion="wissen-jetzt" ${w.laeuft ? 'disabled' : ''}>${w.laeuft ? 'Läuft …' : 'Jetzt abgleichen'}</button></div>
    <form class="wissen-form">
      ${wahl('fahgit', 'FAH-Git', 'Je Projekt nach <code>&lt;Projekt&gt;/claude-wissen/</code>, committet und gepusht; das ganze Gedächtnis ins Repo <code>claude-gedaechtnis</code>. Nie zu GitHub, frederix nie.')}
      ${wahl('ordner', 'Ordner', 'Ohne Git, z. B. iCloud, NAS-Freigabe oder Dropbox. Wählst du den Projektordner selbst (z. B. <code>~/claude</code>), landet das Wissen direkt in <code>&lt;Projekt&gt;/claude-wissen/</code>.')}
      ${wahl('aus', 'Aus', 'Nichts spiegeln.')}
      <div class="feldzeile"><span class="feldname">Ordner</span><input class="suche feld" name="wissenOrdner" value="${esc(e.wissenOrdner || '')}" placeholder="~/claude oder /Volumes/NAS/Claude-Wissen">
        ${nativ() ? '<button class="knopf leise" type="button" data-aktion="ordner-waehlen">Ordner wählen …</button>' : ''}</div>
      <div class="form-zeile"><span class="info">Nach dem Speichern startet der Abgleich sofort, danach alle 30 Minuten.</span><button class="knopf" type="submit">Speichern und abgleichen</button></div>
    </form>
    ${wissenKarte(w)}
  </section>`;
}

function fahgitKarte(f) {
  const st = !f ? '' : f.verbunden ? `Haupt <span class="pille gruen">verbunden</span> als ${esc(f.name || f.benutzer || '–')} · Schlüssel ${f.quelle === 'git' ? 'aus dem git-Zugang dieses Macs' : 'im Cockpit'}`
    : `Haupt <span class="pille ${f.adresse ? 'rot' : ''}">${f.adresse ? 'nicht verbunden' : 'nicht eingerichtet'}</span> ${esc(f.fehler || '')}`;
  const e = f?.ersatz;
  const schl = !e?.erreichbar ? '' : e.verbunden ? ' · derselbe Schlüssel wird angenommen' : ` · <strong>Schlüssel ${esc(e.fehler || 'nicht angenommen')}</strong>`;
  const est = !e ? '' : !e.erreichbar ? `Ersatz <span class="pille rot">nicht erreichbar</span>`
    : e.nurLesen ? `Ersatz <span class="pille gruen">bereit</span> gleicht sich vom Haupt ab, nur lesen${e.gekoppelt === false ? ' · <strong>noch nicht gekoppelt</strong>' : ''}${e.version ? ' · ' + esc(e.version) : ''}${schl}`
    : `Ersatz <span class="pille gelb">übernommen</span> nimmt Pushes an${e.version ? ' · ' + esc(e.version) : ''}${schl}`;
  const ziel = f?.ziel;
  const zst = !ziel ? '' : ziel.art === 'haupt' ? '' : ziel.art === 'ersatz' ? '<strong>Gerade wird auf den Ersatz gepusht.</strong>'
    : `<strong>${esc(ziel.grund || '')}</strong> – Commits bleiben lokal und gehen später zum Haupt.`;
  return `<section class="karte">
    <div class="karte-kopf"><div class="karte-titel">FAH-Git-Verbindung</div></div>
    <p class="info">${st}</p>
    ${est ? `<p class="info">${est}</p>` : ''}${zst ? `<p class="info">${zst}</p>` : ''}
    <form class="fahgit-form">
      <div class="feldzeile"><span class="feldname">Adresse</span><input class="suche feld" name="fahgitAdresse" value="${esc(f?.adresse || '')}" placeholder="z. B. http://192.168.1.20:3300"></div>
      <div class="feldzeile"><span class="feldname">Ersatz</span><input class="suche feld" name="fahgitErsatz" value="${esc(e?.adresse || '')}" placeholder="Fail-over, z. B. http://192.168.1.21:3300 (optional)"></div>
      <div class="feldzeile"><span class="feldname">Benutzer</span><input class="suche feld" name="fahgitBenutzer" value="${esc(f?.benutzer || '')}" placeholder="Benutzername in FAH-Git"></div>
      <div class="feldzeile"><span class="feldname">Schlüssel</span><input class="suche feld" type="password" name="fahgitSchluessel" title="Ein Schlüssel für Haupt und Ersatz" autocomplete="off" placeholder="${f?.quelle === 'cockpit' ? 'gespeichert ✓ – neu einfügen zum Ersetzen' : 'Zugangsschlüssel einfügen'}"></div>
      <div class="form-zeile"><span class="info">Für den Wissens-Spiegel und „In FAH-Git anlegen“. Den Schlüssel erzeugst du in FAH-Git unter Mein Konto → Zugangsschlüssel (Recht: Schreiben). Er liegt im Schlüsselbund und wird auch für git hinterlegt. <strong>Ein Schlüssel gilt für Haupt und Ersatz:</strong> Der gekoppelte Ersatz übernimmt Konten und Zugangsschlüssel laufend vom Haupt – ein eigener Schlüssel wäre nur bei einer ungekoppelten Instanz nötig.
        Fällt der Haupt aus und hast du am Ersatz „Zum Haupt machen“ geklickt, pusht das Cockpit dorthin; solange er nur Ersatz ist, bleiben Commits lokal.</span><button class="knopf" type="submit">Speichern und prüfen</button></div>
    </form>
  </section>`;
}

function limitKarte(l, live) {
  const f = Object.entries(l?.fenster || {});
  const balken = ([n, w]) => {
    const p = prozent(w.auslastung);
    return `<div class="limit-zeile"><span class="feldname">${esc(FENSTER[n] || n)}</span>
      <div class="balken"><div class="balken-fuell ${p >= 90 ? 'rot' : p >= 70 ? 'gelb' : ''}" data-breite="${p ?? 0}"></div></div>
      <span class="limit-wert">${p === null ? '–' : p + ' %'}</span></div>
      <div class="info limit-info">${w.zurueck ? 'setzt zurück ' + new Date(w.zurueck).toLocaleString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''}${w.status && w.status !== 'allowed' ? ' · <strong>' + esc(w.status) + '</strong>' : ''}</div>`;
  };
  return `<section class="karte">
    <div class="karte-kopf"><div class="karte-titel">Nutzungslimit</div><button class="knopf leise" data-aktion="limit-messen" ${l?.misst ? 'disabled' : ''}>${l?.misst ? 'Misst …' : 'Jetzt messen'}</button></div>
    ${f.length ? f.map(balken).join('') : '<p class="info">Noch kein Stand. Er kommt mit jedem Auftrag automatisch – oder mit „Jetzt messen“.</p>'}
    <p class="info">${l?.stand ? `Stand ${wann(l.stand)} (${{ live: 'live', messung: 'gemessen', auftrag: 'aus einem Auftrag' }[l.quelle] || l.quelle})` : ''}${l?.ueberzug?.status ? ` · Zusatzkontingent: ${esc(l.ueberzug.status)}${l.ueberzug.grund ? ' (' + esc(l.ueberzug.grund) + ')' : ''}` : ''}${l?.fehler && live ? ` · <strong>${esc(l.fehler)}</strong>` : ''}.</p>
    <label class="schalter"><input type="checkbox" data-limit-live ${live ? 'checked' : ''}> Live abfragen, jede Minute wie <code>/usage</code></label>
    <p class="info">Live liest das Cockpit dafür deine Claude-Anmeldung aus dem Schlüsselbund – nur im Speicher, nie gespeichert oder angezeigt.
      Ohne Live kommt der Stand mit jedem Auftrag; „Jetzt messen“ schickt dann eine winzige Haiku-Anfrage.</p>
  </section>`;
}

function balkenStellen() {
  for (const el of document.querySelectorAll('.balken-fuell[data-breite]')) el.style.width = Math.min(100, Number(el.dataset.breite)) + '%';
}

// ---------- Einstellungen ----------

function wissenKarte(w) {
  const b = w?.letzter;
  if (!b) return `<p class="info">Noch kein Lauf seit dem Start des Cockpits. Der erste läuft 3 Minuten nach dem Start, danach alle 30 Minuten.</p>`;
  const zahl = {}; for (const p of b.projekte) zahl[p.status] = (zahl[p.status] || 0) + 1;
  const reihe = p => `<li><span class="datum">${esc(p.status)}</span><span>${esc(projektTitel(p.ordner))}${p.notizen != null ? ` · ${p.notizen} Notizen${p.stand ? ' + Stand' : ''}` : ''}${p.grund ? ' – ' + esc(p.grund) : ''}${p.anlegbar ? ` <button class="knopf mini" data-aktion="fahgit-anlegen" data-ordner="${esc(p.ordner)}">In FAH-Git anlegen</button>` : ''}</span></li>`;
  const wichtig = b.projekte.filter(p => p.status !== 'aktuell');
  if (b.ziel === 'aus') return '<p class="info">Wissen wird nicht gespiegelt.</p>';
  if (b.fehler) return `<p class="info"><strong>${esc(b.fehler)}</strong></p>`;
  return `<p class="info">Letzter Lauf ${wann(b.zeit)} ${b.ziel === 'ordner' ? 'in den Ordner <code>' + esc(b.zielOrdner || '') + '</code>' : 'nach FAH-Git'} (${Math.round((b.dauerMs || 0) / 1000)} s): ${Object.entries(zahl).map(([k, v]) => `${v} ${esc(k)}`).join(', ')}.
      Allgemeines Gedächtnis: ${esc(b.allgemein?.status || '–')}${b.allgemein?.grund ? ' – ' + esc(b.allgemein.grund) : ''}.</p>
    ${wichtig.length ? `<details><summary>Einzelheiten (${wichtig.length})</summary><ul class="commits">${wichtig.map(reihe).join('')}</ul></details>` : ''}`;
}

async function einstellungenZeigen(frisch = false) {
  const [e, w, l] = await Promise.all([holen('/api/einstellungen' + (frisch ? '?frisch=1' : '')), holen('/api/wissen').catch(() => null), holen('/api/limit').catch(() => null)]);
  const k = e.ki;
  const methode = { 'claude.ai': 'claude.ai-Konto (Abo)', apiKey: 'API-Schlüssel', api_key: 'API-Schlüssel', oauth_token: 'Abo-Token' }[k.methode] || k.methode || '–';
  const anbieter = { firstParty: 'Anthropic direkt' }[k.anbieter] || k.anbieter || '–';
  const anm = (wert, titel, text, feld) => `<label class="wahl ${e.anmeldung === wert ? 'gewaehlt' : ''}">
      <input type="radio" name="anmeldung" value="${wert}" ${e.anmeldung === wert ? 'checked' : ''}>
      <span><strong>${titel}</strong><span class="info">${text}</span>${feld || ''}</span></label>`;
  const geheimFeld = (art, da, platzhalter) => `<span class="geheim">
      <input class="suche" type="password" name="${art}" autocomplete="off" placeholder="${da ? 'gespeichert ✓ – neu einfügen zum Ersetzen' : platzhalter}">
      ${da ? `<label class="schalter"><input type="checkbox" name="${art}Loeschen"> löschen</label>` : ''}</span>`;
  haupt.innerHTML = kopf('Cockpit / Einstellungen', 'Einstellungen', 'Welche KI für Aufträge läuft und womit',
    '<button class="knopf leise" data-aktion="ki-pruefen">Neu prüfen</button>') + `
    <div class="raster">
      <div>
        <form class="einstellungen-form">
        <section class="karte">
          <div class="karte-kopf"><div class="karte-titel">Standard für Aufträge</div></div>
          <p class="info">Gilt für „Erledigen“ und für Aufträge, bei denen du nichts anderes wählst. „Wie in Claude Code“ nimmt das,
            was in Claude Code auf diesem Mac eingestellt ist (gerade: Modell ${esc(k.standardModell || 'Standard')}, Aufwand ${esc(k.standardAufwand || 'Standard')}).</p>
          <div class="feldzeile"><span class="feldname">Modell</span>${auswahl('modell', MODELL_TEXT, e.modell)}</div>
          <p class="info">Opus für Code und knifflige Fehler, Sonnet für Routine, Haiku für Kleinigkeiten. Größere Modelle brauchen mehr vom Nutzungslimit.</p>
          <div class="feldzeile"><span class="feldname">Aufwand</span>${auswahl('aufwand', AUFWAND_TEXT, e.aufwand)}</div>
          <p class="info">Wie lange Claude nachdenkt, bevor es handelt. Höher = gründlicher, aber langsamer und mehr Verbrauch.</p>
        </section>
        <section class="karte">
          <div class="karte-kopf"><div class="karte-titel">Anmeldung</div></div>
          ${anm('claude-code', 'Wie Claude Code auf diesem Mac (empfohlen)', 'Dein angemeldetes Konto mit Abo – dasselbe wie im Terminal.')}
          ${anm('token', 'Abo-Token (z. B. anderes Konto)', 'Im Terminal <code>claude setup-token</code> ausführen, mit dem gewünschten Konto anmelden und das Token hier einfügen. Läuft über dessen Abo.',
            geheimFeld('token', k.tokenDa, 'Token einfügen …'))}
          ${anm('schluessel', 'API-Schlüssel', 'Schlüssel von console.anthropic.com. Abgerechnet wird nach Verbrauch statt über ein Abo.',
            geheimFeld('schluessel', k.schluesselDa, 'sk-ant-… einfügen'))}
          <p class="info">Token und Schlüssel liegen im macOS-Schlüsselbund und werden nie wieder angezeigt. Claude bekommt sie im Auftrag als
            Umgebungsvariable – ein Auftrag mit „Alles erlauben“ könnte sie also auslesen.</p>
          <div class="form-zeile"><span></span><button class="knopf" type="submit">Speichern</button></div>
        </section>
        </form>
      </div>
      <div>
        ${limitKarte(l, e.limitLive)}
        ${fahgitKarte(e.fahgit)}
        <section class="karte">
          <div class="karte-kopf"><div class="karte-titel">Neue Projekte</div></div>
          <form class="neu-projekte-form">
            <div class="feldzeile"><span class="feldname">Vorsilbe</span><input class="suche feld" name="projektVorsilbe" value="${esc(e.projektVorsilbe || '')}" placeholder="z. B. fah-"></div>
            <div class="feldzeile"><span class="feldname">FAH-Git-Ordner</span><input class="suche feld" name="fahgitProjektOrdner" value="${esc(e.fahgitProjektOrdner || '')}" placeholder="eigene-projekte"></div>
            <div class="form-zeile"><span class="info">Die Vorsilbe kommt vor jeden neuen Ordnernamen (deine Marke). Der FAH-Git-Ordner ist die Vorauswahl beim Anlegen.</span><button class="knopf" type="submit">Speichern</button></div>
          </form>
        </section>
        <section class="karte">
          <div class="karte-kopf"><div class="karte-titel">Welche KI läuft hier</div></div>
          <dl class="fakten">
            <dt>Programm</dt><dd>${esc(k.version || 'Claude Code nicht gefunden')} auf diesem Mac</dd>
            <dt>Anmeldung</dt><dd>${k.angemeldet ? '<span class="pille gruen">angemeldet</span> ' : '<span class="pille rot">nicht angemeldet</span> '}${esc(methode)}</dd>
            ${k.email ? `<dt>Konto</dt><dd>${esc(k.email)}${k.organisation ? ' · ' + esc(k.organisation) : ''}</dd>` : ''}
            ${k.abo ? `<dt>Abo</dt><dd>${esc(k.abo)}</dd>` : ''}
            <dt>Anbieter</dt><dd>${esc(anbieter)}</dd>
            ${k.gueltigBis ? `<dt>Gültig bis</dt><dd>${new Date(k.gueltigBis).toLocaleDateString('de-DE')}</dd>` : ''}
            ${k.fehler ? `<dt>Hinweis</dt><dd>${esc(k.fehler)}</dd>` : ''}
          </dl>
          <p class="info" style="margin-top:12px">Jeder Auftrag startet <code>claude -p</code> im Hintergrund, aus deinem Home-Ordner – mit deinem
            Gedächtnis, deinen Regeln und deinem auto-Modus, wie im Terminal. Das Cockpit fragt nur bei Schritten nach außen nach.</p>
        </section>
        ${w ? wissenEinstellung(e, w) : ''}
      </div>
    </div>`;
}

// ---------- Aktionen ----------

haupt.addEventListener('change', async e => {
  const box = e.target;
  if (!(box instanceof HTMLInputElement) || box.type !== 'checkbox' || !box.dataset.zeile) return;
  box.disabled = true;
  try {
    await senden('/api/todo', { ordner: box.dataset.ordner, zeile: Number(box.dataset.zeile), text: box.dataset.text, erledigt: box.checked });
    box.closest('.todo')?.classList.toggle('erledigt', box.checked);
    await uebersichtLaden(true);
  } catch (err) {
    box.checked = !box.checked;
    hinweis(err.message);
    zeigen();
  } finally { box.disabled = false; }
});

haupt.addEventListener('click', async e => {
  const entfernen = e.target.closest('[data-anhang-weg]');
  if (entfernen) {
    const s = entfernen.closest('[data-anhaenge]').dataset.anhaenge;
    (anhaenge.get(s) || []).splice(Number(entfernen.dataset.anhangWeg), 1);
    anhangZeichnen(s);
    return;
  }
  const gross = e.target.closest('img[data-gross]');
  if (gross) { bildGross(gross.src); return; }
  const sprung = e.target.closest('[data-sprung]');
  if (sprung) { e.preventDefault(); document.getElementById(sprung.dataset.sprung)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
  const bereich = e.target.closest('[data-bereich]');
  if (bereich) { notizBereich = bereich.dataset.bereich; const [, a] = weg(); await notizenZeigen(a); return; }
  const k = e.target.closest('[data-aktion]');
  if (!k || k.tagName === 'FORM') return;
  const aktion = k.dataset.aktion;
  k.disabled = true;
  try {
    if (aktion === 'neu') { await uebersichtLaden(true); await zeigen(); }
    else if (aktion === 'speichern') { await speichern(); }
    else if (aktion === 'ordner-waehlen') { window.webkit.messageHandlers.cockpit.postMessage({ ordnerWaehlen: 'wissen' }); }
    else if (aktion === 'vorschau') {
      const ed = haupt.querySelector('.editor'), v = ed.querySelector('.editor-vorschau'), t = ed.querySelector('.editor-text');
      if (v.hidden) { v.innerHTML = await markdownHtml(t.value); v.hidden = false; t.hidden = true; k.textContent = 'Bearbeiten'; }
      else { v.hidden = true; t.hidden = false; k.textContent = 'Vorschau'; t.focus(); }
    }
    else if (aktion === 'notiz-bearbeiten') {
      const d = await holen('/api/vault/datei?pfad=' + encodeURIComponent(k.dataset.pfad));
      document.getElementById('notiz-ansicht').innerHTML = editorHtml(d, { zurueck: '#/notizen/' + encodeURIComponent(d.pfad) });
      editorSchmutzig = false; haupt.querySelector('.editor-text').focus();
    }
    else if (aktion === 'papierkorb') {
      if (!confirm(`„${k.dataset.pfad}“ in den Papierkorb des Vaults legen? (wiederherstellbar unter .trash/)`)) return;
      await senden('/api/vault/papierkorb', { pfad: k.dataset.pfad });
      location.hash = '#/notizen';
    }
    else if (aktion === 'ki-pruefen') { await einstellungenZeigen(true); balkenStellen(); }
    else if (aktion === 'limit-messen') { k.textContent = 'Misst …'; await senden('/api/limit/messen', {}); await limitLaden(); await einstellungenZeigen(); balkenStellen(); }
    else if (aktion === 'fahgit-anlegen') {
      if (!confirm(`„${k.dataset.ordner}“ in FAH-Git anlegen (eigene-projekte) und den Stand dorthin pushen?`)) return;
      const r = await senden('/api/wissen/anlegen', { ordner: k.dataset.ordner });
      hinweis('Angelegt: ' + r.pfad); await senden('/api/wissen/jetzt', {}); await einstellungenZeigen(); balkenStellen();
    }
    else if (aktion === 'wissen-jetzt') { k.textContent = 'Läuft …'; await senden('/api/wissen/jetzt', {}); await einstellungenZeigen(); hinweis('Wissen gespiegelt.'); }
    else if (aktion === 'erledigen') {
      if (!confirm('Soll Claude dieses To-do jetzt im Hintergrund erledigen?\n\n„' + k.dataset.text + '“')) return;
      const a = await senden('/api/auftrag', { ordner: k.dataset.ordner, todo: { zeile: Number(k.dataset.zeile), text: k.dataset.text } });
      location.hash = '#/a/' + encodeURIComponent(a.id);
    } else if (aktion === 'erlauben' || aktion === 'ablehnen' || aktion === 'immer') {
      const karte = k.closest('.freigabe');
      await senden('/api/freigabe', { auftrag: karte.dataset.auftrag, freigabe: karte.dataset.freigabe,
        erlauben: aktion !== 'ablehnen', immer: aktion === 'immer', antwort: karte.querySelector('[name="antwort"]')?.value || '' });
      await uebersichtLaden(); await zeigen();
    } else if (aktion === 'alles' || aktion === 'fragen') {
      if (aktion === 'alles' && !confirm('Ab jetzt läuft in diesem Auftrag alles ohne Rückfrage – auch Push, Deploy und ssh. Einverstanden?')) return;
      await senden('/api/auftrag/alles', { id: haupt.dataset.auftrag, an: aktion === 'alles' });
      await uebersichtLaden(); await zeigen();
    } else if (aktion === 'abbrechen') {
      if (!confirm('Auftrag abbrechen? Claude hört sofort auf.')) return;
      await senden('/api/auftrag/abbrechen', { id: haupt.dataset.auftrag });
      await zeigen();
    }
  } catch (err) { hinweis(err.message); } finally { k.disabled = false; }
});

haupt.addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target;
  const knopf = f.querySelector('button[type="submit"]');
  if (f.classList.contains('projekt-neu-form')) {
    const wert = n => f.querySelector(`[name="${n}"]`);
    const knopf = f.querySelector('[type="submit"]');
    knopf.disabled = true; knopf.textContent = 'Wird angelegt …';
    try {
      const bauen = wert('bauen').value.trim();
      if (inArbeit.get('neu')) throw new Error('Einen Moment – ein Bild wird noch vorbereitet.');
      const gesendetNeu = [...(anhaenge.get('neu') || [])];
      const bilder = gesendetNeu.map(b => ({ daten: b.daten }));
      const kurz = wert('beschreibung').value.trim() || bauen.split(/(?<=[.!?])\s/)[0].slice(0, 300);
      const r = await senden('/api/projekt/neu', { titel: wert('titel').value, ordner: wert('ordner').value, beschreibung: kurz,
        todos: wert('todos').value, inFahgit: wert('inFahgit') ? wert('inFahgit').checked : false, fahgitOrdner: wert('fahgitOrdner')?.value || '' });
      await uebersichtLaden(true);
      if (bauen || bilder.length) {
        knopf.textContent = 'Claude startet …';
        const text = `Neues Projekt „${wert('titel').value.trim()}“ – gerade im FAH-Cockpit angelegt: Ordner ~/claude/${r.ordner} mit Git `
          + `(README.md, CLAUDE.md, .gitignore, erster Commit)${r.fahgit ? `, in FAH-Git unter ${r.fahgit.pfad} mit Remote fahgit` : ''}${r.stand ? `, Stand-Datei maschine/projekte/${r.ordner}.md im Vault` : ''}.\n\n`
          + `Baue jetzt:\n${bauen || '(siehe Bild)'}\n\nArbeite im Ordner ~/claude/${r.ordner}. Ist etwas Wesentliches unklar, frag am Ende kurz nach, statt zu raten.`;
        const a = await senden('/api/auftrag', { ordner: r.ordner, text, modell: wert('modell').value, aufwand: wert('aufwand').value, allesErlaubt: wert('alles').checked, bilder });
        anhaengeGesendet('neu', gesendetNeu);
        location.hash = '#/a/' + encodeURIComponent(a.id);
        hinweis(r.warnung || 'Angelegt – Claude baut jetzt.');
      } else {
        location.hash = '#/p/' + encodeURIComponent(r.ordner);
        hinweis(r.warnung || (r.fahgit ? `Angelegt – auch in FAH-Git unter ${r.fahgit.pfad}.` : 'Angelegt.'));
      }
    } catch (err) { hinweis(err.message); knopf.disabled = false; knopf.textContent = 'Projekt anlegen'; }
    return;
  }
  if (f.classList.contains('neu-projekte-form')) {
    try {
      await senden('/api/einstellungen', { projektVorsilbe: f.querySelector('[name="projektVorsilbe"]').value, fahgitProjektOrdner: f.querySelector('[name="fahgitProjektOrdner"]').value });
      hinweis('Gespeichert.'); await einstellungenZeigen(); balkenStellen();
    } catch (err) { hinweis(err.message); }
    return;
  }
  if (f.classList.contains('neu-form')) {
    try {
      const d = await senden('/api/vault/neu', { ordner: f.querySelector('[name="ordner"]').value, titel: f.querySelector('[name="titel"]').value });
      sofortBearbeiten = d.pfad;
      location.hash = '#/notizen/' + encodeURIComponent(d.pfad);
    } catch (err) { hinweis(err.message); }
    return;
  }
  if (f.classList.contains('todo-form')) {
    const feld = f.querySelector('[name="todo"]');
    try { await senden('/api/todo/neu', { ordner: f.dataset.ordner, text: feld.value, art: f.querySelector('[name="art"]').value }); feld.value = ''; await uebersichtLaden(true); await zeigen(); }
    catch (err) { hinweis(err.message); }
    return;
  }
  if (f.classList.contains('wissen-form')) {
    try {
      await senden('/api/einstellungen', { wissenZiel: f.querySelector('[name="wissenZiel"]:checked')?.value || 'aus', wissenOrdner: f.querySelector('[name="wissenOrdner"]').value });
      hinweis('Gespeichert – der Abgleich läuft.'); await einstellungenZeigen(); balkenStellen();
      setTimeout(async () => { if (weg()[0] === 'einstellungen') { await einstellungenZeigen(); balkenStellen(); } }, 8000);
    } catch (err) { hinweis(err.message); }
    return;
  }
  if (f.classList.contains('fahgit-form')) {
    const wert = n => f.querySelector(`[name="${n}"]`).value;
    try {
      await senden('/api/einstellungen', { fahgitAdresse: wert('fahgitAdresse'), fahgitErsatz: wert('fahgitErsatz'), fahgitBenutzer: wert('fahgitBenutzer'), fahgitSchluessel: wert('fahgitSchluessel') });
      await einstellungenZeigen(); balkenStellen(); hinweis('FAH-Git-Verbindung gespeichert.');
    } catch (err) { hinweis(err.message); }
    return;
  }
  if (f.classList.contains('einstellungen-form')) {
    const wert = n => f.querySelector(`[name="${n}"]`);
    try {
      await senden('/api/einstellungen', {
        modell: wert('modell').value, aufwand: wert('aufwand').value,
        anmeldung: f.querySelector('[name="anmeldung"]:checked')?.value || 'claude-code',
        token: wert('token')?.value || '', schluessel: wert('schluessel')?.value || '',
        tokenLoeschen: !!wert('tokenLoeschen')?.checked, schluesselLoeschen: !!wert('schluesselLoeschen')?.checked,
      });
      await einstellungenZeigen();
      hinweis('Gespeichert.');
    } catch (err) { hinweis(err.message); }
    return;
  }
  if (!knopf || knopf.disabled) return;                       // Enter während des Sendens: nicht doppelt schicken
  const text = f.querySelector('textarea[name="text"]').value.trim();
  const schluessel = anhangSchluessel(f);
  if (inArbeit.get(schluessel)) { hinweis('Einen Moment – ein Bild wird noch vorbereitet.'); return; }
  const gesendet = [...(anhaenge.get(schluessel) || [])];
  const bilder = gesendet.map(b => ({ daten: b.daten }));
  if (!text && !bilder.length) { hinweis('Bitte schreib, was Claude tun soll.'); return; }
  knopf.disabled = true;
  try {
    if (f.classList.contains('auftrag-form')) {
      const a = await senden('/api/auftrag', { ordner: f.dataset.ordner, text, modell: f.querySelector('[name="modell"]').value,
        aufwand: f.querySelector('[name="aufwand"]').value,
        allesErlaubt: f.querySelector('[name="alles"]').checked, bilder });
      anhaengeGesendet(schluessel, gesendet);
      location.hash = '#/a/' + encodeURIComponent(a.id);
    } else if (f.classList.contains('nachricht-form')) {
      await senden('/api/auftrag/nachricht', { id: f.dataset.id, text, bilder });
      anhaengeGesendet(schluessel, gesendet);
      knopf.disabled = false;                                   // die Seite bleibt stehen – der Knopf muss wieder gehen
      f.querySelector('textarea').value = '';
      document.activeElement?.blur();
      await zeigen();
    }
  } catch (err) { hinweis(err.message); knopf.disabled = false; }
});

haupt.addEventListener('change', async e => {
  const box = e.target.closest?.('[data-limit-live]');
  if (!box) return;
  try { await senden('/api/einstellungen', { limitLive: box.checked }); if (box.checked) await senden('/api/limit/messen', {}); await limitLaden(); await einstellungenZeigen(); balkenStellen(); }
  catch (err) { hinweis(err.message); }
});

haupt.addEventListener('input', e => {
  if (e.target.classList?.contains('editor-text')) { editorSchmutzig = true; const z = document.getElementById('editor-zustand'); if (z) z.textContent = 'ungespeichert'; }
});
document.addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.key === 's' && haupt.querySelector('.editor')) { e.preventDefault(); speichern(); }
});
window.addEventListener('beforeunload', e => { if (editorSchmutzig) { e.preventDefault(); e.returnValue = ''; } });

haupt.addEventListener('keydown', e => {
  if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
  const f = e.target.closest?.('form.nachricht-form');
  if (!f || e.target.tagName !== 'TEXTAREA') return;
  e.preventDefault();
  f.requestSubmit();
});

function uhrenStellen() {
  for (const el of document.querySelectorAll('.v-uhr[data-seit]')) el.textContent = dauer(el.dataset.seit);
}
setInterval(uhrenStellen, 1000);

// ---------- Weg (Hash) und Takt ----------

function weg() {
  const h = decodeURIComponent(location.hash.replace(/^#/, '')) || '/';
  if (h.startsWith('/p/')) return ['projekt', h.slice(3)];
  if (h.startsWith('/a/')) return ['auftrag', h.slice(3)];
  if (h.startsWith('/netz/')) return ['netz', h.slice(6)];
  if (h.startsWith('/notizen/')) return ['notizen', h.slice(9)];
  if (h === '/neu') return ['neu', null];
  if (h.startsWith('/bearbeiten/')) return ['bearbeiten', h.slice(12)];
  return [{ '/todos': 'todos', '/ruhend': 'ruhend', '/auftraege': 'auftraege', '/einstellungen': 'einstellungen', '/netz': 'netz', '/notizen': 'notizen' }[h] || 'uebersicht', null];
}

async function zeigen() {
  const [w, arg] = weg();
  for (const a of document.querySelectorAll('#nav a')) a.classList.toggle('aktiv', a.dataset.weg === (w === 'auftrag' ? 'auftraege' : w));
  if (w !== 'auftrag') delete haupt.dataset.auftrag;
  try {
    if (!daten) await uebersichtLaden();
    if (w === 'projekt') await projektZeigen(arg);
    else if (w === 'auftrag') await auftragZeigen(arg);
    else if (w === 'auftraege') await auftraegeZeigen();
    else if (w === 'todos') await todosZeigen();
    else if (w === 'ruhend') ruhendZeigen();
    else if (w === 'einstellungen') { await einstellungenZeigen(); balkenStellen(); }
    else if (w === 'notizen') await notizenZeigen(arg);
    else if (w === 'neu') await neuZeigen();
    else if (w === 'bearbeiten') await bearbeitenZeigen(arg);
    else if (w === 'netz') { const { netzZeigen } = await import('./netz.js'); await netzZeigen(haupt, { holen, start: arg }); }
    else uebersichtZeigen();
    gezeichnet = fingerabdruck(daten);
  } catch (err) {
    haupt.innerHTML = `<div class="karte"><div class="leer">${esc(err.message)}</div></div>`;
  }
}

/** Selbst aktualisieren (27.11., Betreiber: „ich möchte nicht händisch aktualisieren müssen“): alle 30 s, solange der Tab
    sichtbar ist (verdeckt: Pause, beim Zurückkommen sofort). Neu gezeichnet wird nur, wenn sich etwas geändert hat – und
    nicht, während getippt wird; aufgeklappte Abschnitte und die Scroll-Lage bleiben. Der Server misst höchstens alle 20 s. */
let selbstTimer = null;
async function selbstAktualisieren() {
  clearTimeout(selbstTimer);
  try {
    if (!document.hidden) {
      await uebersichtLaden();
      const [w] = weg();
      const tippt = document.activeElement && ['TEXTAREA', 'INPUT', 'SELECT'].includes(document.activeElement.tagName);
      if (fingerabdruck(daten) !== gezeichnet && !tippt && !['auftrag', 'auftraege', 'notizen', 'bearbeiten', 'netz', 'einstellungen', 'neu'].includes(w) && !editorSchmutzig) {
        const offen = [...haupt.querySelectorAll('details')].map(d => d.open);
        const y = window.scrollY;
        await zeigen();
        haupt.querySelectorAll('details').forEach((d, i) => { if (offen[i]) d.open = true; });
        window.scrollTo(0, y);
      }
    }
  } catch { /* nächster Versuch */ }
  selbstTimer = setTimeout(selbstAktualisieren, 30_000);
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) selbstAktualisieren(); });

/** Solange Claude arbeitet: alle 2 s nachsehen, sonst alle 20 s (für die Zahlen in der Leiste). */
async function takt() {
  clearTimeout(taktTimer);
  try {
    const vorher = JSON.stringify(auftragsZahlen);
    const r = await holen('/api/auftraege');
    auftragsZahlen = { wartet: r.wartet, laeuft: r.laeuft, schlange: r.schlange };
    if (daten) { Object.assign(daten.summen, auftragsZahlen); zahlenZeigen(); }
    const [w] = weg();
    const tippt = document.activeElement && ['TEXTAREA', 'INPUT', 'SELECT'].includes(document.activeElement.tagName);
    if (w !== 'netz' && (w === 'auftrag' || (w === 'auftraege' && !tippt) || (vorher !== JSON.stringify(auftragsZahlen) && w === 'uebersicht' && !tippt))) {
      if (vorher !== JSON.stringify(auftragsZahlen)) await uebersichtLaden(true);
      if (!document.hidden) await zeigen();
    }
  } catch { /* nächster Versuch */ }
  const aktiv = auftragsZahlen.laeuft || auftragsZahlen.schlange || auftragsZahlen.wartet;
  const [jetztWeg] = weg();
  taktTimer = setTimeout(takt, aktiv ? (jetztWeg === 'auftrag' ? 1000 : 2000) : 20000);
}

let letzterHash = location.hash;
window.addEventListener('hashchange', () => {
  if (editorSchmutzig && !confirm('Ungespeicherte Änderungen verwerfen?')) { history.replaceState(null, '', letzterHash); return; }
  editorSchmutzig = false; letzterHash = location.hash;
  window.scrollTo(0, 0); zeigen();
});
window.addEventListener('focus', async () => {
  if (document.activeElement?.id === 'suche') return;
  try { await uebersichtLaden(); const [w] = weg(); if (!['projekt', 'auftrag', 'netz', 'einstellungen', 'notizen', 'bearbeiten', 'neu'].includes(w)) zeigen(); } catch { /* still */ }
});
zeigen().then(() => { taktTimer = setTimeout(takt, 2000); selbstTimer = setTimeout(selbstAktualisieren, 30_000); });
limitLaden(); setInterval(limitLaden, 30_000);
