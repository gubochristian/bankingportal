// Kryptografische Bausteine: Passwort-Hashing, Sitzungstokens, Verschlüsselung von Zugangsdaten.

import { scrypt, randomBytes, timingSafeEqual, createHash, createCipheriv, createDecipheriv, hkdfSync } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

// ---------- Passwörter (scrypt) ----------

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

function scryptAsync(password, salt, { N, r, p, keylen }) {
  return new Promise((resolve, reject) =>
    scrypt(password, salt, keylen, { N, r, p, maxmem: 64 * 1024 * 1024 }, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

// Format: scrypt$N$r$p$salt$hash (Base64)
export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scryptAsync(password.normalize('NFKC'), salt, SCRYPT);
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(password, stored) {
  const parts = String(stored).split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, saltB64, hashB64] = parts;
  const expected = Buffer.from(hashB64, 'base64');
  const key = await scryptAsync(password.normalize('NFKC'), Buffer.from(saltB64, 'base64'), {
    N: Number(N),
    r: Number(r),
    p: Number(p),
    keylen: expected.length,
  });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

// Für unbekannte E-Mail-Adressen trotzdem einen Hash prüfen, damit die Antwortzeit
// nicht verrät, ob ein Konto existiert.
let dummyHash = null;
export async function dummyVerify(password) {
  dummyHash ??= await hashPassword('dummy-password-for-timing');
  await verifyPassword(password, dummyHash);
  return false;
}

// ---------- Tokens ----------

export const newToken = () => randomBytes(32).toString('base64url');
export const sha256 = (value) => createHash('sha256').update(value).digest('hex');

// ---------- Verschlüsselung (AES-256-GCM) ----------

export function loadMasterKey({ appSecret, dataDir }) {
  if (appSecret) return hkdfSync('sha256', Buffer.from(appSecret), Buffer.from('aktienanalyse'), Buffer.from('connection-config'), 32);
  mkdirSync(dataDir, { recursive: true });
  const file = join(dataDir, 'secret.key');
  if (!existsSync(file)) writeFileSync(file, randomBytes(32).toString('base64'), { mode: 0o600 });
  const key = Buffer.from(readFileSync(file, 'utf8').trim(), 'base64');
  if (key.length !== 32) throw new Error(`${file} enthält keinen gültigen 256-Bit-Schlüssel`);
  return Buffer.from(key);
}

// Verschlüsselt ein Objekt. `aad` bindet den Geheimtext an einen Kontext (z. B. Nutzer-ID),
// sodass er nicht in einen anderen Datensatz kopiert werden kann.
export function encryptJson(key, value, aad) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aad));
  const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return `v1:${Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64')}`;
}

export function decryptJson(key, payload, aad) {
  if (!String(payload).startsWith('v1:')) throw new Error('Unbekanntes Verschlüsselungsformat');
  const raw = Buffer.from(payload.slice(3), 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(raw.subarray(12, 28));
  return JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8'));
}
