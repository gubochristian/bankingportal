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
