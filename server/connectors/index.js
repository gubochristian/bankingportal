// Registry der Bank- und Broker-Schnittstellen.
//
// Ein Connector ist ein Objekt mit:
//   id, name, category, status ('available' | 'beta' | 'planned'), description, website
//   fields: [{ key, label, type: 'text' | 'password' | 'select', required, secret, options, placeholder, help }]
//   requiresUpload: true, wenn beim Abruf eine Datei (z. B. CSV-Depotauszug) mitgeschickt wird
//   async test(config, ctx)            → { ok: true, message }
//   async fetchPositions(config, ctx)  → { account: { name }, positions: [...] }
//
// ctx enthält { fetch, upload } – fetch ist austauschbar (Tests), upload ist der Dateiinhalt.
// Neue Anbieter: Datei in diesem Ordner anlegen und unten in CONNECTORS eintragen.

import demo from './demo.js';
import csv from './csv.js';
import trading212 from './trading212.js';
import { PLANNED } from './planned.js';
import { SECURITIES, lookupByIsin, isValidIsin } from '../../js/securities.js';

export class ConnectorError extends Error {}

const CONNECTORS = [demo, csv, trading212, ...PLANNED];
const byId = new Map(CONNECTORS.map((c) => [c.id, c]));

export const getConnector = (id) => byId.get(id) ?? null;

// Beschreibung für das Frontend (ohne Funktionen)
export function listConnectors() {
  return CONNECTORS.map(({ id, name, category, status, description, website, fields = [], requiresUpload = false, notes }) => ({
    id,
    name,
    category,
    status,
    description,
    website,
    notes,
    requiresUpload,
    fields: fields.map(({ key, label, type, required, secret, options, placeholder, help }) => ({ key, label, type, required: !!required, secret: !!secret, options, placeholder, help })),
  }));
}

// Prüft und bereinigt die Konfiguration gegen die Felddefinition des Connectors.
// `previous` erlaubt, geheime Felder beim Bearbeiten leer zu lassen (= unverändert).
export function validateConfig(connector, input = {}, previous = {}) {
  if (connector.status === 'planned') throw new ConnectorError(`${connector.name} ist noch nicht verfügbar.`);
  const out = {};
  for (const f of connector.fields ?? []) {
    let v = input[f.key];
    if ((v === undefined || v === '') && f.secret && previous[f.key]) v = previous[f.key];
    if (v === undefined || v === null) v = '';
    if (typeof v !== 'string') throw new ConnectorError(`Ungültiger Wert für „${f.label}“.`);
    v = v.trim();
    if (v.length > 500) throw new ConnectorError(`„${f.label}“ ist zu lang.`);
    if (f.required && !v) throw new ConnectorError(`Bitte „${f.label}“ angeben.`);
    if (f.type === 'select' && v && !f.options.some((o) => o.value === v)) throw new ConnectorError(`Ungültige Auswahl für „${f.label}“.`);
    out[f.key] = v;
  }
  return out;
}

// Konfiguration für die Anzeige: geheime Felder nur maskiert
export function maskConfig(connector, config) {
  const out = {};
  for (const f of connector.fields ?? []) {
    const v = config[f.key] ?? '';
    out[f.key] = f.secret ? (v ? `••••${v.length > 8 ? v.slice(-4) : ''}` : '') : v;
  }
  return out;
}

const num = (v) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
};
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const CURRENCY_RE = /^[A-Z]{3}$/;
const SYMBOL_RE = /^[A-Z0-9.:-]{1,20}$/;

// Vereinheitlicht eine Position und ordnet ihr – wenn möglich – ein Symbol mit Kursdaten zu.
export function normalizePosition(raw) {
  const quantity = num(raw.quantity);
  if (!(quantity > 0)) return null;
  const isin = isValidIsin(raw.isin) ? String(raw.isin).toUpperCase() : null;
  let symbol = str(raw.symbol, 20).toUpperCase();
  let name = str(raw.name, 100);
  let proxy = false;
  if (!SECURITIES[symbol]) {
    const hit = isin ? lookupByIsin(isin) : null;
    if (hit) {
      symbol = hit.symbol;
      proxy = hit.proxy;
      name ||= hit.name;
    }
  }
  if (!SYMBOL_RE.test(symbol)) symbol = isin ?? '';
  if (!symbol) return null;
  const currency = str(raw.currency, 3).toUpperCase();
  const buyCurrency = str(raw.buyCurrency ?? raw.currency, 3).toUpperCase();
  const buyPrice = num(raw.buyPrice);
  const price = num(raw.price);
  const value = num(raw.value);
  return {
    symbol,
    isin,
    wkn: /^[A-Z0-9]{6}$/.test(str(raw.wkn, 6).toUpperCase()) ? str(raw.wkn, 6).toUpperCase() : null,
    name: name || SECURITIES[symbol]?.name || symbol,
    quantity,
    buyPrice: buyPrice !== null && buyPrice >= 0 ? buyPrice : null,
    buyCurrency: CURRENCY_RE.test(buyCurrency) ? buyCurrency : null,
    price: price !== null && price >= 0 ? price : null,
    currency: CURRENCY_RE.test(currency) ? currency : null,
    value: value !== null && value >= 0 ? value : null,
    known: !!SECURITIES[symbol],
    proxy,
  };
}

export async function runFetch(connector, config, ctx) {
  const res = await connector.fetchPositions(config, ctx);
  const positions = [];
  const skipped = [];
  for (const raw of res.positions ?? []) {
    const p = normalizePosition(raw);
    if (p) positions.push(p);
    else skipped.push(str(raw.name, 60) || str(raw.isin, 12) || '?');
  }
  // gleiche Wertpapiere (z. B. aus mehreren Lagerstellen) zusammenfassen
  const merged = new Map();
  for (const p of positions) {
    const prev = merged.get(p.symbol);
    if (!prev) merged.set(p.symbol, p);
    else {
      const qty = prev.quantity + p.quantity;
      if (prev.buyPrice !== null && p.buyPrice !== null && prev.buyCurrency === p.buyCurrency) {
        prev.buyPrice = (prev.buyPrice * prev.quantity + p.buyPrice * p.quantity) / qty;
      } else prev.buyPrice = null;
      prev.value = prev.value !== null && p.value !== null ? prev.value + p.value : null;
      prev.quantity = qty;
    }
  }
  return { account: { name: str(res.account?.name, 100) || null }, positions: [...merged.values()], skipped };
}
