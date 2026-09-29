// Kennzahlen und regelbasierte Signale aus Kursdaten.
// Erwartet Bars aufsteigend sortiert: { time: 'YYYY-MM-DD', open, high, low, close, volume }

import { sma, rsi, macd, bollinger } from './indicators.js';

const TRADING_DAYS = 252;

function pctChange(from, to) {
  return from ? (to - from) / from : null;
}

function std(values) {
  if (values.length < 2) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

export function maxDrawdown(closes) {
  let peak = -Infinity;
  let maxDd = 0;
  for (const c of closes) {
    if (c > peak) peak = c;
    const dd = (c - peak) / peak;
    if (dd < maxDd) maxDd = dd;
  }
  return maxDd;
}

export function computeStats(bars) {
  const closes = bars.map((b) => b.close);
  const n = closes.length;
  const last = closes[n - 1];
  const back = (days) => (n > days ? pctChange(closes[n - 1 - days], last) : null);

  const lastYear = bars.slice(-TRADING_DAYS);
  const logReturns = [];
  for (let i = Math.max(1, n - TRADING_DAYS); i < n; i++) {
    logReturns.push(Math.log(closes[i] / closes[i - 1]));
  }
  const dailySd = std(logReturns);
  const volatility = dailySd === null ? null : dailySd * Math.sqrt(TRADING_DAYS);
  const meanReturn = logReturns.length
    ? logReturns.reduce((a, b) => a + b, 0) / logReturns.length
    : null;
  const sharpe =
    volatility && meanReturn !== null ? (meanReturn * TRADING_DAYS) / volatility : null;

  const currentYear = bars[n - 1].time.slice(0, 4);
  const firstIdxOfYear = bars.findIndex((b) => b.time.slice(0, 4) === currentYear);
  const ytdBase = firstIdxOfYear > 0 ? closes[firstIdxOfYear - 1] : closes[firstIdxOfYear];

  const years = (Date.parse(bars[n - 1].time) - Date.parse(bars[0].time)) / (365.25 * 864e5);
  const cagr = years > 0.5 ? (last / closes[0]) ** (1 / years) - 1 : null;

  const recentVolume = bars.slice(-30).map((b) => b.volume).filter((v) => v > 0);

  return {
    last,
    lastDate: bars[n - 1].time,
    change1d: n > 1 ? last - closes[n - 2] : null,
    change1dPct: back(1),
    perf1m: back(21),
    perf3m: back(63),
    perf1y: back(TRADING_DAYS),
    ytd: pctChange(ytdBase, last),
    high52: Math.max(...lastYear.map((b) => b.high)),
    low52: Math.min(...lastYear.map((b) => b.low)),
    volatility,
    sharpe,
    maxDrawdown: maxDrawdown(closes),
    cagr,
    avgVolume30: recentVolume.length
      ? recentVolume.reduce((a, b) => a + b, 0) / recentVolume.length
      : null,
    periodStart: bars[0].time,
    bars: n,
  };
}

// Findet, ob `a` die Linie `b` in den letzten `lookback` Bars gekreuzt hat.
// Rückgabe: 'up' | 'down' | null
function recentCross(a, b, lookback) {
  const n = a.length;
  for (let i = n - 1; i > Math.max(0, n - 1 - lookback); i--) {
    if ([a[i], b[i], a[i - 1], b[i - 1]].some((v) => v === null)) return null;
    const now = a[i] - b[i];
    const before = a[i - 1] - b[i - 1];
    if (before <= 0 && now > 0) return 'up';
    if (before >= 0 && now < 0) return 'down';
  }
  return null;
}

export function computeSignals(bars) {
  const closes = bars.map((b) => b.close);
  const n = closes.length;
  const last = closes[n - 1];
  const sma50 = sma(closes, 50);
  const sma200 = sma(closes, 200);
  const rsi14 = rsi(closes, 14);
  const m = macd(closes);
  const bb = bollinger(closes, 20, 2);
  const signals = [];

  if (sma200[n - 1] !== null) {
    const above = last > sma200[n - 1];
    signals.push({
      name: 'Langfristiger Trend',
      value: `${above ? 'über' : 'unter'} SMA 200`,
      tone: above ? 'bullish' : 'bearish',
      detail: `Kurs ${fmt(last)} vs. SMA 200 ${fmt(sma200[n - 1])}`,
    });
  }

  if (sma50[n - 1] !== null && sma200[n - 1] !== null) {
    const cross = recentCross(sma50, sma200, 20);
    const above = sma50[n - 1] > sma200[n - 1];
    signals.push({
      name: 'SMA 50 / SMA 200',
      value: cross === 'up' ? 'Golden Cross' : cross === 'down' ? 'Death Cross' : above ? 'SMA 50 oben' : 'SMA 50 unten',
      tone: above ? 'bullish' : 'bearish',
      detail: cross
        ? 'Kreuzung innerhalb der letzten 20 Handelstage'
        : 'Keine Kreuzung in den letzten 20 Handelstagen',
    });
  }

  if (rsi14[n - 1] !== null) {
    const r = rsi14[n - 1];
    signals.push({
      name: 'RSI (14)',
      value: r.toFixed(1),
      tone: r > 70 ? 'bearish' : r < 30 ? 'bullish' : 'neutral',
      detail: r > 70 ? 'Überkauft (> 70)' : r < 30 ? 'Überverkauft (< 30)' : 'Neutraler Bereich (30–70)',
    });
  }

  if (m.signal[n - 1] !== null) {
    const above = m.line[n - 1] > m.signal[n - 1];
    const cross = recentCross(m.line, m.signal, 5);
    signals.push({
      name: 'MACD (12, 26, 9)',
      value: above ? 'über Signallinie' : 'unter Signallinie',
      tone: above ? 'bullish' : 'bearish',
      detail: cross
        ? `${cross === 'up' ? 'Kaufsignal' : 'Verkaufssignal'}: Kreuzung in den letzten 5 Tagen`
        : `Histogramm ${fmt(m.histogram[n - 1], 3)}`,
    });
  }

  if (bb.upper[n - 1] !== null) {
    const { upper, lower } = { upper: bb.upper[n - 1], lower: bb.lower[n - 1] };
    const pos = (last - lower) / (upper - lower);
    signals.push({
      name: 'Bollinger-Bänder (20, 2)',
      value: `%B ${(pos * 100).toFixed(0)} %`,
      tone: last > upper ? 'bearish' : last < lower ? 'bullish' : 'neutral',
      detail:
        last > upper
          ? 'Kurs über dem oberen Band'
          : last < lower
            ? 'Kurs unter dem unteren Band'
            : 'Kurs innerhalb der Bänder',
    });
  }

  const score = signals.reduce(
    (s, x) => s + (x.tone === 'bullish' ? 1 : x.tone === 'bearish' ? -1 : 0),
    0,
  );
  const verdict = score >= 2 ? 'bullish' : score <= -2 ? 'bearish' : 'neutral';
  return { signals, score, verdict };
}

function fmt(v, digits = 2) {
  return v === null || v === undefined ? '–' : v.toFixed(digits);
}
