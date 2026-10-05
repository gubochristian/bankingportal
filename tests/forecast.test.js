import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simulate, expectedPortfolioReturn } from '../js/forecast.js';
import { convertToEur, loadSeries, FX_PROFILES } from '../js/market.js';
import { parseDepotFile } from '../js/depot-file.js';

const close = (a, b, eps) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

test('Ohne Schwankung wächst das Kapital deterministisch mit der Renditeannahme', () => {
  const r = simulate({ startValue: 10000, monthly: 0, years: 10, expectedReturn: 0.05, volatility: 0, paths: 50 });
  close(r.median, 10000 * 1.05 ** 10, 1e-6);
  close(r.pessimistic, r.optimistic, 1e-6);
  assert.equal(r.probLoss, 0);
});

test('Sparplan ohne Rendite: Endwert = Einzahlungen', () => {
  const r = simulate({ startValue: 1000, monthly: 100, years: 5, expectedReturn: 0, volatility: 0, paths: 10 });
  close(r.paidIn, 1000 + 100 * 60, 1e-9);
  close(r.median, r.paidIn, 1e-6);
  assert.equal(r.bands.length, 6);
  close(r.bands[3].paidIn, 1000 + 100 * 36, 1e-9);
});

test('Mittelwert der Simulation trifft die erwartete Rendite', () => {
  const r = simulate({ startValue: 10000, years: 10, expectedReturn: 0.07, volatility: 0.15, paths: 20000, seed: 7 });
  const expected = 10000 * 1.07 ** 10;
  close(r.mean / expected, 1, 0.03);
  // Bänder sind geordnet
  for (const b of r.bands) assert.ok(b.p10 <= b.p25 && b.p25 <= b.p50 && b.p50 <= b.p75 && b.p75 <= b.p90);
  // Median liegt wegen der Schiefe unter dem Mittelwert
  assert.ok(r.median < r.mean);
});

test('Mehr Volatilität verbreitert den Fächer, Inflation senkt die Kaufkraft', () => {
  const base = { startValue: 10000, monthly: 200, years: 20, expectedReturn: 0.06, paths: 3000 };
  const calm = simulate({ ...base, volatility: 0.08 });
  const wild = simulate({ ...base, volatility: 0.25 });
  assert.ok(wild.optimistic - wild.pessimistic > calm.optimistic - calm.pessimistic);
  assert.ok(wild.probLoss > calm.probLoss);
  const real = simulate({ ...base, volatility: 0.08, inflation: 0.02 });
  close(real.median, calm.median / 1.02 ** 20, calm.median * 0.001);
});

test('Sparziel-Wahrscheinlichkeit', () => {
  const r = simulate({ startValue: 10000, years: 10, expectedReturn: 0.06, volatility: 0.15, goal: 1, paths: 500 });
  assert.equal(r.probGoal, 1);
  assert.equal(simulate({ startValue: 10000, years: 10, paths: 100 }).probGoal, null);
});

test('Erwartete Depotrendite: Anlageklassen-Annahmen abzüglich TER', () => {
  const r = expectedPortfolioReturn([
    { type: 'Aktien-ETF', value: 6000, ter: 0.002 },
    { type: 'Anleihen-ETF', value: 4000, ter: 0.001 },
  ]);
  close(r, 0.6 * (0.07 - 0.002) + 0.4 * (0.03 - 0.001), 1e-12);
});

test('Umrechnung in Euro nutzt den Tageskurs und füllt Lücken auf', () => {
  const bars = [
    { time: '2025-01-02', open: 110, high: 110, low: 110, close: 110 },
    { time: '2025-01-03', open: 120, high: 120, low: 120, close: 120 },
    { time: '2025-01-06', open: 100, high: 100, low: 100, close: 100 },
  ];
  const fx = [{ time: '2025-01-02', close: 1.1 }, { time: '2025-01-03', close: 1.2 }];
  const eur = convertToEur(bars, fx);
  close(eur[0].close, 100, 1e-9);
  close(eur[1].close, 100, 1e-9);
  close(eur[2].close, 100 / 1.2, 1e-9);
});

test('Demo-Wechselkurse sind plausibel', async () => {
  const { bars } = await loadSeries('EUR/USD', { source: 'demo' });
  assert.equal(bars[0].close.toFixed(1), FX_PROFILES['EUR/USD'].start.toFixed(1));
  for (const b of bars) assert.ok(b.close > 0.7 && b.close < 1.6, `EUR/USD ${b.close}`);
});

test('Import übernimmt Umrechnung und Prognose-Einstellungen mit Grenzen', () => {
  const d = parseDepotFile(
    JSON.stringify({
      format: 'aktienanalyse-depot',
      positions: [],
      convertFx: false,
      forecast: { monthly: 250, years: 99, expectedReturn: 6, volatility: 'hoch', inflation: true },
    }),
  );
  assert.equal(d.convertFx, false);
  assert.deepEqual(d.forecast, { start: null, monthly: 250, years: 15, expectedReturn: 6, volatility: null, goal: null, inflation: true });
});
