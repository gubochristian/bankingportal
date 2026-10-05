// Sitzungsüberwachung im Browser:
// - hält die Sitzung bei echter Nutzeraktivität am Leben (Server-Ping höchstens jede Minute)
// - warnt zwei Minuten vor dem automatischen Abmelden
// - meldet ab, sobald die Sitzung abgelaufen ist

import { api } from './api.js';
import { $ } from './util.js';

const PING_INTERVAL = 60_000;
const WARN_BEFORE = 2 * 60_000;

export function startSessionWatch({ expiresAt, onExpired }) {
  let expires = expiresAt;
  let lastActivity = Date.now();
  let lastPing = Date.now();
  let pinging = false;
  let stopped = false;

  const banner = $('#session-warning');
  const countdown = $('#session-countdown');

  async function ping() {
    if (pinging || stopped) return;
    pinging = true;
    try {
      const me = await api.get('/api/auth/me');
      expires = me.session.expiresAt;
      lastPing = Date.now();
    } catch {
      // 401 wird über sessionEvents behandelt
    } finally {
      pinging = false;
    }
  }

  const onActivity = () => {
    lastActivity = Date.now();
  };
  for (const evt of ['pointerdown', 'keydown', 'wheel', 'touchstart']) window.addEventListener(evt, onActivity, { passive: true });

  $('#session-extend').addEventListener('click', () => {
    lastActivity = Date.now();
    ping();
  });

  const timer = setInterval(() => {
    if (stopped) return;
    const now = Date.now();
    // Aktiv gewesen seit dem letzten Ping → Sitzung serverseitig verlängern
    if (lastActivity > lastPing && now - lastPing > PING_INTERVAL) ping();
    const left = expires - now;
    if (left <= 0) {
      stop();
      onExpired('Du wurdest aus Sicherheitsgründen automatisch abgemeldet.');
      return;
    }
    banner.hidden = left > WARN_BEFORE;
    if (!banner.hidden) {
      const s = Math.ceil(left / 1000);
      countdown.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    }
  }, 1000);

  function stop() {
    stopped = true;
    clearInterval(timer);
    banner.hidden = true;
  }

  return {
    stop,
    update(newExpires) {
      expires = newExpires;
      lastPing = Date.now();
    },
  };
}
