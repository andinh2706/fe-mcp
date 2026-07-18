#!/usr/bin/env node
/**
 * Executable entry point for `react-debug-mcp`.
 *
 * This exists so the server can be launched WITHOUT an absolute path to the
 * source file. Instead of:
 *
 *   "command": ["npx", "tsx", "/abs/path/to/react-debug-mcp/src/index.ts"]
 *
 * an agent's MCP config becomes:
 *
 *   "command": ["react-debug-mcp"]              // after `npm i -g .` / `npm link`
 *   "command": ["npx", "-y", "react-debug-mcp"] // once published to npm
 *
 * Why a `.mjs` shim at all? `bin` targets are executed by `node` directly, and
 * node cannot run `.ts`. Rather than adding a build step and a `dist/`, we keep
 * the single no-build code path and register tsx's ESM loader in-process, then
 * import the TypeScript entry point. `register()` installs the loader for the
 * whole module graph, so every transitive `.ts` import inside src/ is handled.
 *
 * In-process (not a spawned `node --import tsx …` child) is deliberate: MCP's
 * stdio transport IS this process's stdin/stdout, so keeping one process means
 * the JSON-RPC pipes need no forwarding and signals/exit codes stay correct.
 *
 * Note: unlike the `start*` scripts in package.json, this does NOT load a `.env`
 * file. Those scripts run from the repo root, where `.env` is *this project's*
 * config; a globally-installed binary runs from the agent's working directory,
 * where a `.env` would belong to someone else's app. Configure it through the
 * MCP client's `environment` block instead (see README).
 */

import { register } from "tsx/esm/api";

register();

await import("../src/index.ts");
