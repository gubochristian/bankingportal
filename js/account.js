// Ansicht „Mein Konto“: Profil, aktive Sitzungen, Passwort ändern, Aktivitäten, Konto löschen.

import { api } from './api.js';
import { $ } from './util.js';

const minutes = (n) => (n === 1 ? '1 Minute' : `${n} Minuten`);

const dateTime = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
const fmt = (ts) => dateTime.format(new Date(ts));

const EVENT_LABEL = {
  register: 'Konto erstellt',
  login: 'Anmeldung',
  login_failed: 'Fehlgeschlagene Anmeldung',
  logout: 'Abmeldung',
  password_changed: 'Passwort geändert',
  session_revoked: 'Sitzung beendet',
  sessions_revoked: 'Andere Sitzungen beendet',
  connection_created: 'Bankverbindung eingerichtet',
  connection_deleted: 'Bankverbindung entfernt',
  connection_synced: 'Depotdaten abgerufen',
};

// Grobe, lesbare Gerätebeschreibung aus dem User-Agent
export function describeDevice(ua = '') {
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : null;
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : null;
  if (!browser && !os) return ua ? ua.slice(0, 40) : 'Unbekanntes Gerät';
  return [browser, os].filter(Boolean).join(' auf ');
}

export function initAccount({ getUser, onLoggedOut }) {
  function showMessage(text, kind = 'error') {
    const el = $('#account-message');
    el.textContent = text;
    el.className = `message ${kind === 'info' ? 'info' : ''}`;
    el.hidden = !text;
  }

  function renderProfile(me, config) {
    const user = getUser();
    const rows = [
      ['E-Mail-Adresse', user.email],
      ['Name', user.name || '–'],
      ['Mitglied seit', fmt(user.createdAt)],
      ['Aktuelle Sitzung gültig bis', `${fmt(me.session.expiresAt)} (verlängert sich bei Aktivität)`],
    ];
    $('#profile').replaceChildren(
      ...rows.map(([k, v]) => {
        const div = document.createElement('div');
        div.append(Object.assign(document.createElement('dt'), { textContent: k }), Object.assign(document.createElement('dd'), { textContent: v }));
        return div;
      }),
    );
    $('#password-username').value = user.email;
    $('#session-policy').textContent = `Automatische Abmeldung nach ${minutes(config.idleMinutes)} Inaktivität, spätestens nach ${config.maxHours === 1 ? '1 Stunde' : `${config.maxHours} Stunden`}.`;
  }

  function renderSessions(sessions) {
    const table = $('#sessions-table');
    table.innerHTML = '<thead><tr><th>Gerät</th><th>IP-Adresse</th><th>Angemeldet</th><th>Zuletzt aktiv</th><th><span class="sr-only">Aktion</span></th></tr></thead><tbody></tbody>';
    table.tBodies[0].append(
      ...sessions.map((s) => {
        const tr = document.createElement('tr');
        const device = document.createElement('td');
        device.textContent = describeDevice(s.userAgent);
        if (s.current) device.append(' ', Object.assign(document.createElement('span'), { className: 'badge status-ok', textContent: 'Diese Sitzung' }));
        tr.append(
          device,
          Object.assign(document.createElement('td'), { textContent: s.ip ?? '–' }),
          Object.assign(document.createElement('td'), { textContent: fmt(s.createdAt) }),
          Object.assign(document.createElement('td'), { textContent: fmt(s.lastSeenAt) }),
        );
        const action = document.createElement('td');
        if (!s.current) {
          const btn = Object.assign(document.createElement('button'), { type: 'button', className: 'btn small', textContent: 'Beenden' });
          btn.addEventListener('click', async () => {
            try {
              await api.del(`/api/auth/sessions/${encodeURIComponent(s.id)}`);
              showMessage('Sitzung beendet.', 'info');
              load();
            } catch (err) {
              showMessage(err.message);
            }
          });
          action.append(btn);
        }
        tr.append(action);
        return tr;
      }),
    );
    $('#revoke-others').disabled = sessions.length < 2;
  }

  function renderActivity(activity) {
    $('#activity').replaceChildren(
      ...activity.map((a) => {
        const li = document.createElement('li');
        li.className = a.event === 'login_failed' ? 'warn' : '';
        li.append(
          Object.assign(document.createElement('strong'), { textContent: EVENT_LABEL[a.event] ?? a.event }),
          Object.assign(document.createElement('span'), { className: 'muted small', textContent: `${fmt(a.at)} · ${describeDevice(a.userAgent)}${a.ip ? ` · ${a.ip}` : ''}` }),
        );
        return li;
      }),
    );
  }

  async function load() {
    try {
      const [me, config, { sessions }, { activity }] = await Promise.all([
        api.get('/api/auth/me'),
        api.get('/api/auth/config'),
        api.get('/api/auth/sessions'),
        api.get('/api/auth/activity'),
      ]);
      renderProfile(me, config);
      renderSessions(sessions);
      renderActivity(activity);
    } catch (err) {
      if (err.status !== 401) showMessage(err.message);
    }
  }

  $('#revoke-others').addEventListener('click', async () => {
    if (!confirm('Alle anderen Sitzungen beenden? Andere Geräte werden sofort abgemeldet.')) return;
    try {
      const { revoked } = await api.post('/api/auth/sessions/revoke-others');
      showMessage(`${revoked} Sitzung(en) beendet.`, 'info');
      load();
    } catch (err) {
      showMessage(err.message);
    }
  });

  $('#password-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if ($('#pw-new').value !== $('#pw-new2').value) {
      showMessage('Die neuen Passwörter stimmen nicht überein.');
      return;
    }
    try {
      await api.post('/api/auth/password', { currentPassword: $('#pw-current').value, newPassword: $('#pw-new').value });
      e.target.reset();
      showMessage('Passwort geändert. Alle anderen Sitzungen wurden beendet.', 'info');
      load();
    } catch (err) {
      showMessage(err.message);
    }
  });

  $('#delete-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!confirm('Konto wirklich endgültig löschen? Alle Depots und Bankverbindungen gehen verloren.')) return;
    try {
      await api.post('/api/auth/delete-account', { password: $('#delete-password').value });
      onLoggedOut();
    } catch (err) {
      showMessage(err.message);
    }
  });

  return {
    show() {
      showMessage('');
      load();
    },
  };
}
