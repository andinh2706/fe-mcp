/**
 * Debugger Collector — barrel module.
 *
 * Manages the CDP Debugger domain. Split into sub-modules:
 *   state.ts          — shared mutable state
 *   scripts.ts        — script tracking, source map resolution
 *   breakpoints.ts    — set/remove breakpoints and logpoints
 *   pause.ts          — wait, step, resume, scope inspection
 *   source-reading.ts — read and search bundled script source
 *
 * This file handles attach() and re-exports the public API.
 */

import type { Client } from "chrome-remote-interface";
import { log } from "../../logger.js";
import { setCdp, getPauseWaiter, setPauseWaiter, setPausedState, resetState, LOGPOINT_PREFIX } from "./state.js";
import { onScriptParsed } from "./scripts.js";

// Re-export public API from sub-modules
export { listScripts } from "./scripts.js";
export { setBreakpoint, setLogpoint, removeBreakpoint, removeAllBreakpoints, listBreakpoints } from "./breakpoints.js";
export { waitForBreakpoint, inspectScope, evaluateAtBreakpoint, resume, stepOver, stepInto, stepOut, isPaused } from "./pause.js";
export { getSource, searchSource } from "./source-reading.js";
export { LOGPOINT_PREFIX };

/**
 * Attach to a CDP client: enable the Debugger domain and wire up the event
 * listeners that back the whole subsystem. Called once from cdp-client.ts per
 * connection (see the lifecycle note in state.ts about reconnects).
 */
export async function attach(client: Client): Promise<void> {
  // A new CDP session invalidates every prior handle (scriptIds, breakpoint IDs,
  // paused frames), so start from a clean slate — otherwise stale state from a
  // previous connection leaks in. No-op on the first connect. See state.ts.
  resetState();

  setCdp(client);

  await client.Debugger.enable();

  // Every parsed script (bundles + their source-map URLs) is recorded so
  // breakpoints/source tools can resolve file names to scriptIds later.
  client.Debugger.scriptParsed(onScriptParsed);

  // The pause handshake: on every pause we do TWO things —
  //   1. buffer the event into pausedState (so a pause that beats
  //      wait_for_breakpoint to the punch is not lost), and
  //   2. wake a waiter if one is currently parked.
  // wait_for_breakpoint reads the buffer first, so exactly one of these paths
  // delivers each pause regardless of ordering. See pause.ts.
  client.Debugger.paused((params: any) => {
    log.info("debugger paused", {
      reason: params.reason,
      hitBreakpoints: params.hitBreakpoints,
      topFrame: params.callFrames?.[0]?.functionName,
    });

    setPausedState(params);

    const waiter = getPauseWaiter();
    if (waiter) {
      setPauseWaiter(null);
      waiter(params);
    }
  });

  // On resume the buffer must be cleared, otherwise the next
  // wait_for_breakpoint would immediately return the stale pause.
  client.Debugger.resumed(() => {
    log.info("debugger resumed");
    setPausedState(null);
  });

  log.info("debugger collector attached");
}
