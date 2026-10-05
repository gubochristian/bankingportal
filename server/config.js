// Laufzeit-Konfiguration aus Umgebungsvariablen (mit sicheren Voreinstellungen).

import { resolve } from 'node:path';

const bool = (v, fallback) => (v === undefined ? fallback : ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase()));
const int = (v, fallback) => (Number.isFinite(Number(v)) && v !== '' && v !== undefined ? Number(v) : fallback);

export function loadConfig(env = process.env, overrides = {}) {
  const root = resolve(import.meta.dirname, '..');
  return {
    root,
    port: int(env.PORT, 8080),
    host: env.HOST ?? '127.0.0.1',
    dataDir: resolve(env.DATA_DIR ?? resolve(root, 'data')),
    // Geheimnis zur Verschlüsselung gespeicherter Zugangsdaten. Ohne Angabe wird
    // beim ersten Start ein Schlüssel in DATA_DIR/secret.key erzeugt.
    appSecret: env.APP_SECRET ?? null,
    // 'auto' = Secure-Cookie, sobald die Anfrage per HTTPS kommt (auch hinter Proxy mit TRUST_PROXY)
    cookieSecure: env.COOKIE_SECURE ?? 'auto',
    trustProxy: bool(env.TRUST_PROXY, false),
    sessionIdleMinutes: int(env.SESSION_IDLE_MINUTES, 30),
    sessionMaxHours: int(env.SESSION_MAX_HOURS, 12),
    allowRegistration: bool(env.ALLOW_REGISTRATION, true),
    // Fehlversuche pro E-Mail bzw. IP, bevor der Login vorübergehend gesperrt wird
    loginMaxAttempts: int(env.LOGIN_MAX_ATTEMPTS, 5),
    loginLockMinutes: int(env.LOGIN_LOCK_MINUTES, 15),
    ...overrides,
  };
}
