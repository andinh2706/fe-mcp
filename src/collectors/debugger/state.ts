/**
 * Shared mutable state for the debugger collector.
 *
 * Every sub-module (scripts / breakpoints / pause / source-reading) imports its
 * state from here, so the ESM module singleton IS the single source of truth —
 * there is exactly one instance per process.
 *
 * LIFECYCLE NOTE: this state lives for the whole process and is NOT reset when
 * cdp-client re-attaches after a reconnect. That's fine for the common case (a
 * page *reload* keeps the same CDP session, and URL-based breakpoints auto-
 * rebind), but note two inherent CDP limitations:
 *   - Source-map breakpoints are pinned to a scriptId; after a reload the script
 *     gets a new id, so those entries in `breakpoints` become stale.
 *   - After a full disconnect + reconnect, previously-issued breakpoint IDs
 *     belong to the old session; removeBreakpoint on them no-ops (errors are
 *     swallowed) and listBreakpoints may show stale entries until cleared.
 */

import type { Client } from "chrome-remote-interface";

/** The CDP client for the current connection; set by attach(), required by every command. */
let cdp: Client | null = null;

export function getCdp(): Client | null { return cdp; }
export function setCdp(client: Client): void { cdp = client; }
/** Return the client or throw a clear error — used by every command that talks to CDP. */
export function requireCdp(): Client {
  if (!cdp) throw new Error("Not connected");
  return cdp;
}

interface ScriptInfo {
  scriptId: string;
  sourceMapURL: string | null;
}

/**
 * Loaded scripts: url → { scriptId, sourceMapURL }
 * URL-keyed so page refreshes overwrite stale entries automatically.
 */
export const scripts = new Map<string, ScriptInfo>();

/** Reverse lookup: scriptId → url (for resolving locations from CDP responses) */
export const scriptIdToUrl = new Map<string, string>();

/** Cached source map consumers: scriptUrl → { consumer, sources } */
export const sourceMapCache = new Map<string, any>();

/** Active breakpoints: id → { id, url, line, column, type, ... } */
export const breakpoints = new Map<string, any>();

/**
 * The most recent Debugger.paused event, buffered here so a pause that arrives
 * BEFORE wait_for_breakpoint is called isn't lost. Set on paused, cleared on
 * resume/step. `waitForBreakpoint` consults this before ever registering a
 * waiter — that's what makes the step→pause handshake race-free.
 */
let pausedState: any = null;

export function getPausedState(): any { return pausedState; }
export function setPausedState(state: any): void { pausedState = state; }

/**
 * One-shot callback that a waiting wait_for_breakpoint installs so the next
 * Debugger.paused wakes it. Single-slot by design: interactive debugging pauses
 * one call at a time. Cleared when fired or when its wait times out.
 */
let pauseWaiter: ((evt: any) => void) | null = null;

export function getPauseWaiter(): ((evt: any) => void) | null { return pauseWaiter; }
export function setPauseWaiter(fn: ((evt: any) => void) | null): void { pauseWaiter = fn; }

/** Monotonic counter backing auto-generated logpoint labels (lp1, lp2, …). */
let logpointCounter = 0;

export function nextLogpointLabel(): string { return `lp${++logpointCounter}`; }
export function resetLogpointCounter(): void { logpointCounter = 0; }

/** Prefix for logpoint console messages — agent searches for this */
export const LOGPOINT_PREFIX = "⚡RDM";

/**
 * Reset every piece of session-scoped state to a clean slate.
 *
 * Called at the start of attach() so each new CDP session begins fresh. A new
 * session invalidates ALL prior handles (scriptIds, breakpoint IDs, paused
 * call-frame/object IDs), so carrying the old maps forward would produce the
 * bugs described in the lifecycle note above: mislabeled locations from
 * scriptId reuse, a phantom pause if we disconnected while paused, and
 * listings of breakpoints that no longer exist. On the first connect the
 * collections are already empty, so this is a no-op.
 *
 * Note: a parked wait_for_breakpoint (if any) is not rejected here — its own
 * timeout will fire and reject it. Breakpoints are cleared, not re-applied:
 * re-establishing them on the new session is intentionally out of scope.
 */
export function resetState(): void {
  scripts.clear();
  scriptIdToUrl.clear();
  sourceMapCache.clear();
  breakpoints.clear();
  pausedState = null;
  pauseWaiter = null;
  logpointCounter = 0;
}
