/**
 * CDP Connection Manager
 *
 * Connects lazily on first tool call. All config comes from env vars:
 *   CDP_HOST       (default: localhost)
 *   CDP_PORT       (default: 9222)
 *   CDP_TARGET_URL (default: none — picks first real page tab)
 *
 * To switch tabs, restart the MCP server with a different CDP_TARGET_URL.
 */

import CDP from "chrome-remote-interface";
import { log } from "./logger.mjs";
import { LOG_EXPRESSION_TRUNCATE } from "./limits.mjs";
import * as networkCollector from "./collectors/network.mjs";
import * as debuggerCollector from "./collectors/debugger/index.mjs";

let client = null;

const CONFIG = {
  host: process.env.CDP_HOST || "localhost",
  port: parseInt(process.env.CDP_PORT || "9222", 10),
  targetUrl: process.env.CDP_TARGET_URL || null,
};

/** URLs that are never valid debug targets */
const IGNORE_URL_PREFIXES = [
  "devtools://",
  "chrome://",
  "chrome-extension://",
  "about:",
  "data:",
];

/**
 * Pick the correct page tab from the target list.
 */
function pickTarget(targets) {
  const pages = targets.filter((t) => {
    if (t.type !== "page") return false;
    if (IGNORE_URL_PREFIXES.some((p) => t.url.startsWith(p))) return false;
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

  if (CONFIG.targetUrl) {
    const match = pages.find((t) => t.url.includes(CONFIG.targetUrl));
    if (match) {
      log.info("matched target", { url: match.url });
      return match;
    }
    log.warn("CDP_TARGET_URL did not match any tab, using first page", {
      filter: CONFIG.targetUrl,
      available: pages.map((t) => t.url),
    });
  }

  log.info("selected target", { url: pages[0].url });
  return pages[0];
}

/**
 * Get or create the CDP connection.
 * On first call: connects, enables domains, attaches collectors.
 * Subsequent calls return the cached client.
 */
export async function getClient() {
  if (client) return client;

  const { host, port } = CONFIG;
  log.info("connecting to Chrome", { host, port, targetUrl: CONFIG.targetUrl });

  try {
    client = await CDP({
      host,
      port,
      target: (targets) => pickTarget(targets),
    });

    await client.Runtime.enable();
    await client.Network.enable();
    await client.DOM.enable();
    await client.Page.enable();

    // Attach collectors automatically
    await networkCollector.attach(client);
    await debuggerCollector.attach(client);

    // Log what we connected to
    const { frameTree } = await client.Page.getFrameTree();
    log.info("connected", { pageUrl: frameTree.frame.url });

    client.on("disconnect", () => {
      log.warn("Chrome disconnected");
      client = null;
    });

    return client;
  } catch (err) {
    client = null;
    log.error("connection failed", { error: err.message });
    throw new Error(
      `Cannot connect to Chrome on ${host}:${port}. ` +
      `Ensure Chrome is running with --remote-debugging-port=${port}\n` +
      `Error: ${err.message}`
    );
  }
}

/**
 * Attempt to connect eagerly (best-effort).
 * Called at startup so the network collector starts capturing immediately.
 * If Chrome isn't ready yet, logs a warning and returns — tool calls will
 * retry via getClient() later.
 */
export async function eagerConnect() {
  try {
    await getClient();
  } catch (err) {
    log.warn("eager connect failed — will retry on first tool call", { error: err.message });
  }
}

/**
 * Evaluate a JS expression in the page context.
 */
export async function evaluate(expression) {
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
