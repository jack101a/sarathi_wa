export class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

async function handleResponse(resp) {
  let data;
  try { data = await resp.json(); } catch { data = null; }
  if (!resp.ok) {
    const msg = data?.message || data?.detail || `Request failed (${resp.status})`;
    throw new ApiError(msg, resp.status, data);
  }
  return data;
}

function buildOpts(opts = {}) {
  return {
    credentials: 'include',
    headers: { Accept: 'application/json', ...(opts.headers || {}) },
    ...opts,
  };
}

export async function apiGet(url, opts = {}) {
  const resp = await fetch(url, { method: 'GET', ...buildOpts(opts) });
  return handleResponse(resp);
}

export async function apiPostJson(url, body = {}, opts = {}) {
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    body: JSON.stringify(body),
    credentials: 'include',
  });
  return handleResponse(resp);
}

export async function apiPostBinary(url, body, fileName, opts = {}) {
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'X-Backup-Filename': encodeURIComponent(fileName || 'uploaded.dump'),
      ...(opts.headers || {}),
    },
    body,
    credentials: 'include',
  });
  return handleResponse(resp);
}

export async function apiPatchJson(url, body = {}, opts = {}) {
  const resp = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    body: JSON.stringify(body),
    credentials: 'include',
  });
  return handleResponse(resp);
}

export async function apiDelete(url, opts = {}) {
  const resp = await fetch(url, { method: 'DELETE', ...buildOpts(opts) });
  return handleResponse(resp);
}

export async function apiPut(url, body = {}, opts = {}) {
  const resp = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    body: JSON.stringify(body),
    credentials: 'include',
  });
  return handleResponse(resp);
}
