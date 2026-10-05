// Mockup-Modus: simuliert die Server-API vollständig im Browser.
//
// Wird nur in den Mockup-Build eingebunden (npm run build:mockup), nie in die echte App.
// Alle Daten liegen im localStorage dieses Browsers – inklusive Passwörtern und
// Zugangsdaten im Klartext. Deshalb: nur zum Ausprobieren, niemals echte Daten eingeben.

import { listConnectors, getConnector, validateConfig, maskConfig, runFetch } from '../server/connectors/index.js';
import { defaultMeta } from '../js/securities.js';

const DB_KEY = 'mockup-db-v1';
const SESSION_KEY = 'mockup-session';
const IDLE_MS = 30 * 60_000;
const MAX_MS = 12 * 3_600_000;
export const DEMO_LOGIN = { email: 'demo@beispiel.de', password: 'Demo-Passwort-2026' };

// ---------- Speicher ----------

const store = {
  get(key) {
    try {
      return JSON.parse(localStorage.getItem(key));
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // ohne Speicher läuft der Mockup nur bis zum Neuladen
    }
  },
  remove(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      // ignorieren
    }
  },
};

let memorySession = null;
const getSessionId = () => store.get(SESSION_KEY) ?? memorySession;
const setSessionId = (id) => {
  memorySession = id;
  if (id) store.set(SESSION_KEY, id);
  else store.remove(SESSION_KEY);
};

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const now = () => Date.now();

function position(symbol, amount) {
  const { known, ...meta } = defaultMeta(symbol);
  return { id: uid(), symbol, amount, ...meta };
}

// Ausgangszustand: Demo-Konto mit zwei Depots, einer Bankverbindung und einer zweiten Sitzung
function seed() {
  const t = now();
  const user = { id: 1, email: DEMO_LOGIN.email, name: 'Demo Nutzer', password: DEMO_LOGIN.password, createdAt: t - 40 * 86_400_000 };
  const etf = { id: 'd-etf', name: 'Altersvorsorge (ETF)', mode: 'amount', benchmark: 'URTH', convertFx: true,
    positions: [['URTH', 24000], ['EEM', 4000], ['AGG', 7000], ['GLD', 2500], ['SAP', 1800], ['ALV', 1500], ['NVO', 1200]].map(([s, a]) => position(s, a)),
    forecast: { monthly: 300, years: 25, inflation: true, goal: 250000 } };
  const tech = { id: 'd-tech', name: 'Tech-Wetten', mode: 'amount', benchmark: 'URTH', convertFx: true,
    positions: [['NVDA', 6000], ['AAPL', 3000], ['MSFT', 2500], ['TSLA', 2000], ['META', 1500]].map(([s, a]) => position(s, a)) };
  return {
    nextId: 2,
    users: [user],
    sessions: [
      { id: 's-other', userId: 1, createdAt: t - 2 * 86_400_000, lastSeenAt: t - 3_600_000 * 5, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/605.1', ip: '84.150.12.7' },
    ],
    data: { 1: { depots: { activeId: 'd-etf', list: [etf, tech] }, settings: {} } },
    connections: [
      { id: 1, userId: 1, provider: 'demo', label: 'Sparkasse (Demo)', config: { login: 'demo.nutzer', pin: '24680', profile: 'balanced' }, createdAt: t - 86_400_000, lastSyncAt: null, lastStatus: null, lastMessage: null, positionsCount: null },
    ],
    audit: [
      { userId: 1, event: 'connection_created', at: t - 86_400_000, ip: '84.150.12.7', userAgent: 'Mozilla/5.0 (iPhone) Safari/605.1' },
      { userId: 1, event: 'login', at: t - 2 * 86_400_000, ip: '84.150.12.7', userAgent: 'Mozilla/5.0 (iPhone) Safari/605.1' },
      { userId: 1, event: 'login_failed', at: t - 2 * 86_400_000 - 60_000, ip: '84.150.12.7', userAgent: 'Mozilla/5.0 (iPhone) Safari/605.1' },
      { userId: 1, event: 'register', at: user.createdAt, ip: '84.150.12.7', userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/130' },
    ],
    failed: {},
  };
}

let db = store.get(DB_KEY) ?? seed();
const save = () => store.set(DB_KEY, db);
save();

// ---------- Hilfen ----------

class MockError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const meta = () => ({ ip: '127.0.0.1 (Mockup)', userAgent: navigator.userAgent });
const audit = (userId, event, detail = null) => db.audit.unshift({ userId, event, at: now(), detail, ...meta() });
const publicUser = (u) => ({ id: u.id, email: u.email, name: u.name, createdAt: u.createdAt });
const sessionInfo = (s) => ({ expiresAt: Math.min(s.lastSeenAt + IDLE_MS, s.createdAt + MAX_MS), idleTimeoutMs: IDLE_MS, maxAgeMs: MAX_MS });

function validatePassword(pw, email) {
  if (typeof pw !== 'string' || pw.length < 10) return 'Das Passwort muss mindestens 10 Zeichen lang sein.';
  if (new Set(pw).size < 5) return 'Das Passwort ist zu gleichförmig.';
  const local = email.split('@')[0].toLowerCase();
  if (local.length >= 4 && pw.toLowerCase().includes(local)) return 'Das Passwort darf die E-Mail-Adresse nicht enthalten.';
  return null;
}

function startSession(userId) {
  const s = { id: uid(), userId, createdAt: now(), lastSeenAt: now(), ...meta() };
  db.sessions.push(s);
  setSessionId(s.id);
  return s;
}

function currentSession() {
  const id = getSessionId();
  const s = db.sessions.find((x) => x.id === id);
  if (!s) return null;
  if (now() - s.lastSeenAt > IDLE_MS || now() - s.createdAt > MAX_MS) {
    db.sessions = db.sessions.filter((x) => x !== s);
    save();
    return null;
  }
  s.lastSeenAt = now();
  return s;
}

const userData = (userId) => (db.data[userId] ??= { depots: null, settings: {} });

function publicConnection(c) {
  const connector = getConnector(c.provider);
  return {
    id: c.id,
    provider: c.provider,
    providerName: connector?.name ?? c.provider,
    label: c.label,
    config: connector ? maskConfig(connector, c.config) : {},
    createdAt: c.createdAt,
    lastSyncAt: c.lastSyncAt,
    lastStatus: c.lastStatus,
    lastMessage: c.lastMessage,
    positionsCount: c.positionsCount,
  };
}

// Externe APIs (z. B. Trading 212) ruft nur der echte Server auf
const offlineFetch = async () => {
  throw Object.assign(new Error('Im Mockup nicht verfügbar: Echte Anbieter-Schnittstellen werden nur vom Server aufgerufen.'), { userFacing: true });
};

// ---------- Routen ----------

const routes = [];
const route = (method, pattern, handler, auth = true) => {
  const keys = [];
  const re = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)'))}$`);
  routes.push({ method, re, keys, handler, auth });
};

route('GET', '/api/auth/config', () => ({ body: { allowRegistration: true, idleMinutes: 30, maxHours: 12 } }), false);

route('POST', '/api/auth/register', ({ body }) => {
  const email = String(body.email ?? '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new MockError(400, 'Bitte eine gültige E-Mail-Adresse angeben.');
  const problem = validatePassword(body.password, email);
  if (problem) throw new MockError(400, problem);
  if (db.users.some((u) => u.email === email)) throw new MockError(409, 'Für diese E-Mail-Adresse existiert bereits ein Konto.');
  const user = { id: db.nextId++, email, name: String(body.name ?? '').trim() || null, password: body.password, createdAt: now() };
  db.users.push(user);
  audit(user.id, 'register');
  audit(user.id, 'login');
  startSession(user.id);
  return { status: 201, body: { user: publicUser(user) } };
}, false);

route('POST', '/api/auth/login', ({ body }) => {
  const email = String(body.email ?? '').trim().toLowerCase();
  const fails = db.failed[email] ?? { count: 0, until: 0 };
  if (fails.until > now()) throw new MockError(429, `Zu viele Fehlversuche. Bitte in ${Math.ceil((fails.until - now()) / 60_000)} Minute(n) erneut versuchen.`);
  const user = db.users.find((u) => u.email === email);
  if (!user || user.password !== body.password) {
    fails.count++;
    if (fails.count >= 5) Object.assign(fails, { count: 0, until: now() + 15 * 60_000 });
    db.failed[email] = fails;
    if (user) audit(user.id, 'login_failed');
    throw new MockError(401, 'E-Mail-Adresse oder Passwort ist falsch.');
  }
  delete db.failed[email];
  audit(user.id, 'login');
  startSession(user.id);
  return { body: { user: publicUser(user) } };
}, false);

route('GET', '/api/auth/me', ({ user, session }) => ({ body: { user: publicUser(user), session: sessionInfo(session) } }));

route('POST', '/api/auth/logout', ({ user, session }) => {
  db.sessions = db.sessions.filter((s) => s.id !== session.id);
  setSessionId(null);
  audit(user.id, 'logout');
  return { status: 204 };
});

route('GET', '/api/auth/sessions', ({ user, session }) => ({
  body: {
    sessions: db.sessions
      .filter((s) => s.userId === user.id)
      .sort((a, b) => b.lastSeenAt - a.lastSeenAt)
      .map((s) => ({ id: s.id, current: s.id === session.id, createdAt: s.createdAt, lastSeenAt: s.lastSeenAt, userAgent: s.userAgent, ip: s.ip })),
  },
}));

route('DELETE', '/api/auth/sessions/:id', ({ user, session, params }) => {
  if (params.id === session.id) throw new MockError(400, 'Die aktuelle Sitzung bitte über „Abmelden“ beenden.');
  const before = db.sessions.length;
  db.sessions = db.sessions.filter((s) => !(s.id === params.id && s.userId === user.id));
  if (db.sessions.length === before) throw new MockError(404, 'Sitzung nicht gefunden.');
  audit(user.id, 'session_revoked');
  return { status: 204 };
});

route('POST', '/api/auth/sessions/revoke-others', ({ user, session }) => {
  const before = db.sessions.length;
  db.sessions = db.sessions.filter((s) => s.userId !== user.id || s.id === session.id);
  audit(user.id, 'sessions_revoked');
  return { body: { revoked: before - db.sessions.length } };
});

route('POST', '/api/auth/password', ({ user, session, body }) => {
  if (body.currentPassword !== user.password) throw new MockError(400, 'Das aktuelle Passwort ist falsch.');
  const problem = validatePassword(body.newPassword, user.email);
  if (problem) throw new MockError(400, problem);
  user.password = body.newPassword;
  db.sessions = db.sessions.filter((s) => s.userId !== user.id || s.id === session.id);
  audit(user.id, 'password_changed');
  return { status: 204 };
});

route('GET', '/api/auth/activity', ({ user }) => ({
  body: { activity: db.audit.filter((a) => a.userId === user.id).slice(0, 20).map(({ event, ip, userAgent, detail, at }) => ({ event, ip, userAgent, detail, at })) },
}));

route('POST', '/api/auth/delete-account', ({ user, body }) => {
  if (body.password !== user.password) throw new MockError(400, 'Das Passwort ist falsch.');
  db.users = db.users.filter((u) => u.id !== user.id);
  db.sessions = db.sessions.filter((s) => s.userId !== user.id);
  db.connections = db.connections.filter((c) => c.userId !== user.id);
  delete db.data[user.id];
  setSessionId(null);
  return { status: 204 };
});

route('GET', '/api/depots', ({ user }) => ({ body: { depots: userData(user.id).depots, updatedAt: null } }));
route('PUT', '/api/depots', ({ user, body }) => {
  if (!body.depots || !Array.isArray(body.depots.list)) throw new MockError(400, 'Ungültige Depotdaten.');
  userData(user.id).depots = body.depots;
  return { body: { updatedAt: now() } };
});

route('GET', '/api/settings', ({ user }) => ({ body: { settings: userData(user.id).settings } }));
route('PUT', '/api/settings', ({ user, body }) => {
  userData(user.id).settings = { twelvedataKey: String(body.settings?.twelvedataKey ?? '').trim() };
  return { body: { settings: userData(user.id).settings } };
});

route('GET', '/api/connectors', () => ({ body: { connectors: listConnectors() } }));
route('GET', '/api/connections', ({ user }) => ({ body: { connections: db.connections.filter((c) => c.userId === user.id).map(publicConnection) } }));

route('POST', '/api/connections', ({ user, body }) => {
  const connector = getConnector(body.provider);
  if (!connector) throw new MockError(400, 'Unbekannter Anbieter.');
  let config;
  try {
    config = validateConfig(connector, body.config);
  } catch (err) {
    throw new MockError(400, err.message);
  }
  const c = { id: db.nextId++, userId: user.id, provider: connector.id, label: String(body.label ?? '').trim() || connector.name, config, createdAt: now(), lastSyncAt: null, lastStatus: null, lastMessage: null, positionsCount: null };
  db.connections.push(c);
  audit(user.id, 'connection_created', connector.id);
  return { status: 201, body: { connection: publicConnection(c) } };
});

const own = (user, id) => {
  const c = db.connections.find((x) => x.id === Number(id) && x.userId === user.id);
  if (!c) throw new MockError(404, 'Verbindung nicht gefunden.');
  return { c, connector: getConnector(c.provider) };
};

route('PUT', '/api/connections/:id', ({ user, params, body }) => {
  const { c, connector } = own(user, params.id);
  try {
    c.config = validateConfig(connector, body.config ?? {}, c.config);
  } catch (err) {
    throw new MockError(400, err.message);
  }
  c.label = String(body.label ?? c.label).trim() || c.label;
  return { body: { connection: publicConnection(c) } };
});

route('DELETE', '/api/connections/:id', ({ user, params }) => {
  const { c } = own(user, params.id);
  db.connections = db.connections.filter((x) => x !== c);
  audit(user.id, 'connection_deleted', c.provider);
  return { status: 204 };
});

route('POST', '/api/connections/:id/test', async ({ user, params }) => {
  const { c, connector } = own(user, params.id);
  try {
    const res = await connector.test(c.config, { fetch: offlineFetch });
    return { body: { ok: true, message: res.message } };
  } catch (err) {
    return { body: { ok: false, message: err.userFacing ? err.message : 'Der Abruf ist fehlgeschlagen.' } };
  }
});

route('POST', '/api/connections/:id/sync', async ({ user, params, body }) => {
  const { c, connector } = own(user, params.id);
  try {
    const result = await runFetch(connector, c.config, { fetch: offlineFetch, upload: typeof body.upload === 'string' ? body.upload : null });
    const msg = `${result.positions.length} Positionen abgerufen` + (result.skipped.length ? `, ${result.skipped.length} übersprungen` : '');
    Object.assign(c, { lastSyncAt: now(), lastStatus: 'ok', lastMessage: msg, positionsCount: result.positions.length });
    audit(user.id, 'connection_synced', `${connector.id}: ${result.positions.length}`);
    return { body: { ...result, fetchedAt: now(), connection: publicConnection(c) } };
  } catch (err) {
    const message = err.userFacing || err.message?.startsWith('Bitte') ? err.message : 'Der Abruf ist fehlgeschlagen.';
    Object.assign(c, { lastSyncAt: now(), lastStatus: 'error', lastMessage: message });
    throw new MockError(502, message);
  }
});

// ---------- fetch abfangen ----------

const json = (status, body) =>
  status === 204 ? new Response(null, { status }) : new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const realFetch = window.fetch.bind(window);

window.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url, location.href);
  if (!url.pathname.startsWith('/api/')) return realFetch(input, init);
  await delay(80 + Math.random() * 120); // realistische Antwortzeit
  const method = (init.method ?? 'GET').toUpperCase();
  const match = routes.find((r) => r.method === method && r.re.test(url.pathname));
  if (!match) return json(404, { error: 'Nicht gefunden' });
  try {
    const params = {};
    const values = url.pathname.match(match.re).slice(1);
    match.keys.forEach((k, i) => (params[k] = decodeURIComponent(values[i])));
    const ctx = { params, body: init.body ? JSON.parse(init.body) : {} };
    if (match.auth) {
      const session = currentSession();
      const user = session && db.users.find((u) => u.id === session.userId);
      if (!user) {
        const had = !!getSessionId();
        setSessionId(null);
        return json(401, { error: had ? 'Deine Sitzung ist abgelaufen. Bitte melde dich erneut an.' : 'Bitte melde dich an.' });
      }
      Object.assign(ctx, { session, user });
    }
    const out = await match.handler(ctx);
    save();
    return json(out.status ?? 200, out.body);
  } catch (err) {
    save();
    return json(err.status ?? 500, { error: err.status ? err.message : 'Interner Fehler im Mockup' });
  }
};

// ---------- Rückfragen ----------
// Die Vorschau-Umgebung blockiert confirm()/prompt(); im Mockup werden Rückfragen
// automatisch bestätigt bzw. mit dem Vorschlagswert beantwortet.
window.confirm = () => true;
window.prompt = (_message, fallback = '') => fallback;

// ---------- Mockup-Leiste ----------

function mountBanner() {
  document.body.dataset.view ??= 'analysis';
  document.body.dataset.auth ??= 'pending';
  const bar = document.createElement('div');
  bar.className = 'mock-banner';
  bar.setAttribute('role', 'note');
  bar.innerHTML =
    '<strong>Mockup</strong><span>Simulierter Server · Daten nur in diesem Browser · keine echten Zugangsdaten eingeben</span>' +
    '<button type="button" class="btn small" id="mock-reset">Zurücksetzen</button>';
  document.body.append(bar);
  bar.querySelector('#mock-reset').addEventListener('click', () => {
    store.remove(DB_KEY);
    setSessionId(null);
    location.hash = '';
    location.reload();
  });

  // Zugangsdaten des Demo-Kontos auf der Anmeldeseite anbieten
  const hint = document.createElement('div');
  hint.className = 'mock-login-hint';
  hint.innerHTML = `<span>Demo-Konto: <code>${DEMO_LOGIN.email}</code> · <code>${DEMO_LOGIN.password}</code></span>`;
  const fill = Object.assign(document.createElement('button'), { type: 'button', className: 'btn small', textContent: 'Eintragen' });
  fill.addEventListener('click', () => {
    document.getElementById('login-email').value = DEMO_LOGIN.email;
    document.getElementById('login-password').value = DEMO_LOGIN.password;
    document.querySelector('#auth-tabs [data-mode=login]').click();
    document.getElementById('login-email').value = DEMO_LOGIN.email;
    document.getElementById('login-password').value = DEMO_LOGIN.password;
  });
  hint.append(fill);
  document.getElementById('auth-message')?.before(hint);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountBanner);
else mountBanner();

