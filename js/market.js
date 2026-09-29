// Gemeinsamer Kurs-Loader für Einzelanalyse und Depot, mit Cache pro Sitzung.

import { generateDemoBars, fetchTwelveData } from './data.js';
import { lookupSecurity } from './securities.js';

const cache = new Map();

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
      bars: generateDemoBars(symbol),
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
