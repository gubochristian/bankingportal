// Stammdaten für häufige Wertpapiere. Dient zum Vorbelegen von Sektor, Region,
// Anlageklasse und Währung im Depot – alle Werte sind im Depot überschreibbar.
//
// `profile` steuert nur die simulierten Demodaten (Beta zum Markt, eigene
// Volatilität), damit Anleihen, Gold oder ETFs realistischer schwanken.
// `regions` beschreibt die Aufteilung bei breit gestreuten ETFs.
// `ter` = laufende Kosten p. a. (Richtwerte der jeweiligen Anbieter, Stand 2025 – bitte vor dem Kauf prüfen).

export const ASSET_CLASSES = ['Aktie', 'Aktien-ETF', 'Anleihen-ETF', 'Rohstoff', 'Krypto', 'Sonstige'];

export const SECTORS = [
  'Technologie',
  'Kommunikation',
  'Zyklischer Konsum',
  'Basiskonsum',
  'Gesundheit',
  'Finanzen',
  'Industrie',
  'Energie',
  'Rohstoffe & Chemie',
  'Versorger',
  'Immobilien',
  'Diversifiziert',
  'Anleihen',
  'Edelmetalle',
  'Sonstige',
];

export const REGIONS = ['Nordamerika', 'Europa', 'Deutschland', 'Asien-Pazifik', 'Schwellenländer', 'Global', 'Sonstige'];

export const CURRENCIES = ['EUR', 'USD', 'CHF', 'GBP', 'DKK', 'JPY', 'Sonstige'];

// Näherungsweise Regionen-Aufteilung breiter Indizes (Stand: grobe Richtwerte)
const WORLD = { Nordamerika: 0.74, Europa: 0.16, 'Asien-Pazifik': 0.1 };
const ALL_WORLD = { Nordamerika: 0.64, Europa: 0.14, 'Asien-Pazifik': 0.1, Schwellenländer: 0.12 };

const stock = (name, sector, region, currency, profile = {}) => ({ name, type: 'Aktie', sector, region, currency, profile });

export const SECURITIES = {
  // USA
  AAPL: stock('Apple', 'Technologie', 'Nordamerika', 'USD', { beta: 1.1 }),
  MSFT: stock('Microsoft', 'Technologie', 'Nordamerika', 'USD', { beta: 1.0 }),
  NVDA: stock('NVIDIA', 'Technologie', 'Nordamerika', 'USD', { beta: 1.7, idio: 0.019 }),
  AMZN: stock('Amazon', 'Zyklischer Konsum', 'Nordamerika', 'USD', { beta: 1.2 }),
  GOOGL: stock('Alphabet', 'Kommunikation', 'Nordamerika', 'USD', { beta: 1.1 }),
  META: stock('Meta Platforms', 'Kommunikation', 'Nordamerika', 'USD', { beta: 1.3, idio: 0.018 }),
  TSLA: stock('Tesla', 'Zyklischer Konsum', 'Nordamerika', 'USD', { beta: 1.9, idio: 0.025 }),
  JPM: stock('JPMorgan Chase', 'Finanzen', 'Nordamerika', 'USD', { beta: 1.1 }),
  V: stock('Visa', 'Finanzen', 'Nordamerika', 'USD', { beta: 0.9 }),
  JNJ: stock('Johnson & Johnson', 'Gesundheit', 'Nordamerika', 'USD', { beta: 0.5, idio: 0.009 }),
  UNH: stock('UnitedHealth', 'Gesundheit', 'Nordamerika', 'USD', { beta: 0.7 }),
  PG: stock('Procter & Gamble', 'Basiskonsum', 'Nordamerika', 'USD', { beta: 0.4, idio: 0.008 }),
  KO: stock('Coca-Cola', 'Basiskonsum', 'Nordamerika', 'USD', { beta: 0.5, idio: 0.008 }),
  WMT: stock('Walmart', 'Basiskonsum', 'Nordamerika', 'USD', { beta: 0.5 }),
  XOM: stock('ExxonMobil', 'Energie', 'Nordamerika', 'USD', { beta: 0.8, idio: 0.015 }),
  'BRK.B': stock('Berkshire Hathaway', 'Finanzen', 'Nordamerika', 'USD', { beta: 0.8, idio: 0.008 }),
  // Deutschland
  SAP: stock('SAP', 'Technologie', 'Deutschland', 'EUR', { beta: 1.1 }),
  SIE: stock('Siemens', 'Industrie', 'Deutschland', 'EUR', { beta: 1.1 }),
  ALV: stock('Allianz', 'Finanzen', 'Deutschland', 'EUR', { beta: 0.9 }),
  MUV2: stock('Munich Re', 'Finanzen', 'Deutschland', 'EUR', { beta: 0.7 }),
  DTE: stock('Deutsche Telekom', 'Kommunikation', 'Deutschland', 'EUR', { beta: 0.6, idio: 0.009 }),
  BAS: stock('BASF', 'Rohstoffe & Chemie', 'Deutschland', 'EUR', { beta: 1.1 }),
  BAYN: stock('Bayer', 'Gesundheit', 'Deutschland', 'EUR', { beta: 0.9, idio: 0.02 }),
  BMW: stock('BMW', 'Zyklischer Konsum', 'Deutschland', 'EUR', { beta: 1.2 }),
  MBG: stock('Mercedes-Benz Group', 'Zyklischer Konsum', 'Deutschland', 'EUR', { beta: 1.2 }),
  VOW3: stock('Volkswagen Vz.', 'Zyklischer Konsum', 'Deutschland', 'EUR', { beta: 1.3 }),
  ADS: stock('adidas', 'Zyklischer Konsum', 'Deutschland', 'EUR', { beta: 1.1 }),
  IFX: stock('Infineon', 'Technologie', 'Deutschland', 'EUR', { beta: 1.5, idio: 0.02 }),
  DBK: stock('Deutsche Bank', 'Finanzen', 'Deutschland', 'EUR', { beta: 1.4, idio: 0.02 }),
  RWE: stock('RWE', 'Versorger', 'Deutschland', 'EUR', { beta: 0.6 }),
  VNA: stock('Vonovia', 'Immobilien', 'Deutschland', 'EUR', { beta: 0.9, idio: 0.017 }),
  // Europa
  ASML: stock('ASML', 'Technologie', 'Europa', 'EUR', { beta: 1.4, idio: 0.02 }),
  NESN: stock('Nestlé', 'Basiskonsum', 'Europa', 'CHF', { beta: 0.4, idio: 0.008 }),
  NOVN: stock('Novartis', 'Gesundheit', 'Europa', 'CHF', { beta: 0.5, idio: 0.009 }),
  NVO: stock('Novo Nordisk', 'Gesundheit', 'Europa', 'DKK', { beta: 0.7, idio: 0.018 }),
  MC: stock('LVMH', 'Zyklischer Konsum', 'Europa', 'EUR', { beta: 1.1 }),
  SHEL: stock('Shell', 'Energie', 'Europa', 'GBP', { beta: 0.8, idio: 0.014 }),
  // Asien
  TSM: stock('TSMC', 'Technologie', 'Asien-Pazifik', 'USD', { beta: 1.3, idio: 0.018 }),
  TM: stock('Toyota', 'Zyklischer Konsum', 'Asien-Pazifik', 'JPY', { beta: 0.8 }),
  // ETFs
  URTH: { ter: 0.0024, name: 'iShares MSCI World ETF', type: 'Aktien-ETF', sector: 'Diversifiziert', region: 'Global', currency: 'USD', regions: WORLD, profile: { beta: 1.0, idio: 0.002, etf: true } },
  VT: { ter: 0.0006, name: 'Vanguard Total World Stock ETF', type: 'Aktien-ETF', sector: 'Diversifiziert', region: 'Global', currency: 'USD', regions: ALL_WORLD, profile: { beta: 0.98, idio: 0.002, etf: true } },
  SPY: { ter: 0.000945, name: 'SPDR S&P 500 ETF', type: 'Aktien-ETF', sector: 'Diversifiziert', region: 'Nordamerika', currency: 'USD', profile: { beta: 1.0, idio: 0.001, etf: true } },
  QQQ: { ter: 0.002, name: 'Invesco QQQ (Nasdaq 100)', type: 'Aktien-ETF', sector: 'Technologie', region: 'Nordamerika', currency: 'USD', profile: { beta: 1.2, idio: 0.005, etf: true } },
  VGK: { ter: 0.0006, name: 'Vanguard FTSE Europe ETF', type: 'Aktien-ETF', sector: 'Diversifiziert', region: 'Europa', currency: 'USD', profile: { beta: 0.9, idio: 0.004, etf: true } },
  EEM: { ter: 0.007, name: 'iShares MSCI Emerging Markets ETF', type: 'Aktien-ETF', sector: 'Diversifiziert', region: 'Schwellenländer', currency: 'USD', profile: { beta: 0.9, idio: 0.007, etf: true } },
  AGG: { ter: 0.0003, name: 'iShares Core US Aggregate Bond ETF', type: 'Anleihen-ETF', sector: 'Anleihen', region: 'Nordamerika', currency: 'USD', profile: { beta: 0.03, idio: 0.003, etf: true } },
  BND: { ter: 0.0003, name: 'Vanguard Total Bond Market ETF', type: 'Anleihen-ETF', sector: 'Anleihen', region: 'Nordamerika', currency: 'USD', profile: { beta: 0.03, idio: 0.003, etf: true } },
  TLT: { ter: 0.0015, name: 'iShares 20+ Year Treasury Bond ETF', type: 'Anleihen-ETF', sector: 'Anleihen', region: 'Nordamerika', currency: 'USD', profile: { beta: -0.1, idio: 0.009, etf: true } },
  GLD: { ter: 0.004, name: 'SPDR Gold Shares', type: 'Rohstoff', sector: 'Edelmetalle', region: 'Global', currency: 'USD', profile: { beta: 0.1, idio: 0.009, etf: true } },
};

export function lookupSecurity(symbol) {
  return SECURITIES[symbol.toUpperCase()] ?? null;
}

// Metadaten für eine neue Depotposition: bekannte Werte oder neutrale Vorgaben
export function defaultMeta(symbol) {
  const s = lookupSecurity(symbol);
  return {
    name: s?.name ?? symbol.toUpperCase(),
    type: s?.type ?? 'Aktie',
    sector: s?.sector ?? 'Sonstige',
    region: s?.region ?? 'Sonstige',
    currency: s?.currency ?? 'USD',
    ter: s?.ter ?? null,
    known: !!s,
  };
}

// ISIN je Symbol (für die Zuordnung von Bank- und Brokerdaten)
export const ISINS = {
  AAPL: 'US0378331005',
  MSFT: 'US5949181045',
  NVDA: 'US67066G1040',
  AMZN: 'US0231351067',
  GOOGL: 'US02079K3059',
  META: 'US30303M1027',
  TSLA: 'US88160R1014',
  JPM: 'US46625H1005',
  V: 'US92826C8394',
  JNJ: 'US4781601046',
  UNH: 'US91324P1021',
  PG: 'US7427181091',
  KO: 'US1912161007',
  WMT: 'US9311421039',
  XOM: 'US30231G1022',
  'BRK.B': 'US0846707026',
  SAP: 'DE0007164600',
  SIE: 'DE0007236101',
  ALV: 'DE0008404005',
  MUV2: 'DE0008430026',
  DTE: 'DE0005557508',
  BAS: 'DE000BASF111',
  BAYN: 'DE000BAY0017',
  BMW: 'DE0005190003',
  MBG: 'DE0007100000',
  VOW3: 'DE0007664039',
  ADS: 'DE000A1EWWW0',
  IFX: 'DE0006231004',
  DBK: 'DE0005140008',
  RWE: 'DE0007037129',
  VNA: 'DE000A1ML7J1',
  ASML: 'NL0010273215',
  NESN: 'CH0038863350',
  NOVN: 'CH0012005267',
  NVO: 'DK0062498333',
  MC: 'FR0000121014',
  SHEL: 'GB00BP6MXD84',
  TSM: 'US8740391003',
  TM: 'JP3633400001',
  URTH: 'US4642863926',
  VT: 'US9220427424',
  SPY: 'US78462F1030',
  QQQ: 'US46090E1038',
  VGK: 'US9220428745',
  EEM: 'US4642872349',
  AGG: 'US4642872265',
  BND: 'US9219378356',
  TLT: 'US4642874329',
  GLD: 'US78463V1070',
};

// Verbreitete europäische UCITS-ETFs ohne eigene Kursdaten in dieser App: Sie werden
// für die Analyse auf ein US-Pendant mit gleichem Index abgebildet (Datenproxy).
export const ISIN_ALIASES = {
  IE00B4L5Y983: { symbol: 'URTH', name: 'iShares Core MSCI World UCITS ETF' },
  IE00BJ0KDQ92: { symbol: 'URTH', name: 'Xtrackers MSCI World UCITS ETF 1C' },
  LU0274208692: { symbol: 'URTH', name: 'Xtrackers MSCI World Swap UCITS ETF 1C' },
  IE00BK5BQT80: { symbol: 'VT', name: 'Vanguard FTSE All-World UCITS ETF (Acc)' },
  IE00B3RBWM25: { symbol: 'VT', name: 'Vanguard FTSE All-World UCITS ETF (Dist)' },
  IE00B5BMR087: { symbol: 'SPY', name: 'iShares Core S&P 500 UCITS ETF' },
  IE00BKM4GZ66: { symbol: 'EEM', name: 'iShares Core MSCI EM IMI UCITS ETF' },
  IE00B4L5YC18: { symbol: 'EEM', name: 'iShares MSCI EM UCITS ETF' },
  IE00B945VV12: { symbol: 'VGK', name: 'Vanguard FTSE Developed Europe UCITS ETF' },
  IE00B53SZB19: { symbol: 'QQQ', name: 'iShares Nasdaq 100 UCITS ETF' },
};

const BY_ISIN = Object.fromEntries(Object.entries(ISINS).map(([sym, isin]) => [isin, sym]));

// Liefert { symbol, name, proxy } für eine ISIN oder null
export function lookupByIsin(isin) {
  const key = String(isin ?? '').trim().toUpperCase();
  if (BY_ISIN[key]) return { symbol: BY_ISIN[key], name: SECURITIES[BY_ISIN[key]].name, proxy: false };
  if (ISIN_ALIASES[key]) return { ...ISIN_ALIASES[key], proxy: true };
  return null;
}

export const isValidIsin = (isin) => /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(String(isin ?? '').toUpperCase());
