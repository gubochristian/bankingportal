import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../server/config.js';
import { createApp } from '../server/app.js';
import { encryptJson, decryptJson, hashPassword, verifyPassword } from '../server/security.js';
import { RateLimiter, validatePassword } from '../server/auth.js';
import { normalizePosition } from '../server/connectors/index.js';
import { parseDepotCsv, parseAmount } from '../server/connectors/csv.js';
import { tickerToSymbol } from '../server/connectors/trading212.js';

// ---------- Testserver ----------

let clock = Date.parse('2026-10-05T10:00:00Z');
let app;
let base;
const fetchCalls = [];

// Nachgebildete Trading-212-API
async function fakeFetch(url, opts) {
  fetchCalls.push({ url, auth: opts.headers.Authorization });
  if (opts.headers.Authorization === 'bad') return new Response('', { status: 401 });
  if (url.endsWith('/account/info')) return Response.json({ id: 42, currencyCode: 'EUR' });
  if (url.endsWith('/equity/portfolio')) {
    return Response.json([
      { ticker: 'AAPL_US_EQ', quantity: 2.5, averagePrice: 150, currentPrice: 190 },
      { ticker: 'VUSAl_EQ', quantity: 10, averagePrice: 80, currentPrice: 90 },
    ]);
  }
  return new Response('', { status: 404 });
}

before(async () => {
  const config = loadConfig({}, { appSecret: 'test-secret', loginMaxAttempts: 3, sessionIdleMinutes: 30, sessionMaxHours: 12 });
  app = createApp(config, { dbPath: ':memory:', now: () => clock, fetchImpl: fakeFetch });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
});

after(() => new Promise((r) => app.server.close(r)));

// Kleiner Client mit Cookie-Speicher (wie ein Browser)
function client() {
  let cookie = '';
  return {
    get cookie() {
      return cookie;
    },
    async req(method, path, body, headers = {}) {
      const res = await fetch(base + path, {
        method,
        headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      const set = res.headers.get('set-cookie');
      if (set) {
        const [pair] = set.split(';');
        cookie = pair.endsWith('=') ? '' : pair;
      }
      const text = await res.text();
      return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null, setCookie: set };
    },
  };
}

const PW = 'Sicheres-Passw0rt!';

// ---------- Einheiten ----------

test('Passwort-Hash ist gesalzen und prüfbar', async () => {
  const a = await hashPassword(PW);
  const b = await hashPassword(PW);
  assert.notEqual(a, b);
  assert.ok(await verifyPassword(PW, a));
  assert.ok(!(await verifyPassword('falsch-falsch', a)));
});

test('Passwortregeln', () => {
  assert.match(validatePassword('kurz'), /mindestens 10/);
  assert.match(validatePassword('passwort123'), /leicht/);
  assert.match(validatePassword('aaaaaaaaaaaa'), /gleichförmig/);
  assert.match(validatePassword('maxmuster-2026!', 'maxmuster@example.org'), /E-Mail/);
  assert.equal(validatePassword(PW, 'anna@example.org'), null);
});

test('Verschlüsselung ist an den Kontext gebunden', () => {
  const key = Buffer.alloc(32, 7);
  const enc = encryptJson(key, { apiKey: 'geheim' }, 'user:1|connection:2');
  assert.ok(!enc.includes('geheim'));
  assert.deepEqual(decryptJson(key, enc, 'user:1|connection:2'), { apiKey: 'geheim' });
  assert.throws(() => decryptJson(key, enc, 'user:2|connection:2'));
  assert.throws(() => decryptJson(Buffer.alloc(32, 8), enc, 'user:1|connection:2'));
});

test('RateLimiter sperrt nach zu vielen Fehlversuchen und gibt wieder frei', () => {
  let t = 0;
  const rl = new RateLimiter({ max: 3, windowMs: 1000, now: () => t });
  rl.fail('x');
  rl.fail('x');
  assert.equal(rl.retryAfter('x'), 0);
  rl.fail('x');
  assert.equal(rl.retryAfter('x'), 1);
  t = 1500;
  assert.equal(rl.retryAfter('x'), 0);
});

// ---------- Anmeldung & Sitzungen ----------

test('Registrierung, Login, Sitzung und Logout', async () => {
  const c = client();
  assert.equal((await c.req('GET', '/api/auth/me')).status, 401);

  const reg = await c.req('POST', '/api/auth/register', { email: 'Anna@Example.org', password: PW, name: 'Anna' });
  assert.equal(reg.status, 201);
  assert.equal(reg.body.user.email, 'anna@example.org');
  assert.match(reg.setCookie, /HttpOnly/);
  assert.match(reg.setCookie, /SameSite=Strict/);
  assert.ok(!reg.body.user.password_hash);

  const me = await c.req('GET', '/api/auth/me');
  assert.equal(me.status, 200);
  assert.equal(me.body.session.idleTimeoutMs, 30 * 60_000);

  assert.equal((await c.req('POST', '/api/auth/register', { email: 'anna@example.org', password: PW })).status, 409);

  const out = await c.req('POST', '/api/auth/logout', {});
  assert.equal(out.status, 204);
  assert.equal((await c.req('GET', '/api/auth/me')).status, 401);

  const c2 = client();
  assert.equal((await c2.req('POST', '/api/auth/login', { email: 'anna@example.org', password: 'falsches-passwort' })).status, 401);
  const ok = await c2.req('POST', '/api/auth/login', { email: 'ANNA@example.org', password: PW });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.user.name, 'Anna');
});

test('Gleiche Fehlermeldung für unbekannte E-Mail und falsches Passwort', async () => {
  const a = await client().req('POST', '/api/auth/login', { email: 'niemand@example.org', password: 'irgendwas-123' });
  const b = await client().req('POST', '/api/auth/login', { email: 'anna@example.org', password: 'irgendwas-123' });
  assert.equal(a.status, 401);
  assert.equal(a.body.error, b.body.error);
});

test('Login wird nach zu vielen Fehlversuchen gesperrt', async () => {
  const c = client();
  await c.req('POST', '/api/auth/register', { email: 'bert@example.org', password: PW });
  const h = { 'X-Test': '1' };
  for (let i = 0; i < 3; i++) await client().req('POST', '/api/auth/login', { email: 'bert@example.org', password: 'falsch-falsch' }, h);
  const locked = await client().req('POST', '/api/auth/login', { email: 'bert@example.org', password: PW });
  assert.equal(locked.status, 429);
  assert.ok(Number(locked.headers.get('retry-after')) > 0);
  clock += 16 * 60_000; // Sperre läuft ab
  assert.equal((await client().req('POST', '/api/auth/login', { email: 'bert@example.org', password: PW })).status, 200);
});

test('Sitzung läuft nach Inaktivität und nach Höchstdauer ab', async () => {
  const c = client();
  await c.req('POST', '/api/auth/register', { email: 'cora@example.org', password: PW });
  clock += 25 * 60_000;
  assert.equal((await c.req('GET', '/api/auth/me')).status, 200); // Aktivität verlängert
  clock += 25 * 60_000;
  assert.equal((await c.req('GET', '/api/auth/me')).status, 200);
  clock += 31 * 60_000; // zu lange inaktiv
  const expired = await c.req('GET', '/api/auth/me');
  assert.equal(expired.status, 401);
  assert.match(expired.body.error, /abgelaufen/);

  const d = client();
  await d.req('POST', '/api/auth/login', { email: 'cora@example.org', password: PW });
  for (let i = 0; i < 26; i++) {
    clock += 28 * 60_000; // immer aktiv, aber insgesamt > 12 h
    if ((await d.req('GET', '/api/auth/me')).status === 401) {
      assert.ok(i >= 24, `zu früh abgelaufen nach ${i} Schritten`);
      return;
    }
  }
  assert.fail('Höchstdauer wurde nicht durchgesetzt');
});

test('Sitzungen auflisten, einzeln widerrufen, Passwortwechsel beendet andere Sitzungen', async () => {
  const a = client();
  const b = client();
  await a.req('POST', '/api/auth/register', { email: 'dora@example.org', password: PW });
  await b.req('POST', '/api/auth/login', { email: 'dora@example.org', password: PW });

  const list = await a.req('GET', '/api/auth/sessions');
  assert.equal(list.body.sessions.length, 2);
  const other = list.body.sessions.find((s) => !s.current);
  assert.equal((await a.req('DELETE', `/api/auth/sessions/${other.id}`)).status, 204);
  assert.equal((await b.req('GET', '/api/auth/me')).status, 401);

  await b.req('POST', '/api/auth/login', { email: 'dora@example.org', password: PW });
  assert.equal((await a.req('POST', '/api/auth/password', { currentPassword: 'falsch', newPassword: 'Neues-Passw0rt!!' })).status, 400);
  assert.equal((await a.req('POST', '/api/auth/password', { currentPassword: PW, newPassword: 'Neues-Passw0rt!!' })).status, 204);
  assert.equal((await b.req('GET', '/api/auth/me')).status, 401);
  assert.equal((await a.req('GET', '/api/auth/me')).status, 200);
  assert.equal((await client().req('POST', '/api/auth/login', { email: 'dora@example.org', password: 'Neues-Passw0rt!!' })).status, 200);

  const activity = await a.req('GET', '/api/auth/activity');
  assert.ok(activity.body.activity.some((e) => e.event === 'password_changed'));
});

test('Neue Anmeldung erzeugt immer ein neues Token (keine Session Fixation)', async () => {
  const c = client();
  await c.req('POST', '/api/auth/login', { email: 'anna@example.org', password: PW });
  const first = c.cookie;
  await c.req('POST', '/api/auth/login', { email: 'anna@example.org', password: PW });
  assert.notEqual(c.cookie, first);
});

test('Cross-Site-Anfragen werden abgelehnt', async () => {
  const c = client();
  await c.req('POST', '/api/auth/login', { email: 'anna@example.org', password: PW });
  const evil = await c.req('PUT', '/api/depots', { depots: { list: [] } }, { Origin: 'https://evil.example' });
  assert.equal(evil.status, 403);
  const evil2 = await c.req('PUT', '/api/depots', { depots: { list: [] } }, { 'Sec-Fetch-Site': 'cross-site' });
  assert.equal(evil2.status, 403);
  const form = await fetch(`${base}/api/depots`, { method: 'PUT', headers: { Cookie: c.cookie, 'Content-Type': 'text/plain' }, body: '{}' });
  assert.equal(form.status, 415);
});

// ---------- Statische Dateien & Header ----------

test('Nur das Frontend wird ausgeliefert, Server-Dateien bleiben privat', async () => {
  const index = await fetch(`${base}/`);
  assert.equal(index.status, 200);
  assert.match(index.headers.get('content-security-policy'), /script-src 'self'/);
  assert.equal(index.headers.get('x-frame-options'), 'DENY');
  assert.equal((await fetch(`${base}/js/app.js`)).status, 200);
  assert.equal((await fetch(`${base}/js/%E0%A4%A.js`)).status, 404);
  for (const p of ['/server/app.js', '/package.json', '/data/app.db', '/data/secret.key', '/js/../server/auth.js', '/%2e%2e/server/app.js', '/tests/server.test.js']) {
    assert.equal((await fetch(base + p)).status, 404, p);
  }
});

test('Registrierungen je IP sind begrenzt', async () => {
  // bisherige Tests haben bereits mehrere Konten von 127.0.0.1 angelegt
  let status = 0;
  for (let i = 0; i < 12 && status !== 429; i++) {
    status = (await client().req('POST', '/api/auth/register', { email: `massen${i}@example.org`, password: PW })).status;
  }
  assert.equal(status, 429);
  clock += 61 * 60_000;
  assert.equal((await client().req('POST', '/api/auth/register', { email: 'spaeter@example.org', password: PW })).status, 201);
});

// ---------- Depots ----------

test('Depots werden pro Nutzer gespeichert und sind für andere unsichtbar', async () => {
  const a = client();
  const b = client();
  await a.req('POST', '/api/auth/register', { email: 'emil@example.org', password: PW });
  await b.req('POST', '/api/auth/register', { email: 'frida@example.org', password: PW });
  assert.equal((await a.req('GET', '/api/depots')).body.depots, null);
  const depots = { activeId: 'd1', list: [{ id: 'd1', name: 'Rente', positions: [{ symbol: 'URTH', amount: 1000 }] }] };
  assert.equal((await a.req('PUT', '/api/depots', { depots })).status, 200);
  assert.deepEqual((await a.req('GET', '/api/depots')).body.depots, depots);
  assert.equal((await b.req('GET', '/api/depots')).body.depots, null);
  assert.equal((await a.req('PUT', '/api/depots', { depots: { list: 'x' } })).status, 400);
});

test('Einstellungen werden verschlüsselt pro Nutzer gespeichert', async () => {
  const c = client();
  await c.req('POST', '/api/auth/register', { email: 'hans@example.org', password: PW });
  assert.deepEqual((await c.req('GET', '/api/settings')).body.settings, {});
  await c.req('PUT', '/api/settings', { settings: { twelvedataKey: ' abc123 ' } });
  assert.equal((await c.req('GET', '/api/settings')).body.settings.twelvedataKey, 'abc123');
  const raw = app.db.prepare("SELECT value FROM user_data WHERE key = 'settings'").all().map((r) => r.value).join();
  assert.ok(!raw.includes('abc123'));
  assert.equal((await c.req('PUT', '/api/settings', { settings: { twelvedataKey: 5 } })).status, 400);
});

// ---------- Schnittstellen ----------

test('Connector-Liste enthält verfügbare und geplante Anbieter', async () => {
  const c = client();
  await c.req('POST', '/api/auth/login', { email: 'anna@example.org', password: PW });
  const { connectors } = (await c.req('GET', '/api/connectors')).body;
  const ids = connectors.map((x) => x.id);
  assert.ok(['demo', 'csv', 'trading212', 'fints', 'finapi'].every((id) => ids.includes(id)));
  assert.equal(connectors.find((x) => x.id === 'fints').status, 'planned');
});

test('Demo-Bank: anlegen, Geheimnisse maskiert, testen, abrufen, löschen', async () => {
  const c = client();
  await c.req('POST', '/api/auth/register', { email: 'gina@example.org', password: PW });
  assert.equal((await c.req('POST', '/api/connections', { provider: 'demo', config: { login: 'gina' } })).status, 400);
  assert.equal((await c.req('POST', '/api/connections', { provider: 'fints', config: {} })).status, 400);

  const created = await c.req('POST', '/api/connections', { provider: 'demo', label: 'Meine Bank', config: { login: 'gina', pin: '12345', profile: 'growth' } });
  assert.equal(created.status, 201);
  const conn = created.body.connection;
  assert.equal(conn.config.pin, '••••');
  assert.ok(!JSON.stringify(created.body).includes('12345'));

  // In der Datenbank liegt die PIN nur verschlüsselt
  const raw = app.db.prepare('SELECT config FROM connections WHERE id = ?').get(conn.id).config;
  assert.ok(raw.startsWith('v1:') && !raw.includes('12345'));

  assert.deepEqual((await c.req('POST', `/api/connections/${conn.id}/test`, {})).body.ok, true);

  const sync = await c.req('POST', `/api/connections/${conn.id}/sync`, {});
  assert.equal(sync.status, 200);
  const symbols = sync.body.positions.map((p) => p.symbol);
  assert.deepEqual(symbols.slice(0, 4), ['NVDA', 'AAPL', 'MSFT', 'ASML']);
  assert.equal(sync.body.positions.find((p) => p.symbol === 'XS0000000000').known, false);
  assert.equal(sync.body.connection.lastStatus, 'ok');

  // Bearbeiten ohne PIN behält die alte PIN, falsche PIN führt zu Fehler beim Abruf
  await c.req('PUT', `/api/connections/${conn.id}`, { label: 'Umbenannt', config: { login: 'gina', pin: '', profile: 'balanced' } });
  assert.equal((await c.req('POST', `/api/connections/${conn.id}/test`, {})).body.ok, true);
  await c.req('PUT', `/api/connections/${conn.id}`, { config: { login: 'gina', pin: 'abc', profile: 'balanced' } });
  const failed = await c.req('POST', `/api/connections/${conn.id}/sync`, {});
  assert.equal(failed.status, 502);
  assert.match(failed.body.error, /PIN/);

  // Fremde Nutzer sehen die Verbindung nicht
  const other = client();
  await other.req('POST', '/api/auth/login', { email: 'anna@example.org', password: PW });
  assert.equal((await other.req('POST', `/api/connections/${conn.id}/sync`, {})).status, 404);
  assert.equal((await other.req('GET', '/api/connections')).body.connections.length, 0);

  assert.equal((await c.req('DELETE', `/api/connections/${conn.id}`)).status, 204);
  assert.equal((await c.req('GET', '/api/connections')).body.connections.length, 0);
});

test('CSV-Depotauszug: Upload beim Abruf', async () => {
  const c = client();
  await c.req('POST', '/api/auth/login', { email: 'gina@example.org', password: PW });
  const { connection } = (await c.req('POST', '/api/connections', { provider: 'csv', config: {} })).body;
  assert.equal((await c.req('POST', `/api/connections/${connection.id}/sync`, {})).status, 502);
  const upload = 'Depotbestand vom 05.10.2026\n\nBezeichnung;ISIN;Stück;Einstandskurs;Währung\nApple Inc.;US0378331005;10;150,25;EUR\n"iShares Core MSCI World";IE00B4L5Y983;"1.200,5";80,10;EUR\nSumme;;;;\n';
  const res = await c.req('POST', `/api/connections/${connection.id}/sync`, { upload });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.positions.map((p) => [p.symbol, p.quantity, p.buyPrice, p.proxy]), [
    ['AAPL', 10, 150.25, false],
    ['URTH', 1200.5, 80.1, true],
  ]);
});

test('Trading 212: Schlüssel wird nur serverseitig genutzt, Ticker werden übersetzt', async () => {
  const c = client();
  await c.req('POST', '/api/auth/login', { email: 'gina@example.org', password: PW });
  const { connection } = (await c.req('POST', '/api/connections', { provider: 'trading212', config: { apiKey: 'KEY123456789', environment: 'demo' } })).body;
  const t = await c.req('POST', `/api/connections/${connection.id}/test`, {});
  assert.equal(t.body.ok, true);
  assert.match(fetchCalls.at(-1).url, /^https:\/\/demo\.trading212\.com/);
  assert.equal(fetchCalls.at(-1).auth, 'KEY123456789');
  const sync = await c.req('POST', `/api/connections/${connection.id}/sync`, {});
  assert.deepEqual(sync.body.positions.map((p) => [p.symbol, p.quantity]), [['AAPL', 2.5], ['VUSA', 10]]);

  await c.req('PUT', `/api/connections/${connection.id}`, { config: { apiKey: 'K', apiSecret: 'S', environment: 'live' } });
  await c.req('POST', `/api/connections/${connection.id}/test`, {});
  assert.equal(fetchCalls.at(-1).auth, `Basic ${Buffer.from('K:S').toString('base64')}`);
});

// ---------- Hilfsfunktionen der Connectors ----------

test('Zahlen- und CSV-Erkennung', () => {
  assert.equal(parseAmount('1.234,56'), 1234.56);
  assert.equal(parseAmount('1,234.56'), 1234.56);
  assert.equal(parseAmount('12,5 €'), 12.5);
  assert.equal(parseAmount(''), null);
  const rows = parseDepotCsv('Name,ISIN,Shares,Average price\nMicrosoft,US5949181045,3,"1,250.00"\n');
  assert.deepEqual([rows[0].quantity, rows[0].buyPrice], [3, 1250]);
  assert.throws(() => parseDepotCsv('a;b\n1;2'), /Kopfzeile/);
});

test('Positionen werden bereinigt und über die ISIN zugeordnet', () => {
  assert.equal(normalizePosition({ isin: 'DE0007164600', quantity: '5' }).symbol, 'SAP');
  assert.equal(normalizePosition({ isin: 'DE0007164600', quantity: 0 }), null);
  assert.equal(normalizePosition({ symbol: '<script>', quantity: 1 }), null);
  const p = normalizePosition({ symbol: 'msft', quantity: 1, currency: 'usd', buyPrice: -3 });
  assert.deepEqual([p.symbol, p.currency, p.buyPrice, p.known], ['MSFT', 'USD', null, true]);
  assert.equal(tickerToSymbol('BRK_B_US_EQ'), 'BRK');
});
