import { createChart, CrosshairMode, LineStyle } from './vendor/lightweight-charts.mjs';
import { sma, rsi, macd, bollinger } from './indicators.js';
import { computeStats, computeSignals } from './analysis.js';
import { generateDemoBars, fetchTwelveData, parseCsv } from './data.js';

// ---------- Hilfsfunktionen ----------

const $ = (sel) => document.querySelector(sel);

const storage = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Speicher nicht verfügbar (z. B. privater Modus) – Einstellung gilt nur für diese Sitzung
    }
  },
};

const numberFmt = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pctFmt = new Intl.NumberFormat('de-DE', {
  style: 'percent',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  signDisplay: 'exceptZero',
});
const compactFmt = new Intl.NumberFormat('de-DE', { notation: 'compact', maximumFractionDigits: 1 });
const dateFmt = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeZone: 'UTC' });

const num = (v) => (v === null || v === undefined || Number.isNaN(v) ? '–' : numberFmt.format(v));
const pct = (v) => (v === null || v === undefined || Number.isNaN(v) ? '–' : pctFmt.format(v));
const date = (iso) => dateFmt.format(new Date(`${iso}T00:00:00Z`));
const toneClass = (v) => (v > 0 ? 'up' : v < 0 ? 'down' : '');

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

// '#rrggbb' → 'rgba(r, g, b, a)' (die Chart-Bibliothek versteht kein color-mix())
function withAlpha(hex, alpha) {
  const m = hex.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return hex;
  const [r, g, b] = m.slice(1).map((x) => parseInt(x, 16));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ---------- Zustand ----------

const state = {
  symbol: null,
  bars: [],
  source: storage.get('source', 'demo'),
  apiKey: storage.get('twelvedataKey', ''),
  watchlist: storage.get('watchlist', ['AAPL', 'MSFT', 'NVDA', 'SAP']),
  overlays: storage.get('overlays', { sma20: false, sma50: true, sma200: true, bollinger: false, volume: true }),
  chartType: storage.get('chartType', 'candles'),
  range: storage.get('range', '252'),
};

// ---------- Charts ----------

function chartOptions({ showTime }) {
  return {
    autoSize: true,
    layout: {
      background: { color: 'transparent' },
      textColor: cssVar('--muted'),
      fontFamily: getComputedStyle(document.body).fontFamily,
    },
    grid: {
      vertLines: { color: cssVar('--grid') },
      horzLines: { color: cssVar('--grid') },
    },
    rightPriceScale: { borderColor: cssVar('--border'), minimumWidth: 72 },
    timeScale: { borderColor: cssVar('--border'), visible: showTime },
    crosshair: { mode: CrosshairMode.Normal },
    localization: { locale: 'de-DE', priceFormatter: (p) => numberFmt.format(p) },
    handleScale: { axisPressedMouseMove: { time: true, price: false } },
  };
}

const priceChart = createChart($('#price-chart'), chartOptions({ showTime: false }));
const rsiChart = createChart($('#rsi-chart'), chartOptions({ showTime: false }));
const macdChart = createChart($('#macd-chart'), chartOptions({ showTime: true }));
const charts = [priceChart, rsiChart, macdChart];

const series = {
  candles: priceChart.addCandlestickSeries({ priceLineVisible: false }),
  line: priceChart.addLineSeries({ lineWidth: 2, priceLineVisible: false }),
  volume: priceChart.addHistogramSeries({
    priceScaleId: '',
    priceFormat: { type: 'volume' },
    lastValueVisible: false,
    priceLineVisible: false,
  }),
  sma20: priceChart.addLineSeries({ lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }),
  sma50: priceChart.addLineSeries({ lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }),
  sma200: priceChart.addLineSeries({ lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }),
  bbUpper: priceChart.addLineSeries({ lineWidth: 1, lineStyle: LineStyle.Dashed, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }),
  bbLower: priceChart.addLineSeries({ lineWidth: 1, lineStyle: LineStyle.Dashed, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }),
  rsi: rsiChart.addLineSeries({ lineWidth: 1.5, priceLineVisible: false }),
  macdHist: macdChart.addHistogramSeries({ priceLineVisible: false, lastValueVisible: false }),
  macdLine: macdChart.addLineSeries({ lineWidth: 1.5, priceLineVisible: false }),
  macdSignal: macdChart.addLineSeries({ lineWidth: 1.5, priceLineVisible: false }),
};

priceChart.priceScale('').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
priceChart.priceScale('right').applyOptions({ scaleMargins: { top: 0.1, bottom: 0.2 } });
rsiChart.priceScale('right').applyOptions({ scaleMargins: { top: 0.08, bottom: 0.08 } });

const rsiLevels = [70, 30].map((price) =>
  series.rsi.createPriceLine({ price, lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: true, title: '' }),
);

function applyTheme() {
  charts.forEach((c, i) => c.applyOptions(chartOptions({ showTime: i === charts.length - 1 })));
  const up = cssVar('--up');
  const down = cssVar('--down');
  series.candles.applyOptions({ upColor: up, downColor: down, borderUpColor: up, borderDownColor: down, wickUpColor: up, wickDownColor: down });
  series.line.applyOptions({ color: cssVar('--accent') });
  series.sma20.applyOptions({ color: cssVar('--c-sma20') });
  series.sma50.applyOptions({ color: cssVar('--c-sma50') });
  series.sma200.applyOptions({ color: cssVar('--c-sma200') });
  series.bbUpper.applyOptions({ color: cssVar('--c-bb') });
  series.bbLower.applyOptions({ color: cssVar('--c-bb') });
  series.rsi.applyOptions({ color: cssVar('--c-sma200') });
  series.macdLine.applyOptions({ color: cssVar('--c-sma50') });
  series.macdSignal.applyOptions({ color: cssVar('--c-sma20') });
  rsiLevels.forEach((l) => l.applyOptions({ color: cssVar('--muted') }));
  if (state.bars.length) renderCharts();
}

// Zeitachse und Fadenkreuz der drei Charts synchronisieren
let syncing = false;
charts.forEach((source) => {
  source.timeScale().subscribeVisibleLogicalRangeChange((range) => {
    if (syncing || !range) return;
    syncing = true;
    charts.filter((c) => c !== source).forEach((c) => c.timeScale().setVisibleLogicalRange(range));
    syncing = false;
  });
});

const crosshairTargets = [
  [priceChart, series.candles],
  [rsiChart, series.rsi],
  [macdChart, series.macdLine],
];
crosshairTargets.forEach(([source]) => {
  source.subscribeCrosshairMove((param) => {
    crosshairTargets
      .filter(([c]) => c !== source)
      .forEach(([c, s]) => {
        if (param.time) c.setCrosshairPosition(NaN, param.time, s);
        else c.clearCrosshairPosition();
      });
    updateLegend(param.time);
  });
});

// OHLC-Legende im Kurschart
const legend = document.createElement('div');
legend.className = 'chart-legend';
Object.assign(legend.style, {
  position: 'absolute',
  top: '6px',
  left: '8px',
  right: '80px',
  zIndex: 3,
  fontSize: '12px',
  pointerEvents: 'none',
  color: 'var(--muted)',
});
$('#price-chart').appendChild(legend);

function updateLegend(time) {
  const bar = (time && state.bars.find((b) => b.time === time)) || state.bars[state.bars.length - 1];
  if (!bar) {
    legend.textContent = '';
    return;
  }
  legend.innerHTML =
    `<strong style="color:var(--text)">${date(bar.time)}</strong> ` +
    `O ${num(bar.open)} · H ${num(bar.high)} · T ${num(bar.low)} · S ${num(bar.close)}` +
    (bar.volume ? ` · Vol ${compactFmt.format(bar.volume)}` : '');
}

// Werte ohne Historie werden als „Whitespace“ übergeben, damit alle Serien
// dieselben logischen Indizes haben und die Charts synchron bleiben.
function toLine(bars, values) {
  return bars.map((b, i) => (values[i] === null ? { time: b.time } : { time: b.time, value: values[i] }));
}

function renderCharts() {
  const bars = state.bars;
  const closes = bars.map((b) => b.close);
  const o = state.overlays;
  const up = cssVar('--up');
  const down = cssVar('--down');

  series.candles.setData(state.chartType === 'candles' ? bars : []);
  series.line.setData(state.chartType === 'line' ? bars.map((b) => ({ time: b.time, value: b.close })) : []);

  const volUp = withAlpha(up, 0.35);
  const volDown = withAlpha(down, 0.35);
  series.volume.setData(
    o.volume
      ? bars.map((b) => ({ time: b.time, value: b.volume, color: b.close >= b.open ? volUp : volDown }))
      : [],
  );

  series.sma20.setData(o.sma20 ? toLine(bars, sma(closes, 20)) : []);
  series.sma50.setData(o.sma50 ? toLine(bars, sma(closes, 50)) : []);
  series.sma200.setData(o.sma200 ? toLine(bars, sma(closes, 200)) : []);
  const bb = bollinger(closes, 20, 2);
  series.bbUpper.setData(o.bollinger ? toLine(bars, bb.upper) : []);
  series.bbLower.setData(o.bollinger ? toLine(bars, bb.lower) : []);

  series.rsi.setData(toLine(bars, rsi(closes, 14)));
  const m = macd(closes);
  series.macdLine.setData(toLine(bars, m.line));
  series.macdSignal.setData(toLine(bars, m.signal));
  series.macdHist.setData(
    bars.map((b, i) =>
      m.histogram[i] === null
        ? { time: b.time }
        : { time: b.time, value: m.histogram[i], color: m.histogram[i] >= 0 ? up : down },
    ),
  );

  applyRange();
  updateLegend(null);
}

function applyRange() {
  const n = state.bars.length;
  if (!n) return;
  const size = state.range === 'max' ? n : Math.min(Number(state.range), n);
  priceChart.timeScale().setVisibleLogicalRange({ from: n - size - 0.5, to: n - 0.5 + 2 });
  document.querySelectorAll('#range-buttons button').forEach((b) => {
    b.classList.toggle('active', b.dataset.range === state.range);
  });
}

// ---------- Rendering: Kurs, Kennzahlen, Signale, Watchlist ----------

function renderQuote(meta) {
  const s = computeStats(state.bars);
  $('#quote-symbol').textContent = state.symbol;
  $('#quote-meta').textContent = [meta.name !== state.symbol ? meta.name : null, meta.exchange, meta.currency, `Stand ${date(s.lastDate)}`]
    .filter(Boolean)
    .join(' · ');
  $('#quote-last').textContent = num(s.last);
  const change = $('#quote-change');
  change.textContent = s.change1d === null ? '' : `${s.change1d > 0 ? '+' : ''}${num(s.change1d)} (${pct(s.change1dPct)})`;
  change.className = `change ${toneClass(s.change1d)}`;
  const badge = $('#source-badge');
  badge.textContent = meta.sourceLabel;
  badge.classList.toggle('demo', meta.source === 'demo');
  document.title = `${state.symbol} – Aktienanalyse`;
  renderStats(s);
}

function renderStats(s) {
  const items = [
    ['Perf. 1 Monat', pct(s.perf1m), toneClass(s.perf1m)],
    ['Perf. 3 Monate', pct(s.perf3m), toneClass(s.perf3m)],
    ['Perf. seit Jahresbeginn', pct(s.ytd), toneClass(s.ytd)],
    ['Perf. 1 Jahr', pct(s.perf1y), toneClass(s.perf1y)],
    ['52W-Hoch', num(s.high52)],
    ['52W-Tief', num(s.low52)],
    ['Abstand zum 52W-Hoch', pct((s.last - s.high52) / s.high52), toneClass((s.last - s.high52) / s.high52)],
    ['Volatilität (1J, p. a.)', pct(s.volatility).replace('+', '')],
    ['Sharpe Ratio (1J, rf = 0)', s.sharpe === null ? '–' : numberFmt.format(s.sharpe)],
    ['Max. Drawdown', pct(s.maxDrawdown), 'down'],
    ['CAGR (Gesamtzeitraum)', pct(s.cagr), toneClass(s.cagr)],
    ['Ø Volumen (30 T.)', s.avgVolume30 ? compactFmt.format(s.avgVolume30) : '–'],
  ];
  const dl = $('#stats');
  dl.replaceChildren(
    ...items.map(([label, value, cls]) => {
      const div = document.createElement('div');
      const dt = document.createElement('dt');
      const dd = document.createElement('dd');
      dt.textContent = label;
      dd.textContent = value;
      if (cls) dd.className = cls;
      div.append(dt, dd);
      return div;
    }),
  );
  const footnote = document.createElement('div');
  footnote.style.gridColumn = '1 / -1';
  footnote.style.background = 'none';
  footnote.style.padding = '0';
  footnote.className = 'muted small';
  footnote.textContent = `Datenbasis: ${s.bars} Handelstage ab ${date(s.periodStart)}`;
  dl.append(footnote);
}

const VERDICT_LABEL = { bullish: 'Überwiegend positiv', bearish: 'Überwiegend negativ', neutral: 'Gemischt / neutral' };
const TONE_LABEL = { bullish: 'positiv', bearish: 'negativ', neutral: 'neutral' };

function renderSignals() {
  const { signals, score, verdict } = computeSignals(state.bars);
  const pill = $('#verdict');
  pill.textContent = signals.length ? `${VERDICT_LABEL[verdict]} (${score > 0 ? '+' : ''}${score})` : '';
  pill.className = `pill ${verdict}`;
  const list = $('#signals');
  if (!signals.length) {
    list.innerHTML = '<li class="muted">Zu wenig Historie für Signale.</li>';
    return;
  }
  list.replaceChildren(
    ...signals.map((s) => {
      const li = document.createElement('li');
      li.innerHTML = `<span class="sig-name"></span><span class="pill ${s.tone}"></span><span class="sig-detail"></span>`;
      li.querySelector('.sig-name').textContent = s.name;
      const p = li.querySelector('.pill');
      p.textContent = s.value;
      p.title = `Einschätzung: ${TONE_LABEL[s.tone]}`;
      li.querySelector('.sig-detail').textContent = s.detail;
      return li;
    }),
  );
}

function renderWatchlist() {
  const ul = $('#watchlist');
  ul.replaceChildren(
    ...state.watchlist.map((sym) => {
      const li = document.createElement('li');
      li.classList.toggle('active', sym === state.symbol);
      const open = document.createElement('button');
      open.className = 'watch-open';
      open.textContent = sym;
      open.addEventListener('click', () => load(sym));
      const remove = document.createElement('button');
      remove.className = 'watch-remove';
      remove.textContent = '×';
      remove.title = `${sym} entfernen`;
      remove.setAttribute('aria-label', `${sym} von der Watchlist entfernen`);
      remove.addEventListener('click', () => {
        state.watchlist = state.watchlist.filter((s) => s !== sym);
        storage.set('watchlist', state.watchlist);
        renderWatchlist();
      });
      li.append(open, remove);
      return li;
    }),
  );
  $('#watch-empty').hidden = state.watchlist.length > 0;
  const addBtn = $('#watch-add');
  addBtn.disabled = !state.symbol || state.watchlist.includes(state.symbol);
}

function showMessage(text, kind = 'error') {
  const el = $('#message');
  el.textContent = text;
  el.className = `message ${kind === 'info' ? 'info' : ''}`;
  el.hidden = !text;
}

// ---------- Laden ----------

let loadToken = 0;

async function load(rawSymbol) {
  const symbol = rawSymbol.trim().toUpperCase();
  if (!symbol) return;
  const token = ++loadToken;
  showMessage('');

  try {
    let bars;
    let meta;
    if (state.source === 'twelvedata') {
      if (!state.apiKey) {
        showMessage('Für echte Kursdaten bitte zuerst einen Twelve Data API-Key in den Einstellungen hinterlegen.', 'info');
        openSettings();
        return;
      }
      showMessage(`Lade Kursdaten für ${symbol} …`, 'info');
      const res = await fetchTwelveData(symbol, state.apiKey);
      bars = res.bars;
      meta = { ...res.meta, source: 'twelvedata', sourceLabel: 'Twelve Data' };
    } else {
      bars = generateDemoBars(symbol);
      meta = { name: symbol, source: 'demo', sourceLabel: 'Demodaten – simuliert, keine echten Kurse' };
    }
    if (token !== loadToken) return; // eine neuere Anfrage läuft bereits
    setData(symbol, bars, meta);
    showMessage('');
  } catch (err) {
    if (token !== loadToken) return;
    showMessage(`Fehler beim Laden von ${symbol}: ${err.message}`);
  }
}

function setData(symbol, bars, meta) {
  state.symbol = symbol;
  state.bars = bars;
  $('#symbol-input').value = symbol;
  if (meta.source !== 'csv') {
    history.replaceState(null, '', `#${encodeURIComponent(symbol)}`);
    storage.set('lastSymbol', symbol);
  }
  renderQuote(meta);
  renderCharts();
  renderSignals();
  renderWatchlist();
}

// ---------- Einstellungen ----------

const dialog = $('#settings-dialog');

function openSettings() {
  $('#api-key-input').value = state.apiKey;
  dialog.showModal();
}

dialog.addEventListener('close', () => {
  if (dialog.returnValue !== 'save') return;
  state.apiKey = $('#api-key-input').value.trim();
  storage.set('twelvedataKey', state.apiKey);
  if (state.apiKey && state.source === 'twelvedata' && state.symbol) load(state.symbol);
});

// ---------- Event-Handler ----------

$('#search-form').addEventListener('submit', (e) => {
  e.preventDefault();
  load($('#symbol-input').value);
});

$('#source-select').value = state.source;
$('#source-select').addEventListener('change', (e) => {
  state.source = e.target.value;
  storage.set('source', state.source);
  if (state.symbol) load(state.symbol);
});

$('#settings-button').addEventListener('click', openSettings);

$('#csv-button').addEventListener('click', () => $('#csv-input').click());
$('#csv-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  loadToken++;
  try {
    const bars = parseCsv(await file.text());
    const symbol = file.name.replace(/\.[^.]+$/, '').toUpperCase().slice(0, 20);
    setData(symbol, bars, { name: file.name, source: 'csv', sourceLabel: 'CSV-Import' });
    showMessage('');
  } catch (err) {
    showMessage(`CSV konnte nicht gelesen werden: ${err.message}`);
  }
});

$('#watch-add').addEventListener('click', () => {
  if (!state.symbol || state.watchlist.includes(state.symbol)) return;
  state.watchlist.push(state.symbol);
  storage.set('watchlist', state.watchlist);
  renderWatchlist();
});

$('#range-buttons').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-range]');
  if (!btn) return;
  state.range = btn.dataset.range;
  storage.set('range', state.range);
  applyRange();
});

document.querySelectorAll('#overlay-toggles input[data-overlay]').forEach((input) => {
  input.checked = !!state.overlays[input.dataset.overlay];
  input.addEventListener('change', () => {
    state.overlays[input.dataset.overlay] = input.checked;
    storage.set('overlays', state.overlays);
    if (state.bars.length) renderCharts();
  });
});

$('#chart-type').value = state.chartType;
$('#chart-type').addEventListener('change', (e) => {
  state.chartType = e.target.value;
  storage.set('chartType', state.chartType);
  if (state.bars.length) renderCharts();
});

window.addEventListener('hashchange', () => {
  const sym = decodeURIComponent(location.hash.slice(1));
  if (sym && sym !== state.symbol) load(sym);
});

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

// ---------- Start ----------

applyTheme();
renderWatchlist();
load(decodeURIComponent(location.hash.slice(1)) || storage.get('lastSymbol', null) || state.watchlist[0] || 'AAPL');
