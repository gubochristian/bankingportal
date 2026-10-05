// Zukunftsprojektion per Monte-Carlo-Simulation (reine Funktionen).
//
// Modell: monatliche Renditen sind log-normalverteilt (geometrische Brownsche
// Bewegung). `expectedReturn` ist die erwartete einfache Jahresrendite, d. h.
// im Mittel wächst 1 € pro Jahr auf 1 € × (1 + expectedReturn).
// Sparraten werden jeweils zu Monatsbeginn eingezahlt.

// Langfristige Renditeannahmen vor Kosten (nominal, grobe Richtwerte, angelehnt
// an übliche Kapitalmarktannahmen großer Anbieter – keine Prognose)
export const RETURN_ASSUMPTIONS = {
  Aktie: 0.07,
  'Aktien-ETF': 0.07,
  'Anleihen-ETF': 0.03,
  Rohstoff: 0.035,
  Krypto: 0.07,
  Sonstige: 0.04,
};

// Erwartete Depotrendite: gewichtete Annahmen je Anlageklasse abzüglich TER
export function expectedPortfolioReturn(positions) {
  const total = positions.reduce((s, p) => s + p.value, 0);
  if (total <= 0) return null;
  return positions.reduce((s, p) => s + (p.value / total) * ((RETURN_ASSUMPTIONS[p.type] ?? 0.04) - (p.ter ?? 0)), 0);
}

function mulberry32(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function percentile(sorted, q) {
  const idx = (sorted.length - 1) * q;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

export function simulate({
  startValue = 0,
  monthly = 0,
  years = 15,
  expectedReturn = 0.06,
  volatility = 0.15,
  inflation = 0,
  goal = null,
  paths = 2000,
  seed = 42,
} = {}) {
  const rand = mulberry32(seed);
  const months = Math.round(years * 12);
  const drift = Math.log(1 + expectedReturn) / 12 - (volatility * volatility) / 24;
  const sd = volatility / Math.sqrt(12);

  // yearly[y][k] = Wert von Pfad k am Ende von Jahr y (y = 0 ist der Start)
  const yearly = Array.from({ length: years + 1 }, () => new Float64Array(paths));
  for (let k = 0; k < paths; k++) {
    let value = startValue;
    yearly[0][k] = value;
    let spare = null; // Box-Muller liefert zwei Zufallszahlen je Aufruf
    for (let m = 1; m <= months; m++) {
      let z;
      if (spare !== null) {
        z = spare;
        spare = null;
      } else {
        const u = 1 - rand();
        const v = rand();
        const r = Math.sqrt(-2 * Math.log(u));
        z = r * Math.cos(2 * Math.PI * v);
        spare = r * Math.sin(2 * Math.PI * v);
      }
      value = (value + monthly) * Math.exp(drift + sd * z);
      if (m % 12 === 0) yearly[m / 12][k] = value;
    }
  }

  // Kaufkraft heute: Werte mit der Inflation abzinsen
  const deflate = (y) => (1 + inflation) ** y;

  const bands = yearly.map((vals, y) => {
    const sorted = Array.from(vals).sort((a, b) => a - b);
    const d = deflate(y);
    return {
      year: y,
      p10: percentile(sorted, 0.1) / d,
      p25: percentile(sorted, 0.25) / d,
      p50: percentile(sorted, 0.5) / d,
      p75: percentile(sorted, 0.75) / d,
      p90: percentile(sorted, 0.9) / d,
      paidIn: startValue + monthly * 12 * y,
    };
  });

  const final = Array.from(yearly[years]).map((v) => v / deflate(years));
  const paidIn = startValue + monthly * months;
  const last = bands[years];
  return {
    bands,
    paidIn,
    median: last.p50,
    pessimistic: last.p10,
    optimistic: last.p90,
    mean: final.reduce((a, b) => a + b, 0) / final.length,
    // Wahrscheinlichkeit, am Ende weniger als eingezahlt zu haben (Kaufkraft bei Inflation)
    probLoss: final.filter((v) => v < paidIn).length / final.length,
    probGoal: goal > 0 ? final.filter((v) => v >= goal).length / final.length : null,
  };
}
