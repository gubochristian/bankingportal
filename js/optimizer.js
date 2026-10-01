// Verbesserungsvorschläge: simuliert typische Umschichtungen, bewertet jede
// Variante mit analyzePortfolio neu und behält nur die, die das Depot messbar
// verbessern. Der Depotwert bleibt dabei gleich (Umschichtung, kein Zukauf).

import { analyzePortfolio } from './portfolio.js';

// Bausteine, die für Vorschläge zusätzlich geladen werden
export const HELPER_SYMBOLS = { core: 'URTH', bond: 'AGG', gold: 'GLD' };

const sum = (arr) => arr.reduce((a, b) => a + b, 0);
const isBroadCore = (p) => p.type === 'Aktien-ETF' && p.sector === 'Diversifiziert' && p.region === 'Global';
const isSingle = (p) => p.type === 'Aktie' || p.type === 'Krypto';
const isStabilizer = (p) => p.type === 'Anleihen-ETF' || p.sector === 'Edelmetalle';

// Setzt `symbol` auf den Zielanteil `share` und skaliert alle übrigen Positionen proportional
function setShare(positions, symbol, share, total, makeMeta) {
  const existing = positions.find((p) => p.symbol === symbol);
  const others = positions.filter((p) => p.symbol !== symbol);
  const othersValue = sum(others.map((p) => p.value));
  if (othersValue <= 0) return null;
  const factor = (total * (1 - share)) / othersValue;
  const next = others.map((p) => ({ ...p, value: p.value * factor }));
  next.push({ ...(existing ?? makeMeta(symbol)), value: total * share });
  return next;
}

function candidates(positions, base, makeMeta) {
  const total = base.totalValue;
  const share = (pred) => sum(positions.filter(pred).map((p) => p.value)) / total;
  const list = [];

  // 1) Einzeltitel auf höchstens 10 % begrenzen
  const cap = 0.1;
  const tooBig = positions.filter((p) => isSingle(p) && p.value / total > 0.15);
  if (tooBig.length) {
    const capped = positions.filter((p) => isSingle(p) && p.value / total > cap);
    const rest = positions.filter((p) => !capped.includes(p));
    const restValue = sum(rest.map((p) => p.value));
    const excess = sum(capped.map((p) => p.value - cap * total));
    if (restValue > 0) {
      list.push({
        key: 'cap',
        title: 'Große Einzelwerte auf 10 % begrenzen',
        text: `${capped.map((p) => p.symbol).join(', ')} auf je 10 % reduzieren und den Überschuss anteilig auf die übrigen Positionen verteilen.`,
        positions: positions.map((p) => (capped.includes(p) ? { ...p, value: cap * total } : { ...p, value: p.value + (excess * p.value) / restValue })),
      });
    }
  }

  // 2) Breiten Welt-ETF als Kern (50 %)
  const coreShare = share(isBroadCore);
  if (coreShare < 0.3) {
    const sym = HELPER_SYMBOLS.core;
    const otherCore = share((p) => isBroadCore(p) && p.symbol !== sym);
    const target = 0.5 - otherCore;
    const next = target > 0.05 ? setShare(positions, sym, target, total, makeMeta) : null;
    if (next) {
      list.push({
        key: 'core',
        title: 'Welt-ETF als Basisinvestment',
        text: `Die Hälfte des Depots in einen breiten MSCI-World-ETF (hier ${sym}) umschichten – die übrigen Positionen werden anteilig verkleinert.`,
        positions: next,
      });
    }
  }

  // 3) Anleihen als Stabilitätsanker (20 %)
  if (share(isStabilizer) < 0.1 && (base.riskClass ?? 0) >= 4) {
    const sym = HELPER_SYMBOLS.bond;
    const next = setShare(positions, sym, 0.2, total, makeMeta);
    if (next) {
      list.push({
        key: 'bonds',
        title: '20 % Anleihen beimischen',
        text: `Ein Fünftel in einen breiten Anleihen-ETF (hier ${sym}) umschichten. Das senkt Schwankungen und Verluste in Krisen – auf Kosten der langfristigen Renditeerwartung.`,
        positions: next,
      });
    }
  }

  // 4) Gold als Krisenschutz (5 %)
  if (!positions.some((p) => p.sector === 'Edelmetalle') && positions.length >= 3) {
    const next = setShare(positions, HELPER_SYMBOLS.gold, 0.05, total, makeMeta);
    if (next) {
      list.push({
        key: 'gold',
        title: '5 % Gold beimischen',
        text: `Eine kleine Gold-Position (hier ${HELPER_SYMBOLS.gold}) entwickelt sich oft unabhängig von Aktien und kann in Krisen stabilisieren.`,
        positions: next,
      });
    }
  }

  // 5) Übergewichteten Sektor auf 25 % zurückführen
  const topSector = base.allocation.sector.find((s) => !['Diversifiziert', 'Anleihen', 'Edelmetalle'].includes(s.key));
  if (topSector && topSector.weight > 0.35) {
    const inSector = (p) => p.sector === topSector.key;
    const othersValue = sum(positions.filter((p) => !inSector(p)).map((p) => p.value));
    if (othersValue > 0) {
      const fIn = 0.25 / topSector.weight;
      const fOut = (total * 0.75) / othersValue;
      list.push({
        key: 'sector',
        title: `${topSector.key} auf 25 % reduzieren`,
        text: `Positionen aus dem Sektor ${topSector.key} anteilig verkleinern und die übrigen Positionen entsprechend aufstocken.`,
        positions: positions.map((p) => ({ ...p, value: p.value * (inSector(p) ? fIn : fOut) })),
      });
    }
  }

  // 6) Gleichgewichtung bei reinen Einzelwert-Depots
  const weights = positions.map((p) => p.value / total);
  if (positions.length >= 3 && share(isSingle) > 0.8 && Math.max(...weights) / Math.min(...weights) > 4) {
    list.push({
      key: 'equal',
      title: 'Alle Positionen gleich gewichten',
      text: `Jede der ${positions.length} Positionen auf ${(100 / positions.length).toFixed(1).replace('.', ',')} % setzen, damit kein Einzelwert dominiert.`,
      positions: positions.map((p) => ({ ...p, value: total / positions.length })),
    });
  }
  return list;
}

const metrics = (r) => ({
  score: r.score.total,
  riskClass: r.riskClass,
  volatility: r.volatility,
  maxDrawdown: r.maxDrawdown ?? null,
  crash: r.scenarios.find((s) => s.key === 'crash')?.impact ?? null,
});

// positions: Eingabe wie für analyzePortfolio; series muss auch die HELPER_SYMBOLS enthalten.
// makeMeta(symbol) liefert die Stammdaten für neu hinzukommende Bausteine.
export function suggestImprovements(positions, series, base, { benchmark = null, makeMeta }) {
  if (!base || positions.length === 0) return [];
  const before = metrics(base);
  const out = [];

  for (const c of candidates(positions, base, makeMeta)) {
    if (c.positions.some((p) => !series[p.symbol])) continue;
    const r = analyzePortfolio(c.positions, series, { benchmark });
    if (!r) continue;
    const after = metrics(r);
    const scoreDelta = after.score - before.score;
    const volDelta = before.volatility !== null && after.volatility !== null ? after.volatility - before.volatility : 0;
    // Nur Vorschläge mit spürbarem Nutzen behalten
    if (scoreDelta < 5 && volDelta > -0.015) continue;

    const valueBefore = new Map(positions.map((p) => [p.symbol, p.value]));
    const changes = c.positions
      .map((p) => ({ symbol: p.symbol, name: p.name, from: valueBefore.get(p.symbol) ?? 0, to: p.value }))
      .filter((x) => Math.abs(x.to - x.from) >= 1)
      .sort((a, b) => Math.abs(b.to - b.from) - Math.abs(a.to - a.from));

    out.push({ key: c.key, title: c.title, text: c.text, before, after, scoreDelta, volDelta, changes });
  }
  // Größte Verbesserung zuerst (Score-Punkte plus Volatilitätssenkung)
  return out.sort((a, b) => b.scoreDelta - b.volDelta * 100 - (a.scoreDelta - a.volDelta * 100));
}
