import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzePortfolio, runScenarios } from '../js/portfolio.js';
import { suggestImprovements } from '../js/optimizer.js';
import { parseDepotFile } from '../js/depot-file.js';
import { generateDemoBars } from '../js/data.js';
import { defaultMeta, SECURITIES } from '../js/securities.js';

const END = new Date('2026-09-29T00:00:00Z');
const series = Object.fromEntries(Object.keys(SECURITIES).map((s) => [s, generateDemoBars(s, { endDate: END })]));
const benchmark = { symbol: 'URTH', name: 'MSCI World', bars: series.URTH };
const meta = (symbol) => {
  const { known, ...m } = defaultMeta(symbol);
  return { symbol, ...m, ter: m.ter ?? 0, regionBreakdown: SECURITIES[symbol]?.regions };
};
const build = (entries) => entries.map(([s, value]) => ({ ...meta(s), value }));
const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

test('Benchmark: der Index selbst hat Beta 1 und Korrelation 1', () => {
  const r = analyzePortfolio(build([['URTH', 10000]]), series, { benchmark });
  close(r.benchmark.beta, 1, 1e-9);
  close(r.benchmark.correlation, 1, 1e-9);
  // normierter Verlauf startet beim Depotwert
  close(r.benchmark.history[0].value, r.history[0].value, 1e-6);
});

test('Benchmark: Tech-Depot ist marktsensitiver als ein Anleihen-Depot', () => {
  const tech = analyzePortfolio(build([['NVDA', 5000], ['TSLA', 5000]]), series, { benchmark });
  const bonds = analyzePortfolio(build([['AGG', 10000]]), series, { benchmark });
  assert.ok(tech.benchmark.beta > 1.2, `Beta ${tech.benchmark.beta}`);
  assert.ok(Math.abs(bonds.benchmark.beta) < 0.3, `Beta ${bonds.benchmark.beta}`);
});

test('Stresstest: Anleihen und Gold steigen im Crash, Fremdwährung verliert ~9 %', () => {
  const positions = build([['AGG', 5000], ['GLD', 5000]]);
  const [crash, , , , fx] = runScenarios(positions, [0.5, 0.5], 10000, {});
  close(crash.impact, 0.5 * 0.03 + 0.5 * 0.08);
  close(fx.impact, 1 / 1.1 - 1);
  close(crash.amount, crash.impact * 10000);
});

test('Stresstest: Euro-Werte sind vom Währungsszenario nicht betroffen', () => {
  const r = analyzePortfolio(build([['SAP', 5000], ['ALV', 5000]]), series, { benchmark });
  assert.equal(r.scenarios.find((s) => s.key === 'fx').impact, 0);
  assert.ok(r.scenarios.find((s) => s.key === 'crash').impact < -0.15);
});

test('Kosten: gewichtete TER und 10-Jahres-Kosten', () => {
  const positions = [{ ...meta('URTH'), ter: 0.002, value: 5000 }, { ...meta('SAP'), value: 5000 }];
  const r = analyzePortfolio(positions, series, { benchmark });
  close(r.costs.annualCost, 10);
  close(r.costs.weightedTer, 0.001);
  close(r.costs.fundTer, 0.002);
  assert.ok(r.costs.tenYearCost > 100 && r.costs.tenYearCost < 200);
});

test('Vorschläge: Tech-Klumpen bekommt einen Welt-ETF-Kern vorgeschlagen, Wert bleibt gleich', () => {
  const positions = build([['NVDA', 6000], ['AAPL', 3000], ['MSFT', 2500], ['TSLA', 2000], ['META', 1500]]);
  const base = analyzePortfolio(positions, series, { benchmark });
  const suggestions = suggestImprovements(positions, series, base, { benchmark, makeMeta: meta });
  const core = suggestions.find((s) => s.key === 'core');
  assert.ok(core, 'Kern-ETF-Vorschlag fehlt');
  assert.ok(core.after.score > core.before.score);
  assert.ok(core.after.volatility < core.before.volatility);
  const delta = core.changes.reduce((a, c) => a + (c.to - c.from), 0);
  close(delta, 0, 1e-6);
  close(core.changes.find((c) => c.symbol === 'URTH').to, base.totalValue * 0.5, 1e-6);
});

test('Vorschläge: gut gestreutes Depot erhält keine Umschichtung', () => {
  const positions = build([['URTH', 9000], ['EEM', 1500], ['AGG', 3000], ['GLD', 1000], ['SAP', 800], ['ALV', 700], ['MSFT', 700], ['NVO', 600], ['JNJ', 500]]);
  const base = analyzePortfolio(positions, series, { benchmark });
  assert.deepEqual(suggestImprovements(positions, series, base, { benchmark, makeMeta: meta }), []);
});

test('Import: gültige Datei wird übernommen, ungültige Werte werden bereinigt', () => {
  const data = parseDepotFile(
    JSON.stringify({
      format: 'aktienanalyse-depot',
      version: 1,
      name: 'Rente',
      mode: 'shares',
      benchmark: 'SPY',
      positions: [
        { symbol: 'aapl', quantity: 3, buyPrice: 150, sector: 'Erfunden', ter: -1 },
        { symbol: '<img src=x>', amount: 100 },
        { symbol: 'URTH', quantity: 'viel' },
      ],
    }),
  );
  assert.equal(data.name, 'Rente');
  assert.equal(data.mode, 'shares');
  assert.equal(data.benchmark, 'SPY');
  assert.equal(data.positions.length, 2);
  assert.equal(data.positions[0].sector, 'Technologie');
  assert.equal(data.positions[0].ter, null);
  assert.equal(data.positions[1].quantity, null);
});

test('Import: fremde Formate werden abgelehnt', () => {
  assert.throws(() => parseDepotFile('kein json'), /JSON/);
  assert.throws(() => parseDepotFile('{"positions": []}'), /Unbekanntes Format/);
});
