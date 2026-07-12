/**
 * CDP Connection Manager
 *
 * Owns the single Chrome DevTools Protocol connection shared by the whole
 * server. Responsibilities:
 *   - Establish the connection lazily and cache it (one connection per process).
 *   - Pick the right browser tab to attach to (see pickTarget).
 *   - Enable the CDP domains the tools rely on and attach the collectors.
 *   - Expose evaluate() — the primitive every React/store snippet runs through.
 *
 * Connection lifecycle:
 *   - Lazy: the socket is opened on the first getClient() call, not at import.
 *   - Memoized: getClient() caches both the resolved client AND the in-flight
 *     connection promise, so concurrent callers (e.g. eagerConnect() racing the
 *     first tool call) share ONE connection instead of opening several and
 *     double-attaching collectors.
 *   - Self-healing: on "disconnect" the cache is cleared, so the next
 *     getClient() transparently reconnects.
 *
 * All configuration comes from ENV (see env.ts):
 *   CDP_HOST       (default: localhost)
 *   CDP_PORT       (default: 9222)
 *   CDP_TARGET_URL (default: none — picks the first real page tab)
 *
 * To switch tabs, restart the MCP server with a different CDP_TARGET_URL.
 */

import CDP, { type Client } from "chrome-remote-interface";
import { log } from "./logger.js";
import { ENV } from "./env.js";
import { serverLimits } from "./limits.js";
import { INTERNAL_URL_PREFIXES, startsWithAny } from "./url-filters.js";
import * as networkCollector from "./collectors/network.js";
import * as debuggerCollector from "./collectors/debugger/index.js";

const { LOG_EXPRESSION_TRUNCATE } = serverLimits();

/** The live connection once established; null before first connect or after a disconnect. */
let client: Client | null = null;

/**
 * The in-flight connection promise while a connect is underway, else null.
 * This is the concurrency guard: if two callers reach getClient() before the
 * first connection resolves, both await this same promise instead of each
 * starting their own CDP() handshake.
 */
let connecting: Promise<Client> | null = null;

/** Resolved connection settings (snapshotted from ENV at module load). */
const CONFIG = {
  host: ENV.CDP_HOST,
  port: ENV.CDP_PORT,
  targetUrl: ENV.CDP_TARGET_URL,
};

/**
 * URL schemes that are never valid debug targets. The shared browser-internal
 * core plus target-specific extras: `about:` (about:blank and friends) and
 * `data:` pages, which are real "page" targets but never the app under debug.
 */
const IGNORE_TARGET_PREFIXES = [...INTERNAL_URL_PREFIXES, "about:", "data:"];

/**
 * Choose which browser tab (CDP "target") to attach to.
 *
 * Chrome exposes one target per tab. We only ever want a real page, so internal
 * targets are filtered out first. When CDP_TARGET_URL is set, the first page
 * whose URL contains that substring wins; otherwise we take the first page and
 * warn if a requested filter matched nothing.
 *
 * Passed to CDP() as its `target` selector.
 */
function pickTarget(targets: any[]) {
  const pages = targets.filter((t) => {
    if (t.type !== "page") return false;
    if (startsWithAny(t.url, IGNORE_TARGET_PREFIXES)) return false;
    return true;
  });

  log.debug("available targets", {
    total: targets.length,
    pages: pages.map((t) => ({ title: t.title, url: t.url })),
  });

  if (pages.length === 0) {
    throw new Error(
      `No valid page targets found (${targets.length} targets were all DevTools/extensions/internal). ` +
      `Make sure you have a web page tab open.`
    );
  }

  // Preferred: the tab whose URL matches CDP_TARGET_URL.
  if (CONFIG.targetUrl) {
    const match = pages.find((t) => t.url.includes(CONFIG.targetUrl));
    if (match) {
      log.info("matched target", { url: match.url });
      return match;
    }
    // Filter set but unmatched — fall through to the first page rather than fail.
    log.warn("CDP_TARGET_URL did not match any tab, using first page", {
      filter: CONFIG.targetUrl,
      available: pages.map((t) => t.url),
    });
  }

  log.info("selected target", { url: pages[0].url });
  return pages[0];
}

/**
 * Open the CDP connection, enable the domains the tools use, and attach the
 * collectors. Throws a user-actionable error if Chrome can't be reached.
 *
 * Kept separate from getClient() so the caching/concurrency logic there stays
 * small and this holds the one-time setup sequence.
 */
async function connect(): Promise<Client> {
  const { host, port } = CONFIG;
  log.info("connecting to Chrome", { host, port, targetUrl: CONFIG.targetUrl });

  try {
    const cdp = await CDP({
      host,
      port,
      target: (targets: any[]) => pickTarget(targets),
    });

    // Enable the domains the tools depend on:
    //   Runtime  — evaluate() / snippet execution
    //   Network  — request/response capture (network collector)
    //   DOM      — selector-based inspection
    //   Page     — frame info + lifecycle
    //   (Debugger is enabled inside debuggerCollector.attach)
    await cdp.Runtime.enable();
    await cdp.Network.enable();
    await cdp.DOM.enable();
    await cdp.Page.enable();

    // Attach collectors — these register the CDP event listeners that buffer
    // network traffic and debugger pauses for later querying by the tools.
    await networkCollector.attach(cdp);
    await debuggerCollector.attach(cdp);

    // Report which page we actually landed on.
    const { frameTree } = await cdp.Page.getFrameTree();
    log.info("connected", { pageUrl: frameTree.frame.url });

    // On disconnect (tab closed, Chrome quit), drop the cache so the next
    // getClient() reconnects from scratch.
    cdp.on("disconnect", () => {
      log.warn("Chrome disconnected");
      client = null;
    });

    return cdp;
  } catch (err: any) {
    log.error("connection failed", { error: err.message });
    throw new Error(
      `Cannot connect to Chrome on ${host}:${port}. ` +
      `Ensure Chrome is running with --remote-debugging-port=${port}\n` +
      `Error: ${err.message}`
    );
  }
}

/**
 * Get the shared CDP connection, connecting on first use.
 *
 * Cache hierarchy:
 *   1. `client` set        → already connected, return immediately.
 *   2. `connecting` set    → a connect is in flight, join that same promise.
 *   3. neither             → start a new connect and memoize it.
 *
 * The `connecting` guard is what prevents concurrent callers from opening
 * duplicate connections (and double-attaching collectors). It is always cleared
 * once the attempt settles, whether it succeeded or failed, so a failed attempt
 * doesn't poison future retries.
 */
export async function getClient(): Promise<Client> {
  if (client) return client;
  if (connecting) return connecting;

  connecting = connect();
  try {
    client = await connecting;
    return client;
  } finally {
    connecting = null;
  }
}

/**
 * Attempt to connect eagerly (best-effort).
 * Called at startup so the network collector starts capturing immediately,
 * before the first tool call. If Chrome isn't ready yet, the failure is
 * swallowed — the connection is retried lazily on the first getClient().
 */
export async function eagerConnect(): Promise<void> {
  try {
    await getClient();
  } catch (err: any) {
    log.warn("eager connect failed — will retry on first tool call", { error: err.message });
  }
}

/**
 * Evaluate a JS expression in the page context and return its value.
 *
 * This is the workhorse behind every React/store snippet: tools stringify a
 * bundled snippet and hand it here. CDP options:
 *   returnByValue   — deep-copy the result out of the page (not a remote handle)
 *   awaitPromise    — if the expression returns a Promise, wait for it
 *   generatePreview — include object previews for richer results
 *
 * A page-side exception is surfaced as a thrown Error with the page's message.
 */
export async function evaluate(expression: string): Promise<any> {
  const cdp = await getClient();
  log.debug("evaluate", { expression: expression.slice(0, LOG_EXPRESSION_TRUNCATE) });

  const result = await cdp.Runtime.evaluate({
    expression,
    returnByValue: true,
    awaitPromise: true,
    generatePreview: true,
  });

  if (result.exceptionDetails) {
    const msg =
      result.exceptionDetails.text +
      " " +
      (result.exceptionDetails.exception?.description || "");
    log.error("evaluate failed", { error: msg });
    throw new Error(msg);
  }

  return result.result.value;
}
