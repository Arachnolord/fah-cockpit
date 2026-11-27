// ============================================================================
// Erdacht und programmiert von Fabian Hammer, Deutschland.
// (c) 2026 Fabian Hammer - Alle Rechte vorbehalten. Geistiges Eigentum.
// ============================================================================
// Bilder in Aufträgen (wie Einfügen im Terminal): Die Oberfläche schickt eingefügte Bilder als base64, hier wird jedes
// geprüft (Art an den ersten Bytes, nicht am Namen; Größe wie die Grenze der Claude-API), abgelegt unter
// <ablage>/auftraege/bilder/<auftrag>/bild-NN.<endung> und als Bild-Block an Claude gegeben.

export const MAX_BILDER = 10;                 // je Nachricht
export const MAX_BYTES = 3_750_000;           // je Bild ≈ 5 MB als base64 – mehr nimmt die Claude-API nicht
export const MAX_NACHRICHT = 12_000_000;      // alle Bilder einer Nachricht zusammen (≈ 16 MB base64)
export const MAX_AUFTRAG = 20_000_000;        // alle Bilder eines Auftrags: --resume schickt den ganzen Verlauf
                                              // mit, die Claude-API nimmt höchstens 32 MB je Anfrage
export const KOERPER_GRENZE = 17_000_000;     // ganze Anfrage: Bilder als base64 plus Text

export const BILDNAME = /^bild-\d{2,4}\.(png|jpg|gif|webp)$/;
export const TYP_VON_ENDUNG = { png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const ARTEN = [
  { typ: 'image/png', endung: 'png', passt: b => b.length > 8 && b.subarray(0, 8).equals(PNG) },
  { typ: 'image/jpeg', endung: 'jpg', passt: b => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { typ: 'image/gif', endung: 'gif', passt: b => /^GIF8[79]a$/.test(b.subarray(0, 6).toString('latin1')) },
  { typ: 'image/webp', endung: 'webp', passt: b => b.length > 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
];

export class BildFehler extends Error {}

/** Art eines Bildes an den ersten Bytes – oder null. */
export function bildArt(puffer) {
  return ARTEN.find(a => a.passt(puffer)) || null;
}

/**
 * Bilder aus einer Anfrage prüfen.
 * @param {unknown} liste  [{ daten: '<base64 oder data:-URL>' }, …]
 * @returns {{ typ: string, endung: string, puffer: Buffer }[]}
 */
export function bilderPruefen(liste) {
  if (liste === undefined || liste === null) return [];
  if (!Array.isArray(liste)) throw new BildFehler('Bilder bitte als Liste schicken.');
  if (liste.length > MAX_BILDER) throw new BildFehler(`Höchstens ${MAX_BILDER} Bilder je Nachricht.`);
  const bilder = liste.map((b, i) => {
    let roh = typeof b === 'string' ? b : String(b?.daten ?? '');
    roh = roh.replace(/^data:image\/[\w.+-]+;base64,/, '').replace(/\s+/g, '');
    if (!roh || !/^[A-Za-z0-9+/]+={0,2}$/.test(roh)) throw new BildFehler(`Bild ${i + 1} ist nicht lesbar.`);
    if (roh.length > Math.ceil(MAX_BYTES / 3) * 4 + 4) throw new BildFehler(`Bild ${i + 1} ist zu groß (höchstens 3,7 MB).`);
    const puffer = Buffer.from(roh, 'base64');
    if (puffer.length > MAX_BYTES) throw new BildFehler(`Bild ${i + 1} ist zu groß (höchstens 3,7 MB).`);
    const art = bildArt(puffer);
    if (!art) throw new BildFehler(`Bild ${i + 1}: nur PNG, JPEG, GIF oder WebP.`);
    return { typ: art.typ, endung: art.endung, puffer };
  });
  if (bilder.reduce((n, b) => n + b.puffer.length, 0) > MAX_NACHRICHT) throw new BildFehler('Zusammen zu groß (höchstens 12 MB je Nachricht) – bitte weniger oder kleinere Bilder.');
  return bilder;
}
