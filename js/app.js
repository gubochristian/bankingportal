import { createChart, CrosshairMode, LineStyle } from './vendor/lightweight-charts.mjs';
import { sma, rsi, macd, bollinger } from './indicators.js';
import { computeStats, computeSignals } from './analysis.js';
import { parseCsv } from './data.js';
import { loadSeries, MissingApiKeyError } from './market.js';
import { initDepot, readLocalDepots, clearLocalDepots } from './depot.js';
import { initConnections } from './connections.js';
import { initAccount } from './account.js';
import { api, sessionEvents } from './api.js';
import { showLogin } from './auth-ui.js';
import { startSessionWatch } from './session.js';
import { $, storage, numberFmt, compactFmt, num, pct, date, toneClass, cssVar, withAlpha } from './util.js';

// ---------- Zustand ----------

const state = {
  symbol: null,
  bars: [],
  source: storage.get('source', 'demo'),
  apiKey: '', // wird nach der Anmeldung aus dem Konto geladen
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

// Ziel-Serie je Chart; im Kurschart die gerade sichtbare (Kerzen oder Linie)
const crosshairTargets = [
  [priceChart, () => (state.chartType === 'line' ? series.line : series.candles)],
  [rsiChart, () => series.rsi],
  [macdChart, () => series.macdLine],
];
crosshairTargets.forEach(([source]) => {
  source.subscribeCrosshairMove((param) => {
    crosshairTargets
      .filter(([c]) => c !== source)
      .forEach(([c, target]) => {
        if (!param.time) return c.clearCrosshairPosition();
        try {
          c.setCrosshairPosition(NaN, param.time, target());
        } catch {
          // Zeitpunkt ohne Wert in diesem Chart (z. B. RSI am Anfang der Historie)
          c.clearCrosshairPosition();
        }
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
    if (state.source === 'twelvedata' && state.apiKey) showMessage(`Lade Kursdaten für ${symbol} …`, 'info');
    const { bars, meta } = await loadSeries(symbol, {
      source: state.source,
      apiKey: state.apiKey,
      onWait: (s) => showMessage(`API-Limit erreicht – neuer Versuch in ${s} Sekunden …`, 'info'),
    });
    if (token !== loadToken) return; // eine neuere Anfrage läuft bereits
    setData(symbol, bars, meta);
    showMessage('');
  } catch (err) {
    if (token !== loadToken) return;
    if (err instanceof MissingApiKeyError) {
      showMessage(err.message, 'info');
      openSettings();
      return;
    }
    showMessage(`Fehler beim Laden von ${symbol}: ${err.message}`);
  }
}

function setData(symbol, bars, meta) {
  state.symbol = symbol;
  state.bars = bars;
  state.loadedSource = meta.source;
  $('#symbol-input').value = symbol;
  if (meta.source !== 'csv') {
    history.replaceState(null, '', `#${encodeURIComponent(symbol)}`);
    $('#nav-analysis').href = `#${encodeURIComponent(symbol)}`;
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

dialog.addEventListener('close', async () => {
  if (dialog.returnValue !== 'save') return;
  state.apiKey = $('#api-key-input').value.trim();
  try {
    await api.put('/api/settings', { settings: { twelvedataKey: state.apiKey } });
  } catch (err) {
    showMessage(`Einstellungen konnten nicht gespeichert werden: ${err.message}`);
  }
  if (!state.apiKey || state.source !== 'twelvedata') return;
  if (document.body.dataset.view === 'depot') depot?.refresh();
  else if (state.symbol) load(state.symbol);
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
  if (document.body.dataset.view === 'depot') depot?.refresh();
  else if (state.symbol) load(state.symbol);
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

$('#depot-add-current').addEventListener('click', () => {
  if (!state.symbol) return;
  const added = depot?.addPosition(state.symbol);
  showMessage(added ? `${state.symbol} wurde dem Depot hinzugefügt.` : `${state.symbol} ist bereits im Depot.`, 'info');
});

// ---------- Ansichten ----------
// #SYMBOL = Einzelanalyse, #depot, #verbindungen, #konto

let depot = null;
let connections = null;
let account = null;
let currentUser = null;
let sessionWatch = null;

const VIEWS = { depot: 'depot', verbindungen: 'connections', konto: 'account' };
const TITLES = { depot: 'Depot', connections: 'Schnittstellen', account: 'Mein Konto' };

function route() {
  if (!depot) return;
  const hash = decodeURIComponent(location.hash.slice(1));
  const view = VIEWS[hash.toLowerCase()] ?? 'analysis';
  document.body.dataset.view = view;
  document.querySelectorAll('.nav-tabs a, #account-link').forEach((a) => {
    const active = (a.dataset.view ?? 'account') === view;
    a.classList.toggle('active', active);
    if (active) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  if (view !== 'depot') depot.hide();
  if (view !== 'analysis') {
    document.title = `${TITLES[view]} – Aktienanalyse`;
    if (view === 'depot') depot.show();
    if (view === 'connections') connections.show();
    if (view === 'account') account.show();
    return;
  }
  $('#nav-analysis').href = state.symbol ? `#${encodeURIComponent(state.symbol)}` : '#';
  const sym = hash || state.symbol || storage.get('lastSymbol', null) || state.watchlist[0] || 'AAPL';
  // Nach einem Quellenwechsel in der Depot-Ansicht neu laden (CSV-Daten bleiben erhalten)
  const staleSource = state.loadedSource !== 'csv' && state.loadedSource !== state.source;
  if (sym !== state.symbol || staleSource) load(sym);
  else if (state.symbol) document.title = `${state.symbol} – Aktienanalyse`;
}

window.addEventListener('hashchange', route);

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

// ---------- Speichern der Depots im Konto ----------

const depotStore = (() => {
  let pending = null;
  let timer = null;
  let saving = false;
  const status = (text, kind = '') => {
    const el = $('#save-status');
    el.textContent = text;
    el.dataset.kind = kind;
  };

  async function flush() {
    clearTimeout(timer);
    if (!pending || saving) return;
    const doc = pending;
    pending = null;
    saving = true;
    status('Wird gespeichert …');
    try {
      await api.put('/api/depots', { depots: doc });
      status('✓ Gespeichert', 'ok');
    } catch (err) {
      pending ??= doc; // beim nächsten Versuch erneut senden
      status(err.status === 401 ? 'Nicht gespeichert – bitte erneut anmelden' : 'Nicht gespeichert – neuer Versuch …', 'error');
      if (err.status !== 401) timer = setTimeout(flush, 5000);
    } finally {
      saving = false;
      if (pending && !timer) timer = setTimeout(flush, 600);
    }
  }

  return {
    save(doc) {
      pending = structuredClone(doc);
      clearTimeout(timer);
      timer = setTimeout(flush, 600);
      status('Ungespeicherte Änderungen');
    },
    flush,
    // Beim Schließen der Seite noch offene Änderungen senden
    flushOnExit() {
      if (!pending) return;
      fetch('/api/depots', {
        method: 'PUT',
        keepalive: true,
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ depots: pending }),
      });
      pending = null;
    },
  };
})();

window.addEventListener('pagehide', () => depotStore.flushOnExit());

// ---------- Anmeldung, Abmeldung, Sitzungsablauf ----------

async function logout() {
  await depotStore.flush();
  try {
    await api.post('/api/auth/logout');
  } catch {
    // Sitzung ggf. schon abgelaufen
  }
  // Neu laden, damit keine Daten des bisherigen Nutzers im Speicher bleiben
  location.hash = '';
  location.reload();
}

$('#logout-button').addEventListener('click', logout);

let reloginOpen = false;
async function handleExpired(message) {
  if (reloginOpen || !currentUser) return;
  reloginOpen = true;
  sessionWatch?.stop();
  document.querySelectorAll('dialog[open]').forEach((d) => d.close());
  const previous = currentUser;
  const user = await showLogin({ message, email: previous.email });
  reloginOpen = false;
  if (user.id !== previous.id) {
    // anderer Nutzer: sauber neu starten
    location.reload();
    return;
  }
  await startSession(user);
  depotStore.flush();
}

sessionEvents.addEventListener('expired', (e) => handleExpired(e.detail));

async function startSession(user) {
  currentUser = user;
  $('#user-label').textContent = user.name || user.email;
  $('#account-link').title = `Angemeldet als ${user.email}`;
  const me = await api.get('/api/auth/me');
  sessionWatch?.stop();
  sessionWatch = startSessionWatch({ expiresAt: me.session.expiresAt, onExpired: handleExpired });
}

// ---------- Start ----------

async function boot() {
  applyTheme();
  renderWatchlist();
  let user = null;
  try {
    user = (await api.get('/api/auth/me')).user;
  } catch (err) {
    if (err.status === 0) {
      $('#boot-screen').textContent = err.message;
      return;
    }
  }
  $('#boot-screen').hidden = true;
  if (!user) user = await showLogin();
  document.body.dataset.auth = 'in';
  await startSession(user);

  // Konto-Daten laden: Einstellungen und Depots
  const [{ settings }, { depots: saved }] = await Promise.all([api.get('/api/settings'), api.get('/api/depots')]);
  state.apiKey = settings.twelvedataKey ?? '';
  // API-Schlüssel aus früheren Versionen (localStorage) einmalig ins Konto übernehmen
  const localKey = storage.get('twelvedataKey', '');
  if (localKey) {
    if (!state.apiKey) {
      state.apiKey = localKey;
      await api.put('/api/settings', { settings: { twelvedataKey: localKey } }).catch(() => {});
    }
    storage.remove('twelvedataKey');
  }

  let savedDepots = saved;
  const local = readLocalDepots();
  if (!saved && local) {
    if (confirm('Auf diesem Gerät wurden Depots aus einer früheren Version gefunden. Sollen sie in dein Konto übernommen werden?')) {
      savedDepots = local;
      await api.put('/api/depots', { depots: local }).catch(() => {});
      clearLocalDepots();
    }
  }

  depot = initDepot({
    getSource: () => state.source,
    getApiKey: () => state.apiKey,
    openSettings,
    savedDepots,
    persist: (doc) => depotStore.save(doc),
  });
  connections = initConnections({ depot });
  account = initAccount({ getUser: () => currentUser, onLoggedOut: () => location.reload() });
  route();
}

boot();
