// Depotauszug als CSV-Datei: funktioniert mit den Exporten der meisten Banken und Broker
// (z. B. comdirect, Consorsbank, ING, DKB, flatex, Trade Republic über Drittanbieter).
// Erkennt Trennzeichen, Kopfzeile (auch nach Vorspann-Zeilen) und Spalten automatisch.

const ALIASES = {
  isin: ['isin'],
  wkn: ['wkn'],
  symbol: ['symbol', 'ticker', 'kürzel', 'kuerzel'],
  name: ['name', 'bezeichnung', 'wertpapier', 'wertpapiername', 'titel', 'instrument', 'gattungsbezeichnung'],
  quantity: ['stück', 'stueck', 'stück/nominale', 'stück/nominal', 'anzahl', 'menge', 'bestand', 'nominale', 'nominal', 'quantity', 'shares', 'stk', 'stk.'],
  buyPrice: ['einstandskurs', 'kaufkurs', 'einstand', 'ø kaufkurs', 'durchschnittskurs', 'kaufpreis', 'einstandspreis', 'average price', 'avg price', 'avg. price', 'ø-kurs'],
  price: ['kurs', 'aktueller kurs', 'akt. kurs', 'letzter kurs', 'price', 'current price'],
  currency: ['währung', 'waehrung', 'currency', 'whg', 'whg.'],
  value: ['wert', 'kurswert', 'marktwert', 'wert in eur', 'kurswert in eur', 'value', 'market value', 'gesamtwert'],
};

const norm = (h) => h.trim().replace(/^"|"$/g, '').toLowerCase().replace(/\s+/g, ' ');

function splitLine(line, delimiter) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else quoted = !quoted;
    } else if (ch === delimiter && !quoted) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

// "1.234,56" (deutsch) bzw. "1,234.56" (englisch) → Zahl
export function parseAmount(raw) {
  let s = String(raw ?? '').replace(/[^\d,.-]/g, '');
  if (!s || s === '-') return null;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/,/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function parseDepotCsv(text) {
  const lines = String(text).replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) throw Object.assign(new Error('Die Datei ist leer.'), { userFacing: true });

  // Kopfzeile in den ersten 20 Zeilen suchen: braucht eine Mengen- und eine Bezeichnungs-/ISIN-Spalte
  let headerIdx = -1;
  let delimiter = ';';
  let cols = null;
  for (let i = 0; i < Math.min(lines.length, 20) && headerIdx === -1; i++) {
    for (const d of [';', ',', '\t']) {
      const cells = splitLine(lines[i], d).map(norm);
      const find = (key) => cells.findIndex((c) => ALIASES[key].includes(c));
      const idx = Object.fromEntries(Object.keys(ALIASES).map((k) => [k, find(k)]));
      if (idx.quantity !== -1 && (idx.isin !== -1 || idx.name !== -1 || idx.symbol !== -1)) {
        headerIdx = i;
        delimiter = d;
        cols = idx;
        break;
      }
    }
  }
  if (headerIdx === -1) {
    throw Object.assign(new Error('Keine passende Kopfzeile gefunden. Erwartet werden Spalten wie „ISIN“ oder „Bezeichnung“ und „Stück“.'), {
      userFacing: true,
    });
  }

  const positions = [];
  for (const line of lines.slice(headerIdx + 1)) {
    const cells = splitLine(line, delimiter);
    const get = (key) => (cols[key] === -1 ? '' : (cells[cols[key]] ?? '').replace(/^"|"$/g, ''));
    const quantity = parseAmount(get('quantity'));
    if (!(quantity > 0)) continue; // Summen-, Leer- und Fußzeilen überspringen
    positions.push({
      isin: get('isin'),
      wkn: get('wkn'),
      symbol: get('symbol'),
      name: get('name'),
      quantity,
      buyPrice: parseAmount(get('buyPrice')),
      buyCurrency: get('currency') || 'EUR',
      price: parseAmount(get('price')),
      currency: get('currency') || 'EUR',
      value: parseAmount(get('value')),
    });
  }
  if (!positions.length) throw Object.assign(new Error('In der Datei wurden keine Positionen mit Stückzahl gefunden.'), { userFacing: true });
  return positions;
}

export default {
  id: 'csv',
  name: 'Depotauszug (CSV-Datei)',
  category: 'Datei-Import',
  status: 'available',
  description:
    'Funktioniert mit fast jeder Bank: Exportiere deinen Depotbestand als CSV und lade die Datei beim Abruf hoch. Spalten wie ISIN, Bezeichnung, Stück und Einstandskurs werden automatisch erkannt.',
  requiresUpload: true,
  fields: [],

  async test() {
    return { ok: true, message: 'Bereit – beim Abruf wird die CSV-Datei hochgeladen.' };
  },

  async fetchPositions(config, ctx) {
    if (!ctx.upload) throw Object.assign(new Error('Bitte eine CSV-Datei auswählen.'), { userFacing: true });
    return { account: { name: 'CSV-Depotauszug' }, positions: parseDepotCsv(ctx.upload) };
  },
};
