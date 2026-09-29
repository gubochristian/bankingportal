// Depot-Bewertung: Allokation, Streuung, Risiko und regelbasierte Hinweise.
// Reine Funktionen ohne DOM-Zugriff.
//
// Eingabe `positions`: [{ symbol, name, value, costBasis?, type, sector, region, currency, regionBreakdown? }]
//   value      – aktueller Marktwert der Position
//   costBasis  – Einstandswert (optional, für Gewinn/Verlust)
// Eingabe `series`: { [symbol]: bars } mit Tageskursen (aufsteigend sortiert)

import { sma } from './indicators.js';
import { maxDrawdown } from './analysis.js';

const TRADING_DAYS = 252;

// Grobe Regionen-Aufteilung für „Global“, wenn nichts Genaueres bekannt ist
const DEFAULT_GLOBAL = { Nordamerika: 0.7, Europa: 0.15, 'Asien-Pazifik': 0.08, Schwellenländer: 0.07 };

// Schwellen der annualisierten Volatilität für Risikoklassen 1–7
// (angelehnt an die SRI-Skala aus den EU-PRIIPs-Basisinformationsblättern)
const RISK_CLASS_LIMITS = [0.005, 0.05, 0.12, 0.2, 0.3, 0.8];
export const RISK_CLASS_LABELS = ['sehr gering', 'gering', 'niedrig bis mittel', 'mittel', 'erhöht', 'hoch', 'sehr hoch'];

export function riskClass(volatility) {
  if (volatility === null || volatility === undefined) return null;
  const idx = RISK_CLASS_LIMITS.findIndex((limit) => volatility < limit);
  return idx === -1 ? 7 : idx + 1;
}

// ---------- Hilfsfunktionen ----------

const sum = (arr) => arr.reduce((a, b) => a + b, 0);

function mean(arr) {
  return arr.length ? sum(arr) / arr.length : 0;
}

// Herfindahl-Index → „effektive Anzahl“ gleich großer Positionen
function effectiveCount(weights) {
  const hhi = sum(weights.map((w) => w * w));
  return hhi > 0 ? 1 / hhi : 0;
}

function groupWeights(entries) {
  const map = new Map();
  for (const [key, w] of entries) map.set(key, (map.get(key) ?? 0) + w);
  return [...map.entries()]
    .map(([key, weight]) => ({ key, weight }))
    .filter((e) => e.weight > 1e-9)
    .sort((a, b) => b.weight - a.weight);
}

// Wie viele „Einzeltitel“ steckt in einer Position? Breite Fonds streuen intern.
function internalHoldings(p) {
  if (p.type === 'Aktien-ETF') return p.sector === 'Diversifiziert' ? 50 : 20;
  if (p.type === 'Anleihen-ETF') return 50;
  return 1;
}

function regionExposure(p) {
  if (p.region !== 'Global') return { [p.region]: 1 };
  return p.regionBreakdown ?? DEFAULT_GLOBAL;
}

const isEquity = (p) => p.type === 'Aktie' || p.type === 'Aktien-ETF';
const isStabilizer = (p) => p.type === 'Anleihen-ETF' || p.sector === 'Edelmetalle';

// Kurse aller Symbole auf gemeinsame Handelstage bringen. Start ist der späteste
// erste Handelstag; Lücken (z. B. unterschiedliche Feiertage) werden mit dem
// letzten bekannten Kurs gefüllt.
export function alignCloses(series, symbols) {
  const start = symbols.map((s) => series[s][0].time).sort().at(-1);
  const dates = [...new Set(symbols.flatMap((s) => series[s].map((b) => b.time)))]
    .filter((d) => d >= start)
    .sort();
  const closes = {};
  for (const s of symbols) {
    const byDate = new Map(series[s].map((b) => [b.time, b.close]));
    let last = null;
    closes[s] = dates.map((d) => (last = byDate.get(d) ?? last));
  }
  return { dates, closes };
}

function logReturns(values) {
  const out = [];
  for (let i = 1; i < values.length; i++) out.push(Math.log(values[i] / values[i - 1]));
  return out;
}

export function covariance(a, b) {
  const ma = mean(a);
  const mb = mean(b);
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] - ma) * (b[i] - mb);
  return s / (a.length - 1);
}

// ---------- Hauptfunktion ----------

export function analyzePortfolio(positions, series, { lookback = TRADING_DAYS } = {}) {
  const valid = positions.filter((p) => p.value > 0);
  const totalValue = sum(valid.map((p) => p.value));
  if (!valid.length || totalValue <= 0) return null;

  const weights = valid.map((p) => p.value / totalValue);
  const symbols = valid.map((p) => p.symbol);

  // --- Gewinn / Verlust ---
  const withCost = valid.filter((p) => p.costBasis > 0);
  const costBasis = sum(withCost.map((p) => p.costBasis));
  const pnl = withCost.length ? sum(withCost.map((p) => p.value)) - costBasis : null;

  // --- Allokation (mit Durchschau bei globalen Fonds) ---
  const allocation = {
    positions: valid
      .map((p, i) => ({ key: p.symbol, label: p.name, weight: weights[i] }))
      .sort((a, b) => b.weight - a.weight),
    sector: groupWeights(valid.map((p, i) => [p.sector, weights[i]])),
    region: groupWeights(
      valid.flatMap((p, i) => Object.entries(regionExposure(p)).map(([r, share]) => [r, share * weights[i]])),
    ),
    type: groupWeights(valid.map((p, i) => [p.type, weights[i]])),
    currency: groupWeights(valid.map((p, i) => [p.currency, weights[i]])),
  };

  // --- Konzentration ---
  const effectiveN = effectiveCount(
    valid.flatMap((p, i) => {
      const k = internalHoldings(p);
      return new Array(k).fill(weights[i] / k);
    }),
  );
  // „Diversifiziert“ wird wie zehn gleich große Sektoren gezählt
  const effectiveSectors = effectiveCount(
    allocation.sector.flatMap((s) => (s.key === 'Diversifiziert' ? new Array(10).fill(s.weight / 10) : [s.weight])),
  );
  const effectiveRegions = effectiveCount(allocation.region.map((r) => r.weight));
  const concentration = {
    count: valid.length,
    maxWeight: allocation.positions[0].weight,
    maxSymbol: allocation.positions[0].key,
    top3: sum(allocation.positions.slice(0, 3).map((p) => p.weight)),
    effectiveN,
    effectiveSectors,
    effectiveRegions,
    equityShare: sum(valid.map((p, i) => (isEquity(p) ? weights[i] : 0))),
    stabilizerShare: sum(valid.map((p, i) => (isStabilizer(p) ? weights[i] : 0))),
    foreignCurrencyShare: sum(valid.map((p, i) => (p.currency !== 'EUR' ? weights[i] : 0))),
    singleStockShare: sum(valid.map((p, i) => (p.type === 'Aktie' ? weights[i] : 0))),
  };

  // --- Risiko aus der Kurshistorie ---
  const risk = computeRisk(valid, weights, series, symbols, lookback, totalValue);

  const result = { totalValue, costBasis: withCost.length ? costBasis : null, pnl, pnlPct: pnl !== null ? pnl / costBasis : null, allocation, concentration, ...risk };
  result.score = diversificationScore(concentration, risk.avgCorrelation);
  result.hints = buildHints(result, valid);
  return result;
}

function computeRisk(positions, weights, series, symbols, lookback, totalValue) {
  const empty = { history: [], volatility: null, riskClass: null, riskContributions: [], correlation: null, avgCorrelation: null };
  if (symbols.some((s) => !series[s] || series[s].length < 2)) return empty;

  const { dates, closes } = alignCloses(series, symbols);
  if (dates.length < 30) return { ...empty, insufficientHistory: true };

  // Wertverlauf des heutigen Depots (Buy & Hold mit heutigen Stückzahlen)
  const shares = symbols.map((s, i) => positions[i].value / closes[s].at(-1));
  const history = dates.map((time, t) => ({ time, value: sum(symbols.map((s, i) => shares[i] * closes[s][t])) }));
  const values = history.map((h) => h.value);

  const window = Math.min(lookback, dates.length - 1);
  const returns = symbols.map((s) => logReturns(closes[s].slice(-(window + 1))));
  const n = symbols.length;

  const cov = returns.map((a) => returns.map((b) => covariance(a, b)));
  const sigma = cov.map((row, i) => Math.sqrt(row[i]));
  const covW = cov.map((row) => sum(row.map((c, j) => c * weights[j])));
  const variance = sum(weights.map((w, i) => w * covW[i]));
  const volatility = Math.sqrt(variance * TRADING_DAYS);

  const corr = cov.map((row, i) => row.map((c, j) => (sigma[i] && sigma[j] ? c / (sigma[i] * sigma[j]) : i === j ? 1 : 0)));
  let corrSum = 0;
  let corrWeight = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      corrSum += weights[i] * weights[j] * corr[i][j];
      corrWeight += weights[i] * weights[j];
    }
  }

  // Risikobeitrag: Anteil jeder Position an der Depotvarianz (Summe = 100 %)
  const riskContributions = symbols
    .map((s, i) => ({
      symbol: s,
      weight: weights[i],
      riskShare: variance > 0 ? (weights[i] * covW[i]) / variance : 0,
      volatility: sigma[i] * Math.sqrt(TRADING_DAYS),
    }))
    .sort((a, b) => b.riskShare - a.riskShare);

  const portReturns = logReturns(values.slice(-(window + 1)));
  const sorted = [...portReturns].sort((a, b) => a - b);
  const cut = Math.max(1, Math.floor(sorted.length * 0.05));
  const var95 = -(Math.exp(sorted[cut - 1]) - 1);
  const cvar95 = -(Math.exp(mean(sorted.slice(0, cut))) - 1);

  let worstMonth = null;
  for (let t = 21; t < values.length; t++) {
    const r = values[t] / values[t - 21] - 1;
    if (worstMonth === null || r < worstMonth) worstMonth = r;
  }

  const annualReturn = mean(portReturns) * TRADING_DAYS;

  // Trend: Anteil des Depots, der unter der eigenen 200-Tage-Linie notiert
  let belowSma200 = 0;
  let trendCovered = 0;
  symbols.forEach((s, i) => {
    const c = series[s].map((b) => b.close);
    const m = sma(c, 200).at(-1);
    if (m === null) return;
    trendCovered += weights[i];
    if (c.at(-1) < m) belowSma200 += weights[i];
  });

  return {
    history,
    historyDays: dates.length,
    lookbackDays: window,
    volatility,
    riskClass: riskClass(volatility),
    maxDrawdown: maxDrawdown(values),
    var95,
    var95Amount: var95 * totalValue,
    cvar95,
    worstMonth,
    return1y: values.length > TRADING_DAYS ? values.at(-1) / values.at(-1 - TRADING_DAYS) - 1 : null,
    sharpe: volatility > 0 ? annualReturn / volatility : null,
    diversificationRatio: volatility > 0 ? (sum(weights.map((w, i) => w * sigma[i])) * Math.sqrt(TRADING_DAYS)) / volatility : null,
    avgCorrelation: corrWeight > 0 ? corrSum / corrWeight : null,
    correlation: { symbols, matrix: corr },
    riskContributions,
    belowSma200Share: trendCovered > 0 ? belowSma200 / trendCovered : null,
  };
}

// ---------- Streuungs-Score ----------

export function diversificationScore(c, avgCorrelation) {
  const clamp = (v) => Math.max(0, Math.min(1, v));
  const parts = {
    positions: 30 * clamp(c.effectiveN / 20),
    sectors: 25 * clamp(c.effectiveSectors / 8),
    regions: 20 * clamp(c.effectiveRegions / 3),
    // Ohne Kurshistorie neutral bewerten
    correlation: avgCorrelation === null ? 12.5 : 25 * clamp((0.9 - avgCorrelation) / 0.7),
  };
  const total = Math.round(sum(Object.values(parts)));
  const label = total >= 80 ? 'Sehr gut gestreut' : total >= 60 ? 'Gut gestreut' : total >= 40 ? 'Ausbaufähig' : 'Stark konzentriert';
  return { total, label, parts };
}

// ---------- Hinweise ----------

const pct = (v) => `${(v * 100).toLocaleString('de-DE', { maximumFractionDigits: 1 })} %`;

function buildHints(r, positions) {
  const hints = [];
  const add = (level, title, text) => hints.push({ level, title, text });
  const c = r.concentration;

  // Anzahl und Klumpen
  if (c.effectiveN < 3) {
    add('critical', 'Sehr wenige Positionen', `Das Depot entspricht nur etwa ${c.effectiveN.toFixed(1)} gleich großen Positionen. Ein einzelner Ausfall trifft das Gesamtvermögen stark.`);
  } else if (c.effectiveN < 8) {
    add('warning', 'Geringe Streuung über Einzelwerte', `Effektiv nur ~${c.effectiveN.toFixed(1)} gleich große Positionen. Ab etwa 15–20 Einzeltiteln oder einem breiten ETF sinkt das titelspezifische Risiko deutlich.`);
  } else if (c.effectiveN >= 20) {
    add('good', 'Breite Streuung über Einzelwerte', `Das Depot entspricht effektiv ~${Math.round(c.effectiveN)} gleich großen Positionen (inkl. ETF-Inhalte).`);
  }

  const top = r.allocation.positions[0];
  const topIsFund = positions.find((p) => p.symbol === top.key)?.type.includes('ETF');
  if (!topIsFund && top.weight > 0.35) {
    add('critical', `Klumpenrisiko: ${top.key}`, `${top.key} macht ${pct(top.weight)} des Depots aus. Üblich ist, Einzeltitel auf höchstens 10–20 % zu begrenzen.`);
  } else if (!topIsFund && top.weight > 0.2) {
    add('warning', `Große Einzelposition: ${top.key}`, `${top.key} hat einen Anteil von ${pct(top.weight)}. Prüfe, ob dieses Gewicht bewusst gewählt ist.`);
  }

  // Sektoren
  const topSector = r.allocation.sector.find((s) => s.key !== 'Diversifiziert' && s.key !== 'Anleihen');
  if (topSector && topSector.weight > 0.5) {
    add('critical', `Sektor-Klumpen: ${topSector.key}`, `${pct(topSector.weight)} des Depots entfallen auf ${topSector.key}. Branchenkrisen würden das Depot stark treffen.`);
  } else if (topSector && topSector.weight > 0.3) {
    add('warning', `Übergewicht ${topSector.key}`, `${pct(topSector.weight)} liegen im Sektor ${topSector.key}. Eine Beimischung anderer Branchen senkt die Abhängigkeit.`);
  }
  if (c.effectiveSectors >= 6) {
    add('good', 'Gute Branchenmischung', `Das Depot verteilt sich effektiv auf ~${c.effectiveSectors.toFixed(1)} Sektoren.`);
  }

  // Regionen
  const topRegion = r.allocation.region[0];
  if (topRegion.key === 'Deutschland' && topRegion.weight > 0.4) {
    add('info', 'Heimatmarkt-Neigung (Home Bias)', `${pct(topRegion.weight)} in deutschen Werten – Deutschland macht nur rund 2 % der weltweiten Marktkapitalisierung aus.`);
  } else if (topRegion.weight > 0.8 && topRegion.key !== 'Global') {
    add('warning', `Starke Abhängigkeit von ${topRegion.key}`, `${pct(topRegion.weight)} des Depots entfallen auf ${topRegion.key}. Eine regionale Krise würde fast das gesamte Depot betreffen.`);
  } else if (c.effectiveRegions >= 2.5) {
    add('good', 'Regional gut verteilt', `Das Depot ist über mehrere Regionen gestreut (effektiv ~${c.effectiveRegions.toFixed(1)}).`);
  }

  // Währung
  if (c.foreignCurrencyShare > 0.7) {
    add('info', 'Hohes Fremdwährungsrisiko', `${pct(c.foreignCurrencyShare)} notieren nicht in Euro. Wechselkursschwankungen wirken zusätzlich auf deine Rendite in Euro – das gilt auch für Euro-notierte Fonds mit Fremdwährungs-Inhalten.`);
  }

  // Anlageklassen
  if (c.stabilizerShare === 0 && c.equityShare > 0.95) {
    add('info', 'Kein Stabilitätsanker', 'Das Depot besteht vollständig aus Aktien. Anleihen oder Gold können Kursrückgänge abfedern – je nach Anlagehorizont und Risikobereitschaft.');
  } else if (c.stabilizerShare >= 0.2) {
    add('good', 'Stabilisierende Beimischung', `${pct(c.stabilizerShare)} in Anleihen/Edelmetallen dämpfen typischerweise die Schwankungen.`);
  }
  if (c.singleStockShare > 0.9 && c.count < 10) {
    add('warning', 'Nur Einzelaktien, kein Basisinvestment', 'Ein breit gestreuter ETF (z. B. auf den MSCI World) als Kern kann das titelspezifische Risiko deutlich senken.');
  }

  // Risiko aus der Historie
  if (r.insufficientHistory) {
    add('info', 'Zu wenig gemeinsame Kurshistorie', 'Für Risiko-Kennzahlen werden mindestens 30 gemeinsame Handelstage benötigt.');
  }
  if (r.riskClass !== null) {
    if (r.riskClass >= 6) {
      add('critical', `Hohes Schwankungsrisiko (Risikoklasse ${r.riskClass}/7)`, `Die annualisierte Volatilität liegt bei ${pct(r.volatility)}. Wertschwankungen von 30 % und mehr innerhalb eines Jahres sind möglich.`);
    } else if (r.riskClass === 5) {
      add('warning', `Erhöhtes Risiko (Risikoklasse 5/7)`, `Volatilität ${pct(r.volatility)} p. a. – das liegt über einem breiten Aktienmarkt-ETF (typisch 14–18 %).`);
    } else if (r.riskClass <= 3) {
      add('good', `Moderates Risiko (Risikoklasse ${r.riskClass}/7)`, `Volatilität ${pct(r.volatility)} p. a.`);
    }
  }
  if (r.avgCorrelation !== null && c.count > 1) {
    if (r.avgCorrelation > 0.65) {
      add('warning', 'Positionen bewegen sich sehr ähnlich', `Die durchschnittliche Korrelation beträgt ${r.avgCorrelation.toFixed(2)}. Mehr Positionen derselben Art bringen hier kaum Streuungseffekt.`);
    } else if (r.avgCorrelation < 0.35) {
      add('good', 'Niedrige Korrelation', `Die Positionen schwanken weitgehend unabhängig voneinander (Ø Korrelation ${r.avgCorrelation.toFixed(2)}).`);
    }
  }
  for (const rc of r.riskContributions ?? []) {
    if (rc.riskShare > 0.2 && rc.riskShare > rc.weight * 1.5) {
      add('info', `${rc.symbol} dominiert das Risiko`, `${rc.symbol} hat ${pct(rc.weight)} Gewicht, verursacht aber ${pct(rc.riskShare)} der Depotschwankung.`);
    }
  }
  if (r.maxDrawdown !== undefined && r.maxDrawdown < -0.35) {
    add('info', 'Hoher historischer Verlust', `Das heutige Depot hätte zwischenzeitlich ${pct(-r.maxDrawdown)} verloren (maximaler Drawdown im betrachteten Zeitraum).`);
  }
  if (r.belowSma200Share !== null && r.belowSma200Share !== undefined && r.belowSma200Share > 0.5) {
    add('info', 'Schwacher Trend', `${pct(r.belowSma200Share)} des Depots notieren unter ihrer 200-Tage-Linie.`);
  }

  const order = { critical: 0, warning: 1, info: 2, good: 3 };
  return hints.sort((a, b) => order[a.level] - order[b.level]);
}
