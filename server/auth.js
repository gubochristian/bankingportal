// Anmeldung und Sitzungsverwaltung.
//
// - Passwörter: scrypt mit zufälligem Salt
// - Sitzungen: zufälliges 256-Bit-Token im HttpOnly-Cookie (SameSite=Strict); in der
//   Datenbank liegt nur dessen SHA-256-Hash
// - Ablauf: nach Inaktivität (Standard 30 min) und spätestens nach einer festen
//   Höchstdauer (Standard 12 h)
// - Nach Login wird immer eine neue Sitzung erzeugt (Schutz vor Session Fixation)
// - Brute-Force-Schutz: Sperre nach mehreren Fehlversuchen je E-Mail und je IP

import { hashPassword, verifyPassword, dummyVerify, newToken, sha256 } from './security.js';
import { HttpError } from './http.js';

export const SESSION_COOKIE = 'sid';
const TOUCH_INTERVAL = 60_000; // last_seen_at höchstens einmal pro Minute schreiben

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;
const COMMON_PASSWORDS = new Set(['passwort123', 'password123', '1234567890', 'qwertzuiop', 'qwertyuiop', 'hallo12345', 'passwort1234', 'abcdefghij']);

export function validatePassword(password, email = '') {
  if (typeof password !== 'string' || password.length < 10) return 'Das Passwort muss mindestens 10 Zeichen lang sein.';
  if (password.length > 200) return 'Das Passwort darf höchstens 200 Zeichen lang sein.';
  if (COMMON_PASSWORDS.has(password.toLowerCase())) return 'Dieses Passwort ist zu leicht zu erraten.';
  if (email && password.toLowerCase().includes(email.split('@')[0].toLowerCase()) && email.split('@')[0].length >= 4) {
    return 'Das Passwort darf die E-Mail-Adresse nicht enthalten.';
  }
  if (new Set(password).size < 5) return 'Das Passwort ist zu gleichförmig.';
  return null;
}

// Zählt Fehlversuche in einem Zeitfenster und sperrt danach vorübergehend.
export class RateLimiter {
  constructor({ max, windowMs, now = Date.now }) {
    this.max = max;
    this.windowMs = windowMs;
    this.now = now;
    this.entries = new Map();
  }

  retryAfter(key) {
    const e = this.entries.get(key);
    if (!e) return 0;
    const t = this.now();
    if (e.lockedUntil > t) return Math.ceil((e.lockedUntil - t) / 1000);
    if (t - e.first > this.windowMs) this.entries.delete(key);
    return 0;
  }

  fail(key) {
    const t = this.now();
    let e = this.entries.get(key);
    if (!e || t - e.first > this.windowMs) e = { count: 0, first: t, lockedUntil: 0 };
    e.count++;
    if (e.count >= this.max) e.lockedUntil = t + this.windowMs;
    this.entries.set(key, e);
  }

  reset(key) {
    this.entries.delete(key);
  }

  // Abgelaufene Einträge entfernen, damit der Speicher nicht unbegrenzt wächst
  prune() {
    const t = this.now();
    for (const [key, e] of this.entries) {
      if (e.lockedUntil <= t && t - e.first > this.windowMs) this.entries.delete(key);
    }
  }
}

const publicUser = (u) => ({ id: u.id, email: u.email, name: u.name, createdAt: u.created_at });

export function createAuth(db, config, { now = Date.now } = {}) {
  const idleMs = config.sessionIdleMinutes * 60_000;
  const maxMs = config.sessionMaxHours * 3_600_000;
  const limiter = new RateLimiter({ max: config.loginMaxAttempts, windowMs: config.loginLockMinutes * 60_000, now });
  // Registrierungen je IP begrenzen (Schutz vor Massenanlage und Abfragen, ob ein Konto existiert)
  const registrations = new RateLimiter({ max: 10, windowMs: 60 * 60_000, now });

  const q = {
    userByEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
    userById: db.prepare('SELECT * FROM users WHERE id = ?'),
    insertUser: db.prepare('INSERT INTO users (email, name, password_hash, created_at, password_changed_at) VALUES (?, ?, ?, ?, ?)'),
    updatePassword: db.prepare('UPDATE users SET password_hash = ?, password_changed_at = ? WHERE id = ?'),
    deleteUser: db.prepare('DELETE FROM users WHERE id = ?'),
    insertSession: db.prepare('INSERT INTO sessions (id, user_id, created_at, last_seen_at, user_agent, ip) VALUES (?, ?, ?, ?, ?, ?)'),
    sessionById: db.prepare('SELECT * FROM sessions WHERE id = ?'),
    touchSession: db.prepare('UPDATE sessions SET last_seen_at = ?, ip = ? WHERE id = ?'),
    deleteSession: db.prepare('DELETE FROM sessions WHERE id = ?'),
    deleteUserSession: db.prepare('DELETE FROM sessions WHERE id = ? AND user_id = ?'),
    deleteOtherSessions: db.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?'),
    sessionsByUser: db.prepare('SELECT * FROM sessions WHERE user_id = ? ORDER BY last_seen_at DESC'),
    purgeExpired: db.prepare('DELETE FROM sessions WHERE last_seen_at < ? OR created_at < ?'),
    audit: db.prepare('INSERT INTO audit_log (user_id, event, ip, user_agent, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)'),
    activity: db.prepare('SELECT event, ip, user_agent, detail, created_at FROM audit_log WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?'),
  };

  function audit(userId, event, meta = {}, detail = null) {
    q.audit.run(userId ?? null, event, meta.ip ?? null, (meta.userAgent ?? '').slice(0, 300) || null, detail, now());
  }

  function createSession(userId, meta) {
    const token = newToken();
    const t = now();
    q.insertSession.run(sha256(token), userId, t, t, (meta.userAgent ?? '').slice(0, 300), meta.ip ?? null);
    return token;
  }

  function sessionInfo(s) {
    return { expiresAt: Math.min(s.last_seen_at + idleMs, s.created_at + maxMs), idleTimeoutMs: idleMs, maxAgeMs: maxMs };
  }

  return {
    idleMs,
    maxMs,
    publicUser,
    sessionInfo,
    audit,

    async register({ email, password, name }, meta) {
      if (!config.allowRegistration) throw new HttpError(403, 'Die Registrierung ist deaktiviert.');
      const wait = registrations.retryAfter(`ip:${meta.ip}`);
      if (wait > 0) throw new HttpError(429, 'Zu viele Registrierungen von dieser Adresse. Bitte später erneut versuchen.', { retryAfter: wait });
      registrations.fail(`ip:${meta.ip}`);
      email = String(email ?? '').trim().toLowerCase();
      name = String(name ?? '').trim().slice(0, 80) || null;
      if (!EMAIL_RE.test(email) || email.length > 254) throw new HttpError(400, 'Bitte eine gültige E-Mail-Adresse angeben.');
      const problem = validatePassword(password, email);
      if (problem) throw new HttpError(400, problem);
      if (q.userByEmail.get(email)) throw new HttpError(409, 'Für diese E-Mail-Adresse existiert bereits ein Konto.');
      const hash = await hashPassword(password);
      const t = now();
      const { lastInsertRowid } = q.insertUser.run(email, name, hash, t, t);
      const userId = Number(lastInsertRowid);
      audit(userId, 'register', meta);
      audit(userId, 'login', meta);
      return { token: createSession(userId, meta), user: publicUser(q.userById.get(userId)) };
    },

    async login({ email, password }, meta) {
      email = String(email ?? '').trim().toLowerCase();
      password = String(password ?? '');
      const keys = [`email:${email}`, `ip:${meta.ip}`];
      const wait = Math.max(...keys.map((k) => limiter.retryAfter(k)));
      if (wait > 0) {
        throw new HttpError(429, `Zu viele Fehlversuche. Bitte in ${Math.ceil(wait / 60)} Minute(n) erneut versuchen.`, { retryAfter: wait });
      }
      const user = email ? q.userByEmail.get(email) : null;
      const ok = user ? await verifyPassword(password, user.password_hash) : await dummyVerify(password);
      if (!ok) {
        keys.forEach((k) => limiter.fail(k));
        if (user) audit(user.id, 'login_failed', meta);
        // bewusst gleiche Meldung für unbekannte E-Mail und falsches Passwort
        throw new HttpError(401, 'E-Mail-Adresse oder Passwort ist falsch.');
      }
      limiter.reset(`email:${email}`);
      audit(user.id, 'login', meta);
      return { token: createSession(user.id, meta), user: publicUser(user) };
    },

    // Prüft das Token aus dem Cookie; verlängert die Sitzung bei Aktivität (gleitender Ablauf).
    resolve(token, meta = {}) {
      if (!token || typeof token !== 'string' || token.length > 100) return null;
      const id = sha256(token);
      const s = q.sessionById.get(id);
      if (!s) return null;
      const t = now();
      if (t - s.last_seen_at > idleMs || t - s.created_at > maxMs) {
        q.deleteSession.run(id);
        return null;
      }
      const user = q.userById.get(s.user_id);
      if (!user) return null;
      if (t - s.last_seen_at > TOUCH_INTERVAL) {
        q.touchSession.run(t, meta.ip ?? s.ip, id);
        s.last_seen_at = t;
      }
      return { session: s, user };
    },

    logout(sessionId, userId, meta) {
      q.deleteSession.run(sessionId);
      audit(userId, 'logout', meta);
    },

    listSessions(userId, currentId) {
      return q.sessionsByUser.all(userId).map((s) => ({
        id: s.id,
        current: s.id === currentId,
        createdAt: s.created_at,
        lastSeenAt: s.last_seen_at,
        userAgent: s.user_agent,
        ip: s.ip,
      }));
    },

    revokeSession(userId, sessionId, meta) {
      const { changes } = q.deleteUserSession.run(sessionId, userId);
      if (!changes) throw new HttpError(404, 'Sitzung nicht gefunden.');
      audit(userId, 'session_revoked', meta);
    },

    revokeOtherSessions(userId, currentId, meta) {
      const { changes } = q.deleteOtherSessions.run(userId, currentId);
      audit(userId, 'sessions_revoked', meta, String(changes));
      return Number(changes);
    },

    async changePassword(userId, currentId, { currentPassword, newPassword }, meta) {
      const user = q.userById.get(userId);
      if (!(await verifyPassword(String(currentPassword ?? ''), user.password_hash))) {
        throw new HttpError(400, 'Das aktuelle Passwort ist falsch.');
      }
      const problem = validatePassword(newPassword, user.email);
      if (problem) throw new HttpError(400, problem);
      q.updatePassword.run(await hashPassword(newPassword), now(), userId);
      // Alle anderen Sitzungen beenden – falls das alte Passwort kompromittiert war
      q.deleteOtherSessions.run(userId, currentId);
      audit(userId, 'password_changed', meta);
    },

    async deleteAccount(userId, { password }) {
      const user = q.userById.get(userId);
      if (!(await verifyPassword(String(password ?? ''), user.password_hash))) {
        throw new HttpError(400, 'Das Passwort ist falsch.');
      }
      q.deleteUser.run(userId); // Sitzungen, Daten und Verbindungen werden per CASCADE gelöscht
    },

    activity(userId, limit = 20) {
      return q.activity.all(userId, limit).map((a) => ({ event: a.event, ip: a.ip, userAgent: a.user_agent, detail: a.detail, at: a.created_at }));
    },

    purgeExpired() {
      const t = now();
      q.purgeExpired.run(t - idleMs, t - maxMs);
      limiter.prune();
      registrations.prune();
    },
  };
}
