// Client für die Server-API. Sitzungscookies sendet der Browser automatisch (HttpOnly).

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Wird ausgelöst, wenn der Server die Sitzung nicht (mehr) akzeptiert
export const sessionEvents = new EventTarget();

export async function api(method, path, body) {
  let res;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'Der Server ist nicht erreichbar. Bitte Verbindung prüfen.');
  }
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const err = new ApiError(res.status, data?.error ?? `Fehler ${res.status}`);
    if (res.status === 401 && !path.startsWith('/api/auth/login') && !path.startsWith('/api/auth/register')) {
      sessionEvents.dispatchEvent(new CustomEvent('expired', { detail: err.message }));
    }
    throw err;
  }
  return data;
}

api.get = (path) => api('GET', path);
api.post = (path, body = {}) => api('POST', path, body);
api.put = (path, body) => api('PUT', path, body);
api.del = (path) => api('DELETE', path);
