import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sma, ema, rsi, macd, bollinger } from '../js/indicators.js';
import { computeStats, computeSignals, maxDrawdown } from '../js/analysis.js';
import { generateDemoBars, parseCsv } from '../js/data.js';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

test('sma', () => {
  assert.deepEqual(sma([1, 2, 3, 4, 5], 3), [null, null, 2, 3, 4]);
});

test('ema startet mit SMA und glättet danach', () => {
  const out = ema([2, 4, 6, 8], 3);
  assert.deepEqual(out.slice(0, 2), [null, null]);
  close(out[2], 4);
  close(out[3], 8 * 0.5 + 4 * 0.5);
});

test('rsi: nur steigende Kurse ergeben 100, konstante 50', () => {
  const rising = Array.from({ length: 30 }, (_, i) => i + 1);
  assert.equal(rsi(rising, 14)[29], 100);
  assert.equal(rsi(new Array(30).fill(5), 14)[29], 50);
  assert.equal(rsi(rising, 14)[13], null);
});

test('rsi: Referenzwert nach Wilder', () => {
  // Klassisches Beispiel aus Wilder / StockCharts (erster RSI ≈ 70,53)
  const prices = [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28];
  close(rsi(prices, 14)[14], 70.46, 0.1);
});

test('macd: Histogramm = Linie − Signal', () => {
  const values = Array.from({ length: 80 }, (_, i) => 100 + Math.sin(i / 5) * 10);
  const m = macd(values);
  assert.equal(m.line[24], null);
  assert.notEqual(m.line[25], null);
  assert.equal(m.signal[32], null);
  assert.notEqual(m.signal[33], null);
  close(m.histogram[79], m.line[79] - m.signal[79]);
});

test('bollinger: konstante Kurse ergeben Bänder ohne Breite', () => {
  const bb = bollinger(new Array(25).fill(10), 20, 2);
  assert.equal(bb.upper[24], 10);
  assert.equal(bb.lower[24], 10);
  assert.equal(bb.upper[18], null);
});

test('maxDrawdown', () => {
  close(maxDrawdown([100, 120, 90, 130, 117]), -0.25);
});

test('Demodaten sind deterministisch und plausibel', () => {
  const end = new Date('2026-09-29T00:00:00Z');
  const a = generateDemoBars('AAPL', { endDate: end });
  const b = generateDemoBars('aapl', { endDate: end });
  assert.deepEqual(a, b);
  assert.equal(a.length, 756);
  assert.equal(a.at(-1).time, '2026-09-29');
  for (const bar of a) {
    assert.ok(bar.high >= Math.max(bar.open, bar.close) - 0.01);
    assert.ok(bar.low <= Math.min(bar.open, bar.close) + 0.01);
    assert.ok(bar.low > 0);
  }
});

test('computeStats und computeSignals liefern vollständige Ergebnisse', () => {
  const bars = generateDemoBars('MSFT', { endDate: new Date('2026-09-29T00:00:00Z') });
  const s = computeStats(bars);
  assert.equal(s.last, bars.at(-1).close);
  assert.ok(s.high52 >= s.low52);
  assert.ok(s.volatility > 0);
  assert.ok(s.maxDrawdown <= 0);
  const { signals, verdict } = computeSignals(bars);
  assert.equal(signals.length, 5);
  assert.ok(['bullish', 'bearish', 'neutral'].includes(verdict));
});

test('parseCsv: Yahoo-Format', () => {
  const csv = 'Date,Open,High,Low,Close,Adj Close,Volume\n2025-01-03,10,11,9,10.5,10.4,1000\n2025-01-02,9,10,8,9.5,9.4,900\n';
  const bars = parseCsv(csv);
  assert.deepEqual(bars[0], { time: '2025-01-02', open: 9, high: 10, low: 8, close: 9.5, volume: 900 });
  assert.equal(bars[1].close, 10.5);
});

test('parseCsv: deutsches Format mit Semikolon und Dezimalkomma', () => {
  const csv = 'Datum;Eröffnung;Hoch;Tief;Schlusskurs;Volumen\n02.01.2025;1.100,50;1.120,00;1.090,00;1.110,25;12.000\n03.01.2025;1.110,25;1.130,00;1.100,00;1.125,00;8.000';
  const bars = parseCsv(csv);
  assert.equal(bars.length, 2);
  assert.deepEqual(bars[0], { time: '2025-01-02', open: 1100.5, high: 1120, low: 1090, close: 1110.25, volume: 12000 });
});

test('parseCsv: nur Datum und Schlusskurs', () => {
  const bars = parseCsv('date,close\n2025-01-02,5\n2025-01-03,6');
  assert.deepEqual(bars[1], { time: '2025-01-03', open: 6, high: 6, low: 6, close: 6, volume: 0 });
});

test('parseCsv: verständliche Fehler', () => {
  assert.throws(() => parseCsv('foo,bar\n1,2\n3,4'), /Datumsspalte/);
  assert.throws(() => parseCsv('Date,Close\n'), /keine Datenzeilen/);
});
