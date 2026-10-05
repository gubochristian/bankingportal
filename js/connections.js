// Ansicht „Schnittstellen“: Anbieter auswählen, Verbindungen konfigurieren, testen und abrufen.
// Zugangsdaten gehen nur an den eigenen Server; dort werden sie verschlüsselt gespeichert.

import { api } from './api.js';
import { $ } from './util.js';

const STATUS_LABEL = { available: 'Verfügbar', beta: 'Beta', planned: 'In Vorbereitung' };
const dateTime = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' });

export function initConnections({ depot }) {
  const state = { connectors: [], connections: [], loaded: false, editing: null };
  const connectorById = (id) => state.connectors.find((c) => c.id === id);

  function showMessage(text, kind = 'error') {
    const el = $('#connections-message');
    el.textContent = '';
    el.className = `message ${kind === 'info' ? 'info' : ''}`;
    if (text instanceof Node) el.append(text);
    else el.textContent = text;
    el.hidden = !text;
  }

  async function load() {
    try {
      const [{ connectors }, { connections }] = await Promise.all([api.get('/api/connectors'), api.get('/api/connections')]);
      state.connectors = connectors;
      state.connections = connections;
      state.loaded = true;
      render();
    } catch (err) {
      if (err.status !== 401) showMessage(err.message);
    }
  }

  // ---------- Darstellung ----------

  function el(tag, props = {}, ...children) {
    const node = Object.assign(document.createElement(tag), props);
    node.append(...children.filter((c) => c !== null && c !== undefined && c !== false));
    return node;
  }

  function render() {
    renderConnections();
    renderProviders();
  }

  function renderConnections() {
    const list = $('#connection-list');
    $('#connections-empty').hidden = state.connections.length > 0;
    list.replaceChildren(
      ...state.connections.map((c) => {
        const connector = connectorById(c.provider);
        const linked = depot.findLinkedDepot(c.id);
        const status = c.lastStatus === 'ok' ? 'ok' : c.lastStatus === 'error' ? 'error' : 'none';
        const statusText =
          status === 'none'
            ? 'Noch nicht abgerufen'
            : `${status === 'ok' ? '✓' : '✕'} ${c.lastMessage ?? ''} · ${dateTime.format(new Date(c.lastSyncAt))}`;

        const syncBtn = el('button', { type: 'button', className: 'btn small primary', textContent: connector?.requiresUpload ? 'Datei hochladen & abrufen' : 'Jetzt abrufen' });
        syncBtn.addEventListener('click', () => sync(c, syncBtn));
        const testBtn = el('button', { type: 'button', className: 'btn small', textContent: 'Verbindung testen' });
        testBtn.addEventListener('click', () => testConnection(c, testBtn));
        const editBtn = el('button', { type: 'button', className: 'btn small', textContent: 'Bearbeiten' });
        editBtn.addEventListener('click', () => openDialog(connector, c));
        const delBtn = el('button', { type: 'button', className: 'btn small', textContent: 'Entfernen' });
        delBtn.addEventListener('click', () => remove(c));

        let depotLink = null;
        if (linked) {
          depotLink = el('a', { href: '#depot', className: 'small', textContent: `→ Depot „${linked.name}“ öffnen` });
          depotLink.addEventListener('click', (e) => {
            e.preventDefault();
            depot.openDepot(linked.id);
          });
        }

        return el(
          'article',
          { className: `connection ${status}` },
          el(
            'div',
            { className: 'connection-head' },
            el('div', {}, el('strong', { textContent: c.label }), el('div', { className: 'muted small', textContent: c.providerName })),
            el('span', { className: `badge status-${status}`, textContent: status === 'ok' ? 'Aktuell' : status === 'error' ? 'Fehler' : 'Neu' }),
          ),
          el('p', { className: `small connection-status ${status}`, textContent: statusText }),
          depotLink,
          el('div', { className: 'connection-actions' }, syncBtn, connector?.requiresUpload ? null : testBtn, connector?.fields.length ? editBtn : null, delBtn),
        );
      }),
    );
  }

  function renderProviders() {
    $('#provider-grid').replaceChildren(
      ...state.connectors.map((c) => {
        const btn = el('button', {
          type: 'button',
          className: `btn small ${c.status === 'planned' ? '' : 'primary'}`,
          textContent: c.status === 'planned' ? 'In Vorbereitung' : 'Verbinden',
          disabled: c.status === 'planned',
        });
        btn.addEventListener('click', () => openDialog(c));
        return el(
          'article',
          { className: `provider ${c.status}` },
          el('div', { className: 'provider-head' }, el('strong', { textContent: c.name }), el('span', { className: `badge provider-${c.status}`, textContent: STATUS_LABEL[c.status] })),
          el('div', { className: 'muted small', textContent: c.category }),
          el('p', { className: 'small', textContent: c.description }),
          c.notes ? el('p', { className: 'muted small provider-notes', textContent: c.notes }) : null,
          el('div', { className: 'provider-actions' }, btn),
        );
      }),
    );
  }

  // ---------- Dialog: Verbindung anlegen / bearbeiten ----------

  const dialog = $('#connection-dialog');

  function openDialog(connector, existing = null) {
    if (!connector) return;
    state.editing = { connector, existing };
    $('#connection-dialog-title').textContent = existing ? `${existing.label} bearbeiten` : `${connector.name} verbinden`;
    $('#connection-dialog-desc').textContent = connector.description;
    $('#connection-label').value = existing?.label ?? connector.name;
    $('#connection-dialog-error').hidden = true;
    $('#connection-fields').replaceChildren(
      ...connector.fields.map((f) => {
        let input;
        if (f.type === 'select') {
          input = el('select');
          for (const o of f.options) input.add(new Option(o.label, o.value, false, existing ? existing.config[f.key] === o.value : false));
        } else {
          input = el('input', { type: f.type === 'password' ? 'password' : 'text', maxLength: 500, autocomplete: 'off' });
          if (f.secret && existing?.config[f.key]) input.placeholder = `${existing.config[f.key]} (leer lassen = unverändert)`;
          else {
            input.placeholder = f.placeholder ?? '';
            if (existing && !f.secret) input.value = existing.config[f.key] ?? '';
          }
          input.required = f.required && !(f.secret && existing?.config[f.key]);
        }
        input.dataset.key = f.key;
        return el('label', { className: 'field' }, el('span', { textContent: f.label + (f.required ? '' : ' (optional)') }), input, f.help ? el('small', { className: 'muted', textContent: f.help }) : null);
      }),
    );
    dialog.showModal();
  }

  $('#connection-form').addEventListener('submit', async (e) => {
    if (e.submitter?.value !== 'save') return;
    e.preventDefault();
    const { connector, existing } = state.editing;
    const config = {};
    $('#connection-fields').querySelectorAll('[data-key]').forEach((input) => (config[input.dataset.key] = input.value));
    const btn = $('#connection-save');
    btn.disabled = true;
    try {
      const body = { provider: connector.id, label: $('#connection-label').value, config };
      const { connection } = existing ? await api.put(`/api/connections/${existing.id}`, body) : await api.post('/api/connections', body);
      dialog.close();
      await load();
      showMessage(existing ? 'Verbindung gespeichert.' : `Verbindung „${connection.label}“ eingerichtet. Rufe jetzt die Depotdaten ab.`, 'info');
    } catch (err) {
      const box = $('#connection-dialog-error');
      box.textContent = err.message;
      box.hidden = false;
    } finally {
      btn.disabled = false;
    }
  });

  // ---------- Aktionen ----------

  async function testConnection(c, btn) {
    btn.disabled = true;
    try {
      const res = await api.post(`/api/connections/${c.id}/test`);
      showMessage(res.message, res.ok ? 'info' : 'error');
    } catch (err) {
      showMessage(err.message);
    } finally {
      btn.disabled = false;
    }
  }

  function pickFile() {
    return new Promise((resolve) => {
      const input = $('#connection-upload');
      input.value = '';
      input.onchange = async () => {
        const file = input.files[0];
        if (!file) return resolve(null);
        if (file.size > 2 * 1024 * 1024) {
          showMessage('Die Datei ist größer als 2 MB.');
          return resolve(null);
        }
        resolve(await readText(file));
      };
      input.click();
    });
  }

  // Bankexporte sind oft in Windows-1252 kodiert – bei kaputten Umlauten neu dekodieren
  async function readText(file) {
    const buf = await file.arrayBuffer();
    const utf8 = new TextDecoder('utf-8').decode(buf);
    return utf8.includes('\uFFFD') ? new TextDecoder('windows-1252').decode(buf) : utf8;
  }

  async function sync(c, btn) {
    const connector = connectorById(c.provider);
    let upload;
    if (connector?.requiresUpload) {
      upload = await pickFile();
      if (!upload) return;
    }
    btn.disabled = true;
    const label = btn.textContent;
    btn.textContent = 'Wird abgerufen …';
    try {
      const res = await api.post(`/api/connections/${c.id}/sync`, upload ? { upload } : {});
      const result = depot.importFromConnection({ connectionId: c.id, label: c.label, positions: res.positions });
      await load();
      const msg = document.createElement('span');
      msg.append(`${res.positions.length} Positionen abgerufen und in das Depot „${result.depotName}“ übernommen. `);
      if (result.unknown.length) msg.append(`Ohne Kursdaten (fließen nicht in die Analyse ein): ${result.unknown.join(', ')}. `);
      if (result.proxies.length) msg.append(`Über Vergleichs-ETF abgebildet: ${result.proxies.join(', ')}. `);
      if (res.skipped.length) msg.append(`Übersprungen: ${res.skipped.join(', ')}. `);
      const open = Object.assign(document.createElement('a'), { href: '#depot', textContent: 'Depot öffnen →' });
      open.addEventListener('click', (e) => {
        e.preventDefault();
        depot.openDepot(result.depotId);
      });
      msg.append(open);
      showMessage(msg, 'info');
    } catch (err) {
      showMessage(err.message);
      await load();
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
  }

  async function remove(c) {
    const linked = depot.findLinkedDepot(c.id);
    const extra = linked ? ` Das Depot „${linked.name}“ bleibt erhalten, wird aber nicht mehr aktualisiert.` : '';
    if (!confirm(`Verbindung „${c.label}“ entfernen? Die gespeicherten Zugangsdaten werden gelöscht.${extra}`)) return;
    try {
      await api.del(`/api/connections/${c.id}`);
      depot.unlinkConnection(c.id);
      await load();
      showMessage('Verbindung entfernt.', 'info');
    } catch (err) {
      showMessage(err.message);
    }
  }

  return {
    show() {
      showMessage('');
      load();
    },
  };
}
