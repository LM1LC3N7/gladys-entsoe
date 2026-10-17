// -----------------------------------------------------------------------------
// The only place that talks to the network: `fetch` with a timeout, an
// identifiable User-Agent, and a body read up to MAX_RESPONSE_BYTES at most.
// The tests replace `fetch` with `setFetch()`.
//
// The ENTSO-E security token is in the URL: no message built here carries
// the URL, the query or the body of an answer.
// -----------------------------------------------------------------------------

import { HTTP_TIMEOUT, MAX_RESPONSE_BYTES, USER_AGENT } from './constants.js';

let fetchImpl = (...args) => globalThis.fetch(...args);

/** Replace the fetch implementation (tests only). Returns the previous one. */
export function setFetch(impl) {
  const previous = fetchImpl;
  fetchImpl = impl;
  return previous;
}

export class EntsoeError extends Error {
  /**
   * `code`: 'unauthorized' (token refused), 'rate_limited', 'server',
   * 'bad_request', 'http', 'network', 'timeout', 'too_large', 'invalid'.
   */
  constructor(code, message, { status, retryAfter } = {}) {
    super(message);
    this.name = 'EntsoeError';
    this.code = code;
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

/** Retry-After (seconds or an HTTP date) -> milliseconds, undefined when absent or invalid. */
export function retryAfterMs(value, now = Date.now()) {
  if (value === null || value === undefined || value === '') {
    return undefined;
  }
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : undefined;
}

/** The body as text, refused past `limit` bytes (read in chunks, never whole). */
export async function readBounded(response, limit = MAX_RESPONSE_BYTES) {
  const declared = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declared) && declared > limit) {
    await response.body?.cancel?.().catch(() => {});
    throw new EntsoeError('too_large', `ENTSO-E answered more than ${limit} bytes`);
  }
  if (!response.body?.getReader) {
    const text = await response.text();
    if (Buffer.byteLength(text) > limit) {
      throw new EntsoeError('too_large', `ENTSO-E answered more than ${limit} bytes`);
    }
    return text;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => {});
      throw new EntsoeError('too_large', `ENTSO-E answered more than ${limit} bytes`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');
}

/** A failed request or body read, as a fixed-message EntsoeError. */
function networkError(err) {
  const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError';
  // Never err.message: some runtimes put the URL (and the token) in it.
  return timedOut
    ? new EntsoeError('timeout', 'ENTSO-E did not answer in time')
    : new EntsoeError('network', 'ENTSO-E is unreachable (network error)');
}

/**
 * GET `url`: resolves `{ status, text }` for a 200 or a 400 (the platform
 * explains a 400 in an XML acknowledgement); throws an EntsoeError otherwise.
 */
export async function getText(url, { timeout = HTTP_TIMEOUT, now = Date.now } = {}) {
  let response;
  try {
    response = await fetchImpl(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/xml, text/xml' },
      signal: AbortSignal.timeout(Math.max(1, timeout)),
      redirect: 'error',
    });
  } catch (err) {
    throw networkError(err);
  }
  const { status } = response;
  if (status === 200 || status === 400) {
    try {
      return { status, text: await readBounded(response) };
    } catch (err) {
      // The body stream fails like the request (timeout, reset): same
      // fixed-message errors, never the original message.
      throw err instanceof EntsoeError ? err : networkError(err);
    }
  }
  await response.body?.cancel?.().catch(() => {});
  if (status === 401) {
    throw new EntsoeError('unauthorized', 'ENTSO-E refused the security token (401)', { status });
  }
  if (status === 429) {
    throw new EntsoeError('rate_limited', 'ENTSO-E asked to slow down (429)', {
      status,
      retryAfter: retryAfterMs(response.headers?.get?.('retry-after'), now()),
    });
  }
  if (status >= 500) {
    throw new EntsoeError('server', `ENTSO-E answered ${status}`, { status });
  }
  throw new EntsoeError('http', `ENTSO-E answered ${status}`, { status });
}
