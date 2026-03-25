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
 * Setup (in index.mjs, after creating the McpServer):
 *   import { log } from './logger.mjs';
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

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const stderrLevel = LEVELS[process.env.LOG_LEVEL || "info"] ?? LEVELS.info;
const logFile = process.env.LOG_FILE || null;

/**
 * Map our log levels to MCP LoggingLevel values.
 * MCP uses syslog-style: debug, info, notice, warning, error, critical, alert, emergency
 */
const MCP_LEVEL_MAP = {
  debug: "debug",
  info: "info",
  warn: "warning",
  error: "error",
};

/** Reference to the McpServer instance, set via log.setServer() */
let mcpServer = null;

function formatEntry(level, message, data) {
  const entry = {
    time: new Date().toISOString(),
    level,
    msg: message,
    ...(data && Object.keys(data).length > 0 ? { data } : {}),
  };
  return JSON.stringify(entry);
}

function write(level, message, data) {
  // ── stderr (always-on fallback) ──────────────────────────────────────
  if (LEVELS[level] >= stderrLevel) {
    const line = formatEntry(level, message, data);
    process.stderr.write(line + "\n");

    if (logFile) {
      try { appendFileSync(logFile, line + "\n"); } catch {}
    }
  }

  // ── MCP notification (when server is connected) ──────────────────────
  if (mcpServer) {
    try {
      mcpServer.sendLoggingMessage({
        level: MCP_LEVEL_MAP[level] || "info",
        logger: "react-debug-mcp",
        data: data
          ? `${message} ${JSON.stringify(data)}`
          : message,
      });
    } catch {
      // Non-fatal — server might not be connected yet or client disconnected
    }
  }
}

export const log = {
  debug: (msg, data) => write("debug", msg, data),
  info: (msg, data) => write("info", msg, data),
  warn: (msg, data) => write("warn", msg, data),
  error: (msg, data) => write("error", msg, data),

  /**
   * Register the McpServer instance to enable MCP logging notifications.
   * Call once from index.mjs after creating the server.
   * @param {import("@modelcontextprotocol/sdk/server/mcp.js").McpServer} server
   */
  setServer(server) {
    mcpServer = server;
  },
};
