/**
 * Dual-mode logger for the MCP server.
 *
 * Two output channels:
 *
 *   1. MCP notifications (primary) — sends structured `notifications/message`
 *      to the connected MCP client. These appear in the MCP Inspector's logging
 *      panel alongside tool calls. The client can control the level dynamically
 *      via `logging/setLevel`.
 *
 *   2. stderr + optional file (fallback) — always active, works before the MCP
 *      server is connected and in non-MCP contexts.
 *
 * CRITICAL: MCP uses stdin/stdout for JSON-RPC transport.
 * Any console.log() will corrupt the protocol and crash the connection.
 *
 * Setup (in index.ts, after creating the McpServer):
 *   import { log } from './logger.js';
 *   log.setServer(server);  // enables MCP notifications
 *
 * Environment variables:
 *   LOG_LEVEL=debug|info|warn|error  (default: info) — controls stderr output
 *   LOG_FILE=/path/to/debug.log      (optional, also writes to a file)
 *
 * MCP notification level is controlled independently by the client via
 * `logging/setLevel`. If no setLevel is received, the server sends all
 * messages at info and above.
 */

import { appendFileSync } from "node:fs";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ENV, type LogLevel } from "./env.js";
import { serverLimits } from "./limits.js";

const { TOOL_RESULT_PREVIEW } = serverLimits();

// Numeric severities so `write` can gate output with a simple `>=` comparison.
const LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

// LOG_LEVEL gates ONLY the stderr/file channel: messages below this are dropped
// there. (The MCP channel's verbosity is controlled independently by the client
// via `logging/setLevel` — see write().)
const stderrLevel = LEVELS[ENV.LOG_LEVEL];
const logFile = ENV.LOG_FILE;

/**
 * Map our four levels to MCP LoggingLevel values.
 * MCP uses syslog-style names (debug, info, notice, warning, error, critical,
 * alert, emergency); our "warn" is MCP "warning".
 */
const MCP_LEVEL_MAP: Record<LogLevel, string> = {
  debug: "debug",
  info: "info",
  warn: "warning",
  error: "error",
};

/**
 * The McpServer instance, once registered via setServer(). While null (i.e.
 * before startup wiring, or in non-MCP contexts), the MCP channel is skipped
 * and only stderr/file is used.
 */
let mcpServer: McpServer | null = null;

/** Render one log record as a single-line JSON string; omits `data` when empty. */
function formatEntry(level: LogLevel, message: string, data?: Record<string, any>): string {
  const entry = {
    time: new Date().toISOString(),
    level,
    msg: message,
    ...(data && Object.keys(data).length > 0 ? { data } : {}),
  };
  return JSON.stringify(entry);
}

/**
 * Fan a log record out to both channels.
 *
 * IMPORTANT: never use console.log here — stdout is the MCP JSON-RPC transport,
 * so diagnostics MUST go to stderr (or the SDK's structured notifications).
 */
function write(level: LogLevel, message: string, data?: Record<string, any>): void {
  // ── stderr + optional file (always-on fallback, gated by LOG_LEVEL) ──
  if (LEVELS[level] >= stderrLevel) {
    const line = formatEntry(level, message, data);
    process.stderr.write(line + "\n");

    if (logFile) {
      // Best-effort file logging — a bad path must not crash the server.
      try { appendFileSync(logFile, line + "\n"); } catch {}
    }
  }

  // ── MCP notification (only once a server is registered) ──────────────
  // Sent regardless of LOG_LEVEL; the connected client decides what it wants
  // via logging/setLevel.
  //
  // `data` is sent as a STRUCTURED OBJECT, not a flattened string. The MCP spec
  // types this field as arbitrary JSON ("a string message or an object"), so
  // clients render it as expandable JSON rather than one long line — which is
  // what makes the LOG_TOOL_RESULTS trace legible in a client's log panel
  // (OpenCode's, or the MCP Inspector's) instead of a wall of escaped text.
  if (mcpServer) {
    try {
      mcpServer.sendLoggingMessage({
        // `|| "info"` is defensive only (every LogLevel is mapped); `as any`
        // bridges our string to the SDK's LoggingLevel union.
        level: (MCP_LEVEL_MAP[level] || "info") as any,
        logger: "react-debug-mcp",
        // msg first so it reads as a headline, with the structured fields flat
        // alongside it: { msg: "tool done", tool: "get_page_info", ms: 2, … }
        data: { msg: message, ...(data ?? {}) },
      });
    } catch {
      // Non-fatal — server might not be connected yet or the client dropped.
    }
  }
}

/**
 * Log the OUTCOME of every tool call (opt-in via LOG_TOOL_RESULTS).
 *
 * Each tool already logs its invocation (name + args) on entry, but nothing
 * logged how it FINISHED — so a log file told you what an agent asked for, never
 * what it got back. This wraps McpServer.tool() once, adding a completion line
 * (duration, ok/error, result size + preview) to every handler. All 26 tools are
 * covered uniformly, including any that never logged themselves.
 *
 * Combined with LOG_FILE, this turns the log into a full trace of an agent
 * session — the cheap alternative to a tee proxy, with no extra process:
 *
 *   LOG_FILE=./agent.log LOG_TOOL_RESULTS=1 yarn start   # then: tail -f agent.log
 *
 * Off by default: it is noisy, and tool results can carry page data (tokens,
 * store state, response bodies). Result previews are capped at
 * TOOL_RESULT_PREVIEW (src/limits.ts).
 *
 * MUST run before any tool registers — setServer() is called before the
 * register*() calls in index.ts, which is precisely why it lives here.
 *
 * Behaviour-preserving: arguments pass through untouched, the handler's result
 * is returned unchanged, and errors are re-thrown after being logged.
 */
function instrumentToolOutcomes(server: McpServer): void {
  // Cast away the SDK's overload set — we forward arguments verbatim.
  const original = server.tool.bind(server) as (...args: any[]) => any;

  (server as any).tool = (...args: any[]) => {
    // tool() is overloaded, but the handler is always the last argument.
    const last = args.length - 1;
    const handler = args[last];
    if (typeof handler !== "function") return original(...args);

    const tool = String(args[0]);

    args[last] = async (toolArgs: any, extra: any) => {
      const started = Date.now();
      try {
        const result = await handler(toolArgs, extra);
        // MCP results are { content: [{ type: "text", text }], isError? }.
        const text = (result?.content ?? [])
          .map((part: any) => (typeof part?.text === "string" ? part.text : ""))
          .join("\n");
        write("info", "tool done", {
          tool,
          ms: Date.now() - started,
          ok: !result?.isError,
          chars: text.length,
          preview: text.slice(0, TOOL_RESULT_PREVIEW),
        });
        return result;
      } catch (err: any) {
        write("error", "tool threw", { tool, ms: Date.now() - started, error: err?.message });
        throw err;   // never swallow — the client still needs the failure
      }
    };

    return original(...args);
  };
}

/**
 * The public logger. Each method is a thin wrapper over write(). `data` is an
 * optional structured payload (serialized into the log line / MCP message).
 */
export const log = {
  debug: (msg: string, data?: Record<string, any>) => write("debug", msg, data),
  info: (msg: string, data?: Record<string, any>) => write("info", msg, data),
  warn: (msg: string, data?: Record<string, any>) => write("warn", msg, data),
  error: (msg: string, data?: Record<string, any>) => write("error", msg, data),

  /**
   * Register the McpServer instance. This does two things:
   *   1. Enables MCP logging notifications (in addition to stderr/file).
   *   2. When LOG_TOOL_RESULTS is set, instruments the server so every tool
   *      call also logs its outcome — see instrumentToolOutcomes above.
   *
   * Call once from index.ts, after creating the server and BEFORE registering
   * any tools. Until it's called, logs go to stderr/file only.
   */
  setServer(server: McpServer) {
    mcpServer = server;
    if (ENV.LOG_TOOL_RESULTS) instrumentToolOutcomes(server);
  },
};
