#!/usr/bin/env -S npx tsx

/**
 * react-debug-mcp — Entry Point
 *
 * A focused debugging MCP (Model Context Protocol) server for React apps.
 * Designed to run alongside chrome-devtools-mcp:
 *   - chrome-devtools-mcp: automation (navigate, click, fill, screenshot, performance)
 *   - react-debug-mcp:     runtime inspection (React state, store, network responses)
 *
 * WHAT THIS FILE DOES (startup sequence)
 * ──────────────────────────────────────
 *   1. Creates the McpServer and advertises the `logging` capability so the
 *      connected client can receive structured log notifications.
 *   2. Wires the logger to the server (log.setServer) so every log line is
 *      mirrored as an MCP `notifications/message` in addition to stderr.
 *   3. Registers all 26 tools, grouped by concern (react / store / network /
 *      debugger / general).
 *   4. Connects the server to the STDIO transport — stdin/stdout become the
 *      JSON-RPC channel the MCP client talks to. (This is why logging must
 *      never use console.log: it would corrupt that channel.)
 *   5. Kicks off an eager, NON-BLOCKING connection to Chrome via CDP (the
 *      Chrome DevTools Protocol). Connecting early lets the network collector
 *      start capturing requests immediately, before the first tool call. If
 *      Chrome isn't up yet, the failure is swallowed and the connection is
 *      retried lazily on the first tool that needs it.
 *
 * CONFIGURATION (environment variables — all parsed in env.ts, exposed as ENV)
 * ───────────────────────────────────────────────────────────────────────────
 *   CDP_HOST        Hostname where Chrome's remote-debugging endpoint listens.
 *                   Default: "localhost". Set this when Chrome runs on another
 *                   machine or inside a container (e.g. "127.0.0.1", "host.docker.internal").
 *
 *   CDP_PORT        TCP port of Chrome's remote-debugging endpoint — i.e. the
 *                   value passed to Chrome's `--remote-debugging-port=<port>`
 *                   flag. Default: "9222". Parsed to an integer before use.
 *
 *   CDP_TARGET_URL  Optional URL substring used to pick WHICH browser tab to
 *                   attach to when several are open (Chrome exposes one debug
 *                   "target" per tab). The first page tab whose URL contains
 *                   this string is chosen — e.g. "localhost:3000" attaches to
 *                   your dev-server tab and ignores others. Default: none, in
 *                   which case the first real page tab is used (internal
 *                   devtools://, chrome://, and extension tabs are skipped).
 *                   To switch tabs, restart the server with a different value.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { log } from "./logger.js";
import { ENV } from "./env.js";
import { eagerConnect } from "./cdp-client.js";

import { register as registerReactTools } from "./tools/react.js";
import { register as registerStoreTools } from "./tools/store.js";
import { register as registerNetworkTools } from "./tools/network.js";
import { register as registerDebuggerTools } from "./tools/debugger.js";
import { register as registerGeneralTools } from "./tools/general.js";

// Echo the effective CDP configuration (already parsed in env.ts) up front so
// the resolved host/port/tab is visible in logs.
log.info("starting react-debug-mcp", {
  CDP_HOST: ENV.CDP_HOST,
  CDP_PORT: ENV.CDP_PORT,
  CDP_TARGET_URL: ENV.CDP_TARGET_URL || "(first page tab)",
});

// The high-level MCP server. `capabilities.logging: {}` advertises that this
// server emits log notifications and honours the client's `logging/setLevel`.
const server = new McpServer(
  {
    name: "react-debug-mcp",
    version: "2.0.0",
  },
  {
    capabilities: {
      logging: {},
    },
  },
);

// Enable MCP logging notifications (in addition to stderr)
log.setServer(server);

// Register all tools by concern. Each register() attaches its tools to the
// server; the counts here must match the "tools registered" log line below.
registerReactTools(server);      // 8 React component/context/tree inspection tools
registerStoreTools(server);      // 1 Redux/Zustand store reader
registerNetworkTools(server);    // 1 network request/response query tool
registerDebuggerTools(server);   // 15 breakpoint / logpoint / source tools
registerGeneralTools(server);    // 1 evaluate_in_page escape hatch

// Bind the server to stdin/stdout as the JSON-RPC transport and start serving.
// `await` resolves once the transport is connected and the server is ready.
const transport = new StdioServerTransport();
await server.connect(transport);
log.info("tools registered: react(8), store(1), network(1), debugger(15), general(1)");
log.info("server ready");

// Connect to Chrome eagerly so network collector starts capturing immediately.
// Non-blocking — if Chrome isn't running yet, tool calls will retry via getClient().
eagerConnect();
