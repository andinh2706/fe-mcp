/**
 * Network Collector
 *
 * Captures request/response pairs including full response bodies.
 *
 * Two data sources:
 *   1. LIVE — CDP Network domain events captured after attach() (has full bodies)
 *   2. HISTORICAL — performance.getEntriesByType('resource') fetched on attach
 *      (metadata only: URL, status, timing, size — no response bodies)
 *
 * Historical entries let the agent see what API calls happened before the MCP
 * server connected, then decide which to reproduce for full body capture.
 */

import { log } from "../logger.mjs";
import { MAX_NETWORK_BUFFER, NETWORK_BODY_TRUNCATE, NETWORK_DEFAULT_LIMIT } from "../limits.mjs";

/** @type {Map<string, object>} requestId → request data */
const requests = new Map();

/** URLs to ignore — Chrome internals, DevTools assets, extensions */
const IGNORE_URL_PREFIXES = [
  "devtools://",
  "chrome://",
  "chrome-extension://",
  "data:",
];

/** Resource types that are NOT API calls — skip capturing their bodies */
const RESOURCE_TYPES = new Set([
  "Document",
  "Stylesheet",
  "Image",
  "Media",
  "Font",
  "Script",
  "TextTrack",
  "Manifest",
  "SignedExchange",
  "Ping",
  "Preflight",
  "CSPViolationReport",
]);

function shouldIgnore(url) {
  return IGNORE_URL_PREFIXES.some((prefix) => url.startsWith(prefix));
}

function isApiRequest(type) {
  return !RESOURCE_TYPES.has(type);
}

/**
 * Attach listeners to a CDP client and backfill historical requests.
 *
 * Historical backfill uses performance.getEntriesByType('resource') to
 * recover API call metadata (URL, status, timing) that happened before
 * the MCP server connected. These entries appear with source: 'historical'
 * and have no response bodies.
 */
export async function attach(client) {
  // ── Live capture via CDP events ──────────────────────────────────────

  client.Network.requestWillBeSent((params) => {
    if (shouldIgnore(params.request.url)) return;
    if (!isApiRequest(params.type)) return;

    requests.set(params.requestId, {
      url: params.request.url,
      method: params.request.method,
      headers: params.request.headers,
      postData: params.request.postData,
      timestamp: params.timestamp,
      type: params.type,
      response: null,
      responseBody: null,
      source: "live",
    });

    // Evict oldest if over limit
    if (requests.size > MAX_NETWORK_BUFFER) {
      const oldest = requests.keys().next().value;
      requests.delete(oldest);
    }
  });

  client.Network.responseReceived((params) => {
    const req = requests.get(params.requestId);
    if (req) {
      req.response = {
        status: params.response.status,
        statusText: params.response.statusText,
        headers: params.response.headers,
        mimeType: params.response.mimeType,
      };
    }
  });

  client.Network.loadingFinished(async (params) => {
    const req = requests.get(params.requestId);
    if (!req) return;

    try {
      const { body, base64Encoded } = await client.Network.getResponseBody({
        requestId: params.requestId,
      });
      req.responseBody = base64Encoded
        ? Buffer.from(body, "base64").toString()
        : body;
    } catch {
      // Some requests (redirects, cancelled) don't have bodies
    }
  });

  // ── Historical backfill via Performance API ──────────────────────────

  try {
    const result = await client.Runtime.evaluate({
      expression: `(function() {
        const entries = performance.getEntriesByType('resource');
        return entries
          .filter(e => e.initiatorType === 'fetch' || e.initiatorType === 'xmlhttprequest')
          .map(e => ({
            url: e.name,
            initiatorType: e.initiatorType,
            startTime: e.startTime,
            duration: e.duration,
            transferSize: e.transferSize,
            encodedBodySize: e.encodedBodySize,
            decodedBodySize: e.decodedBodySize,
            responseStatus: e.responseStatus || 0,
          }));
      })()`,
      returnByValue: true,
    });

    if (result.result?.value) {
      const entries = result.result.value;
      let backfilled = 0;

      for (const entry of entries) {
        if (shouldIgnore(entry.url)) continue;

        // Use a synthetic key — performance entries don't have request IDs
        const key = `hist_${entry.startTime}_${entry.url.slice(-60)}`;

        // Don't overwrite live entries for the same URL that might already exist
        const alreadyLive = Array.from(requests.values()).some(
          r => r.source === "live" && r.url === entry.url
        );
        if (alreadyLive) continue;

        requests.set(key, {
          url: entry.url,
          method: entry.initiatorType === "fetch" ? "FETCH" : "XHR",
          headers: null,
          postData: null,
          timestamp: entry.startTime / 1000,
          type: entry.initiatorType,
          response: entry.responseStatus ? {
            status: entry.responseStatus,
            statusText: null,
            headers: null,
            mimeType: null,
          } : null,
          responseBody: null,
          source: "historical",
          timing: {
            startTime: Math.round(entry.startTime),
            duration: Math.round(entry.duration),
          },
          size: entry.decodedBodySize || entry.transferSize || null,
        });

        backfilled++;
      }

      if (backfilled > 0) {
        log.info("network backfill", { historical: backfilled, total: entries.length });
      }
    }
  } catch (err) {
    // Non-fatal — historical backfill is best-effort
    log.debug("network backfill failed", { error: err.message });
  }

  log.info("network collector attached");
}

/**
 * Query captured requests.
 */
export function query({ urlPattern, method, statusFilter, limit = NETWORK_DEFAULT_LIMIT, includeHistorical = true }) {
  let results = Array.from(requests.values());

  if (!includeHistorical) {
    results = results.filter((r) => r.source !== "historical");
  }

  if (urlPattern) {
    results = results.filter((r) => r.url.includes(urlPattern));
  }
  if (method && method !== "any") {
    results = results.filter((r) => {
      if (r.source === "historical") {
        // Historical entries don't have exact methods, match loosely
        return true;
      }
      return r.method === method;
    });
  }
  if (statusFilter === "errors_only") {
    results = results.filter((r) => r.response && r.response.status >= 400);
  } else if (statusFilter === "success_only") {
    results = results.filter(
      (r) => r.response && r.response.status >= 200 && r.response.status < 300
    );
  }

  // Most recent first, limited
  return results.slice(-limit).reverse().map((r) => {
    const entry = {
      url: r.url,
      method: r.method,
      status: r.response?.status || "pending",
      statusText: r.response?.statusText || undefined,
      contentType: r.response?.mimeType || undefined,
      source: r.source,
    };

    // Historical entries: include timing + size metadata
    if (r.source === "historical") {
      if (r.timing) entry.timing = r.timing;
      if (r.size) entry.sizeBytes = r.size;
    }

    if (r.responseBody) {
      try {
        entry.responseParsed = JSON.parse(r.responseBody);
      } catch {
        const body = r.responseBody;
        entry.responseBody =
          body.length > NETWORK_BODY_TRUNCATE ? body.slice(0, NETWORK_BODY_TRUNCATE) + "\n...[truncated]" : body;
      }
    }

    if (r.postData) {
      try {
        entry.requestBody = JSON.parse(r.postData);
      } catch {
        entry.requestBody = r.postData;
      }
    }

    return entry;
  });
}

/**
 * Clear all captured requests.
 */
export function clear() {
  requests.clear();
  log.info("network collector cleared");
}
