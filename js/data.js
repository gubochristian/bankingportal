// Datenquellen: simulierte Demodaten, Twelve Data API und CSV-Import.
// Alle Loader liefern Bars aufsteigend sortiert:
// { time: 'YYYY-MM-DD', open, high, low, close, volume }

import { lookupSecurity } from './securities.js';

// ---------- Demodaten ----------

function hashString(s) {
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

function mulberry32(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function toIsoDate(d) {
  return d.toISOString().slice(0, 10);
}

// Normalverteilte Zufallszahl, deterministisch aus einem Schlüssel (z. B. „MARKET|2025-01-02“).
// So erhalten alle Symbole am selben Tag denselben Markt- bzw. Sektorfaktor.
function gaussFor(key) {
  const rand = mulberry32(hashString(key));
  const u = 1 - rand();
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const MARKET_VOL = 0.011;
const SECTOR_VOL = 0.008;

// Tägliche Marktrendite inkl. wechselnder Trendphasen (ca. 3 Monate je Phase)
function marketReturn(date) {
  const phase = Math.floor(Date.parse(date) / (864e5 * 91));
  const drift = (mulberry32(hashString(`MARKET|phase|${phase}`))() - 0.4) * 0.0022;
  return drift + gaussFor(`MARKET|${date}`) * MARKET_VOL;
}

// Simulierte Kurse nach einem einfachen Faktormodell:
//   Rendite = Beta × Markt + Sektorfaktor + titelspezifisches Rauschen
// Dadurch sind Aktien untereinander realistisch korreliert (stärker innerhalb
// eines Sektors), und Anleihen/Gold verhalten sich anders als Aktien.
// Gleiches Symbol ergibt immer dieselbe Kurve.
export function generateDemoBars(symbol, { days = 3 * 252, endDate = new Date(), profile } = {}) {
  const sym = symbol.toUpperCase();
  const known = lookupSecurity(sym);
  const rand = mulberry32(hashString(sym));
  const p = profile ?? known?.profile ?? {};
  const beta = p.beta ?? 0.6 + rand() * 0.9;
  const idio = p.idio ?? 0.007 + rand() * 0.008;
  const sector = p.etf ? null : known?.sector ?? `Sektor ${hashString(sym) % 6}`;
  const alpha = (rand() - 0.5) * 0.0008;

  const dates = [];
  const d = new Date(Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), endDate.getUTCDate()));
  while (dates.length < days) {
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) dates.unshift(toIsoDate(d));
    d.setUTCDate(d.getUTCDate() - 1);
  }

  let price = 20 + rand() * 280;
  const baseVolume = 1e6 * (1 + rand() * 20);
  const bars = [];

  for (const date of dates) {
    const sectorMove = sector ? gaussFor(`SECTOR|${sector}|${date}`) * SECTOR_VOL : 0;
    const ret = alpha + beta * marketReturn(date) + sectorMove + gaussFor(`${sym}|${date}`) * idio;
    const dayVol = Math.abs(beta) * MARKET_VOL + idio;
    const open = price * (1 + gaussFor(`${sym}|open|${date}`) * dayVol * 0.25);
    const close = price * Math.exp(ret);
    const high = Math.max(open, close) * (1 + Math.abs(gaussFor(`${sym}|high|${date}`)) * dayVol * 0.4);
    const low = Math.min(open, close) * (1 - Math.abs(gaussFor(`${sym}|low|${date}`)) * dayVol * 0.4);
    const volume = Math.round(baseVolume * (0.6 + rand() * 0.8) * (1 + (Math.abs(close - open) / open) * 20));
    bars.push({ time: date, open: round(open), high: round(high), low: round(low), close: round(close), volume });
    price = close;
  }
  return bars;
}

function round(v) {
  return Math.round(v * 100) / 100;
}

// ---------- Twelve Data ----------

export async function fetchTwelveData(symbol, apiKey, { outputsize = 1500 } = {}) {
  const url = new URL('https://api.twelvedata.com/time_series');
  url.search = new URLSearchParams({
    symbol,
    interval: '1day',
    outputsize: String(outputsize),
    apikey: apiKey,
  });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} von Twelve Data`);
  const json = await res.json();
  if (json.status === 'error') throw new Error(json.message || 'Unbekannter Fehler von Twelve Data');
  if (!Array.isArray(json.values) || json.values.length === 0) {
    throw new Error(`Keine Kursdaten für „${symbol}“ gefunden`);
  }
  const bars = json.values
    .map((v) => ({
      time: v.datetime.slice(0, 10),
      open: Number(v.open),
      high: Number(v.high),
      low: Number(v.low),
      close: Number(v.close),
      volume: Number(v.volume ?? 0),
    }))
    .sort((a, b) => a.time.localeCompare(b.time));
  return {
    bars,
    meta: {
      name: json.meta?.symbol ?? symbol,
      currency: json.meta?.currency ?? '',
      exchange: json.meta?.exchange ?? '',
    },
  };
}

// ---------- CSV-Import ----------

const COLUMN_ALIASES = {
  time: ['date', 'datum', 'time', 'datetime', 'timestamp'],
  open: ['open', 'eröffnung', 'eroeffnung', 'erster', 'opening'],
  high: ['high', 'hoch', 'max'],
  low: ['low', 'tief', 'min'],
  close: ['close', 'schluss', 'schlusskurs', 'letzter', 'kurs', 'price', 'closing'],
  adjClose: ['adj close', 'adj_close', 'adjclose', 'adjusted close'],
  volume: ['volume', 'volumen', 'vol', 'stücke', 'stuecke'],
};

function detectColumn(headers, key) {
  return headers.findIndex((h) => COLUMN_ALIASES[key].includes(h));
}

function parseNumber(raw, decimalComma) {
  if (raw === undefined) return NaN;
  let s = raw.trim().replace(/^"|"$/g, '');
  if (s === '' || s.toLowerCase() === 'null') return NaN;
  s = decimalComma ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  return Number(s);
}

function parseDate(raw) {
  const s = raw.trim().replace(/^"|"$/g, '');
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); // US-Format MM/DD/YYYY
  if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  return null;
}

export function parseCsv(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length < 2) throw new Error('Die CSV-Datei enthält keine Datenzeilen');

  const delimiter = lines[0].includes(';') ? ';' : lines[0].includes('\t') ? '\t' : ',';
  const decimalComma = delimiter !== ',';
  const headers = lines[0].split(delimiter).map((h) => h.trim().replace(/^"|"$/g, '').toLowerCase());

  const idx = Object.fromEntries(Object.keys(COLUMN_ALIASES).map((k) => [k, detectColumn(headers, k)]));
  if (idx.time === -1) throw new Error('Keine Datumsspalte gefunden (erwartet z. B. „Date“ oder „Datum“)');
  if (idx.close === -1 && idx.adjClose === -1) {
    throw new Error('Keine Schlusskurs-Spalte gefunden (erwartet z. B. „Close“ oder „Schlusskurs“)');
  }

  const byDate = new Map();
  for (const line of lines.slice(1)) {
    const cells = line.split(delimiter);
    const time = parseDate(cells[idx.time] ?? '');
    const close = parseNumber(cells[idx.close !== -1 ? idx.close : idx.adjClose], decimalComma);
    if (!time || !Number.isFinite(close)) continue;
    const pick = (key) => {
      const v = idx[key] === -1 ? NaN : parseNumber(cells[idx[key]], decimalComma);
      return Number.isFinite(v) ? v : close;
    };
    const volume = idx.volume === -1 ? 0 : parseNumber(cells[idx.volume], decimalComma);
    byDate.set(time, {
      time,
      open: pick('open'),
      high: Math.max(pick('high'), close),
      low: Math.min(pick('low'), close),
      close,
      volume: Number.isFinite(volume) ? volume : 0,
    });
  }

  const bars = [...byDate.values()].sort((a, b) => a.time.localeCompare(b.time));
  if (bars.length < 2) throw new Error('Zu wenige gültige Datenzeilen in der CSV-Datei');
  return bars;
}
