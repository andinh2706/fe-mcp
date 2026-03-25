/**
 * Debugger Collector — barrel module.
 *
 * Manages the CDP Debugger domain. Split into sub-modules:
 *   state.mjs          — shared mutable state
 *   scripts.mjs        — script tracking, source map resolution
 *   breakpoints.mjs    — set/remove breakpoints and logpoints
 *   pause.mjs          — wait, step, resume, scope inspection
 *   source-reading.mjs — read and search bundled script source
 *
 * This file handles attach() and re-exports the public API.
 */

import { log } from "../../logger.mjs";
import { setCdp, getPauseWaiter, setPauseWaiter, setPausedState, LOGPOINT_PREFIX } from "./state.mjs";
import { onScriptParsed } from "./scripts.mjs";

// Re-export public API from sub-modules
export { listScripts } from "./scripts.mjs";
export { setBreakpoint, setLogpoint, removeBreakpoint, removeAllBreakpoints, listBreakpoints } from "./breakpoints.mjs";
export { waitForBreakpoint, inspectScope, evaluateAtBreakpoint, resume, stepOver, stepInto, stepOut, isPaused } from "./pause.mjs";
export { getSource, searchSource } from "./source-reading.mjs";
export { LOGPOINT_PREFIX };

/**
 * Attach to a CDP client. Enables Debugger domain and listens for events.
 * Called once from cdp-client.mjs on connection.
 */
export async function attach(client) {
  setCdp(client);

  await client.Debugger.enable();

  // Track loaded scripts
  client.Debugger.scriptParsed(onScriptParsed);

  // Buffer pause events
  client.Debugger.paused((params) => {
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

  client.Debugger.resumed(() => {
    log.info("debugger resumed");
    setPausedState(null);
  });

  log.info("debugger collector attached");
}
