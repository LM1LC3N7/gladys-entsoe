// -----------------------------------------------------------------------------
// Fake `fetch` for the tests: routes requests to a handler, records every
// call, and fails loudly on an unexpected one. No test touches the network.
// -----------------------------------------------------------------------------

import { setFetch } from '../../src/http.js';

setFetch(async () => {
  throw new Error('Network call without a fake fetch in a test');
});

export const xml = (body, status = 200, headers = {}) =>
  new Response(body, { status, headers: { 'content-type': 'text/xml', ...headers } });

export const status = (code, headers = {}) =>
  new Response(code === 204 ? null : 'error', { status: code, headers });

/**
 * Install a fake fetch: `handler(call)` answers, `call` being
 * `{ url, params, init }` with the query parsed.
 */
export function installFetch(handler) {
  const calls = [];
  const previous = setFetch(async (url, init = {}) => {
    const call = { url, params: Object.fromEntries(new URL(url).searchParams), init };
    calls.push(call);
    return handler(call);
  });
  return { calls, restore: () => setFetch(previous) };
}
