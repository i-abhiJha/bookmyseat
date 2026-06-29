// API client: attaches the access token and refreshes it once on a 401.

const TOKENS_KEY = 'bms_tokens';

export function getTokens() {
  try {
    return JSON.parse(localStorage.getItem(TOKENS_KEY)) || {};
  } catch {
    return {};
  }
}
export function setTokens(tokens) {
  localStorage.setItem(TOKENS_KEY, JSON.stringify(tokens));
}
export function clearTokens() {
  localStorage.removeItem(TOKENS_KEY);
}

export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

async function raw(path, { method = 'GET', body, auth = true } = {}, accessToken) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth && accessToken) headers.Authorization = `Bearer ${accessToken}`;
  return fetch(`/api/v1${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
}

export async function api(path, opts = {}) {
  const { accessToken, refreshToken } = getTokens();
  let res = await raw(path, opts, accessToken);

  // on 401, try refreshing once and retry
  if (res.status === 401 && opts.auth !== false && refreshToken) {
    const r = await fetch('/api/v1/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (r.ok) {
      const fresh = await r.json();
      setTokens(fresh);
      res = await raw(path, opts, fresh.accessToken);
    } else {
      clearTokens();
    }
  }

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(res.status, data?.error?.message || 'Request failed', data?.error?.details);
  }
  return { data, headers: res.headers };
}
