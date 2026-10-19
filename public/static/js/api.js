/**
 * Tiny fetch wrapper for JSON API calls, with a global in-flight indicator:
 * a top-center spinner shown only when a request is still pending after
 * 300ms (no flashing on fast reads). The counter settles when the HTTP
 * response arrives; error responses settle it too.
 */

let inflight = 0;
let showTimer = null;
let spinnerEl = null;

function getSpinner() {
  if (!spinnerEl) {
    spinnerEl = document.createElement('div');
    spinnerEl.className = 'fetch-spinner';
    spinnerEl.setAttribute('role', 'status');
    spinnerEl.setAttribute('aria-label', 'Loading');
    spinnerEl.hidden = true;
    document.body.appendChild(spinnerEl);
  }
  return spinnerEl;
}

function track(p) {
  inflight += 1;
  if (showTimer === null) {
    showTimer = setTimeout(function () {
      if (inflight > 0) getSpinner().hidden = false;
      showTimer = null;
    }, 300);
  }
  const done = function () {
    inflight -= 1;
    if (inflight === 0) {
      clearTimeout(showTimer);
      showTimer = null;
      if (spinnerEl) spinnerEl.hidden = true;
    }
  };
  p.then(done, done);
}

function makeRequest(url, init) {
  const p = fetch(url, init);
  track(p); // settles when the HTTP response arrives (headers), before json()
  return p;
}

const api = {
  async get(url) {
    const res = await makeRequest(url);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `GET ${url} failed (${res.status})`);
    }
    return res.json();
  },

  async post(url, body) {
    const res = await makeRequest(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `POST ${url} failed (${res.status})`);
    }
    return res.json();
  },

  async patch(url, body) {
    const res = await makeRequest(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `PATCH ${url} failed (${res.status})`);
    }
    return res.json();
  },

  async del(url) {
    const res = await makeRequest(url, { method: 'DELETE' });
    if (!res.ok && res.status !== 204) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `DELETE ${url} failed (${res.status})`);
    }
  },

  async put(url, body) {
    const res = await makeRequest(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `PUT ${url} failed (${res.status})`);
    }
    return res.json();
  },

  async upload(url, formData) {
    const res = await makeRequest(url, { method: 'POST', body: formData });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `Upload to ${url} failed (${res.status})`);
    }
    return res.json();
  },
};
