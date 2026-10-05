// Gemeinsamer Kurs-Loader für Einzelanalyse und Depot, mit Cache pro Sitzung.

import { generateDemoBars, fetchTwelveData } from './data.js';
import { lookupSecurity } from './securities.js';

const cache = new Map();

// Wechselkurse als „1 EUR = x Fremdwährung“ (wie bei Twelve Data, z. B. EUR/USD).
// Profile steuern nur die simulierten Demodaten.
export const FX_PROFILES = {
  'EUR/USD': { start: 1.08, idio: 0.0045, beta: 0, alpha: 0, etf: true, decimals: 4 },
  'EUR/CHF': { start: 0.95, idio: 0.003, beta: 0, alpha: 0, etf: true, decimals: 4 },
  'EUR/GBP': { start: 0.85, idio: 0.0033, beta: 0, alpha: 0, etf: true, decimals: 4 },
  'EUR/DKK': { start: 7.46, idio: 0.0002, beta: 0, alpha: 0, etf: true, decimals: 4 },
  'EUR/JPY': { start: 160, idio: 0.006, beta: 0, alpha: 0, etf: true, decimals: 2 },
};

export const fxSymbol = (currency) => `EUR/${currency}`;
export const hasFx = (currency) => fxSymbol(currency) in FX_PROFILES;

// Rechnet Kurse in Euro um: Kurs in Fremdwährung ÷ (Fremdwährung je Euro).
// Tage ohne Wechselkurs nutzen den letzten bekannten (bzw. ersten verfügbaren) Kurs.
export function convertToEur(bars, fxBars) {
  const byDate = new Map(fxBars.map((b) => [b.time, b.close]));
  let fx = fxBars[0]?.close ?? 1;
  return bars.map((b) => {
    fx = byDate.get(b.time) ?? fx;
    return { ...b, open: b.open / fx, high: b.high / fx, low: b.low / fx, close: b.close / fx };
  });
}

export class MissingApiKeyError extends Error {
  constructor() {
    super('Für echte Kursdaten bitte zuerst einen Twelve Data API-Key in den Einstellungen hinterlegen.');
  }
}

const isRateLimit = (err) => /api credits|rate limit|too many/i.test(err.message);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Lädt Tageskurse. Rückgabe: { bars, meta: { name, currency, exchange, source, sourceLabel } }
export async function loadSeries(symbol, { source, apiKey, onWait } = {}) {
  const key = `${source}:${symbol}`;
  if (cache.has(key)) return cache.get(key);

  let result;
  if (source === 'twelvedata') {
    if (!apiKey) throw new MissingApiKeyError();
    let res;
    try {
      res = await fetchTwelveData(symbol, apiKey);
    } catch (err) {
      // Kostenloser Tarif: begrenzte Abrufe pro Minute → einmal warten und erneut versuchen
      if (!isRateLimit(err)) throw err;
      onWait?.(60);
      await wait(61_000);
      res = await fetchTwelveData(symbol, apiKey);
    }
    result = { bars: res.bars, meta: { ...res.meta, source, sourceLabel: 'Twelve Data' } };
  } else {
    result = {
      bars: generateDemoBars(symbol, { profile: FX_PROFILES[symbol] }),
      meta: {
        name: lookupSecurity(symbol)?.name ?? symbol,
        currency: lookupSecurity(symbol)?.currency ?? '',
        source: 'demo',
        sourceLabel: 'Demodaten – simuliert, keine echten Kurse',
      },
    };
  }
  cache.set(key, result);
  return result;
}
