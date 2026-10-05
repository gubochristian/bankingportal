// Anmelde- und Registrierungsmaske.

import { api } from './api.js';
import { $ } from './util.js';

const minutes = (n) => (n === 1 ? '1 Minute' : `${n} Minuten`);

let config = null;

// Zeigt die Anmeldemaske und löst auf, sobald die Anmeldung erfolgreich war.
export async function showLogin({ message = '', email = '' } = {}) {
  config ??= await api.get('/api/auth/config').catch(() => ({ allowRegistration: true, idleMinutes: 30 }));
  const view = $('#auth-view');
  document.body.dataset.auth = 'out';
  view.hidden = false;
  $('#auth-register-tab').hidden = !config.allowRegistration;
  $('#auth-session-note').textContent = `Aus Sicherheitsgründen wirst du nach ${minutes(config.idleMinutes)} Inaktivität automatisch abgemeldet.`;
  setMode('login');
  showError(message, message ? 'info' : 'error');
  if (email) $('#login-email').value = email;
  (email ? $('#login-password') : $('#login-email')).focus();

  return new Promise((resolve) => {
    const finish = (user) => {
      $('#login-form').removeEventListener('submit', onLogin);
      $('#register-form').removeEventListener('submit', onRegister);
      $('#login-password').value = '';
      $('#register-password').value = '';
      $('#register-password2').value = '';
      view.hidden = true;
      document.body.dataset.auth = 'in';
      resolve(user);
    };

    async function onLogin(e) {
      e.preventDefault();
      await submit(e.submitter ?? $('#login-form button[type=submit]'), async () => {
        const { user } = await api.post('/api/auth/login', {
          email: $('#login-email').value,
          password: $('#login-password').value,
        });
        finish(user);
      });
    }

    async function onRegister(e) {
      e.preventDefault();
      if ($('#register-password').value !== $('#register-password2').value) {
        showError('Die Passwörter stimmen nicht überein.');
        return;
      }
      await submit(e.submitter ?? $('#register-form button[type=submit]'), async () => {
        const { user } = await api.post('/api/auth/register', {
          name: $('#register-name').value,
          email: $('#register-email').value,
          password: $('#register-password').value,
        });
        finish(user);
      });
    }

    $('#login-form').addEventListener('submit', onLogin);
    $('#register-form').addEventListener('submit', onRegister);
  });
}

async function submit(button, fn) {
  button.disabled = true;
  showError('');
  try {
    await fn();
  } catch (err) {
    showError(err.message);
  } finally {
    button.disabled = false;
  }
}

function showError(text, kind = 'error') {
  const el = $('#auth-message');
  el.textContent = text;
  el.className = `message ${kind === 'info' ? 'info' : ''}`;
  el.hidden = !text;
}

function setMode(mode) {
  document.querySelectorAll('#auth-tabs button').forEach((b) => {
    const active = b.dataset.mode === mode;
    b.classList.toggle('active', active);
    b.setAttribute('aria-selected', active);
  });
  $('#login-form').hidden = mode !== 'login';
  $('#register-form').hidden = mode !== 'register';
}

document.querySelectorAll('#auth-tabs button').forEach((b) =>
  b.addEventListener('click', () => {
    setMode(b.dataset.mode);
    showError('');
    (b.dataset.mode === 'login' ? $('#login-email') : $('#register-name')).focus();
  }),
);
