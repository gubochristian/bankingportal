import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzePortfolio, alignCloses, riskClass, diversificationScore } from '../js/portfolio.js';
import { generateDemoBars } from '../js/data.js';
import { defaultMeta } from '../js/securities.js';

const END = new Date('2026-09-29T00:00:00Z');
const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

function build(entries) {
  const positions = entries.map(([symbol, value]) => ({ symbol, value, ...defaultMeta(symbol) }));
  const series = Object.fromEntries(entries.map(([s]) => [s, generateDemoBars(s, { endDate: END })]));
  return analyzePortfolio(positions, series);
}

test('riskClass folgt den SRI-Schwellen', () => {
  assert.equal(riskClass(0.001), 1);
  assert.equal(riskClass(0.03), 2);
  assert.equal(riskClass(0.1), 3);
  assert.equal(riskClass(0.15), 4);
  assert.equal(riskClass(0.25), 5);
  assert.equal(riskClass(0.5), 6);
  assert.equal(riskClass(0.9), 7);
  assert.equal(riskClass(null), null);
});

test('alignCloses füllt Lücken mit dem letzten Kurs', () => {
  const series = {
    A: [{ time: '2025-01-01', close: 1 }, { time: '2025-01-02', close: 2 }, { time: '2025-01-03', close: 3 }],
    B: [{ time: '2025-01-02', close: 10 }, { time: '2025-01-04', close: 12 }],
  };
  const { dates, closes } = alignCloses(series, ['A', 'B']);
  assert.deepEqual(dates, ['2025-01-02', '2025-01-03', '2025-01-04']);
  assert.deepEqual(closes.A, [2, 3, 3]);
  assert.deepEqual(closes.B, [10, 10, 12]);
});

test('Gewichte, Allokation und Risikobeiträge summieren sich auf 100 %', () => {
  const r = build([['AAPL', 3000], ['MSFT', 2000], ['AGG', 5000]]);
  close(r.totalValue, 10000);
  const sum = (arr) => arr.reduce((a, b) => a + b.weight, 0);
  close(sum(r.allocation.positions), 1);
  close(sum(r.allocation.sector), 1);
  close(sum(r.allocation.region), 1);
  close(r.riskContributions.reduce((a, b) => a + b.riskShare, 0), 1, 1e-6);
  assert.equal(r.allocation.positions[0].key, 'AGG');
  // Anleihen senken das Risiko: Anteil am Risiko liegt unter dem Gewicht
  const agg = r.riskContributions.find((x) => x.symbol === 'AGG');
  assert.ok(agg.riskShare < agg.weight);
});

test('Einzelposition: Volatilität entspricht der Einzeltitel-Volatilität', () => {
  const r = build([['MSFT', 1000]]);
  close(r.volatility, r.riskContributions[0].volatility, 1e-9);
  close(r.concentration.effectiveN, 1);
  assert.ok(r.hints.some((h) => h.level === 'critical' && h.title.includes('Klumpenrisiko')));
});

test('Globaler ETF wird regional aufgeteilt und zählt als breit gestreut', () => {
  const r = build([['URTH', 10000]]);
  assert.ok(r.allocation.region.length >= 3);
  assert.equal(r.allocation.region[0].key, 'Nordamerika');
  assert.ok(r.concentration.effectiveN > 40);
  assert.ok(!r.hints.some((h) => h.title.includes('Klumpenrisiko')));
});

test('Tech-Klumpen wird schlechter bewertet als ein ausgewogenes Depot', () => {
  const tech = build([['NVDA', 6000], ['AAPL', 3000], ['MSFT', 2500], ['TSLA', 2000], ['META', 1500]]);
  const balanced = build([['URTH', 9000], ['EEM', 1500], ['AGG', 3000], ['GLD', 1000], ['SAP', 800], ['JNJ', 500]]);
  assert.ok(balanced.score.total > tech.score.total, `${balanced.score.total} > ${tech.score.total}`);
  assert.ok(balanced.volatility < tech.volatility);
  assert.ok(tech.hints.some((h) => h.title.includes('Technologie')));
  assert.ok(tech.hints.some((h) => h.title === 'Kein Stabilitätsanker'));
  assert.ok(balanced.hints.some((h) => h.level === 'good'));
});

test('Gewinn/Verlust nur aus Positionen mit Einstandswert', () => {
  const positions = [
    { symbol: 'AAPL', value: 1200, costBasis: 1000, ...defaultMeta('AAPL') },
    { symbol: 'MSFT', value: 800, ...defaultMeta('MSFT') },
  ];
  const series = { AAPL: generateDemoBars('AAPL', { endDate: END }), MSFT: generateDemoBars('MSFT', { endDate: END }) };
  const r = analyzePortfolio(positions, series);
  close(r.pnl, 200);
  close(r.pnlPct, 0.2);
});

test('diversificationScore ist auf 0–100 begrenzt', () => {
  const max = diversificationScore({ effectiveN: 100, effectiveSectors: 20, effectiveRegions: 5 }, -0.5);
  assert.equal(max.total, 100);
  const min = diversificationScore({ effectiveN: 0, effectiveSectors: 0, effectiveRegions: 0 }, 0.95);
  assert.equal(min.total, 0);
});

test('Leeres Depot liefert null', () => {
  assert.equal(analyzePortfolio([], {}), null);
});
