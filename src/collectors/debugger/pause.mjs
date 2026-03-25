/**
 * Pause, resume, stepping, and scope inspection.
 *
 * All locations returned are in bundled script coordinates (line/column
 * in the generated bundle, not original source files).
 */

import { log } from "../../logger.mjs";
import { BREAKPOINT_SCOPE_MAX_PROPS, STEP_TIMEOUT_MS } from "../../limits.mjs";
import {
  requireCdp, breakpoints,
  getPausedState, setPausedState,
  setPauseWaiter,
} from "./state.mjs";

// ---------------------------------------------------------------------------
// Wait / Resume / Stepping
// ---------------------------------------------------------------------------

/**
 * Wait for a breakpoint to be hit. Blocks until Debugger.paused fires.
 * If already paused (buffered), returns immediately.
 */
export async function waitForBreakpoint(timeoutMs = 60000) {
  requireCdp();

  let params = getPausedState();

  if (!params) {
    params = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        setPauseWaiter(null);
        reject(new Error(`Timeout: no breakpoint hit within ${timeoutMs / 1000}s. Perform the action that triggers the code path, then call wait_for_breakpoint again.`));
      }, timeoutMs);

      setPauseWaiter((evt) => {
        clearTimeout(timer);
        resolve(evt);
      });
    });
  }

  const frames = params.callFrames.map((frame, i) => ({
    index: i,
    functionName: frame.functionName || "(anonymous)",
    url: frame.url,
    line: frame.location.lineNumber + 1,
    column: frame.location.columnNumber + 1,
  }));

  let topScope = null;
  if (params.callFrames.length > 0) {
    topScope = await getScopeVariables(params.callFrames[0], BREAKPOINT_SCOPE_MAX_PROPS);
  }

  const hitBp = params.hitBreakpoints?.[0];
  const bpInfo = hitBp ? breakpoints.get(hitBp) : null;

  return {
    reason: params.reason,
    hitBreakpoint: bpInfo ? { id: bpInfo.id, urlPattern: bpInfo.urlPattern, line: bpInfo.line } : null,
    callStack: frames,
    topFrame: {
      function: frames[0]?.functionName,
      location: `${frames[0]?.url}:${frames[0]?.line}:${frames[0]?.column}`,
      scope: topScope,
    },
    isPaused: true,
  };
}

/**
 * Inspect scope variables for a specific call frame (while paused).
 * frame_index 0 = top of stack.
 */
export async function inspectScope(frameIndex = 0, maxProps = 30) {
  const pausedState = getPausedState();
  if (!pausedState) throw new Error("Not paused at a breakpoint. Call wait_for_breakpoint first.");
  if (frameIndex >= pausedState.callFrames.length) {
    throw new Error(`Frame index ${frameIndex} out of range. Stack has ${pausedState.callFrames.length} frames.`);
  }

  const frame = pausedState.callFrames[frameIndex];
  const scope = await getScopeVariables(frame, maxProps);

  return {
    frameIndex,
    function: frame.functionName || "(anonymous)",
    location: `${frame.url}:${frame.location.lineNumber + 1}:${frame.location.columnNumber + 1}`,
    scope,
  };
}

/**
 * Evaluate an expression in the context of a paused call frame.
 */
export async function evaluateAtBreakpoint(expression, frameIndex = 0) {
  const cdp = requireCdp();
  const pausedState = getPausedState();
  if (!pausedState) throw new Error("Not paused at a breakpoint.");

  const frame = pausedState.callFrames[frameIndex];
  if (!frame) throw new Error(`Frame ${frameIndex} out of range.`);

  const result = await cdp.Debugger.evaluateOnCallFrame({
    callFrameId: frame.callFrameId,
    expression: `(function() {
      try {
        const __v = ${expression};
        return JSON.parse(JSON.stringify(__v));
      } catch(e) {
        return { __evaluationError: e.message };
      }
    })()`,
    returnByValue: true,
  });

  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text + " " + (result.exceptionDetails.exception?.description || ""));
  }

  return result.result.value;
}

/** Resume execution. */
export async function resume() {
  const cdp = requireCdp();
  if (!getPausedState()) throw new Error("Not paused.");
  await cdp.Debugger.resume();
  setPausedState(null);
  log.info("resumed execution");
}

/** Step over the current line. */
export async function stepOver() {
  const cdp = requireCdp();
  if (!getPausedState()) throw new Error("Not paused.");
  setPausedState(null);
  await cdp.Debugger.stepOver();
  return waitForBreakpoint(STEP_TIMEOUT_MS);
}

/** Step into the current function call. */
export async function stepInto() {
  const cdp = requireCdp();
  if (!getPausedState()) throw new Error("Not paused.");
  setPausedState(null);
  await cdp.Debugger.stepInto();
  return waitForBreakpoint(STEP_TIMEOUT_MS);
}

/** Step out of the current function. */
export async function stepOut() {
  const cdp = requireCdp();
  if (!getPausedState()) throw new Error("Not paused.");
  setPausedState(null);
  await cdp.Debugger.stepOut();
  return waitForBreakpoint(STEP_TIMEOUT_MS);
}

/** Check if currently paused. */
export function isPaused() {
  return getPausedState() !== null;
}

// ---------------------------------------------------------------------------
// Scope variable extraction (internal)
// ---------------------------------------------------------------------------

async function getScopeVariables(frame, maxProps) {
  const cdp = requireCdp();
  const result = { local: {}, closure: {} };

  for (const scope of frame.scopeChain) {
    if (scope.type !== "local" && scope.type !== "closure") continue;
    if (!scope.object?.objectId) continue;

    try {
      const props = await cdp.Runtime.getProperties({
        objectId: scope.object.objectId,
        ownProperties: true,
        generatePreview: true,
      });

      const target = scope.type === "local" ? result.local : result.closure;
      let count = 0;

      for (const prop of props.result) {
        if (count >= maxProps) {
          target["...truncated"] = `${props.result.length - maxProps} more properties`;
          break;
        }
        if (prop.name.startsWith("__")) continue;

        if (prop.value) {
          try {
            if (prop.value.type === "object" && prop.value.objectId) {
              if (prop.value.preview) {
                const obj = {};
                for (const p of prop.value.preview.properties || []) {
                  obj[p.name] = p.value;
                }
                if (prop.value.preview.overflow) obj["..."] = "more properties";
                target[prop.name] = obj;
              } else {
                target[prop.name] = prop.value.description || `[${prop.value.type}]`;
              }
            } else if (prop.value.type === "function") {
              target[prop.name] = `[function ${prop.value.description?.split("(")[0]?.trim() || ""}]`;
            } else {
              target[prop.name] = prop.value.value !== undefined ? prop.value.value : prop.value.description;
            }
          } catch {
            target[prop.name] = `[${prop.value.type}]`;
          }
        }
        count++;
      }
    } catch (err) {
      log.debug("scope read error", { type: scope.type, error: err.message });
    }
  }

  if (frame.this) {
    try {
      if (frame.this.preview) {
        const obj = {};
        for (const p of frame.this.preview.properties || []) {
          obj[p.name] = p.value;
        }
        result.this = obj;
      } else if (frame.this.value !== undefined) {
        result.this = frame.this.value;
      } else {
        result.this = frame.this.description || frame.this.type;
      }
    } catch {
      result.this = frame.this.type;
    }
  }

  return result;
}
