// (c) 2026 Fabian Hammer - Alle Rechte vorbehalten. FAH-Cockpit – Wissensnetz wie die Graph-Ansicht in Obsidian.
// Eigene Kräfte-Simulation auf einem Canvas, ohne Fremdpakete. Projekte sind Knotenpunkte, daran hängen Stand, Notizen
// und Doku. Klick auf eine Datei: hinzoomen und daneben lesen.

const FARBEN = {
  projekt: '#8fd16a', ruht: '#5d6169', stand: '#6fa8ff', notiz: '#b78cff', doku: '#f2c14e', index: '#e8e9eb', hub: '#e8e9eb', eigen: '#e8875f',
};
const ARTEN = { stand: 'Stand', notiz: 'Notiz', doku: 'Doku', index: 'Gedächtnis-Index', hub: 'Knotenpunkt', projekt: 'Projekt', eigen: 'Eigene Notiz' };
const DATEI = new Set(['stand', 'notiz', 'doku', 'index', 'eigen']);

let zustand = null;   // bleibt über Seitenwechsel erhalten (Lage der Knoten, Ausschnitt)

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- Markdown → HTML (sicher: erst escapen, dann formatieren) ----------

function inline(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*\s][^*]*)\*(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>')
    .replace(/\[\[([^\]|#]+)(?:[|#]([^\]]*))?\]\]/g, (m, ziel, text) => `<a href="#" class="wiki" data-wiki="${ziel.trim()}">${text || ziel}</a>`)
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, text, ziel) => {
      if (/^https?:\/\//.test(ziel)) return `<a href="${ziel}" target="_blank" rel="noopener noreferrer">${text}</a>`;
      const md = /([\w.-]+)\.md$/.exec(ziel);
      return md ? `<a href="#" class="wiki" data-wiki="${md[1]}">${text}</a>` : `<span class="link-tot">${text}</span>`;
    });
}

export function markdown(text) {
  const zeilen = String(text).replace(/\r\n/g, '\n').split('\n');
  const aus = [];
  let i = 0;
  if (zeilen[0] === '---') {
    const ende = zeilen.indexOf('---', 1);
    if (ende > 0) {
      aus.push('<dl class="eigenschaften">' + zeilen.slice(1, ende).map(z => {
        const m = /^([\w-]+):\s*(.*)$/.exec(z); return m ? `<dt>${esc(m[1])}</dt><dd>${inline(m[2])}</dd>` : '';
      }).join('') + '</dl>');
      i = ende + 1;
    }
  }
  let liste = null, absatz = [];
  const absatzEnde = () => { if (absatz.length) { aus.push('<p>' + absatz.map(inline).join('<br>') + '</p>'); absatz = []; } };
  const listeEnde = () => { if (liste) { aus.push(`</${liste}>`); liste = null; } };
  for (; i < zeilen.length; i++) {
    const z = zeilen[i];
    if (/^```/.test(z)) {
      absatzEnde(); listeEnde();
      const code = [];
      for (i++; i < zeilen.length && !/^```/.test(zeilen[i]); i++) code.push(zeilen[i]);
      aus.push('<pre><code>' + esc(code.join('\n')) + '</code></pre>');
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(z) && /^\s*\|[\s:|-]+\|\s*$/.test(zeilen[i + 1] || '')) {
      absatzEnde(); listeEnde();
      const zelle = r => r.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      const kopf = zelle(z); i += 2;
      const reihen = [];
      for (; i < zeilen.length && /^\s*\|.*\|\s*$/.test(zeilen[i]); i++) reihen.push(zelle(zeilen[i]));
      i--;
      aus.push('<table><thead><tr>' + kopf.map(c => `<th>${inline(c)}</th>`).join('') + '</tr></thead><tbody>' +
        reihen.map(r => '<tr>' + r.map(c => `<td>${inline(c)}</td>`).join('') + '</tr>').join('') + '</tbody></table>');
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(z);
    if (h) { absatzEnde(); listeEnde(); aus.push(`<h${h[1].length + 1}>${inline(h[2])}</h${h[1].length + 1}>`); continue; }
    if (/^\s*(---|\*\*\*|___)\s*$/.test(z)) { absatzEnde(); listeEnde(); aus.push('<hr>'); continue; }
    const li = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(z);
    if (li) {
      absatzEnde();
      const art = /\d/.test(li[1]) ? 'ol' : 'ul';
      if (liste !== art) { listeEnde(); aus.push(`<${art}>`); liste = art; }
      const cb = /^\[( |x|X)\]\s+(.*)$/.exec(li[2]);
      aus.push(cb ? `<li class="aufgabe ${cb[1] === ' ' ? '' : 'erledigt'}">${cb[1] === ' ' ? '☐' : '☑'} ${inline(cb[2])}</li>` : `<li>${inline(li[2])}</li>`);
      continue;
    }
    if (/^>\s?/.test(z)) { absatzEnde(); listeEnde(); aus.push(`<blockquote>${inline(z.replace(/^>\s?/, ''))}</blockquote>`); continue; }
    if (!z.trim()) { absatzEnde(); listeEnde(); continue; }
    listeEnde(); absatz.push(z);
  }
  absatzEnde(); listeEnde();
  return aus.join('\n');
}

// ---------- Simulation ----------

function aufbauen(daten, alt) {
  const lage = new Map((alt?.knoten || []).map(k => [k.id, k]));
  const knoten = daten.knoten.map(k => ({ ...k, nachbarn: new Set() }));
  const index = new Map(knoten.map(k => [k.id, k]));
  const kanten = [];
  for (const [a, b] of daten.kanten) {
    const ka = index.get(a), kb = index.get(b);
    if (!ka || !kb) continue;
    ka.nachbarn.add(kb); kb.nachbarn.add(ka);
    kanten.push([ka, kb]);
  }
  const projekte = knoten.filter(k => k.art === 'projekt');
  const R = 60 + Math.sqrt(knoten.length) * 34;
  projekte.forEach((k, i) => { const w = (i / projekte.length) * Math.PI * 2; k.x = Math.cos(w) * R; k.y = Math.sin(w) * R; });
  for (const k of knoten) {
    const l = lage.get(k.id);
    if (l) { k.x = l.x; k.y = l.y; continue; }
    if (k.art === 'hub') { k.x = 0; k.y = 0; continue; }
    if (k.x === undefined) {
      const eltern = [...k.nachbarn].find(n => n.art === 'projekt' || n.art === 'hub');
      const ex = eltern?.x ?? 0, ey = eltern?.y ?? 0;
      k.x = ex + (Math.random() - 0.5) * 80; k.y = ey + (Math.random() - 0.5) * 80;
    }
  }
  for (const k of knoten) {
    k.vx = 0; k.vy = 0;
    const grad = k.nachbarn.size;
    k.r = k.art === 'projekt' ? 7 + Math.min(10, Math.sqrt(grad) * 1.6) : k.art === 'hub' ? 11 : k.art === 'index' ? 7 : 3.4 + Math.min(3, grad * 0.25);
    k.farbe = k.art === 'projekt' ? (k.status === 'ruht' ? FARBEN.ruht : FARBEN.projekt) : FARBEN[k.art];
  }
  return { knoten, kanten, index, hitze: lage.size ? 0.3 : 1 };
}

/** Ein Schritt: Abstoßung (Gitter mit Reichweite), Federn an Kanten, leichter Zug zur Mitte. */
function schritt(n, sichtbar) {
  const ks = n.knoten.filter(sichtbar);
  const ZELLE = 120, REICH2 = 260 * 260;
  const gitter = new Map();
  for (const k of ks) {
    const s = Math.floor(k.x / ZELLE) + ',' + Math.floor(k.y / ZELLE);
    (gitter.get(s) || gitter.set(s, []).get(s)).push(k);
  }
  const a = n.hitze;
  for (const k of ks) {
    const gx = Math.floor(k.x / ZELLE), gy = Math.floor(k.y / ZELLE);
    for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) {
      const z = gitter.get((gx + dx) + ',' + (gy + dy));
      if (!z) continue;
      for (const o of z) {
        if (o === k) continue;
        let ex = k.x - o.x, ey = k.y - o.y, d2 = ex * ex + ey * ey;
        if (d2 > REICH2) continue;
        if (d2 < 1) { ex = Math.random() - 0.5; ey = Math.random() - 0.5; d2 = 1; }
        const f = (k.art === 'projekt' && o.art === 'projekt' ? 2600 : 900) / d2;
        k.vx += ex * f * a * 0.5; k.vy += ey * f * a * 0.5;
      }
    }
  }
  for (const [x, y] of n.kanten) {
    if (!sichtbar(x) || !sichtbar(y)) continue;
    const dx = y.x - x.x, dy = y.y - x.y, d = Math.sqrt(dx * dx + dy * dy) || 1;
    const laenge = (x.art === 'projekt' || y.art === 'projekt' || x.art === 'hub' || y.art === 'hub') ? 55 : 90;
    const f = (d - laenge) * 0.02 * a;
    const fx = dx / d * f, fy = dy / d * f;
    x.vx += fx; x.vy += fy; y.vx -= fx; y.vy -= fy;
  }
  for (const k of ks) {
    k.vx -= k.x * 0.0009 * a; k.vy -= k.y * 0.0009 * a;
    k.vx *= 0.82; k.vy *= 0.82;
    k.x += Math.max(-30, Math.min(30, k.vx)); k.y += Math.max(-30, Math.min(30, k.vy));
  }
  n.hitze = Math.max(0, n.hitze * 0.985 - 0.0005);
}

// ---------- Ansicht ----------

export async function netzZeigen(haupt, { holen, start = null }) {
  haupt.innerHTML = `<div class="pfad">Cockpit / Wissensnetz</div>
    <div class="kopf"><div><h1>Wissensnetz</h1><div class="unterzeile" id="netz-unter">Lädt …</div></div>
      <div class="werkzeuge">
        <input class="suche" id="netz-suche" type="search" placeholder="Datei oder Projekt suchen …" aria-label="Im Netz suchen">
        <button class="knopf leise" data-netz="alles">Alles zeigen</button>
      </div></div>
    <div class="netz-filter">
      <label class="schalter"><input type="checkbox" data-filter="stand" checked><span class="punkt-f stand"></span>Stand</label>
      <label class="schalter"><input type="checkbox" data-filter="notiz" checked><span class="punkt-f notiz"></span>Claudes Notizen</label>
      <label class="schalter"><input type="checkbox" data-filter="doku" checked><span class="punkt-f doku"></span>Doku im Projekt</label>
      <label class="schalter"><input type="checkbox" data-filter="eigen" checked><span class="punkt-f eigen"></span>Meine Notizen</label>
      <label class="schalter"><input type="checkbox" data-filter="ruht"><span class="punkt-f ruht"></span>Ruhende Projekte</label>
      <span class="zeile-klein">Ziehen = verschieben · Mausrad = zoomen · Klick auf eine Datei = hinzoomen und lesen</span>
    </div>
    <div class="netz" id="netz"><canvas id="netz-flaeche"></canvas>
      <aside class="leser" id="leser" hidden><div class="leser-kopf"><div class="leser-titel" id="leser-titel"></div>
        <button class="knopf leise" data-netz="schliessen" aria-label="Schließen">✕</button></div>
        <div class="leser-info" id="leser-info"></div><div class="leser-text" id="leser-text"></div></aside>
    </div>`;
  const daten = await holen('/api/netz');
  const n = aufbauen(daten, zustand?.netz);
  const filter = { stand: true, notiz: true, doku: true, eigen: true, ruht: false, ...(zustand?.filter || {}) };
  for (const box of haupt.querySelectorAll('[data-filter]')) box.checked = !!filter[box.dataset.filter];
  const ansicht = zustand?.ansicht || { x: 0, y: 0, k: 0.55 };
  let gewaehlt = null, ueber = null, animation = null;
  zustand = { netz: n, filter, ansicht };

  const projektRuht = k => k.art === 'projekt' && k.status === 'ruht';
  const elternRuhen = k => k.art !== 'projekt' && k.art !== 'hub' && k.art !== 'index' &&
    [...k.nachbarn].filter(x => x.art === 'projekt').length > 0 && [...k.nachbarn].filter(x => x.art === 'projekt').every(projektRuht);
  const sichtbar = k => {
    if (k.art === 'projekt') return filter.ruht || k.status !== 'ruht';
    if (k.id === 'h:mensch') return filter.eigen;
    if (k.art === 'hub' || k.art === 'index') return filter.notiz;
    if (!filter[k.art]) return false;
    return filter.ruht || !elternRuhen(k);
  };
  const zahl = n.knoten.filter(sichtbar).length;
  haupt.querySelector('#netz-unter').textContent = `${n.knoten.filter(k => k.art === 'projekt').length} Projekte · ${n.knoten.filter(k => DATEI.has(k.art)).length} Dateien · ${n.kanten.length} Verbindungen`;

  const leser = haupt.querySelector('#leser');
  const flaeche = haupt.querySelector('#netz-flaeche');
  const behaelter = haupt.querySelector('#netz');
  const ctx = flaeche.getContext('2d');
  let breite = 0, hoehe = 0;
  const groesse = () => {
    const r = behaelter.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    breite = r.width; hoehe = r.height;
    flaeche.width = Math.round(breite * dpr); flaeche.height = Math.round(hoehe * dpr);
    flaeche.style.width = breite + 'px'; flaeche.style.height = hoehe + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  groesse();
  const weltZuBild = (x, y) => [(x - ansicht.x) * ansicht.k + breite / 2, (y - ansicht.y) * ansicht.k + hoehe / 2];
  const bildZuWelt = (x, y) => [(x - breite / 2) / ansicht.k + ansicht.x, (y - hoehe / 2) / ansicht.k + ansicht.y];

  function zeichnen() {
    ctx.clearRect(0, 0, breite, hoehe);
    const fokus = gewaehlt || ueber;
    const nah = fokus ? new Set([fokus, ...fokus.nachbarn]) : null;
    ctx.lineWidth = 1;
    for (const [a, b] of n.kanten) {
      if (!sichtbar(a) || !sichtbar(b)) continue;
      const hell = nah && nah.has(a) && nah.has(b) && (a === fokus || b === fokus);
      ctx.strokeStyle = hell ? 'rgba(166,227,107,.55)' : nah ? 'rgba(255,255,255,.03)' : 'rgba(255,255,255,.07)';
      const [x1, y1] = weltZuBild(a.x, a.y), [x2, y2] = weltZuBild(b.x, b.y);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    }
    const schrift = Math.max(10, Math.min(14, 11 * Math.sqrt(ansicht.k)));
    ctx.font = `${schrift}px -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (const k of n.knoten) {
      if (!sichtbar(k)) continue;
      const [x, y] = weltZuBild(k.x, k.y);
      if (x < -60 || y < -60 || x > breite + 60 || y > hoehe + 60) continue;
      const r = Math.max(2, k.r * Math.sqrt(ansicht.k));
      ctx.globalAlpha = nah && !nah.has(k) ? 0.18 : 1;
      ctx.fillStyle = k.farbe;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      if (k === gewaehlt) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, r + 3, 0, Math.PI * 2); ctx.stroke(); ctx.lineWidth = 1; }
      const zeigeName = k.art === 'projekt' || k.art === 'hub' || k === fokus || (nah && nah.has(k)) || ansicht.k > 1.7;
      if (zeigeName) {
        ctx.fillStyle = k.art === 'projekt' || k.art === 'hub' ? '#e8e9eb' : '#a9adb4';
        const t = k.titel.length > 42 ? k.titel.slice(0, 40) + '…' : k.titel;
        ctx.fillText(t, x, y + r + 3);
      }
    }
    ctx.globalAlpha = 1;
  }

  function takt() {
    if (!document.body.contains(flaeche)) return;                    // Seite gewechselt
    if (n.hitze > 0.002) schritt(n, sichtbar);
    if (animation) {
      const t = Math.min(1, (performance.now() - animation.start) / animation.dauer);
      const e = 1 - Math.pow(1 - t, 3);
      ansicht.x = animation.von.x + (animation.nach.x - animation.von.x) * e;
      ansicht.y = animation.von.y + (animation.nach.y - animation.von.y) * e;
      ansicht.k = animation.von.k + (animation.nach.k - animation.von.k) * e;
      if (t >= 1) animation = null;
    }
    zeichnen();
    requestAnimationFrame(takt);
  }

  // Ziel in die Mitte des freien Bereichs links vom Lesefenster rücken
  const zoomZu = (k, faktor) => {
    const leserBreite = leser && !leser.hidden ? leser.getBoundingClientRect().width : 0;
    animation = { start: performance.now(), dauer: 550, von: { ...ansicht }, nach: { x: k.x + (leserBreite / 2) / faktor, y: k.y, k: faktor } };
  };
  const allesZeigen = () => {
    const ks = n.knoten.filter(sichtbar);
    if (!ks.length) return;
    const xs = ks.map(k => k.x), ys = ks.map(k => k.y);
    const w = Math.max(...xs) - Math.min(...xs) + 120, h = Math.max(...ys) - Math.min(...ys) + 120;
    animation = { start: performance.now(), dauer: 550, von: { ...ansicht },
      nach: { x: (Math.max(...xs) + Math.min(...xs)) / 2, y: (Math.max(...ys) + Math.min(...ys)) / 2, k: Math.min(2.5, Math.min(breite / w, hoehe / h)) } };
  };

  // ---------- Lesefenster ----------
  async function oeffnen(k) {
    gewaehlt = k;
    leser.hidden = false;
    behaelter.classList.add('mit-leser');
    haupt.querySelector('#leser-titel').innerHTML = `<span class="punkt-f ${k.art === 'projekt' && k.status === 'ruht' ? 'ruht' : k.art}"></span>${esc(k.titel)}`;
    const info = haupt.querySelector('#leser-info'), text = haupt.querySelector('#leser-text');
    if (k.art === 'projekt') {
      const dateien = [...k.nachbarn].filter(x => DATEI.has(x.art));
      info.innerHTML = `Projekt · ~/claude/${esc(k.ordner)}${k.offen ? ` · ${k.offen} offene To-dos` : ''} · <a href="#/p/${encodeURIComponent(k.ordner)}">Projektseite öffnen</a>`;
      text.innerHTML = dateien.length ? '<ul class="leser-liste">' + dateien.sort((a, b) => a.art.localeCompare(b.art) || a.titel.localeCompare(b.titel))
        .map(d => `<li><a href="#" data-knoten="${esc(d.id)}"><span class="punkt-f ${d.art}"></span>${esc(d.titel)}</a></li>`).join('') + '</ul>' : '<p class="leer">Keine Dateien.</p>';
      zoomZu(k, Math.max(ansicht.k, 1.5));
      return;
    }
    if (k.art === 'hub') {
      info.textContent = k.id === 'h:mensch' ? 'Deine Ideen, Notizen und Aufnahmen (mensch/)' : 'Notizen, die zu keinem Projekt gehören';
      text.innerHTML = '<ul class="leser-liste">' + [...k.nachbarn].sort((a, b) => a.titel.localeCompare(b.titel))
        .map(d => `<li><a href="#" data-knoten="${esc(d.id)}"><span class="punkt-f ${d.art}"></span>${esc(d.titel)}</a></li>`).join('') + '</ul>';
      zoomZu(k, Math.max(ansicht.k, 1.2));
      return;
    }
    zoomZu(k, 2.6);
    info.textContent = 'Lädt …'; text.innerHTML = '';
    try {
      const d = await holen('/api/netz/datei?id=' + encodeURIComponent(k.id));
      if (gewaehlt !== k) return;
      const projekte = [...k.nachbarn].filter(x => x.art === 'projekt');
      const obsidian = k.vault ? ` · <a href="#/bearbeiten/${encodeURIComponent(k.vault)}">Bearbeiten</a>` : '';
      info.innerHTML = `${ARTEN[k.art]} · <code>${esc(d.pfad)}</code> · geändert ${new Date(d.geaendert).toLocaleDateString('de-DE')}${obsidian}` +
        (projekte.length ? `<br>gehört zu ${projekte.map(p => `<a href="#" data-knoten="${esc(p.id)}">${esc(p.titel)}</a>`).join(', ')}` : '');
      text.innerHTML = markdown(d.text) + (d.gekuerzt ? '<p class="leer">… gekürzt</p>' : '');
    } catch (e) { info.textContent = e.message; }
  }
  const schliessen = () => { leser.hidden = true; behaelter.classList.remove('mit-leser'); gewaehlt = null; };

  leser.addEventListener('click', e => {
    const a = e.target.closest('a[data-knoten], a.wiki');
    if (!a) return;
    e.preventDefault();
    let ziel = a.dataset.knoten ? n.index.get(a.dataset.knoten) : null;
    if (!ziel && a.dataset.wiki) {
      const w = a.dataset.wiki.toLowerCase();
      ziel = n.knoten.find(k => k.art === 'notiz' && k.titel.toLowerCase() === w) || n.knoten.find(k => k.titel.toLowerCase().includes(w));
    }
    if (ziel) oeffnen(ziel);
  });

  // ---------- Maus und Finger ----------
  let ziehen = null;
  const treffer = (bx, by) => {
    const [wx, wy] = bildZuWelt(bx, by);
    let bester = null, bestD = Infinity;
    for (const k of n.knoten) {
      if (!sichtbar(k)) continue;
      const d = Math.hypot(k.x - wx, k.y - wy), grenze = (k.r + 5) / Math.sqrt(ansicht.k) + 4 / ansicht.k;
      if (d < grenze && d < bestD) { bester = k; bestD = d; }
    }
    return bester;
  };
  const punkt = e => { const r = flaeche.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  flaeche.addEventListener('pointerdown', e => {
    const [x, y] = punkt(e);
    ziehen = { x, y, sx: ansicht.x, sy: ansicht.y, bewegt: false };
    flaeche.setPointerCapture(e.pointerId);
  });
  flaeche.addEventListener('pointermove', e => {
    const [x, y] = punkt(e);
    if (ziehen) {
      if (Math.hypot(x - ziehen.x, y - ziehen.y) > 4) ziehen.bewegt = true;
      if (ziehen.bewegt) { animation = null; ansicht.x = ziehen.sx - (x - ziehen.x) / ansicht.k; ansicht.y = ziehen.sy - (y - ziehen.y) / ansicht.k; }
      return;
    }
    const k = treffer(x, y);
    if (k !== ueber) { ueber = k; flaeche.style.cursor = k ? 'pointer' : 'grab'; }
  });
  flaeche.addEventListener('pointerup', e => {
    const [x, y] = punkt(e);
    const war = ziehen; ziehen = null;
    if (war && !war.bewegt) { const k = treffer(x, y); if (k) oeffnen(k); else if (gewaehlt) schliessen(); }
  });
  flaeche.addEventListener('pointerleave', () => { ueber = null; });
  flaeche.addEventListener('wheel', e => {
    e.preventDefault();
    animation = null;
    const [x, y] = punkt(e);
    const [wx, wy] = bildZuWelt(x, y);
    ansicht.k = Math.max(0.12, Math.min(6, ansicht.k * Math.exp(-e.deltaY * 0.0015)));
    ansicht.x = wx - (x - breite / 2) / ansicht.k; ansicht.y = wy - (y - hoehe / 2) / ansicht.k;
  }, { passive: false });
  const beiGroesse = () => { if (document.body.contains(flaeche)) groesse(); else window.removeEventListener('resize', beiGroesse); };
  window.addEventListener('resize', beiGroesse);

  haupt.querySelector('.netz-filter').addEventListener('change', e => {
    const box = e.target.closest('[data-filter]'); if (!box) return;
    filter[box.dataset.filter] = box.checked;
    n.hitze = Math.max(n.hitze, 0.35);
  });
  haupt.querySelector('[data-netz="alles"]').addEventListener('click', allesZeigen);
  haupt.querySelector('[data-netz="schliessen"]').addEventListener('click', schliessen);
  haupt.querySelector('#netz-suche').addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    const q = e.target.value.trim().toLowerCase();
    if (!q) return;
    const k = n.knoten.filter(sichtbar).find(x => x.titel.toLowerCase() === q) || n.knoten.filter(sichtbar).find(x => x.titel.toLowerCase().includes(q))
      || n.knoten.find(x => x.titel.toLowerCase().includes(q));
    if (k) oeffnen(k);
  });

  // Erstes Öffnen: Simulation vorwärmen, dann alles ins Bild
  if (!zustand.vorgewaermt) {
    for (let i = 0; i < 260 && n.hitze > 0.05; i++) schritt(n, sichtbar);
    zustand.vorgewaermt = true;
    const ks = n.knoten.filter(sichtbar), xs = ks.map(k => k.x), ys = ks.map(k => k.y);
    ansicht.x = (Math.max(...xs) + Math.min(...xs)) / 2; ansicht.y = (Math.max(...ys) + Math.min(...ys)) / 2;
    ansicht.k = Math.min(1.5, Math.min(breite / (Math.max(...xs) - Math.min(...xs) + 120), hoehe / (Math.max(...ys) - Math.min(...ys) + 120)));
  }
  void zahl;
  if (start && n.index.get(start)) {
    const k = n.index.get(start);
    if (k.art === 'projekt' && k.status === 'ruht') { filter.ruht = true; haupt.querySelector('[data-filter="ruht"]').checked = true; }
    oeffnen(k);
  }
  requestAnimationFrame(takt);
}
