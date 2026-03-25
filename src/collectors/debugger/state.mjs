/**
 * Shared mutable state for the debugger collector.
 *
 * Centralized here so all sub-modules import from the same source.
 * ESM module singletons guarantee a single instance.
 */

/** Reference to the CDP client */
let cdp = null;

export function getCdp() { return cdp; }
export function setCdp(client) { cdp = client; }
export function requireCdp() {
  if (!cdp) throw new Error("Not connected");
  return cdp;
}

/**
 * Loaded scripts: url → { scriptId, sourceMapURL }
 * URL-keyed so page refreshes overwrite stale entries automatically.
 */
export const scripts = new Map();

/** Reverse lookup: scriptId → url (for resolving locations from CDP responses) */
export const scriptIdToUrl = new Map();

/** Cached source map consumers: scriptUrl → { consumer, sources } */
export const sourceMapCache = new Map();

/** Active breakpoints: id → { id, url, line, column, type, ... } */
export const breakpoints = new Map();

/** Buffered pause event — stored when Debugger.paused fires */
let pausedState = null;

export function getPausedState() { return pausedState; }
export function setPausedState(state) { pausedState = state; }

/** Resolve function for wait_for_breakpoint — called when paused */
let pauseWaiter = null;

export function getPauseWaiter() { return pauseWaiter; }
export function setPauseWaiter(fn) { pauseWaiter = fn; }

/** Logpoint counter for unique labels */
let logpointCounter = 0;

export function nextLogpointLabel() { return `lp${++logpointCounter}`; }
export function resetLogpointCounter() { logpointCounter = 0; }

/** Prefix for logpoint console messages — agent searches for this */
export const LOGPOINT_PREFIX = "⚡RDM";
