/**
 * Debugger Tools
 *
 * Two debugging modes:
 *
 * BREAKPOINT FLOW (interactive, pauses execution):
 *   set_breakpoint → (user acts) → wait_for_breakpoint → inspect/evaluate →
 *   set new breakpoint + resume → repeat
 *
 * LOGPOINT FLOW (passive, no pause):
 *   set_logpoint → (user acts) → agent reads structured logs via
 *   chrome-devtools-mcp list_console_messages → set more logpoints → repeat
 *
 * Logpoints are prefixed with ⚡RDM so the agent can filter them from noise.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as dbg from "../collectors/debugger/index.js";
import { log } from "../logger.js";
import { serverLimits } from "../limits.js";

const { BREAKPOINT_DEFAULT_TIMEOUT_S, LOG_EXPRESSION_TRUNCATE } = serverLimits();

export function register(server: McpServer) {

  // ==========================================================================
  // BREAKPOINTS
  // ==========================================================================

  server.tool(
    "list_scripts",
    `List BUNDLED JavaScript files loaded in the browser (e.g. "main.js",
"vendors-node_modules_lodash.js"). These are the actual script URLs the
browser downloaded — NOT original source files like "CartItem.tsx".

Original source files (e.g. .tsx, .ts) only exist inside source maps.
They won't appear here. Use this when you need to see what bundles are
loaded, or to debug why set_breakpoint can't resolve a file.`,
    {
      filter: z.string().optional().describe("Substring to filter bundled script URLs (e.g. 'main', 'vendor', '.js')"),
    },
    async ({ filter }) => {
      log.info("list_scripts", { filter });
      const scripts = dbg.listScripts(filter);
      return {
        content: [{
          type: "text",
          text: scripts.length > 0
            ? JSON.stringify({ total: scripts.length, scripts }, null, 2)
            : `No scripts found${filter ? ` matching "${filter}"` : ""}. The page may not have loaded yet — try calling get_page_info first.`,
        }],
      };
    }
  );

  server.tool(
    "read_source",
    `Read the BUNDLED (generated) source code of a script as the browser sees it.
Returns the compiled JavaScript from the bundle, NOT the original .tsx/.ts source.

Use this for: inspecting vendor/third-party code, verifying what the browser
is actually executing, or debugging source map issues.

For reading your own application source code, use the filesystem directly —
original line numbers match the filesystem exactly (webpack dev server +
devtool: source-map).`,
    {
      file: z.string().describe("Bundled script name or URL fragment (e.g. 'main.js', 'vendor')"),
      start_line: z.number().optional().describe("First line to return (1-based, default: 1)"),
      end_line: z.number().optional().describe("Last line to return (1-based, default: start + 200)"),
    },
    async ({ file, start_line, end_line }) => {
      log.info("read_source", { file, start_line, end_line });
      try {
        const result = await dbg.getSource(file, start_line, end_line);
        if (result.error) {
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], isError: true };
        }
        const header = `File: ${result.url}\nLines: ${result.showing.from}–${result.showing.to} of ${result.totalLines}${result.hasSourceMap ? " (source-mapped)" : ""}\n${"─".repeat(60)}`;
        return { content: [{ type: "text", text: header + "\n" + result.source }] };
      } catch (err: any) {
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "search_source",
    `Search for a text pattern across BUNDLED scripts loaded in the browser.
Returns matches with bundled script URLs and line numbers in the generated
(compiled) code — NOT original source line numbers.

Use this to narrow down WHICH bundled files contain a function or variable
when you don't know where to look. For searching original source code, use
grep/find on the filesystem instead.

Searches run in parallel across all loaded scripts for fast results.`,
    {
      query: z.string().describe("Text to search for (plain text or regex)"),
      file_filter: z.string().optional().describe("Substring to filter which files are searched (e.g. 'CartItem', 'hooks/')"),
      is_regex: z.boolean().optional().describe("Treat query as a regular expression (default: false)"),
      case_sensitive: z.boolean().optional().describe("Case-sensitive search (default: false)"),
    },
    async ({ query, file_filter, is_regex, case_sensitive }) => {
      log.info("search_source", { query, file_filter, is_regex });
      try {
        const result = await dbg.searchSource(query, file_filter, is_regex, case_sensitive);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err: any) {
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "set_breakpoint",
    `Set a breakpoint using an ORIGINAL source file name and line number.
Execution will PAUSE when this line is hit.

Accepts original source file names (e.g. "CartItem.tsx", "useCheckout.ts") —
the tool automatically resolves these to the correct location in the bundled
script via source maps. Read the source file from the filesystem FIRST to
identify the correct line number.

Resolution strategy:
  1. Tries matching the file name against bundled script URLs directly
  2. If no match, searches source maps for the original file and maps the
     line to the generated (bundled) location

An optional condition can make it conditional (e.g. "item.id === 5").`,
    {
      file: z.string().describe("Original source file name or path fragment (e.g. 'CartItem.tsx', 'hooks/useCart')"),
      line: z.number().describe("Line number in the original source file (1-based)"),
      column: z.number().optional().describe("Column number in the original source file (1-based, optional)"),
      condition: z.string().optional().describe("JS expression — breakpoint only fires when truthy (e.g. 'count > 10', 'item.id === 5')"),
    },
    async ({ file, line, column, condition }) => {
      log.info("set_breakpoint", { file, line, condition });
      try {
        const bp = await dbg.setBreakpoint({ urlPattern: file, line, column, condition });

        if (bp.error) {
          return { content: [{ type: "text", text: JSON.stringify(bp, null, 2) }], isError: true };
        }

        const resolved = bp.resolved.length > 0
          ? `Resolved to: ${bp.resolved.map((r: any) => `${r.url}:${r.line}:${r.column}`).join(", ")}${bp.resolvedVia === "source-map" ? ` (via source map, original: ${bp.originalSource})` : ""}`
          : "Pending — script not yet loaded. The breakpoint will activate when the script loads.";
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              breakpointId: bp.id,
              file,
              line,
              condition: condition || null,
              resolved: bp.resolved,
              message: resolved,
              nextStep: "Have the user perform the action that triggers this code, then call wait_for_breakpoint.",
            }, null, 2),
          }],
        };
      } catch (err: any) {
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "wait_for_breakpoint",
    `Block until a breakpoint is hit. Returns the call stack, the function name
and file location where execution paused, and all local/closure scope variables
at the top of the stack.

Call this AFTER setting a breakpoint and after the user has performed (or is
performing) the action that triggers the code path. If the breakpoint was already
hit before this call, it returns immediately with the buffered state.

After this returns, the execution is PAUSED. You can then:
  - inspect_scope(frame_index) to look at other stack frames
  - evaluate_at_breakpoint(expression) to eval in the paused context
  - step_over / step_into / step_out to advance execution
  - resume to continue, optionally after setting new breakpoints`,
    {
      timeout_seconds: z.number().optional().describe(`How long to wait (default: ${BREAKPOINT_DEFAULT_TIMEOUT_S}s). If you expect the user to need time, increase this.`),
    },
    async ({ timeout_seconds = BREAKPOINT_DEFAULT_TIMEOUT_S }) => {
      log.info("wait_for_breakpoint", { timeout_seconds });
      try {
        const result = await dbg.waitForBreakpoint(timeout_seconds * 1000);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err: any) {
        return { content: [{ type: "text", text: err.message }], isError: true };
      }
    }
  );

  server.tool(
    "inspect_scope",
    `Inspect variables in a specific call frame while paused at a breakpoint.
Frame 0 is the top of the stack (where the breakpoint hit). Higher indices
are callers further up the stack. Returns local variables, closure variables,
and the 'this' binding.`,
    {
      frame_index: z.number().optional().describe("Stack frame index (default: 0 = top of stack)"),
    },
    async ({ frame_index = 0 }) => {
      log.info("inspect_scope", { frame_index });
      try {
        const result = await dbg.inspectScope(frame_index);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err: any) {
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "evaluate_at_breakpoint",
    `Evaluate a JavaScript expression in the context of the paused call frame.
The expression has access to all local variables, closures, and 'this' at
the breakpoint location. Use this to inspect specific values, call methods,
or check conditions that the scope dump doesn't show clearly.

Examples: "response.data", "items.filter(i => i.status === 'error')",
"this.state", "Object.keys(props)"`,
    {
      expression: z.string().describe("JS expression to evaluate in the paused frame's context"),
      frame_index: z.number().optional().describe("Which stack frame to evaluate in (default: 0 = top)"),
    },
    async ({ expression, frame_index = 0 }) => {
      log.info("evaluate_at_breakpoint", { expression: expression.slice(0, LOG_EXPRESSION_TRUNCATE), frame_index });
      try {
        const result = await dbg.evaluateAtBreakpoint(expression, frame_index);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err: any) {
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "step_over",
    `Execute the current line and pause at the next line (does not enter function
calls). Returns the new pause location and scope, just like wait_for_breakpoint.
Only works while paused at a breakpoint.`,
    {},
    async () => {
      log.info("step_over");
      try {
        const result = await dbg.stepOver();
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err: any) {
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "step_into",
    `Step into the function call on the current line. Returns the new pause
location inside the called function. Only works while paused at a breakpoint.`,
    {},
    async () => {
      log.info("step_into");
      try {
        const result = await dbg.stepInto();
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err: any) {
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "step_out",
    `Step out of the current function, pausing at the caller. Returns the new
pause location. Only works while paused at a breakpoint.`,
    {},
    async () => {
      log.info("step_out");
      try {
        const result = await dbg.stepOut();
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err: any) {
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "resume",
    `Resume execution after a breakpoint pause. If you've set additional
breakpoints, execution will pause again when one is hit — call
wait_for_breakpoint again to catch it. If no more breakpoints are ahead,
execution continues normally.`,
    {},
    async () => {
      log.info("resume");
      try {
        await dbg.resume();
        return {
          content: [{
            type: "text",
            text: "Execution resumed. If another breakpoint is ahead, call wait_for_breakpoint to catch it.",
          }],
        };
      } catch (err: any) {
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  // ==========================================================================
  // LOGPOINTS
  // ==========================================================================

  server.tool(
    "set_logpoint",
    `Set a logpoint — a non-pausing breakpoint that captures variable values to
the console. Accepts ORIGINAL source file names (e.g. "CartItem.tsx") —
resolved to bundled locations via source maps, same as set_breakpoint.

Unlike breakpoints, logpoints do NOT pause execution. They output structured
data to console.log with the prefix "${dbg.LOGPOINT_PREFIX}" so the agent can
find them among other logs.

After setting logpoints, tell the user to perform the action, then use
chrome-devtools-mcp's list_console_messages to read the results. Filter for
messages containing "${dbg.LOGPOINT_PREFIX}" to find logpoint output.

Output format: ${dbg.LOGPOINT_PREFIX}|<label>|<timestamp>|<JSON data>`,
    {
      file: z.string().describe("Original source file name or path fragment (e.g. 'CartItem.tsx')"),
      line: z.number().describe("Line number in the original source file (1-based)"),
      column: z.number().optional().describe("Column number (1-based, optional)"),
      expressions: z.record(z.string()).describe(
        "Object mapping label names to JS expressions to capture (e.g. {\"count\": \"count\", \"data\": \"response.data\"})"
      ),
      label: z.string().optional().describe("Custom label for this logpoint (default: auto-generated like 'lp1')"),
    },
    async ({ file, line, column, expressions, label }) => {
      log.info("set_logpoint", { file, line, expressions, label });
      try {
        const lp = await dbg.setLogpoint({ urlPattern: file, line, column, expressions, label });

        if (lp.error) {
          return { content: [{ type: "text", text: JSON.stringify(lp, null, 2) }], isError: true };
        }

        const resolved = lp.resolved.length > 0
          ? `Resolved to: ${lp.resolved.map((r: any) => `${r.url}:${r.line}`).join(", ")}${lp.resolvedVia === "source-map" ? ` (via source map)` : ""}`
          : "Pending — script not yet loaded.";
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              logpointId: lp.id,
              label: lp.label,
              file,
              line,
              expressions,
              resolved: lp.resolved,
              message: resolved,
              nextStep: `Tell the user to perform the action. Then use chrome-devtools-mcp list_console_messages and look for "${dbg.LOGPOINT_PREFIX}|${lp.label}" in the output.`,
            }, null, 2),
          }],
        };
      } catch (err: any) {
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  // ==========================================================================
  // MANAGEMENT
  // ==========================================================================

  server.tool(
    "list_breakpoints",
    `List all active breakpoints and logpoints with their IDs, locations, and types.`,
    {},
    async () => {
      const bps = dbg.listBreakpoints();
      return {
        content: [{
          type: "text",
          text: bps.length > 0
            ? JSON.stringify(bps, null, 2)
            : "No active breakpoints or logpoints.",
        }],
      };
    }
  );

  server.tool(
    "remove_breakpoint",
    `Remove a specific breakpoint or logpoint by its ID (returned by set_breakpoint
or set_logpoint).`,
    {
      breakpoint_id: z.string().describe("The breakpoint/logpoint ID to remove"),
    },
    async ({ breakpoint_id }) => {
      log.info("remove_breakpoint", { breakpoint_id });
      try {
        await dbg.removeBreakpoint(breakpoint_id);
        return { content: [{ type: "text", text: `Removed: ${breakpoint_id}` }] };
      } catch (err: any) {
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "remove_all_breakpoints",
    `Remove ALL breakpoints and logpoints. Use this to clean up before starting
a new debugging investigation.`,
    {},
    async () => {
      log.info("remove_all_breakpoints");
      try {
        await dbg.removeAllBreakpoints();
        return { content: [{ type: "text", text: "All breakpoints and logpoints removed." }] };
      } catch (err: any) {
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );
}
