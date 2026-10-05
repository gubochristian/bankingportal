// Depot-Ansicht: Positionen erfassen, Kurse laden, Bewertung darstellen.

import { createChart, CrosshairMode } from './vendor/lightweight-charts.mjs';
import { loadSeries, MissingApiKeyError, convertToEur, fxSymbol, hasFx } from './market.js';
import { analyzePortfolio, RISK_CLASS_LABELS } from './portfolio.js';
import { suggestImprovements, HELPER_SYMBOLS } from './optimizer.js';
import { parseDepotFile, BENCHMARK_NAMES } from './depot-file.js';
import { simulate, expectedPortfolioReturn } from './forecast.js';
import { ASSET_CLASSES, SECTORS, REGIONS, CURRENCIES, SECURITIES, lookupSecurity, defaultMeta } from './securities.js';
import { $, storage, num, pct, pct1, eur, numberFmt, cssVar, withAlpha, toneClass } from './util.js';

const oneDecimal = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 });

const EXAMPLES = {
  balanced: [
    ['URTH', 9000], ['EEM', 1500], ['AGG', 3000], ['GLD', 1000], ['SAP', 800], ['ALV', 700], ['MSFT', 700], ['NVO', 600], ['JNJ', 500],
  ],
  tech: [
    ['NVDA', 6000], ['AAPL', 3000], ['MSFT', 2500], ['TSLA', 2000], ['META', 1500], ['ASML', 1000],
  ],
  dax: [
    ['SAP', 2500], ['SIE', 2000], ['ALV', 1500], ['DTE', 1200], ['BAS', 1000], ['BMW', 900], ['IFX', 800], ['MUV2', 800],
  ],
};

const LEVEL_LABEL = { critical: 'Kritisch', warning: 'Warnung', info: 'Hinweis', good: 'Positiv' };
const LEVEL_ICON = { critical: '✕', warning: '!', info: 'i', good: '✓' };

let nextId = 1;
const newId = (prefix = 'p') => `${prefix}${Date.now().toString(36)}${nextId++}`;

// Gespeicherte Depots laden; übernimmt das Einzeldepot aus der Vorversion
function loadDepots() {
  const saved = storage.get('depots', null);
  if (saved?.list?.length) return saved;
  const legacy = storage.get('depot', null);
  const first = { id: newId('d'), name: 'Mein Depot', mode: 'amount', positions: [], benchmark: 'URTH', ...(legacy ?? {}) };
  return { activeId: first.id, list: [first] };
}

export function initDepot({ getSource, getApiKey, openSettings }) {
  const depots = loadDepots();
  const active = () => depots.list.find((d) => d.id === depots.activeId) ?? depots.list[0];

  const state = {
    mode: active().mode ?? 'amount',
    positions: active().positions ?? [],
    benchmark: active().benchmark ?? 'URTH',
    series: {}, // symbol → bars (für die aktuelle Quelle)
    errors: {}, // symbol → Fehlermeldung
    fx: {}, // Währung → Wechselkurs-Bars (EUR/xxx)
    convertFx: active().convertFx ?? true,
    forecast: { monthly: 100, years: 15, inflation: false, ...(active().forecast ?? {}) },
    input: [],
    extraErrors: new Set(), // Vergleichsindex/Bausteine ohne Kurse
    allocTab: storage.get('depotAllocTab', 'sector'),
    visible: false,
    loadToken: 0,
    result: null,
    suggestions: [],
  };

  function save() {
    Object.assign(active(), {
      mode: state.mode,
      positions: state.positions,
      benchmark: state.benchmark,
      convertFx: state.convertFx,
      forecast: state.forecast,
    });
    storage.set('depots', depots);
  }

  // ---------- Mehrere Depots ----------

  function renderDepotSelect() {
    const sel = $('#depot-select');
    sel.replaceChildren(...depots.list.map((d) => new Option(d.name, d.id, false, d.id === depots.activeId)));
    $('#depot-delete').disabled = depots.list.length < 2;
  }

  function switchDepot(id) {
    depots.activeId = id;
    const d = active();
    state.mode = d.mode ?? 'amount';
    state.positions = d.positions ?? [];
    state.benchmark = d.benchmark ?? 'URTH';
    state.convertFx = d.convertFx ?? true;
    state.forecast = { monthly: 100, years: 15, inflation: false, ...(d.forecast ?? {}) };
    storage.set('depots', depots);
    syncControls();
    renderDepotSelect();
    renderMode();
    refresh();
  }

  function createDepot(name, data = {}) {
    const d = { id: newId('d'), name, mode: 'amount', positions: [], benchmark: 'URTH', ...data };
    depots.list.push(d);
    switchDepot(d.id);
  }

  $('#depot-select').addEventListener('change', (e) => switchDepot(e.target.value));

  $('#depot-new').addEventListener('click', () => {
    const name = prompt('Name des neuen Depots:', `Depot ${depots.list.length + 1}`);
    if (name?.trim()) createDepot(name.trim());
  });

  $('#depot-rename').addEventListener('click', () => {
    const name = prompt('Neuer Name:', active().name);
    if (!name?.trim()) return;
    active().name = name.trim();
    save();
    renderDepotSelect();
  });

  $('#depot-delete').addEventListener('click', () => {
    if (depots.list.length < 2 || !confirm(`Depot „${active().name}“ endgültig löschen?`)) return;
    depots.list = depots.list.filter((d) => d.id !== depots.activeId);
    switchDepot(depots.list[0].id);
  });

  $('#depot-export').addEventListener('click', () => {
    const d = active();
    const data = { format: 'aktienanalyse-depot', version: 1, name: d.name, mode: state.mode, benchmark: state.benchmark, convertFx: state.convertFx, forecast: state.forecast, positions: state.positions };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(blob),
      download: `${d.name.replace(/[^\wäöüÄÖÜß-]+/g, '_')}.json`,
    });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  $('#depot-import').addEventListener('click', () => $('#depot-import-file').click());
  $('#depot-import-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const data = parseDepotFile(await file.text());
      if (depots.list.some((d) => d.name === data.name)) data.name = `${data.name} (Import)`;
      state.notice = `Depot „${data.name}“ mit ${data.positions.length} Positionen importiert.`;
      createDepot(data.name, data);
    } catch (err) {
      showMessage(`Import fehlgeschlagen: ${err.message}`);
    }
  });

  // ---------- Formular & Auswahllisten ----------

  $('#security-list').replaceChildren(
    ...Object.entries(SECURITIES).map(([sym, s]) => {
      const o = document.createElement('option');
      o.value = sym;
      o.label = `${s.name} · ${s.type}`;
      return o;
    }),
  );

  function renderMode() {
    document.querySelectorAll('#depot-mode button').forEach((b) => b.classList.toggle('active', b.dataset.mode === state.mode));
    document.body.dataset.depotMode = state.mode;
    const amount = state.mode === 'amount';
    $('#depot-qty-label').textContent = amount ? 'Betrag in €' : 'Stückzahl';
    $('#qty-head').textContent = amount ? 'Betrag' : 'Stück';
  }

  $('#depot-mode').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-mode]');
    if (!btn || btn.dataset.mode === state.mode) return;
    // Beim Wechsel die Positionen sinnvoll umrechnen (über den aktuellen Kurs)
    const toShares = btn.dataset.mode === 'shares';
    for (const p of state.positions) {
      const last = barsFor(p.symbol, p.currency)?.at(-1)?.close;
      if (!last) continue;
      if (toShares && p.amount) p.quantity = round(p.amount / last, 4);
      if (!toShares && p.quantity) p.amount = Math.round(p.quantity * last);
    }
    state.mode = btn.dataset.mode;
    save();
    renderMode();
    renderTable();
    evaluate();
  });

  $('#depot-add').addEventListener('submit', (e) => {
    e.preventDefault();
    const symbol = $('#depot-symbol').value.trim().toUpperCase();
    const qty = Number($('#depot-qty').value);
    const buy = Number($('#depot-buy').value);
    if (!symbol || !(qty > 0)) return;
    if (!addPosition(symbol, qty, buy > 0 ? buy : null)) {
      showMessage(`${symbol} ist bereits im Depot – passe die Menge direkt in der Tabelle an.`, 'info');
      return;
    }
    $('#depot-symbol').value = '';
    $('#depot-qty').value = '';
    $('#depot-buy').value = '';
    $('#depot-symbol').focus();
  });

  $('#depot-example').addEventListener('change', (e) => {
    const example = EXAMPLES[e.target.value];
    e.target.value = '';
    if (!example) return;
    if (state.positions.length && !confirm('Das aktuelle Depot wird durch das Beispiel ersetzt. Fortfahren?')) return;
    state.mode = 'amount';
    state.positions = example.map(([symbol, amount]) => ({ id: newId(), symbol, amount, ...stripKnown(defaultMeta(symbol)) }));
    save();
    renderMode();
    refresh();
  });

  $('#depot-clear').addEventListener('click', () => {
    if (!state.positions.length || !confirm('Alle Positionen aus dem Depot entfernen?')) return;
    state.positions = [];
    save();
    renderTable();
    evaluate();
  });

  function stripKnown({ known, ...meta }) {
    return meta;
  }

  // Öffentlich: auch aus der Einzelanalyse nutzbar („+ Ins Depot“)
  function addPosition(symbol, qty = null, buyPrice = null) {
    symbol = symbol.toUpperCase();
    if (state.positions.some((p) => p.symbol === symbol)) return false;
    const pos = { id: newId(), symbol, ...stripKnown(defaultMeta(symbol)) };
    if (state.mode === 'amount') pos.amount = qty ?? 1000;
    else {
      pos.quantity = qty ?? 10;
      if (buyPrice) pos.buyPrice = buyPrice;
    }
    state.positions.push(pos);
    save();
    if (state.visible) refresh();
    return true;
  }

  // ---------- Tabelle ----------

  function select(options, value, onChange, label) {
    const el = document.createElement('select');
    el.setAttribute('aria-label', label);
    for (const opt of options) el.add(new Option(opt, opt, false, opt === value));
    if (!options.includes(value)) el.add(new Option(value, value, true, true));
    el.addEventListener('change', () => onChange(el.value));
    return el;
  }

  function numberInput(value, onChange, label) {
    const el = document.createElement('input');
    el.type = 'number';
    el.min = '0';
    el.step = 'any';
    el.inputMode = 'decimal';
    el.value = value ?? '';
    el.setAttribute('aria-label', label);
    el.addEventListener('change', () => onChange(el.value === '' ? null : Number(el.value)));
    return el;
  }

  function td(content, cls) {
    const cell = document.createElement('td');
    if (cls) cell.className = cls;
    if (content instanceof Node) cell.append(content);
    else cell.textContent = content ?? '';
    return cell;
  }

  function update(pos, field, value) {
    pos[field] = value;
    save();
    renderTable();
    evaluate();
  }

  function renderTable() {
    const body = $('#positions-body');
    const values = positionValues();
    const total = values.reduce((s, v) => s + (v.value ?? 0), 0);

    body.replaceChildren(
      ...state.positions.map((p) => {
        const v = values.find((x) => x.id === p.id);
        const tr = document.createElement('tr');
        if (state.errors[p.symbol]) tr.className = 'has-error';

        const symCell = document.createElement('div');
        symCell.className = 'sym';
        const link = document.createElement('a');
        link.href = `#${encodeURIComponent(p.symbol)}`;
        link.textContent = p.symbol;
        link.title = 'In der Einzelanalyse öffnen';
        const name = document.createElement('span');
        name.className = 'muted small';
        name.textContent = state.errors[p.symbol] ? state.errors[p.symbol] : p.name;
        symCell.append(link, name);

        const remove = document.createElement('button');
        remove.className = 'icon-remove';
        remove.textContent = '×';
        remove.title = `${p.symbol} entfernen`;
        remove.setAttribute('aria-label', `${p.symbol} aus dem Depot entfernen`);
        remove.addEventListener('click', () => {
          state.positions = state.positions.filter((x) => x !== p);
          save();
          renderTable();
          evaluate();
        });

        const qtyField = state.mode === 'amount' ? 'amount' : 'quantity';
        const pnl = v.costBasis ? v.value - v.costBasis : null;
        tr.append(
          td(symCell),
          td(select(ASSET_CLASSES, p.type, (x) => update(p, 'type', x), `Anlageklasse ${p.symbol}`)),
          td(select(SECTORS, p.sector, (x) => update(p, 'sector', x), `Sektor ${p.symbol}`)),
          td(select(REGIONS, p.region, (x) => update(p, 'region', x), `Region ${p.symbol}`)),
          td(select(CURRENCIES, p.currency, (x) => update(p, 'currency', x), `Währung ${p.symbol}`)),
          td(
            p.type === 'Aktie'
              ? '–'
              : numberInput(terOf(p) === null ? null : round(terOf(p) * 100, 3), (x) => update(p, 'ter', x === null ? null : x / 100), `TER in Prozent ${p.symbol}`),
            'num ter',
          ),
          td(numberInput(p[qtyField], (x) => update(p, qtyField, x), `${state.mode === 'amount' ? 'Betrag' : 'Stückzahl'} ${p.symbol}`), 'num'),
          td(numberInput(p.buyPrice, (x) => update(p, 'buyPrice', x), `Kaufkurs ${p.symbol}`), 'num shares-only'),
          td(priceCell(p, v), 'num'),
          td(v.value !== null ? eur(v.value) : '–', 'num'),
          td(v.value && total ? pct1(v.value / total) : '–', 'num'),
          td(pnl === null ? '–' : `${eur(pnl)} (${pct(pnl / v.costBasis)})`, `num shares-only ${toneClass(pnl)}`),
          td(remove),
        );
        return tr;
      }),
    );
    $('#depot-empty').hidden = state.positions.length > 0;
    $('#positions-table').hidden = state.positions.length === 0;
  }

  // Kurs in Handelswährung, bei Umrechnung zusätzlich in Euro
  function priceCell(p, v) {
    if (v.rawLast === null) return state.errors[p.symbol] ? '–' : '…';
    if (p.currency === 'EUR') return num(v.rawLast);
    const el = document.createElement('div');
    el.className = 'price-cell';
    el.append(Object.assign(document.createElement('span'), { textContent: `${num(v.rawLast)} ${p.currency}` }));
    if (state.convertFx && state.fx[p.currency]) {
      el.append(Object.assign(document.createElement('span'), { className: 'muted small', textContent: `= ${num(v.last)} €` }));
    }
    return el;
  }

  // TER: eigener Wert der Position, sonst Richtwert aus den Stammdaten
  function terOf(p) {
    if (p.type === 'Aktie') return 0;
    return p.ter === undefined ? (lookupSecurity(p.symbol)?.ter ?? null) : p.ter;
  }

  // Aktueller Wert jeder Position aus Menge bzw. Betrag und letztem Kurs (in Euro)
  function positionValues(positions = state.positions, mode = state.mode, bars = barsFor) {
    return positions.map((p) => {
      const last = bars(p.symbol, p.currency)?.at(-1)?.close ?? null;
      const rawLast = state.series[p.symbol]?.at(-1)?.close ?? null;
      if (mode === 'amount') return { id: p.id, last, rawLast, value: p.amount > 0 ? p.amount : null, costBasis: null };
      const value = last !== null && p.quantity > 0 ? p.quantity * last : null;
      const costBasis = p.buyPrice > 0 && p.quantity > 0 ? p.buyPrice * p.quantity : null;
      return { id: p.id, last, rawLast, value, costBasis };
    });
  }

  // ---------- Laden & Bewerten ----------

  function showMessage(text, kind = 'error') {
    const el = $('#depot-message');
    el.textContent = text;
    el.className = `message ${kind === 'info' ? 'info' : ''}`;
    el.hidden = !text;
  }

  let loadedSource = null;
  const eurCache = new Map();

  // Kurse in Euro (falls Umrechnung aktiv und Wechselkurs geladen), sonst Originalkurse
  function barsFor(symbol, currency, convert = state.convertFx) {
    const raw = state.series[symbol];
    if (!raw || !convert || currency === 'EUR' || !state.fx[currency]) return raw ?? null;
    const key = `${symbol}|${currency}`;
    if (!eurCache.has(key)) eurCache.set(key, convertToEur(raw, state.fx[currency]));
    return eurCache.get(key);
  }

  const currencyOf = (symbol) => state.positions.find((p) => p.symbol === symbol)?.currency ?? lookupSecurity(symbol)?.currency ?? 'USD';

  // Lädt fehlende Kursreihen nacheinander. Gibt false zurück, wenn abgebrochen wurde.
  async function loadMissing(symbols, { token, label, critical }) {
    const source = getSource();
    const todo = [...new Set(symbols)].filter((s) => !state.series[s] && !state.errors[s] && !state.extraErrors.has(s));
    for (const [i, symbol] of todo.entries()) {
      if (source === 'twelvedata') showMessage(`${label} … (${i + 1}/${todo.length}: ${symbol})`, 'info');
      try {
        const { bars } = await loadSeries(symbol, {
          source,
          apiKey: getApiKey(),
          onWait: (sec) => showMessage(`API-Limit des kostenlosen Tarifs erreicht – weiter in ${sec} Sekunden …`, 'info'),
        });
        if (token !== state.loadToken) return false;
        state.series[symbol] = bars;
      } catch (err) {
        if (token !== state.loadToken) return false;
        if (err instanceof MissingApiKeyError) {
          showMessage(err.message, 'info');
          openSettings();
          return false;
        }
        if (critical) state.errors[symbol] = `Keine Kurse: ${err.message}`;
        else state.extraErrors.add(symbol);
      }
    }
    return true;
  }

  // Wechselkurse für alle benötigten Fremdwährungen
  async function loadFx(currencies, token) {
    const needed = [...new Set(currencies)].filter((c) => c !== 'EUR' && hasFx(c) && !state.fx[c]);
    if (!(await loadMissing(needed.map(fxSymbol), { token, label: 'Lade Wechselkurse', critical: false }))) return false;
    for (const c of needed) if (state.series[fxSymbol(c)]) state.fx[c] = state.series[fxSymbol(c)];
    eurCache.clear();
    return true;
  }

  const extraSymbols = (benchmark) => [benchmark, ...Object.values(HELPER_SYMBOLS)];

  async function refresh() {
    const token = ++state.loadToken;
    const source = getSource();
    if (source !== loadedSource) {
      state.series = {};
      state.errors = {};
      state.extraErrors = new Set();
      state.fx = {};
      eurCache.clear();
      loadedSource = source;
    }
    renderTable();
    showMessage('');

    if (!(await loadMissing(state.positions.map((p) => p.symbol), { token, label: 'Lade Kurse', critical: true }))) return;
    // Vergleichsindex und Bausteine für Vorschläge (Fehler hier sind nicht kritisch)
    if (!(await loadMissing(extraSymbols(state.benchmark), { token, label: 'Lade Vergleichsdaten', critical: false }))) return;
    if (state.convertFx) {
      const currencies = [...state.positions.map((p) => p.currency), ...extraSymbols(state.benchmark).map(currencyOf)];
      if (!(await loadFx(currencies, token))) return;
    }
    if (token !== state.loadToken) return;

    const missingFx = state.convertFx
      ? [...new Set(state.positions.map((p) => p.currency))].filter((c) => c !== 'EUR' && !state.fx[c])
      : [];
    const notes = [];
    if (Object.keys(state.errors).length) {
      notes.push(`Für ${Object.keys(state.errors).join(', ')} konnten keine Kurse geladen werden – diese Positionen fließen nicht in die Bewertung ein.`);
    }
    if (missingFx.length) notes.push(`Kein Wechselkurs für ${missingFx.join(', ')} – diese Werte werden nicht umgerechnet.`);
    // Bestätigungen (z. B. nach Import) erst nach dem Laden anzeigen, damit sie nicht überschrieben werden
    if (!notes.length && state.notice) notes.push(state.notice);
    state.notice = null;
    showMessage(notes.join(' '), Object.keys(state.errors).length ? 'error' : 'info');
    renderTable();
    evaluate();
  }

  function toInput(p, value, costBasis = null) {
    const known = lookupSecurity(p.symbol);
    return {
      symbol: p.symbol,
      name: p.name,
      value,
      costBasis,
      ter: terOf(p) ?? 0,
      type: p.type,
      sector: p.sector,
      region: p.region,
      currency: p.currency,
      regionBreakdown: p.region === 'Global' && known?.region === 'Global' ? known.regions : undefined,
    };
  }

  // Stammdaten für Bausteine, die ein Vorschlag neu ins Depot bringt
  const makeMeta = (symbol) => toInput({ symbol, ...stripKnown(defaultMeta(symbol)) }, 0);

  // Bewertet ein beliebiges Depot (aktuelles oder eines aus dem Vergleich)
  function analyzeDepot({ positions, mode, benchmark, convertFx }) {
    const convert = convertFx !== false;
    const bars = (symbol, currency) => barsFor(symbol, currency, convert);
    const values = positionValues(positions, mode, bars);
    const input = positions
      .map((p, i) => ({ p, v: values[i] }))
      .filter(({ p, v }) => v.value > 0 && bars(p.symbol, p.currency))
      .map(({ p, v }) => toInput(p, v.value, v.costBasis));
    const series = Object.fromEntries(input.map((p) => [p.symbol, bars(p.symbol, p.currency)]));
    for (const sym of extraSymbols(benchmark)) {
      if (!series[sym]) {
        const b = bars(sym, lookupSecurity(sym)?.currency ?? 'USD');
        if (b) series[sym] = b;
      }
    }
    const bm = series[benchmark] ? { symbol: benchmark, name: BENCHMARK_NAMES[benchmark] ?? benchmark, bars: series[benchmark] } : null;
    const result = input.length ? analyzePortfolio(input, series, { benchmark: bm }) : null;
    return { input, series, benchmark: bm, result };
  }

  function evaluate() {
    const { input, series, benchmark, result } = analyzeDepot({
      positions: state.positions,
      mode: state.mode,
      benchmark: state.benchmark,
      convertFx: state.convertFx,
    });
    state.input = input;
    state.result = result;
    state.suggestions = result ? suggestImprovements(input, series, result, { benchmark, makeMeta }) : [];
    renderResults();
    renderForecast();
  }

  // ---------- Ergebnisse ----------

  function renderResults() {
    const r = state.result;
    $('#depot-results').hidden = !r;
    if (!r) return;

    $('#kpi-value').textContent = eur(r.totalValue);
    const pnlEl = $('#kpi-pnl');
    pnlEl.textContent = r.pnl !== null ? `G/V ${r.pnl > 0 ? '+' : ''}${eur(r.pnl)} (${pct(r.pnlPct)})` : `${r.concentration.count} Positionen`;
    pnlEl.className = `kpi-sub ${r.pnl !== null ? toneClass(r.pnl) : ''}`;

    $('#kpi-risk').textContent = r.riskClass ?? '–';
    $('#kpi-risk-label').textContent = r.riskClass ? `Risiko ${RISK_CLASS_LABELS[r.riskClass - 1]}` : 'zu wenig Kurshistorie';
    $('#risk-scale').replaceChildren(
      ...Array.from({ length: 7 }, (_, i) => {
        const seg = document.createElement('span');
        if (r.riskClass && i < r.riskClass) seg.className = 'on';
        if (r.riskClass === i + 1) seg.classList.add('current');
        return seg;
      }),
    );

    $('#kpi-score').textContent = r.score.total;
    $('#kpi-score-label').textContent = r.score.label;
    $('#score-fill').style.width = `${r.score.total}%`;

    $('#kpi-vol').textContent = r.volatility === null ? '–' : pct1(r.volatility);
    $('#kpi-dd').textContent = r.maxDrawdown === undefined ? '–' : pct1(r.maxDrawdown);
    $('#kpi-dd-sub').textContent = r.historyDays ? `größter Verlust in ${Math.round(r.historyDays / 21)} Monaten` : '';
    $('#kpi-var').textContent = r.var95 === undefined ? '–' : pct1(-r.var95);
    $('#kpi-var-sub').textContent = r.var95Amount !== undefined ? `≈ ${eur(-r.var95Amount)} an einem schlechten Tag` : '';

    const b = r.benchmark;
    $('#kpi-beta').textContent = b?.beta == null ? '–' : numberFmt.format(b.beta);
    $('#kpi-beta-sub').textContent = b?.beta == null ? 'kein Vergleichsindex' : `zum ${b.name} · ${b.beta > 1.1 ? 'schwankt stärker' : b.beta < 0.9 ? 'schwankt schwächer' : 'schwankt ähnlich'}`;
    const noCosts = r.costs.annualCost < 0.5;
    $('#kpi-ter').textContent = noCosts ? '0 %' : pct2(r.costs.weightedTer);
    $('#kpi-ter-sub').textContent = noCosts
      ? 'keine Fondskosten (Ordergebühren nicht erfasst)'
      : `≈ ${eur(r.costs.annualCost)} pro Jahr · ${eur(r.costs.tenYearCost)} in 10 Jahren`;

    renderHints(r.hints);
    renderSuggestions();
    renderScenarios(r);
    renderAllocation();
    renderRiskBars(r);
    renderCorrelation(r);
    renderHistory(r);
  }

  function renderHints(hints) {
    const counts = hints.reduce((acc, h) => ({ ...acc, [h.level]: (acc[h.level] ?? 0) + 1 }), {});
    $('#hint-count').textContent = ['critical', 'warning', 'good']
      .filter((l) => counts[l])
      .map((l) => `${counts[l]} × ${LEVEL_LABEL[l]}`)
      .join(' · ');
    $('#hints').replaceChildren(
      ...hints.map((h) => {
        const li = document.createElement('li');
        li.className = `hint ${h.level}`;
        li.innerHTML = '<span class="hint-icon" aria-hidden="true"></span><div><div class="hint-head"><strong></strong><span class="hint-level"></span></div><p></p></div>';
        li.querySelector('.hint-icon').textContent = LEVEL_ICON[h.level];
        li.querySelector('strong').textContent = h.title;
        li.querySelector('.hint-level').textContent = LEVEL_LABEL[h.level];
        li.querySelector('p').textContent = h.text;
        return li;
      }),
    );
  }

  function barRow(label, sublabel, parts) {
    const row = document.createElement('div');
    row.className = 'bar-row';
    const lab = document.createElement('div');
    lab.className = 'bar-label';
    lab.textContent = label;
    if (sublabel) {
      lab.title = sublabel;
    }
    const tracks = document.createElement('div');
    tracks.className = 'bar-tracks';
    for (const { value, cls, text, tip } of parts) {
      const line = document.createElement('div');
      line.className = 'bar-line';
      line.title = tip;
      const track = document.createElement('div');
      track.className = 'bar-track';
      const fill = document.createElement('div');
      fill.className = `bar-fill ${cls}`;
      fill.style.width = `${Math.max(0, Math.min(1, value)) * 100}%`;
      track.append(fill);
      const val = document.createElement('span');
      val.className = 'bar-value';
      val.textContent = text;
      line.append(track, val);
      tracks.append(line);
    }
    row.append(lab, tracks);
    return row;
  }

  function renderAllocation() {
    const r = state.result;
    if (!r) return;
    document.querySelectorAll('#alloc-tabs button').forEach((b) => {
      const active = b.dataset.alloc === state.allocTab;
      b.classList.toggle('active', active);
      b.setAttribute('aria-selected', active);
    });
    const items = r.allocation[state.allocTab];
    const max = Math.max(...items.map((i) => i.weight));
    $('#alloc-bars').replaceChildren(
      ...items.map((i) =>
        barRow(i.key, i.label, [{ value: i.weight / max, cls: 'f1', text: pct1(i.weight), tip: `${i.label ?? i.key}: ${pct1(i.weight)}` }]),
      ),
    );
    const notes = {
      positions: `Effektiv ${oneDecimal.format(r.concentration.effectiveN)} gleich große Positionen (ETF-Inhalte eingerechnet).`,
      sector: `Effektiv ${oneDecimal.format(r.concentration.effectiveSectors)} Sektoren. „Diversifiziert“ = breit gestreute Fonds.`,
      region: `Effektiv ${oneDecimal.format(r.concentration.effectiveRegions)} Regionen. Globale Fonds sind anteilig auf Regionen verteilt.`,
      type: `Aktienanteil ${pct1(r.concentration.equityShare)}, Anleihen/Edelmetalle ${pct1(r.concentration.stabilizerShare)}.`,
      currency: `${pct1(r.concentration.foreignCurrencyShare)} in Fremdwährungen (Handelswährung des Wertpapiers).`,
    };
    $('#alloc-note').textContent = notes[state.allocTab];
  }

  $('#alloc-tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-alloc]');
    if (!btn) return;
    state.allocTab = btn.dataset.alloc;
    storage.set('depotAllocTab', state.allocTab);
    renderAllocation();
  });

  function renderRiskBars(r) {
    const el = $('#risk-bars');
    if (!r.riskContributions.length) {
      el.innerHTML = '<p class="muted">Zu wenig Kurshistorie für eine Risikozerlegung.</p>';
      return;
    }
    const max = Math.max(...r.riskContributions.flatMap((x) => [x.weight, x.riskShare]));
    el.replaceChildren(
      ...r.riskContributions.map((x) =>
        barRow(x.symbol, null, [
          { value: x.weight / max, cls: 'f1', text: pct1(x.weight), tip: `${x.symbol} – Gewicht: ${pct1(x.weight)}` },
          { value: x.riskShare / max, cls: 'f2', text: pct1(x.riskShare), tip: `${x.symbol} – Anteil am Risiko: ${pct1(x.riskShare)} (Volatilität ${pct1(x.volatility)})` },
        ]),
      ),
    );
  }

  // ---------- Stresstest ----------

  function renderScenarios(r) {
    const max = Math.max(0.1, ...r.scenarios.map((sc) => Math.abs(sc.impact)));
    $('#scenarios').replaceChildren(
      ...r.scenarios.map((sc) => {
        const row = document.createElement('div');
        row.className = 'scenario';
        row.innerHTML =
          '<div class="scenario-head"><strong></strong><span class="scenario-value"></span></div>' +
          '<div class="div-track"><div class="div-fill"></div></div><p></p>';
        row.querySelector('strong').textContent = sc.title;
        const val = row.querySelector('.scenario-value');
        val.textContent = Math.abs(sc.impact) < 0.0005 ? '± 0 %' : `${sc.impact > 0 ? '+' : ''}${pct1(sc.impact)} (${sc.amount > 0 ? '+' : ''}${eur(sc.amount)})`;
        val.className = `scenario-value ${toneClass(sc.impact)}`;
        const fill = row.querySelector('.div-fill');
        const w = (Math.abs(sc.impact) / max) * 50;
        fill.style.width = `${w}%`;
        fill.style.left = sc.impact < 0 ? `${50 - w}%` : '50%';
        fill.classList.add(sc.impact < 0 ? 'loss' : 'gain');
        const drivers = sc.drivers.length ? ` Größte Verlusttreiber: ${sc.drivers.map((d) => `${d.symbol} (${pct1(d.impact)})`).join(', ')}.` : '';
        row.querySelector('p').textContent = sc.description + drivers;
        row.title = `${sc.title}: ${val.textContent}`;
        return row;
      }),
    );
  }

  // ---------- Verbesserungsvorschläge ----------

  function chip(label, before, after, fmt, betterWhenLower) {
    const el = document.createElement('span');
    el.className = 'chip';
    if (before === null || before === undefined || after === null || after === undefined) return null;
    const better = betterWhenLower ? after < before - 1e-9 : after > before + 1e-9;
    const worse = betterWhenLower ? after > before + 1e-9 : after < before - 1e-9;
    el.classList.add(better ? 'better' : worse ? 'worse' : 'same');
    el.innerHTML = '<span class="chip-label"></span> <span class="chip-values"></span><span class="chip-mark" aria-hidden="true"></span>';
    el.querySelector('.chip-label').textContent = label;
    el.querySelector('.chip-values').textContent = `${fmt(before)} → ${fmt(after)}`;
    el.querySelector('.chip-mark').textContent = better ? ' ▲' : worse ? ' ▼' : '';
    el.title = better ? 'Verbesserung' : worse ? 'Verschlechterung' : 'unverändert';
    return el;
  }

  function renderSuggestions() {
    const list = $('#suggestions');
    if (!state.suggestions.length) {
      const li = document.createElement('li');
      li.className = 'suggestion empty';
      li.textContent =
        state.extraErrors.size >= Object.keys(HELPER_SYMBOLS).length
          ? 'Für Vorschläge konnten keine Vergleichsdaten geladen werden.'
          : 'Keine Umschichtung verbessert das Depot spürbar – es ist bereits gut aufgestellt.';
      list.replaceChildren(li);
      return;
    }
    list.replaceChildren(
      ...state.suggestions.map((sg) => {
        const li = document.createElement('li');
        li.className = 'suggestion';
        li.innerHTML =
          '<div class="suggestion-head"><strong></strong><button type="button" class="btn small primary">Übernehmen</button></div>' +
          '<p></p><div class="chips"></div><details><summary>Umschichtungen anzeigen</summary><ul class="changes"></ul></details>';
        li.querySelector('strong').textContent = sg.title;
        li.querySelector('p').textContent = sg.text;
        li.querySelector('.chips').append(
          ...[
            chip('Streuung', sg.before.score, sg.after.score, (v) => String(v), false),
            chip('Risikoklasse', sg.before.riskClass, sg.after.riskClass, (v) => String(v), true),
            chip('Volatilität', sg.before.volatility, sg.after.volatility, pct1, true),
            chip('Crash −30 %', sg.before.crash, sg.after.crash, pct1, false),
          ].filter(Boolean),
        );
        li.querySelector('.changes').append(
          ...sg.changes.map((c) => {
            const item = document.createElement('li');
            const diff = c.to - c.from;
            item.textContent = `${c.symbol}: ${eur(c.from)} → ${eur(c.to)} (${diff > 0 ? '+' : ''}${eur(diff)})`;
            return item;
          }),
        );
        li.querySelector('button').addEventListener('click', () => applySuggestion(sg));
        return li;
      }),
    );
  }

  function applySuggestion(sg) {
    if (!confirm(`„${sg.title}“ auf das Depot „${active().name}“ anwenden? Tipp: Exportiere das Depot vorher, um den alten Stand zu sichern.`)) return;
    for (const c of sg.changes) {
      let pos = state.positions.find((p) => p.symbol === c.symbol);
      if (!pos) {
        pos = { id: newId(), symbol: c.symbol, ...stripKnown(defaultMeta(c.symbol)) };
        state.positions.push(pos);
      }
      if (state.mode === 'amount') pos.amount = Math.round(c.to);
      else {
        const last = barsFor(c.symbol, pos.currency)?.at(-1)?.close;
        if (last) pos.quantity = round(c.to / last, 4);
      }
    }
    save();
    state.notice = `Vorschlag „${sg.title}“ übernommen.`;
    refresh();
  }

  // Divergierende Farbskala: −1 blau · 0 grau · +1 rot
  function corrColor(v) {
    const mid = hexToRgb(cssVar('--div-mid'));
    const pole = hexToRgb(cssVar(v >= 0 ? '--div-pos' : '--div-neg'));
    const t = Math.min(1, Math.abs(v));
    const rgb = mid.map((m, i) => Math.round(m + (pole[i] - m) * t));
    const lum = (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
    return { bg: `rgb(${rgb.join(',')})`, fg: lum > 0.55 ? '#17202c' : '#ffffff' };
  }

  function renderCorrelation(r) {
    const table = $('#corr-table');
    if (!r.correlation) {
      table.replaceChildren();
      $('#corr-note').textContent = 'Zu wenig Kurshistorie für Korrelationen.';
      return;
    }
    const MAX = 12;
    const order = r.allocation.positions.map((p) => p.key).slice(0, MAX);
    const idx = order.map((s) => r.correlation.symbols.indexOf(s));
    const head = document.createElement('tr');
    head.append(document.createElement('th'), ...order.map((s) => Object.assign(document.createElement('th'), { textContent: s, scope: 'col' })));
    const rows = order.map((s, a) => {
      const tr = document.createElement('tr');
      tr.append(Object.assign(document.createElement('th'), { textContent: s, scope: 'row' }));
      order.forEach((s2, b) => {
        const v = r.correlation.matrix[idx[a]][idx[b]];
        const cell = document.createElement('td');
        if (a === b) {
          cell.className = 'diag';
          cell.textContent = '—';
        } else {
          const c = corrColor(v);
          cell.style.background = c.bg;
          cell.style.color = c.fg;
          cell.textContent = v.toFixed(2).replace('.', ',');
          cell.title = `${s} ↔ ${s2}: ${v.toFixed(2).replace('.', ',')}`;
        }
        tr.append(cell);
      });
      return tr;
    });
    table.replaceChildren(Object.assign(document.createElement('thead'), {}), document.createElement('tbody'));
    table.tHead.append(head);
    table.tBodies[0].append(...rows);
    $('#corr-note').textContent =
      `Ø gewichtete Korrelation: ${r.avgCorrelation === null ? '–' : r.avgCorrelation.toFixed(2).replace('.', ',')}. ` +
      'Werte nahe +1 bewegen sich gleich, nahe 0 unabhängig, negative gegenläufig.' +
      (r.correlation.symbols.length > MAX ? ` Gezeigt: die ${MAX} größten Positionen.` : '');
  }

  // ---------- Wertverlauf ----------

  let chart = null;
  let area = null;
  let benchLine = null;

  function ensureChart() {
    if (chart) return;
    chart = createChart($('#depot-chart'), {
      autoSize: true,
      layout: { background: { color: 'transparent' }, fontFamily: getComputedStyle(document.body).fontFamily },
      rightPriceScale: { minimumWidth: 72 },
      crosshair: { mode: CrosshairMode.Magnet },
      localization: { locale: 'de-DE', priceFormatter: (p) => eur(p) },
      handleScale: false,
      handleScroll: false,
    });
    area = chart.addAreaSeries({ lineWidth: 2, priceLineVisible: false });
    benchLine = chart.addLineSeries({ lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: true });
  }

  function applyChartTheme() {
    if (!chart) return;
    const line = cssVar('--viz-1');
    chart.applyOptions({
      layout: { textColor: cssVar('--muted') },
      grid: { vertLines: { color: cssVar('--grid') }, horzLines: { color: cssVar('--grid') } },
      rightPriceScale: { borderColor: cssVar('--border') },
      timeScale: { borderColor: cssVar('--border') },
    });
    area.applyOptions({ lineColor: line, topColor: withAlpha(line, 0.25), bottomColor: withAlpha(line, 0.02) });
    benchLine.applyOptions({ color: cssVar('--viz-2') });
  }

  function renderHistory(r) {
    ensureChart();
    applyChartTheme();
    area.setData(r.history.map((h) => ({ time: h.time, value: h.value })));
    benchLine.setData(r.benchmark ? r.benchmark.history : []);
    $('#bench-legend').textContent = r.benchmark?.name ?? 'Vergleichsindex (keine Daten)';
    chart.timeScale().fitContent();
    const extra = [
      ['Rendite 1 Jahr', pct(r.return1y), toneClass(r.return1y)],
      [`${r.benchmark?.name ?? 'Index'} 1 Jahr`, pct(r.benchmark?.return1y), toneClass(r.benchmark?.return1y)],
      ['Korrelation zum Index', r.benchmark?.correlation == null ? '–' : numberFmt.format(r.benchmark.correlation)],
      ['Sharpe Ratio (rf = 0)', r.sharpe === null || r.sharpe === undefined ? '–' : numberFmt.format(r.sharpe)],
      ['Schlechtester Monat', pct(r.worstMonth), 'down'],
      ['Expected Shortfall (95 %)', r.cvar95 === undefined ? '–' : pct(-r.cvar95), 'down'],
      ['Diversifikationseffekt', r.diversificationRatio ? `× ${numberFmt.format(r.diversificationRatio)}` : '–'],
      ['Unter 200-Tage-Linie', r.belowSma200Share === null || r.belowSma200Share === undefined ? '–' : pct1(r.belowSma200Share)],
    ];
    const tips = {
      'Expected Shortfall (95 %)': 'Durchschnittlicher Tagesverlust an den 5 % schlechtesten Tagen',
      Diversifikationseffekt: 'Gewichtete Einzelvolatilitäten ÷ Depotvolatilität. Je höher, desto mehr Schwankung wird durch Streuung ausgeglichen.',
      'Unter 200-Tage-Linie': 'Anteil des Depots, dessen Kurs unter dem 200-Tage-Durchschnitt liegt',
    };
    $('#depot-extra').replaceChildren(
      ...extra.map(([label, value, cls]) => {
        const div = document.createElement('div');
        if (tips[label]) div.title = tips[label];
        const dt = Object.assign(document.createElement('dt'), { textContent: label });
        const dd = Object.assign(document.createElement('dd'), { textContent: value });
        if (cls && value !== '–') dd.className = cls;
        div.append(dt, dd);
        return div;
      }),
    );
  }

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    applyChartTheme();
    if (state.result) renderCorrelation(state.result);
  });

  $('#benchmark-select').addEventListener('change', (e) => {
    state.benchmark = e.target.value;
    save();
    refresh();
  });

  // ---------- Steuerelemente ----------

  function syncControls() {
    $('#benchmark-select').value = state.benchmark;
    $('#depot-fx').checked = state.convertFx;
    $('#fx-note').textContent = state.convertFx
      ? 'Kurse in Fremdwährung werden mit dem Wechselkurs in Euro umgerechnet.'
      : 'Währungen werden nicht umgerechnet – alle Kurse werden als Euro-Beträge behandelt.';
    const f = state.forecast;
    $('#fc-start').value = f.start ?? '';
    $('#fc-monthly').value = f.monthly ?? '';
    $('#fc-years').value = f.years;
    $('#fc-years-out').textContent = `${f.years} Jahre`;
    $('#fc-return').value = f.expectedReturn ?? '';
    $('#fc-vol').value = f.volatility ?? '';
    $('#fc-goal').value = f.goal ?? '';
    $('#fc-inflation').checked = !!f.inflation;
  }

  $('#depot-fx').addEventListener('change', (e) => {
    state.convertFx = e.target.checked;
    save();
    syncControls();
    refresh();
  });

  // ---------- Zukunftsprojektion ----------

  const optNum = (el) => (el.value === '' ? null : Number(el.value));

  $('#forecast-form').addEventListener('input', () => {
    state.forecast = {
      start: optNum($('#fc-start')),
      monthly: optNum($('#fc-monthly')) ?? 0,
      years: Number($('#fc-years').value),
      expectedReturn: optNum($('#fc-return')),
      volatility: optNum($('#fc-vol')),
      goal: optNum($('#fc-goal')),
      inflation: $('#fc-inflation').checked,
    };
    $('#fc-years-out').textContent = `${state.forecast.years} Jahre`;
    save();
    scheduleForecast();
  });
  $('#forecast-form').addEventListener('submit', (e) => e.preventDefault());

  let forecastTimer = null;
  function scheduleForecast() {
    clearTimeout(forecastTimer);
    forecastTimer = setTimeout(renderForecast, 120);
  }

  function renderForecast() {
    const r = state.result;
    if (!r) return;
    const f = state.forecast;
    const derivedReturn = expectedPortfolioReturn(state.input);
    const derivedVol = r.volatility ?? 0.15;
    $('#fc-start').placeholder = Math.round(r.totalValue);
    $('#fc-return').placeholder = (derivedReturn * 100).toFixed(1);
    $('#fc-vol').placeholder = (derivedVol * 100).toFixed(1);

    const params = {
      startValue: f.start ?? r.totalValue,
      monthly: f.monthly ?? 0,
      years: f.years,
      expectedReturn: f.expectedReturn !== null && f.expectedReturn !== undefined ? f.expectedReturn / 100 : derivedReturn,
      volatility: f.volatility !== null && f.volatility !== undefined ? f.volatility / 100 : derivedVol,
      inflation: f.inflation ? 0.02 : 0,
      goal: f.goal,
    };
    const sim = simulate(params);
    state.forecastResult = sim;

    $('#fc-assumption').textContent =
      `Annahmen: ${pct1(params.expectedReturn)} Rendite und ${pct1(params.volatility)} Volatilität pro Jahr` +
      (f.expectedReturn == null ? ' (Rendite aus Richtwerten je Anlageklasse abzüglich Kosten' : ' (Rendite manuell') +
      (f.volatility == null ? ', Volatilität aus den letzten 12 Monaten).' : ', Volatilität manuell).') +
      (params.inflation ? ' Werte in heutiger Kaufkraft.' : '');

    const tiles = [
      ['Eingezahlt', eur(sim.paidIn), `Start ${eur(params.startValue)} + ${eur(params.monthly)} × ${params.years * 12} Monate`],
      ['Wahrscheinlicher Wert (Median)', eur(sim.median), `${sim.median >= sim.paidIn ? '+' : ''}${eur(sim.median - sim.paidIn)} ggü. Einzahlungen`],
      ['Ungünstig (10 %)', eur(sim.pessimistic), '9 von 10 Verläufen lagen darüber'],
      ['Günstig (90 %)', eur(sim.optimistic), '1 von 10 Verläufen lag darüber'],
      ['Verlustrisiko', pct1(sim.probLoss), params.inflation ? 'Endwert unter Einzahlungen (Kaufkraft)' : 'Endwert unter Einzahlungen'],
    ];
    if (sim.probGoal !== null) tiles.push(['Sparziel erreicht', pct1(sim.probGoal), `in ${params.years} Jahren mindestens ${eur(params.goal)}`]);
    $('#fc-kpis').replaceChildren(
      ...tiles.map(([label, value, sub]) => {
        const div = document.createElement('div');
        div.className = 'fc-kpi';
        div.append(
          Object.assign(document.createElement('div'), { className: 'kpi-label', textContent: label }),
          Object.assign(document.createElement('div'), { className: 'fc-value', textContent: value }),
          Object.assign(document.createElement('div'), { className: 'kpi-sub', textContent: sub }),
        );
        return div;
      }),
    );
    drawFan(sim, params.goal);
    renderForecastTable(sim);
  }

  function renderForecastTable(sim) {
    const step = sim.bands.length > 21 ? 5 : sim.bands.length > 11 ? 2 : 1;
    const rows = sim.bands.filter((b) => b.year % step === 0 || b.year === sim.bands.length - 1);
    const table = $('#fc-table');
    table.innerHTML = '<thead><tr><th>Jahr</th><th class="num">Eingezahlt</th><th class="num">Ungünstig (10 %)</th><th class="num">Median</th><th class="num">Günstig (90 %)</th></tr></thead><tbody></tbody>';
    table.tBodies[0].append(
      ...rows.map((b) => {
        const tr = document.createElement('tr');
        for (const [v, cls] of [[String(b.year)], [eur(b.paidIn), 'num'], [eur(b.p10), 'num'], [eur(b.p50), 'num'], [eur(b.p90), 'num']]) {
          tr.append(Object.assign(document.createElement('td'), { textContent: v, className: cls ?? '' }));
        }
        return tr;
      }),
    );
  }

  // Fächerdiagramm als SVG: Bänder 10–90 % und 25–75 %, Median, Einzahlungen
  const SVG = 'http://www.w3.org/2000/svg';
  const svgEl = (tag, attrs = {}) => {
    const el = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    return el;
  };
  const compactEur = new Intl.NumberFormat('de-DE', { notation: 'compact', maximumFractionDigits: 1, style: 'currency', currency: 'EUR' });

  function niceMax(v) {
    const pow = 10 ** Math.floor(Math.log10(v));
    return [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].map((m) => m * pow).find((m) => m >= v) ?? 10 * pow;
  }

  function drawFan(sim, goal) {
    const box = $('#fan-chart');
    const width = Math.max(300, box.clientWidth || 800);
    const height = 300;
    const m = { top: 12, right: 16, bottom: 28, left: 64 };
    const w = width - m.left - m.right;
    const h = height - m.top - m.bottom;
    const n = sim.bands.length - 1;
    const yMax = niceMax(Math.max(sim.bands[n].p90, goal ?? 0, sim.paidIn) * 1.02);
    const x = (year) => m.left + (year / n) * w;
    const y = (v) => m.top + h - (Math.max(0, v) / yMax) * h;

    const svg = svgEl('svg', { width, height, viewBox: `0 0 ${width} ${height}` });
    // Raster und Achsen
    for (let i = 0; i <= 4; i++) {
      const v = (yMax / 4) * i;
      svg.append(svgEl('line', { x1: m.left, x2: width - m.right, y1: y(v), y2: y(v), class: 'fan-grid' }));
      const t = svgEl('text', { x: m.left - 8, y: y(v) + 4, class: 'fan-axis', 'text-anchor': 'end' });
      t.textContent = compactEur.format(v);
      svg.append(t);
    }
    // so viele Jahresmarken, wie Platz ist (mind. ~56 px pro Beschriftung)
    const xStep = [1, 2, 5, 10].find((st) => (n / st) * 56 <= w) ?? 10;
    for (let yr = 0; yr <= n; yr += xStep) {
      const t = svgEl('text', { x: x(yr), y: height - 8, class: 'fan-axis', 'text-anchor': 'middle' });
      t.textContent = yr === 0 ? 'heute' : `${yr} J.`;
      svg.append(t);
    }

    const area = (hiKey, loKey) =>
      sim.bands.map((b, i) => `${i ? 'L' : 'M'}${x(b.year)},${y(b[hiKey])}`).join('') +
      [...sim.bands].reverse().map((b) => `L${x(b.year)},${y(b[loKey])}`).join('') + 'Z';
    const line = (key) => sim.bands.map((b, i) => `${i ? 'L' : 'M'}${x(b.year)},${y(b[key])}`).join('');

    svg.append(svgEl('path', { d: area('p90', 'p10'), class: 'fan-outer' }));
    svg.append(svgEl('path', { d: area('p75', 'p25'), class: 'fan-inner' }));
    svg.append(svgEl('path', { d: line('paidIn'), class: 'fan-paid' }));
    svg.append(svgEl('path', { d: line('p50'), class: 'fan-median' }));
    if (goal > 0 && goal <= yMax) {
      svg.append(svgEl('line', { x1: m.left, x2: width - m.right, y1: y(goal), y2: y(goal), class: 'fan-goal' }));
      const t = svgEl('text', { x: width - m.right - 4, y: y(goal) - 6, class: 'fan-axis fan-goal-label', 'text-anchor': 'end' });
      t.textContent = `Sparziel ${compactEur.format(goal)}`;
      svg.append(t);
    }

    // Hover: Linie, Punkte und Tooltip für das nächstgelegene Jahr
    const cursor = svgEl('line', { y1: m.top, y2: m.top + h, class: 'fan-cursor', visibility: 'hidden' });
    const dot = svgEl('circle', { r: 5, class: 'fan-dot', visibility: 'hidden' });
    svg.append(cursor, dot);
    const hit = svgEl('rect', { x: m.left, y: m.top, width: w, height: h, fill: 'transparent' });
    svg.append(hit);

    const tip = document.createElement('div');
    tip.className = 'fan-tip';
    tip.hidden = true;
    const move = (evt) => {
      const rect = svg.getBoundingClientRect();
      const px = evt.clientX - rect.left;
      const yr = Math.max(0, Math.min(n, Math.round(((px - m.left) / w) * n)));
      const b = sim.bands[yr];
      cursor.setAttribute('x1', x(yr));
      cursor.setAttribute('x2', x(yr));
      dot.setAttribute('cx', x(yr));
      dot.setAttribute('cy', y(b.p50));
      cursor.setAttribute('visibility', 'visible');
      dot.setAttribute('visibility', 'visible');
      tip.hidden = false;
      tip.innerHTML = '';
      tip.append(Object.assign(document.createElement('strong'), { textContent: yr === 0 ? 'Heute' : `Nach ${yr} ${yr === 1 ? 'Jahr' : 'Jahren'}` }));
      for (const [label, v] of [['Günstig (90 %)', b.p90], ['Median', b.p50], ['Ungünstig (10 %)', b.p10], ['Eingezahlt', b.paidIn]]) {
        const row = document.createElement('div');
        row.append(Object.assign(document.createElement('span'), { textContent: label }), Object.assign(document.createElement('span'), { textContent: eur(v) }));
        tip.append(row);
      }
      const left = x(yr) + 12 + 220 > width ? x(yr) - 12 - 220 : x(yr) + 12;
      tip.style.left = `${left}px`;
      tip.style.top = `${m.top}px`;
    };
    const leave = () => {
      cursor.setAttribute('visibility', 'hidden');
      dot.setAttribute('visibility', 'hidden');
      tip.hidden = true;
    };
    hit.addEventListener('pointermove', move);
    hit.addEventListener('pointerleave', leave);
    box.replaceChildren(svg, tip);
  }

  // Bei Größenänderung neu zeichnen
  let lastFanWidth = 0;
  new ResizeObserver(() => {
    const wNow = $('#fan-chart').clientWidth;
    if (state.forecastResult && wNow && Math.abs(wNow - lastFanWidth) > 4) {
      lastFanWidth = wNow;
      drawFan(state.forecastResult, state.forecast.goal);
    }
  }).observe($('#fan-chart'));

  // ---------- Depotvergleich ----------

  async function runComparison() {
    const card = $('#compare-card');
    card.hidden = false;
    card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const table = $('#compare-table');
    table.innerHTML = '<tbody><tr><td class="muted">Lade Kurse für alle Depots …</td></tr></tbody>';
    const token = state.loadToken;
    const all = depots.list.map((d) => (d.id === depots.activeId ? { ...d, ...active(), positions: state.positions, mode: state.mode } : d));
    const symbols = all.flatMap((d) => (d.positions ?? []).map((p) => p.symbol));
    if (!(await loadMissing(symbols, { token, label: 'Lade Kurse für den Vergleich', critical: false }))) return;
    const currencies = all.flatMap((d) => (d.positions ?? []).map((p) => p.currency));
    if (!(await loadFx(currencies, token))) return;
    showMessage('');

    const rows = all.map((d) => ({
      depot: d,
      result: analyzeDepot({ positions: d.positions ?? [], mode: d.mode ?? 'amount', benchmark: state.benchmark, convertFx: d.convertFx }).result,
    }));
    const metrics = [
      ['Depotwert', (r) => r.totalValue, eur, null],
      ['Positionen', (r) => r.concentration.count, String, null],
      ['Risikoklasse', (r) => r.riskClass, (v) => `${v} / 7`, 'low'],
      ['Streuungs-Score', (r) => r.score.total, (v) => `${v} / 100`, 'high'],
      ['Volatilität p. a.', (r) => r.volatility, pct1, 'low'],
      ['Max. Drawdown', (r) => r.maxDrawdown, pct1, 'high'],
      ['Crash-Szenario (−30 %)', (r) => r.scenarios.find((x) => x.key === 'crash')?.impact, pct1, 'high'],
      [`Beta zum ${BENCHMARK_NAMES[state.benchmark]}`, (r) => r.benchmark?.beta, (v) => numberFmt.format(v), null],
      ['Rendite 1 Jahr', (r) => r.return1y, pct, 'high'],
      ['Sharpe Ratio', (r) => r.sharpe, (v) => numberFmt.format(v), 'high'],
      ['Laufende Kosten', (r) => r.costs.weightedTer, pct2, 'low'],
      ['Kritische Hinweise', (r) => r.hints.filter((x) => x.level === 'critical').length, String, 'low'],
    ];
    const head = document.createElement('tr');
    head.append(Object.assign(document.createElement('th'), { textContent: 'Kennzahl' }));
    for (const { depot } of rows) {
      const th = Object.assign(document.createElement('th'), { className: 'num', textContent: depot.name, scope: 'col' });
      if (depot.id === depots.activeId) th.classList.add('current');
      head.append(th);
    }
    const body = metrics.map(([label, get, fmt, better]) => {
      const tr = document.createElement('tr');
      tr.append(Object.assign(document.createElement('th'), { textContent: label, scope: 'row' }));
      const vals = rows.map(({ result }) => (result ? get(result) : null));
      const valid = vals.filter((v) => v !== null && v !== undefined && Number.isFinite(v));
      const best = better && valid.length > 1 ? (better === 'low' ? Math.min(...valid) : Math.max(...valid)) : null;
      vals.forEach((v) => {
        const td = Object.assign(document.createElement('td'), { className: 'num' });
        td.textContent = v === null || v === undefined || !Number.isFinite(v) ? '–' : fmt(v);
        if (best !== null && v === best && valid.filter((x) => x === best).length < valid.length) {
          td.classList.add('best');
          td.textContent += ' ▲';
          td.title = 'günstigster Wert';
        }
        tr.append(td);
      });
      return tr;
    });
    table.replaceChildren(document.createElement('thead'), document.createElement('tbody'));
    table.tHead.append(head);
    table.tBodies[0].append(...body);
  }

  $('#depot-compare-btn').addEventListener('click', runComparison);
  $('#compare-close').addEventListener('click', () => ($('#compare-card').hidden = true));

  // ---------- Öffentliche Schnittstelle ----------

  syncControls();
  renderDepotSelect();
  renderMode();
  renderTable();

  return {
    show() {
      state.visible = true;
      refresh();
    },
    hide() {
      state.visible = false;
    },
    refresh() {
      if (state.visible) refresh();
    },
    addPosition,
  };
}

function round(v, digits) {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

function hexToRgb(hex) {
  const m = hex.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  return m ? m.slice(1).map((x) => parseInt(x, 16)) : [128, 128, 128];
}

const pct2 = (v) =>
  v === null || v === undefined ? '–' : `${(v * 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} %`;
