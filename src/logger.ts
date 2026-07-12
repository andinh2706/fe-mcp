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
  // via logging/setLevel. `data` is folded into the message string because MCP
  // log notifications carry a single `data` payload.
  if (mcpServer) {
    try {
      mcpServer.sendLoggingMessage({
        // `|| "info"` is defensive only (every LogLevel is mapped); `as any`
        // bridges our string to the SDK's LoggingLevel union.
        level: (MCP_LEVEL_MAP[level] || "info") as any,
        logger: "react-debug-mcp",
        data: data
          ? `${message} ${JSON.stringify(data)}`
          : message,
      });
    } catch {
      // Non-fatal — server might not be connected yet or the client dropped.
    }
  }
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
   * Register the McpServer instance to enable MCP logging notifications.
   * Call once from index.ts after creating the server. Until this is called,
   * logs go to stderr/file only.
   */
  setServer(server: McpServer) {
    mcpServer = server;
  },
};
