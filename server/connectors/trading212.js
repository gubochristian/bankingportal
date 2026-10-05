// Trading 212 – offizielle Public API (Beta).
// Dokumentation: https://t212public-api-docs.redoc.ly/
// Den API-Schlüssel erzeugt man in der Trading-212-App unter Einstellungen → API (Beta).
// Hinweis: Mit einem echten Konto wurde dieser Connector noch nicht getestet.

const BASE = {
  live: 'https://live.trading212.com',
  demo: 'https://demo.trading212.com',
};

function authHeader(config) {
  // Neuere Schlüssel bestehen aus Key + Secret (HTTP Basic), ältere nur aus dem Key.
  if (config.apiSecret) return `Basic ${Buffer.from(`${config.apiKey}:${config.apiSecret}`).toString('base64')}`;
  return config.apiKey;
}

async function call(config, ctx, path) {
  const res = await ctx.fetch(`${BASE[config.environment] ?? BASE.live}${path}`, {
    headers: { Authorization: authHeader(config), Accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 401 || res.status === 403) {
    throw Object.assign(new Error('Trading 212 hat den API-Schlüssel abgelehnt. Bitte Schlüssel und Berechtigungen (Portfolio lesen) prüfen.'), { userFacing: true });
  }
  if (res.status === 429) throw Object.assign(new Error('Trading 212: Abruflimit erreicht, bitte kurz warten.'), { userFacing: true });
  if (!res.ok) throw Object.assign(new Error(`Trading 212 antwortete mit HTTP ${res.status}.`), { userFacing: true });
  return res.json();
}

// "AAPL_US_EQ" → "AAPL", "VUSAl_EQ" (London) → "VUSA"
export function tickerToSymbol(ticker) {
  const base = String(ticker ?? '').split('_')[0];
  return base.replace(/[a-z]+$/, '').toUpperCase();
}

export default {
  id: 'trading212',
  name: 'Trading 212',
  category: 'Broker (API)',
  status: 'beta',
  website: 'https://www.trading212.com',
  description: 'Liest die offenen Positionen über die offizielle Trading-212-API. Nur Lesezugriff nötig.',
  notes: 'Beta: noch nicht mit einem echten Konto getestet. Einstandskurse werden nicht übernommen, da sie in der Handelswährung geliefert werden.',
  fields: [
    { key: 'apiKey', label: 'API-Schlüssel', type: 'password', required: true, secret: true, help: 'Trading 212 → Einstellungen → API (Beta)' },
    { key: 'apiSecret', label: 'API-Secret (falls vorhanden)', type: 'password', required: false, secret: true },
    {
      key: 'environment',
      label: 'Umgebung',
      type: 'select',
      required: true,
      options: [
        { value: 'live', label: 'Echtgeld-Konto' },
        { value: 'demo', label: 'Übungskonto (Demo)' },
      ],
    },
  ],

  async test(config, ctx) {
    const info = await call(config, ctx, '/api/v0/equity/account/info');
    return { ok: true, message: `Verbunden mit Trading-212-Konto ${info.id ?? ''} (${info.currencyCode ?? '?'}).`.replace(' ()', '') };
  },

  async fetchPositions(config, ctx) {
    const items = await call(config, ctx, '/api/v0/equity/portfolio');
    if (!Array.isArray(items)) throw Object.assign(new Error('Unerwartete Antwort von Trading 212.'), { userFacing: true });
    return {
      account: { name: 'Trading 212' },
      positions: items.map((p) => ({
        symbol: tickerToSymbol(p.ticker),
        name: tickerToSymbol(p.ticker),
        quantity: p.quantity,
        price: p.currentPrice,
      })),
    };
  },
};
