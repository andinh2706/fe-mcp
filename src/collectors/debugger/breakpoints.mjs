/**
 * Breakpoint and logpoint management.
 *
 * Both setBreakpoint and setLogpoint use a common two-step resolution:
 *   1. Try setBreakpointByUrl (direct URL regex match against bundled scripts)
 *   2. Fall back to source map resolution (for original files that only exist
 *      inside source maps, e.g. .tsx files bundled into main.js)
 */

import { log } from "../../logger.mjs";
import { requireCdp, breakpoints, LOGPOINT_PREFIX, nextLogpointLabel, resetLogpointCounter } from "./state.mjs";
import { locToEntry, urlPatternToRegex, resolveViaSourceMap } from "./scripts.mjs";

// ---------------------------------------------------------------------------
// Common resolution logic
// ---------------------------------------------------------------------------

/**
 * Resolve a breakpoint/logpoint location using the two-step strategy.
 * Returns the CDP result with resolved locations, or an error descriptor.
 *
 * @param {object} opts
 * @param {string} opts.urlPattern — file name or path fragment (original source name accepted)
 * @param {number} opts.line — 1-based line in the original source
 * @param {number} [opts.column] — 1-based column
 * @param {string} [opts.condition] — CDP condition expression
 * @returns {{ id: string, resolved: object[], resolvedVia?: string, originalSource?: string, error?: string }}
 */
async function resolveLocation({ urlPattern, line, column, condition }) {
  const cdp = requireCdp();
  const cdpLine = line - 1;
  const cdpColumn = column ? column - 1 : 0;

  // Strategy 1: direct URL regex match against bundled script URLs
  const result = await cdp.Debugger.setBreakpointByUrl({
    lineNumber: cdpLine,
    urlRegex: urlPatternToRegex(urlPattern),
    columnNumber: cdpColumn,
    condition: condition || undefined,
  });

  if (result.locations.length > 0) {
    return {
      id: result.breakpointId,
      resolved: result.locations.map(locToEntry),
    };
  }

  // Strategy 1 returned pending — remove it before trying strategy 2
  log.info("breakpoint pending — trying source map resolution", { urlPattern, line });
  try { await cdp.Debugger.removeBreakpoint({ breakpointId: result.breakpointId }); } catch {}

  // Strategy 2: source map resolution (original .tsx → generated location in bundle)
  const mapped = await resolveViaSourceMap(urlPattern, line, column || 1);

  if (!mapped) {
    return {
      id: null,
      resolved: [],
      error: `No bundled script URL matches "${urlPattern}" and no source map contains it. Use list_scripts to see loaded bundled scripts.`,
    };
  }

  const smResult = await cdp.Debugger.setBreakpoint({
    location: {
      scriptId: mapped.scriptId,
      lineNumber: mapped.generatedLine - 1,
      columnNumber: mapped.generatedColumn,
    },
    condition: condition || undefined,
  });

  return {
    id: smResult.breakpointId,
    resolved: [locToEntry(smResult.actualLocation)],
    resolvedVia: "source-map",
    originalSource: mapped.originalSource,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Set a breakpoint by file name/pattern and original source line number.
 * Accepts original source file names (e.g. "CartItem.tsx") — resolved via
 * source maps to the generated location in the bundled script.
 */
export async function setBreakpoint({ urlPattern, line, column, condition }) {
  const result = await resolveLocation({ urlPattern, line, column, condition });

  if (!result.id) {
    // Neither strategy succeeded — return error without storing
    return {
      urlPattern, line, column: column || null, condition: condition || null,
      type: "breakpoint", resolved: [], error: result.error,
    };
  }

  const bp = {
    id: result.id,
    urlPattern,
    line,
    column: column || null,
    condition: condition || null,
    type: "breakpoint",
    resolved: result.resolved,
    ...(result.resolvedVia ? { resolvedVia: result.resolvedVia } : {}),
    ...(result.originalSource ? { originalSource: result.originalSource } : {}),
  };

  breakpoints.set(bp.id, bp);
  log.info("breakpoint set", bp);
  return bp;
}

/**
 * Set a logpoint — a non-pausing breakpoint that captures variable values.
 * Accepts original source file names (e.g. "CartItem.tsx") — resolved via
 * source maps to the generated location in the bundled script.
 *
 * Output format: ⚡RDM|<label>|<timestamp>|<JSON data>
 */
export async function setLogpoint({ urlPattern, line, column, expressions, label }) {
  const resolvedLabel = label || nextLogpointLabel();

  // Build condition that logs structured data and returns false (no pause)
  const captureCode = Object.entries(expressions)
    .map(([name, expr]) =>
      `${JSON.stringify(name)}: (() => { try { const v = ${expr}; return JSON.parse(JSON.stringify(v)); } catch(e) { return '[[error: ' + e.message + ']]'; } })()`
    )
    .join(",\n      ");

  const condition = `((() => {
    try {
      const __data = { ${captureCode} };
      console.log("${LOGPOINT_PREFIX}|${resolvedLabel}|" + Date.now() + "|" + JSON.stringify(__data));
    } catch(e) {
      console.log("${LOGPOINT_PREFIX}|${resolvedLabel}|" + Date.now() + "|" + JSON.stringify({__error: e.message}));
    }
    return false;
  })())`;

  const result = await resolveLocation({ urlPattern, line, column, condition });

  if (!result.id) {
    return {
      urlPattern, line, column: column || null,
      type: "logpoint", label: resolvedLabel, expressions,
      resolved: [], error: result.error,
    };
  }

  const lp = {
    id: result.id,
    urlPattern, line, column: column || null,
    type: "logpoint", label: resolvedLabel, expressions,
    resolved: result.resolved,
    ...(result.resolvedVia ? { resolvedVia: result.resolvedVia } : {}),
    ...(result.originalSource ? { originalSource: result.originalSource } : {}),
  };

  breakpoints.set(lp.id, lp);
  log.info("logpoint set", lp);
  return lp;
}

/**
 * Remove a breakpoint or logpoint by ID.
 */
export async function removeBreakpoint(breakpointId) {
  const cdp = requireCdp();
  await cdp.Debugger.removeBreakpoint({ breakpointId });
  breakpoints.delete(breakpointId);
  log.info("breakpoint removed", { breakpointId });
}

/**
 * Remove all breakpoints and logpoints.
 */
export async function removeAllBreakpoints() {
  const cdp = requireCdp();
  for (const id of breakpoints.keys()) {
    try { await cdp.Debugger.removeBreakpoint({ breakpointId: id }); } catch {}
  }
  breakpoints.clear();
  resetLogpointCounter();
  log.info("all breakpoints/logpoints removed");
}

/**
 * List all active breakpoints and logpoints.
 */
export function listBreakpoints() {
  return Array.from(breakpoints.values());
}
