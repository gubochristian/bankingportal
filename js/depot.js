// Depot-Ansicht: Positionen erfassen, Kurse laden, Bewertung darstellen.

import { createChart, CrosshairMode } from './vendor/lightweight-charts.mjs';
import { loadSeries, MissingApiKeyError } from './market.js';
import { analyzePortfolio, RISK_CLASS_LABELS } from './portfolio.js';
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
const newId = () => `p${Date.now().toString(36)}${nextId++}`;

export function initDepot({ getSource, getApiKey, openSettings }) {
  const state = {
    mode: 'amount',
    positions: [],
    ...storage.get('depot', {}),
    series: {}, // symbol → bars (für die aktuelle Quelle)
    errors: {}, // symbol → Fehlermeldung
    allocTab: storage.get('depotAllocTab', 'sector'),
    visible: false,
    loadToken: 0,
    result: null,
  };

  const save = () => storage.set('depot', { mode: state.mode, positions: state.positions });

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
      const last = state.series[p.symbol]?.at(-1)?.close;
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
          td(numberInput(p[qtyField], (x) => update(p, qtyField, x), `${state.mode === 'amount' ? 'Betrag' : 'Stückzahl'} ${p.symbol}`), 'num'),
          td(numberInput(p.buyPrice, (x) => update(p, 'buyPrice', x), `Kaufkurs ${p.symbol}`), 'num shares-only'),
          td(v.last ? num(v.last) : '…', 'num'),
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

  // Aktueller Wert jeder Position aus Menge bzw. Betrag und letztem Kurs
  function positionValues() {
    return state.positions.map((p) => {
      const last = state.series[p.symbol]?.at(-1)?.close ?? null;
      if (state.mode === 'amount') return { id: p.id, last, value: p.amount > 0 ? p.amount : null, costBasis: null };
      const value = last !== null && p.quantity > 0 ? p.quantity * last : null;
      const costBasis = p.buyPrice > 0 && p.quantity > 0 ? p.buyPrice * p.quantity : null;
      return { id: p.id, last, value, costBasis };
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

  async function refresh() {
    const token = ++state.loadToken;
    const source = getSource();
    if (source !== loadedSource) {
      state.series = {};
      state.errors = {};
      loadedSource = source;
    }
    renderTable();
    const missing = [...new Set(state.positions.map((p) => p.symbol))].filter((s) => !state.series[s] && !state.errors[s]);
    showMessage('');

    for (const [i, symbol] of missing.entries()) {
      if (source === 'twelvedata') showMessage(`Lade Kurse … (${i + 1}/${missing.length}: ${symbol})`, 'info');
      try {
        const { bars } = await loadSeries(symbol, {
          source,
          apiKey: getApiKey(),
          onWait: (s) => showMessage(`API-Limit des kostenlosen Tarifs erreicht – weiter in ${s} Sekunden …`, 'info'),
        });
        if (token !== state.loadToken) return;
        state.series[symbol] = bars;
      } catch (err) {
        if (token !== state.loadToken) return;
        if (err instanceof MissingApiKeyError) {
          showMessage(err.message, 'info');
          openSettings();
          return;
        }
        state.errors[symbol] = `Keine Kurse: ${err.message}`;
      }
    }
    if (token !== state.loadToken) return;
    showMessage(
      Object.keys(state.errors).length
        ? `Für ${Object.keys(state.errors).join(', ')} konnten keine Kurse geladen werden – diese Positionen fließen nicht in die Bewertung ein.`
        : '',
    );
    renderTable();
    evaluate();
  }

  function evaluate() {
    const values = positionValues();
    const input = state.positions
      .map((p, i) => ({ p, v: values[i] }))
      .filter(({ p, v }) => v.value > 0 && state.series[p.symbol])
      .map(({ p, v }) => {
        const known = lookupSecurity(p.symbol);
        return {
          symbol: p.symbol,
          name: p.name,
          value: v.value,
          costBasis: v.costBasis,
          type: p.type,
          sector: p.sector,
          region: p.region,
          currency: p.currency,
          regionBreakdown: p.region === 'Global' && known?.region === 'Global' ? known.regions : undefined,
        };
      });
    const series = Object.fromEntries(input.map((p) => [p.symbol, state.series[p.symbol]]));
    state.result = input.length ? analyzePortfolio(input, series) : null;
    renderResults();
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

    renderHints(r.hints);
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
  }

  function renderHistory(r) {
    ensureChart();
    applyChartTheme();
    area.setData(r.history.map((h) => ({ time: h.time, value: h.value })));
    chart.timeScale().fitContent();
    const extra = [
      ['Rendite 1 Jahr', pct(r.return1y), toneClass(r.return1y)],
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

  // ---------- Öffentliche Schnittstelle ----------

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
