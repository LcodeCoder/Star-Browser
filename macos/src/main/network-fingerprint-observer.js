'use strict';
const MEMORY_HEADERS = new Set(['device-memory', 'sec-ch-device-memory']);
function memoryHeaders(headers) {
  const selected = {};
  for (const [name, value] of Object.entries(headers || {})) {
    const key = name.toLowerCase();
    if (MEMORY_HEADERS.has(key)) selected[key] = String(value).slice(0, 128);
  }
  return selected;
}
function safeOrigin(value) {
  try { const url = new URL(value); return /^https?:$/.test(url.protocol) ? url.origin : null; }
  catch { return null; }
}
// Passive observation only. Keep two hardware headers and sanitized origins;
// discard Cookie, Authorization, request bodies, paths and query parameters.
class NetworkFingerprintObserver {
  constructor({limit = 32, pendingLimit = 256} = {}) {
    this.limit = limit; this.pendingLimit = pendingLimit;
    this.mainFrameId = null; this.loaderId = null;
    this.requestsObserved = 0; this.requests = new Map(); this.pending = new Map();
  }
  setMainFrame(frameId) { this.mainFrameId = frameId; }
  clear() { this.requestsObserved = 0; this.requests.clear(); this.pending.clear(); }
  record(method, params) {
    if (method === 'Page.frameNavigated' && !params.frame?.parentId) {
      this.setMainFrame(params.frame.id); return;
    }
    if (!['Network.requestWillBeSent', 'Network.requestWillBeSentExtraInfo', 'Network.responseReceived'].includes(method)) return;
    if (method === 'Network.requestWillBeSent' && params.type === 'Document' && params.frameId === this.mainFrameId && params.loaderId !== this.loaderId) {
      this.clear(); this.loaderId = params.loaderId;
    }
    const id = params.requestId;
    if (!id) return;
    if (method === 'Network.responseReceived') {
      if (params.hasExtraInfo === false) this.pending.delete(id);
      return;
    }
    let state = this.pending.get(id);
    if (!state) { state = {requests: [], extras: []}; this.pending.set(id, state); }
    if (method === 'Network.requestWillBeSent') {
      if (params.redirectResponse && params.redirectHasExtraInfo === false) state.requests.shift();
      const request = {origin: safeOrigin(params.request?.url), type: params.type};
      state.requests.push(request); this.requestsObserved++;
      this.remember(request, memoryHeaders(params.request?.headers), 'request-event');
    } else state.extras.push(memoryHeaders(params.headers));
    while (state.requests.length && state.extras.length) this.remember(state.requests.shift(), state.extras.shift(), 'extra-info');
    if (!state.requests.length && !state.extras.length) this.pending.delete(id);
    while (state.requests.length > 4) state.requests.shift();
    while (state.extras.length > 4) state.extras.shift();
    while (this.pending.size > this.pendingLimit) this.pending.delete(this.pending.keys().next().value);
  }
  remember(request, headers, source) {
    if (!request.origin) return;
    this.requests.delete(request.origin);
    this.requests.set(request.origin, {origin: request.origin, type: request.type, headers, source, observedAt: Date.now()});
    while (this.requests.size > this.limit) this.requests.delete(this.requests.keys().next().value);
  }
  snapshot() {
    return {status: this.requestsObserved ? 'observed' : 'no-requests-observed',
      requestsObserved: this.requestsObserved, requests: [...this.requests.values()].map(value => ({...value, headers: {...value.headers}}))};
  }
}
module.exports = {NetworkFingerprintObserver, memoryHeaders, safeOrigin};
