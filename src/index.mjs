#!/usr/bin/env node

/**
 * react-debug-mcp — Entry Point
 *
 * A focused debugging MCP server for React apps.
 * Designed to run alongside chrome-devtools-mcp:
 *   - chrome-devtools-mcp: automation (navigate, click, fill, screenshot, performance)
 *   - react-debug-mcp: runtime inspection (React state, store, network responses)
 *
 * Connects eagerly to Chrome at startup so the network collector begins
 * capturing immediately. If Chrome isn't ready, retries on first tool call.
 *   CDP_HOST, CDP_PORT, CDP_TARGET_URL
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { log } from "./logger.mjs";
import { eagerConnect } from "./cdp-client.mjs";

import { register as registerReactTools } from "./tools/react.mjs";
import { register as registerStoreTools } from "./tools/store.mjs";
import { register as registerNetworkTools } from "./tools/network.mjs";
import { register as registerDebuggerTools } from "./tools/debugger.mjs";
import { register as registerGeneralTools } from "./tools/general.mjs";

log.info("starting react-debug-mcp", {
  CDP_HOST: process.env.CDP_HOST || "localhost",
  CDP_PORT: process.env.CDP_PORT || "9222",
  CDP_TARGET_URL: process.env.CDP_TARGET_URL || "(first page tab)",
});

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

registerReactTools(server);
registerStoreTools(server);
registerNetworkTools(server);
registerDebuggerTools(server);
registerGeneralTools(server);

const transport = new StdioServerTransport();
await server.connect(transport);
log.info("tools registered: react(8), store(1), network(1), debugger(15), general(1)");
log.info("server ready");

// Connect to Chrome eagerly so network collector starts capturing immediately.
// Non-blocking — if Chrome isn't running yet, tool calls will retry via getClient().
eagerConnect();
