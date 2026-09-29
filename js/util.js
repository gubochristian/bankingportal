// Gemeinsame Hilfsfunktionen: Speicher, Zahlenformate, Farben.

export const $ = (sel) => document.querySelector(sel);

export const storage = {
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

export const numberFmt = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const pctFmt = new Intl.NumberFormat('de-DE', {
  style: 'percent',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  signDisplay: 'exceptZero',
});
export const compactFmt = new Intl.NumberFormat('de-DE', { notation: 'compact', maximumFractionDigits: 1 });
export const dateFmt = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeZone: 'UTC' });

export const num = (v) => (v === null || v === undefined || Number.isNaN(v) ? '–' : numberFmt.format(v));
export const pct = (v) => (v === null || v === undefined || Number.isNaN(v) ? '–' : pctFmt.format(v));
export const date = (iso) => dateFmt.format(new Date(`${iso}T00:00:00Z`));
export const toneClass = (v) => (v > 0 ? 'up' : v < 0 ? 'down' : '');

export function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

// '#rrggbb' → 'rgba(r, g, b, a)' (die Chart-Bibliothek versteht kein color-mix())
export function withAlpha(hex, alpha) {
  const m = hex.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return hex;
  const [r, g, b] = m.slice(1).map((x) => parseInt(x, 16));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export const eurFmt = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
export const eur = (v) => (v === null || v === undefined || Number.isNaN(v) ? '–' : eurFmt.format(v));
export const pct1 = (v) =>
  v === null || v === undefined || Number.isNaN(v)
    ? '–'
    : new Intl.NumberFormat('de-DE', { style: 'percent', maximumFractionDigits: 1 }).format(v);
