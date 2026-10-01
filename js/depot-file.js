// Export-/Importformat für Depots (JSON). Ohne DOM-Abhängigkeiten, damit testbar.

import { ASSET_CLASSES, SECTORS, REGIONS, CURRENCIES, defaultMeta } from './securities.js';

export const BENCHMARK_NAMES = { URTH: 'MSCI World', VT: 'FTSE All-World', SPY: 'S&P 500', VGK: 'FTSE Europe', EEM: 'MSCI Emerging Markets' };

let counter = 1;
const newId = () => `p${Date.now().toString(36)}i${counter++}`;

// Prüft eine importierte Depot-Datei und übernimmt nur bekannte Felder
export function parseDepotFile(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Die Datei ist kein gültiges JSON.');
  }
  if (data?.format !== 'aktienanalyse-depot' || !Array.isArray(data.positions)) {
    throw new Error('Unbekanntes Format – erwartet wird eine mit dieser App exportierte Depot-Datei.');
  }
  const str = (v, max = 60) => (typeof v === 'string' ? v.slice(0, max) : undefined);
  const numOrNull = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);
  const positions = data.positions
    .filter((p) => typeof p?.symbol === 'string' && /^[A-Za-z0-9.:\-]{1,20}$/.test(p.symbol))
    .map((p) => {
      const symbol = p.symbol.toUpperCase();
      const meta = defaultMeta(symbol);
      const pos = {
        id: newId(),
        symbol,
        name: str(p.name, 80) ?? meta.name,
        type: ASSET_CLASSES.includes(p.type) ? p.type : meta.type,
        sector: SECTORS.includes(p.sector) ? p.sector : meta.sector,
        region: REGIONS.includes(p.region) ? p.region : meta.region,
        currency: CURRENCIES.includes(p.currency) ? p.currency : meta.currency,
        amount: numOrNull(p.amount),
        quantity: numOrNull(p.quantity),
        buyPrice: numOrNull(p.buyPrice),
      };
      if (p.ter === null || typeof p.ter === 'number') pos.ter = numOrNull(p.ter);
      return pos;
    });
  return {
    name: str(data.name) || 'Importiertes Depot',
    mode: data.mode === 'shares' ? 'shares' : 'amount',
    benchmark: Object.keys(BENCHMARK_NAMES).includes(data.benchmark) ? data.benchmark : 'URTH',
    positions,
  };
}
