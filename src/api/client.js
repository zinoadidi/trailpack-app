// HTTP client for the Trailpack API (API.md v1).
// One place that knows the routes, the error shape and the token handling.
// Tokens: access token in memory only; refresh token persisted by the caller
// (IndexedDB through the storage helpers), never here.

export class ApiError extends Error {
  constructor(code, message, status, extra = {}) {
    super(message || code || 'request_failed');
    this.name = 'ApiError';
    this.code = code || 'request_failed';
    this.status = status || 0;
    Object.assign(this, extra);
  }
}

export function createClient({ baseUrl, fetchImpl = globalThis.fetch, onUnauthorized = async () => {} }) {
  if (!baseUrl) throw new Error('apiBase is missing from config.json');
  const root = String(baseUrl).replace(/\/+$/, '');

  let accessToken = null;
  let refreshHandler = null;

  function setAccessToken(token) {
    accessToken = token || null;
  }

  function getAccessToken() {
    return accessToken;
  }

  async function parse(res) {
    if (res.status === 204) return null;
    const text = await res.text();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return { raw: text };
    }
  }

  async function toError(res, body) {
    const code = (body && body.error) || (res.status === 401 ? 'unauthorized' : 'request_failed');
    const message = (body && body.message) || code;
    return new ApiError(code, message, res.status, {
      serverRev: body && body.serverRev,
      serverDoc: body && body.serverDoc,
      budget: body && body.budget,
      retryAfter: res.headers.get('retry-after'),
    });
  }

  /**
   * @param {string} path e.g. "/auth/login" (relative to the API root)
   */
  async function request(path, { method = 'GET', body, headers = {}, auth = true, raw = false, retry = true } = {}) {
    const h = { accept: 'application/json', ...headers };
    if (auth && accessToken) h.authorization = 'Bearer ' + accessToken;
    let payload;
    if (raw) {
      payload = body;
    } else if (body !== undefined) {
      h['content-type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    let res;
    try {
      res = await fetchImpl(root + path, { method, headers: h, body: payload, credentials: 'omit' });
    } catch (err) {
      throw new ApiError('network', 'Could not reach the server', 0, { cause: err });
    }
    if (res.status === 401 && auth && retry && refreshHandler) {
      const ok = await refreshHandler();
      if (ok) return request(path, { method, body, headers, auth, raw, retry: false });
      await onUnauthorized();
      throw new ApiError('unauthorized', 'Session expired', 401);
    }
    if (!res.ok) {
      const errBody = await parse(res);
      throw await toError(res, errBody);
    }
    if (rawResponse(res)) return res;
    return parse(res);
  }

  function rawResponse(res) {
    const type = res.headers.get('content-type') || '';
    return !type.includes('application/json');
  }

  const api = {
    setAccessToken,
    getAccessToken,
    setRefreshHandler(fn) {
      refreshHandler = fn;
    },
    request,
    baseUrl: root,

    // Same as request, but never follows a 401 with a token refresh. Public
    // auth calls use this so a bad refresh token cannot loop.
    raw: (path, opts = {}) => request(path, { ...opts, auth: false, retry: false }),

    // public
    health: () => request('/health', { auth: false }),
    checkCode: (code) => request('/access/check', { method: 'POST', body: { code }, auth: false }),
    redeem: (payload) => request('/access/redeem', { method: 'POST', body: payload, auth: false }),
    login: (email, password) => request('/auth/login', { method: 'POST', body: { email, password }, auth: false }),
    refresh: (refreshToken) =>
      request('/auth/refresh', { method: 'POST', body: { refreshToken }, auth: false, retry: false }),
    logout: (refreshToken) => request('/auth/logout', { method: 'POST', body: { refreshToken }, auth: false }),
    bootstrap: (payload) => request('/admin/bootstrap', { method: 'POST', body: payload, auth: false }),

    // account
    me: () => request('/me'),
    updateMe: (patch) => request('/me', { method: 'PATCH', body: patch }),
    changePassword: (current, next) => request('/me/password', { method: 'POST', body: { current, next } }),
    deleteMe: (password) => request('/me', { method: 'DELETE', body: { password } }),

    // admin
    createCode: (body = {}) => request('/admin/codes', { method: 'POST', body }),
    listCodes: () => request('/admin/codes'),
    revokeCode: (id) => request('/admin/codes/' + encodeURIComponent(id), { method: 'DELETE' }),
    listAccounts: () => request('/admin/accounts'),
    updateAccount: (id, patch) => request('/admin/accounts/' + encodeURIComponent(id), { method: 'PATCH', body: patch }),
    deleteAccount: (id) => request('/admin/accounts/' + encodeURIComponent(id), { method: 'DELETE' }),
    usage: (days = 7) => request('/admin/usage?days=' + encodeURIComponent(days)),
    providers: () => request('/admin/providers'),

    // sync
    getChanges: (since = 0, limit = 200) => request(`/sync/changes?since=${since}&limit=${limit}`),
    getDoc: (collection, id) => request(`/sync/docs/${collection}/${encodeURIComponent(id)}`),
    putDoc: (collection, id, doc, baseRev) =>
      request(`/sync/docs/${collection}/${encodeURIComponent(id)}`, {
        method: 'PUT',
        body: baseRev ? { doc, baseRev } : { doc },
      }),
    deleteDoc: (collection, id) => request(`/sync/docs/${collection}/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    putFile: async (id, bytes, { name, type }) => {
      const headers = { 'x-file-name': name || id, 'content-type': type || 'application/octet-stream' };
      return request('/sync/files/' + encodeURIComponent(id), { method: 'PUT', body: bytes, headers, raw: true });
    },
    listFiles: () => request('/sync/files'),
    getFile: (id) => request('/sync/files/' + encodeURIComponent(id), { raw: true }),
    deleteFile: (id) => request('/sync/files/' + encodeURIComponent(id), { method: 'DELETE' }),
    syncUsage: () => request('/sync/usage'),
    syncExport: () => request('/sync/export'),

    // ingest and LLM
    extract: (bytes, { name, type }) =>
      request('/ingest/extract', {
        method: 'POST',
        body: bytes,
        raw: true,
        headers: { 'x-file-name': name || 'file', 'content-type': type || 'application/octet-stream' },
      }),
    models: () => request('/llm/models'),
    chat: (payload) => request('/llm/chat', { method: 'POST', body: payload }),
  };

  return api;
}
