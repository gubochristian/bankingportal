// HTTP-Anwendung: API, Sitzungen und Auslieferung des Frontends.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { mkdirSync } from 'node:fs';

import { openDb } from './db.js';
import { createAuth, SESSION_COOKIE } from './auth.js';
import { loadMasterKey, encryptJson, decryptJson } from './security.js';
import { HttpError, sendJson, readJson, parseCookies, serializeCookie, clientIp, isHttps } from './http.js';
import { listConnectors, getConnector, validateConfig, maskConfig, runFetch, ConnectorError } from './connectors/index.js';

const STATIC_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.csv': 'text/csv; charset=utf-8',
};
// Nur diese Pfade werden ausgeliefert – Server-Code, Datenbank und Schlüssel bleiben privat.
const STATIC_PREFIXES = ['/css/', '/js/', '/examples/'];

const SECURITY_HEADERS = {
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "connect-src 'self' https://api.twelvedata.com",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; '),
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

const MAX_DEPOTS_BYTES = 1024 * 1024;
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

export function createApp(config, { fetchImpl = globalThis.fetch, now = Date.now, dbPath } = {}) {
  if (!dbPath) mkdirSync(config.dataDir, { recursive: true });
  const db = openDb(dbPath ?? join(config.dataDir, 'app.db'));
  const auth = createAuth(db, config, { now });
  const masterKey = loadMasterKey(config);

  const q = {
    getData: db.prepare('SELECT value, updated_at FROM user_data WHERE user_id = ? AND key = ?'),
    putData: db.prepare(
      'INSERT INTO user_data (user_id, key, value, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
    ),
    connections: db.prepare('SELECT * FROM connections WHERE user_id = ? ORDER BY created_at'),
    connection: db.prepare('SELECT * FROM connections WHERE id = ? AND user_id = ?'),
    insertConnection: db.prepare('INSERT INTO connections (user_id, provider, label, config, created_at) VALUES (?, ?, ?, ?, ?)'),
    updateConnection: db.prepare('UPDATE connections SET label = ?, config = ? WHERE id = ? AND user_id = ?'),
    deleteConnection: db.prepare('DELETE FROM connections WHERE id = ? AND user_id = ?'),
    syncResult: db.prepare('UPDATE connections SET last_sync_at = ?, last_status = ?, last_message = ?, snapshot = COALESCE(?, snapshot) WHERE id = ?'),
  };

  const aad = (userId, connId) => `user:${userId}|connection:${connId ?? 'new'}`;
  const readConfig = (row) => decryptJson(masterKey, row.config, aad(row.user_id, row.id));

  function publicConnection(row) {
    const connector = getConnector(row.provider);
    let config = {};
    try {
      config = connector ? maskConfig(connector, readConfig(row)) : {};
    } catch {
      config = {};
    }
    return {
      id: row.id,
      provider: row.provider,
      providerName: connector?.name ?? row.provider,
      label: row.label,
      config,
      createdAt: row.created_at,
      lastSyncAt: row.last_sync_at,
      lastStatus: row.last_status,
      lastMessage: row.last_message,
      positionsCount: row.snapshot ? JSON.parse(row.snapshot).positions.length : null,
    };
  }

  // Fehler aus Connectors: nur bewusst formulierte Meldungen an den Nutzer weitergeben
  function connectorMessage(err) {
    if (err instanceof ConnectorError || err.userFacing) return err.message;
    if (err.name === 'TimeoutError' || err.name === 'AbortError') return 'Der Anbieter hat nicht rechtzeitig geantwortet.';
    console.error('[connector]', err);
    return 'Der Abruf ist fehlgeschlagen. Bitte später erneut versuchen.';
  }

  function sessionCookie(req, token, maxAgeMs) {
    const secure = config.cookieSecure === 'auto' ? isHttps(req, config.trustProxy) : config.cookieSecure === 'true' || config.cookieSecure === true;
    return serializeCookie(SESSION_COOKIE, token, { maxAge: maxAgeMs / 1000, secure });
  }

  // ---------- Routen ----------

  const routes = [];
  const route = (method, pattern, handler, { auth: needsAuth = true } = {}) => {
    const keys = [];
    const re = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)'))}$`);
    routes.push({ method, re, keys, handler, needsAuth });
  };

  // Auth
  route(
    'POST',
    '/api/auth/register',
    async (ctx) => {
      const body = await readJson(ctx.req);
      const { token, user } = await auth.register(body, ctx.meta);
      return { status: 201, body: { user }, headers: { 'Set-Cookie': sessionCookie(ctx.req, token, auth.maxMs) } };
    },
    { auth: false },
  );

  route(
    'POST',
    '/api/auth/login',
    async (ctx) => {
      const body = await readJson(ctx.req);
      const { token, user } = await auth.login(body, ctx.meta);
      return { body: { user }, headers: { 'Set-Cookie': sessionCookie(ctx.req, token, auth.maxMs) } };
    },
    { auth: false },
  );

  route(
    'GET',
    '/api/auth/config',
    async () => ({ body: { allowRegistration: config.allowRegistration, idleMinutes: config.sessionIdleMinutes, maxHours: config.sessionMaxHours } }),
    { auth: false },
  );

  route('GET', '/api/auth/me', async (ctx) => ({ body: { user: auth.publicUser(ctx.user), session: auth.sessionInfo(ctx.session) } }));

  route('POST', '/api/auth/logout', async (ctx) => {
    auth.logout(ctx.session.id, ctx.user.id, ctx.meta);
    return { status: 204, headers: { 'Set-Cookie': sessionCookie(ctx.req, '', 0) } };
  });

  route('GET', '/api/auth/sessions', async (ctx) => ({ body: { sessions: auth.listSessions(ctx.user.id, ctx.session.id) } }));

  route('DELETE', '/api/auth/sessions/:id', async (ctx) => {
    if (ctx.params.id === ctx.session.id) throw new HttpError(400, 'Die aktuelle Sitzung bitte über „Abmelden“ beenden.');
    auth.revokeSession(ctx.user.id, ctx.params.id, ctx.meta);
    return { status: 204 };
  });

  route('POST', '/api/auth/sessions/revoke-others', async (ctx) => ({
    body: { revoked: auth.revokeOtherSessions(ctx.user.id, ctx.session.id, ctx.meta) },
  }));

  route('POST', '/api/auth/password', async (ctx) => {
    await auth.changePassword(ctx.user.id, ctx.session.id, await readJson(ctx.req), ctx.meta);
    return { status: 204 };
  });

  route('GET', '/api/auth/activity', async (ctx) => ({ body: { activity: auth.activity(ctx.user.id) } }));

  route('POST', '/api/auth/delete-account', async (ctx) => {
    await auth.deleteAccount(ctx.user.id, await readJson(ctx.req));
    return { status: 204, headers: { 'Set-Cookie': sessionCookie(ctx.req, '', 0) } };
  });

  // Depots (als ein JSON-Dokument je Nutzer)
  route('GET', '/api/depots', async (ctx) => {
    const row = q.getData.get(ctx.user.id, 'depots');
    return { body: { depots: row ? JSON.parse(row.value) : null, updatedAt: row?.updated_at ?? null } };
  });

  route('PUT', '/api/depots', async (ctx) => {
    const { depots } = await readJson(ctx.req, MAX_DEPOTS_BYTES);
    if (!depots || typeof depots !== 'object' || !Array.isArray(depots.list) || depots.list.length > 50) {
      throw new HttpError(400, 'Ungültige Depotdaten.');
    }
    const t = now();
    q.putData.run(ctx.user.id, 'depots', JSON.stringify(depots), t);
    return { body: { updatedAt: t } };
  });

  // Persönliche Einstellungen (z. B. API-Schlüssel für Kursdaten) – verschlüsselt gespeichert
  route('GET', '/api/settings', async (ctx) => {
    const row = q.getData.get(ctx.user.id, 'settings');
    return { body: { settings: row ? decryptJson(masterKey, row.value, `user:${ctx.user.id}|settings`) : {} } };
  });

  route('PUT', '/api/settings', async (ctx) => {
    const { settings } = await readJson(ctx.req, 16 * 1024);
    const key = settings?.twelvedataKey;
    if (key !== undefined && (typeof key !== 'string' || key.length > 200)) throw new HttpError(400, 'Ungültiger API-Schlüssel.');
    const clean = { twelvedataKey: (key ?? '').trim() };
    q.putData.run(ctx.user.id, 'settings', encryptJson(masterKey, clean, `user:${ctx.user.id}|settings`), now());
    return { body: { settings: clean } };
  });

  // Schnittstellen
  route('GET', '/api/connectors', async () => ({ body: { connectors: listConnectors() } }));

  route('GET', '/api/connections', async (ctx) => ({ body: { connections: q.connections.all(ctx.user.id).map(publicConnection) } }));

  route('POST', '/api/connections', async (ctx) => {
    const body = await readJson(ctx.req);
    const connector = getConnector(body.provider);
    if (!connector) throw new HttpError(400, 'Unbekannter Anbieter.');
    if (q.connections.all(ctx.user.id).length >= 20) throw new HttpError(400, 'Maximal 20 Verbindungen pro Konto.');
    let cfg;
    try {
      cfg = validateConfig(connector, body.config);
    } catch (err) {
      throw new HttpError(400, err.message);
    }
    const label = String(body.label ?? '').trim().slice(0, 60) || connector.name;
    // Erst anlegen, dann mit der endgültigen ID als Kontext verschlüsseln
    const { lastInsertRowid } = q.insertConnection.run(ctx.user.id, connector.id, label, 'pending', now());
    const id = Number(lastInsertRowid);
    q.updateConnection.run(label, encryptJson(masterKey, cfg, aad(ctx.user.id, id)), id, ctx.user.id);
    auth.audit(ctx.user.id, 'connection_created', ctx.meta, connector.id);
    return { status: 201, body: { connection: publicConnection(q.connection.get(id, ctx.user.id)) } };
  });

  const ownConnection = (ctx) => {
    const row = q.connection.get(Number(ctx.params.id), ctx.user.id);
    if (!row) throw new HttpError(404, 'Verbindung nicht gefunden.');
    const connector = getConnector(row.provider);
    if (!connector) throw new HttpError(400, 'Anbieter nicht mehr verfügbar.');
    return { row, connector };
  };

  route('PUT', '/api/connections/:id', async (ctx) => {
    const { row, connector } = ownConnection(ctx);
    const body = await readJson(ctx.req);
    let cfg;
    try {
      cfg = validateConfig(connector, body.config ?? {}, readConfig(row));
    } catch (err) {
      throw new HttpError(400, err.message);
    }
    const label = String(body.label ?? row.label).trim().slice(0, 60) || row.label;
    q.updateConnection.run(label, encryptJson(masterKey, cfg, aad(ctx.user.id, row.id)), row.id, ctx.user.id);
    return { body: { connection: publicConnection(q.connection.get(row.id, ctx.user.id)) } };
  });

  route('DELETE', '/api/connections/:id', async (ctx) => {
    const { row } = ownConnection(ctx);
    q.deleteConnection.run(row.id, ctx.user.id);
    auth.audit(ctx.user.id, 'connection_deleted', ctx.meta, row.provider);
    return { status: 204 };
  });

  route('POST', '/api/connections/:id/test', async (ctx) => {
    const { row, connector } = ownConnection(ctx);
    try {
      const res = await connector.test(readConfig(row), { fetch: fetchImpl });
      return { body: { ok: true, message: res.message } };
    } catch (err) {
      return { body: { ok: false, message: connectorMessage(err) } };
    }
  });

  route('POST', '/api/connections/:id/sync', async (ctx) => {
    const { row, connector } = ownConnection(ctx);
    const body = connector.requiresUpload ? await readJson(ctx.req, MAX_UPLOAD_BYTES) : {};
    const upload = typeof body.upload === 'string' ? body.upload : null;
    try {
      const result = await runFetch(connector, readConfig(row), { fetch: fetchImpl, upload });
      const t = now();
      const message = `${result.positions.length} Positionen abgerufen` + (result.skipped.length ? `, ${result.skipped.length} übersprungen` : '');
      q.syncResult.run(t, 'ok', message, JSON.stringify({ positions: result.positions, fetchedAt: t }), row.id);
      auth.audit(ctx.user.id, 'connection_synced', ctx.meta, `${connector.id}: ${result.positions.length}`);
      return { body: { ...result, fetchedAt: t, connection: publicConnection(q.connection.get(row.id, ctx.user.id)) } };
    } catch (err) {
      const message = connectorMessage(err);
      q.syncResult.run(now(), 'error', message, null, row.id);
      throw new HttpError(502, message);
    }
  });

  // ---------- Verarbeitung ----------

  // Schutz vor Cross-Site-Requests: Zustandsändernde Anfragen müssen vom selben Ursprung kommen.
  function checkSameOrigin(req) {
    const origin = req.headers.origin;
    const site = req.headers['sec-fetch-site'];
    if (site && !['same-origin', 'none'].includes(site)) return false;
    if (origin) {
      const proto = isHttps(req, config.trustProxy) ? 'https' : 'http';
      const host = (config.trustProxy && req.headers['x-forwarded-host']) || req.headers.host;
      return origin === `${proto}://${host}`;
    }
    return true;
  }

  async function handleApi(req, res, url) {
    const match = routes.find((r) => r.method === req.method && r.re.test(url.pathname));
    if (!match) {
      const known = routes.some((r) => r.re.test(url.pathname));
      throw new HttpError(known ? 405 : 404, known ? 'Methode nicht erlaubt' : 'Nicht gefunden');
    }
    if (!['GET', 'HEAD'].includes(req.method) && !checkSameOrigin(req)) throw new HttpError(403, 'Anfrage von fremder Herkunft abgelehnt.');

    const meta = { ip: clientIp(req, config.trustProxy), userAgent: String(req.headers['user-agent'] ?? '') };
    const ctx = { req, meta, params: {} };
    const values = url.pathname.match(match.re).slice(1);
    try {
      match.keys.forEach((k, i) => (ctx.params[k] = decodeURIComponent(values[i])));
    } catch {
      throw new HttpError(400, 'Ungültige Adresse');
    }

    if (match.needsAuth) {
      const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
      const resolved = auth.resolve(token, meta);
      if (!resolved) {
        const headers = token ? { 'Set-Cookie': sessionCookie(req, '', 0) } : {};
        throw new HttpError(401, token ? 'Deine Sitzung ist abgelaufen. Bitte melde dich erneut an.' : 'Bitte melde dich an.', { headers });
      }
      ctx.user = resolved.user;
      ctx.session = resolved.session;
    }

    const out = await match.handler(ctx);
    if (out.status === 204) {
      res.writeHead(204, { 'Cache-Control': 'no-store', ...(out.headers ?? {}) });
      res.end();
    } else sendJson(res, out.status ?? 200, out.body, out.headers);
  }

  async function handleStatic(req, res, url) {
    if (!['GET', 'HEAD'].includes(req.method)) throw new HttpError(405, 'Methode nicht erlaubt');
    let path;
    try {
      path = decodeURIComponent(url.pathname);
    } catch {
      throw new HttpError(404, 'Nicht gefunden');
    }
    if (path === '/' || path === '/index.html') path = '/index.html';
    else if (!STATIC_PREFIXES.some((p) => path.startsWith(p)) || path.includes('..') || path.includes('\0')) {
      throw new HttpError(404, 'Nicht gefunden');
    }
    const file = normalize(join(config.root, path));
    if (!file.startsWith(config.root)) throw new HttpError(404, 'Nicht gefunden');
    let body;
    try {
      body = await readFile(file);
    } catch {
      throw new HttpError(404, 'Nicht gefunden');
    }
    res.writeHead(200, {
      'Content-Type': STATIC_TYPES[extname(file)] ?? 'application/octet-stream',
      'Cache-Control': path === '/index.html' ? 'no-cache' : 'public, max-age=300',
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  }

  const server = createServer(async (req, res) => {
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
    if (isHttps(req, config.trustProxy)) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname.startsWith('/api/')) await handleApi(req, res, url);
      else await handleStatic(req, res, url);
    } catch (err) {
      if (res.headersSent) return res.end();
      if (err instanceof HttpError) {
        const headers = { ...(err.extra.headers ?? {}) };
        if (err.extra.retryAfter) headers['Retry-After'] = String(err.extra.retryAfter);
        if (url.pathname.startsWith('/api/')) sendJson(res, err.status, { error: err.message }, headers);
        else {
          res.writeHead(err.status, { 'Content-Type': 'text/plain; charset=utf-8', ...headers });
          res.end(err.message);
        }
      } else {
        console.error(err);
        sendJson(res, 500, { error: 'Interner Fehler' });
      }
    }
  });

  // Abgelaufene Sitzungen regelmäßig aufräumen
  const purgeTimer = setInterval(() => auth.purgeExpired(), 10 * 60_000);
  purgeTimer.unref();
  server.on('close', () => {
    clearInterval(purgeTimer);
    db.close();
  });

  return { server, db, auth };
}
