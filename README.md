# react-debug-mcp

A focused MCP server for **runtime debugging of React apps**. Designed to run alongside [chrome-devtools-mcp](https://github.com/ChromeDevTools/chrome-devtools-mcp).

| Concern | Server |
|---------|--------|
| Navigate, click, fill forms, screenshot | chrome-devtools-mcp |
| Console logs, performance traces | chrome-devtools-mcp |
| **React component state & props** | **react-debug-mcp** |
| **Redux/Zustand store inspection** | **react-debug-mcp** |
| **API response bodies** | **react-debug-mcp** |
| **Breakpoints, stepping, scope inspection** | **react-debug-mcp** |
| **Logpoints (non-pausing value capture)** | **react-debug-mcp** |

## Tools (26 total)

### React Inspection

| Tool | Purpose |
|------|---------|
| `get_page_info` | Detect React, version, stores, dev/prod, DevTools hook |
| `get_component_tree` | Component hierarchy with names, keys, optional hooks/props. Supports `start_selector` to scope to a subtree |
| `get_react_component_path` | Path from root component to the component at a CSS selector. Optional props/hooks per node |
| `find_react_component(name)` | Find all instances by name, with prop filtering. Supports `start_selector` to scope the search. Returns full `parentPath` from root |
| `inspect_react_component_by_name(name)` | Deep inspect a specific instance by name + targeting |
| `inspect_react_component(selector)` | Inspect by CSS selector (quick path) |
| `inspect_react_context(selector)` | All Context.Provider values flowing into a component |
| `get_react_error_boundaries` | Error Boundaries, Suspense fallbacks, dev overlays |

All inspection tools support `show_function_details` to expand function values to `{functionName, functionBody, paramCount}` instead of `"[function]"`.

### State & Network

| Tool | Purpose |
|------|---------|
| `get_store_state(path?)` | Read Redux/Zustand state with dot-path |
| `get_network_responses(url_pattern?)` | API requests — live ones include full bodies, historical ones (before MCP connected) include URL/status/timing |

### Breakpoints (interactive, pauses execution)

| Tool | Purpose |
|------|---------|
| `list_scripts(filter?)` | Discover loaded source files when set_breakpoint match is ambiguous |
| `read_source(file)` | Read source from the browser — for vendor code or confirming what's loaded |
| `search_source(query)` | Search loaded scripts to narrow down which files to read from disk |
| `set_breakpoint(file, line)` | Set a breakpoint — read the source file from disk first to pick the line |
| `wait_for_breakpoint` | Block until breakpoint fires, returns scope |
| `inspect_scope(frame_index?)` | Read variables at any stack frame |
| `evaluate_at_breakpoint(expression)` | Eval in the paused frame's context |
| `step_over` / `step_into` / `step_out` | Execution control |
| `resume` | Continue execution |

### Logpoints (passive, no pause)

| Tool | Purpose |
|------|---------|
| `set_logpoint(file, line, expressions)` | Capture values to console without pausing |

### Management

| Tool | Purpose |
|------|---------|
| `list_breakpoints` | Show all active breakpoints and logpoints |
| `remove_breakpoint(id)` | Remove one |
| `remove_all_breakpoints` | Clean slate |
| `evaluate_in_page(expression)` | Ad-hoc JS evaluation escape hatch |

## Debugging Workflows

Line numbers on disk match the browser exactly (webpack dev server with 
`devtool: source-map`). Read files from the filesystem to pick breakpoint 
lines, then fix bugs by editing the same files.

### Breakpoint Flow

```
You: "The checkout total is wrong. Debug it."

Agent: (reads src/hooks/useCheckout.ts from filesystem)
  → 40 │ function calculateTotal(items) {
     41 │   const subtotal = items.reduce((s, i) => s + i.price, 0);
     42 │   const taxRate = getTaxRate();
     43 │   const tax = subtotal * taxRate;
     44 │   return { subtotal, tax, total: subtotal + tax };

Agent: set_breakpoint({ file: "useCheckout.ts", line: 42 })
  → "Breakpoint set. Have user trigger the code path."

Agent: "Please click the checkout button."

You: (click checkout in the browser)

Agent: wait_for_breakpoint()
  → paused at useCheckout.ts:42
     scope: { items: [...], subtotal: 29.97, taxRate: undefined }

Agent: "Found the bug — getTaxRate() returns undefined at line 42."

Agent: resume()

Agent: (edits src/hooks/useCheckout.ts on disk to fix the bug)
  → webpack dev server hot-reloads the fix
```

Multi-breakpoint investigation (using search_source to narrow down):

```
Agent: search_source({ query: "item.price" })
  → CartItem.tsx:23, PriceDisplay.tsx:8, calculateTotal.ts:12

Agent: (reads src/components/CartItem.tsx from filesystem around line 23)
Agent: set_breakpoint({ file: "CartItem.tsx", line: 23 })
Agent: "Click an item to add to cart."
You: (click)
Agent: wait_for_breakpoint()
  → scope: { item: { id: 5, price: "9.99" } }    ← price is a string!

Agent: (reads src/utils/calculateTotal.ts from filesystem around line 12)
Agent: set_breakpoint({ file: "calculateTotal.ts", line: 12 })
Agent: resume()
Agent: wait_for_breakpoint()
  → scope: { items: [...], sum: "09.999.99" }     ← string concatenation!

Agent: "Root cause: price comes from API as string, not number."
Agent: (edits src/utils/calculateTotal.ts to add parseFloat)
```

### Logpoint Flow

```
You: "Some cart items show wrong prices but I'm not sure which ones."

Agent: (reads src/components/CartItem.tsx from filesystem)
  → line 15: const displayPrice = formatPrice(props.price);

Agent: set_logpoint({
  file: "CartItem.tsx",
  line: 15,
  expressions: { "id": "props.id", "price": "props.price", "computed": "displayPrice" },
  label: "cart-price"
})
  → "Logpoint set. Please browse through the cart items."

Agent: "Please scroll through your cart so all items render."

You: (scroll through)

Agent: (uses chrome-devtools-mcp) list_console_messages
  → Finds messages with ⚡RDM|cart-price prefix:
    ⚡RDM|cart-price|1711234567|{"id":1,"price":9.99,"computed":"$9.99"}
    ⚡RDM|cart-price|1711234568|{"id":2,"price":"5.00","computed":"$NaN"}
    ⚡RDM|cart-price|1711234569|{"id":3,"price":12.50,"computed":"$12.50"}

Agent: "Item 2 has price as string '5.00' instead of number."
Agent: (edits the API response handler on disk to fix the type)
```

## Setup

```bash
cd react-debug-mcp
npm install
```

### OpenCode config

Add to your project's `opencode.jsonc`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "react-debug": {
      "type": "local",
      "command": ["node", "/path/to/react-debug-mcp/src/index.mjs"],
      "environment": {
        "CDP_PORT": "9222",
        "CDP_TARGET_URL": "localhost:3000"
      },
      "enabled": true
    },
    "chrome-devtools": {
      "type": "local",
      "command": ["npx", "-y", "chrome-devtools-mcp@latest", "--browser-url", "http://127.0.0.1:9222"],
      "enabled": true
    }
  }
}
```

### What happens at runtime when you start OpenCode

```
1. You run `opencode` in your project directory.

2. OpenCode reads opencode.jsonc, finds the "react-debug" MCP config.

3. OpenCode spawns:  node /path/to/react-debug-mcp/src/index.mjs
   with CDP_PORT=9222 and CDP_TARGET_URL=localhost:3000 in the env.
   The process's stdin/stdout become the JSON-RPC transport.

4. MCP handshake (over stdin/stdout):
   ← Client sends:   { method: "initialize", params: { capabilities: { ... } } }
   → Server responds: { capabilities: { tools: {}, logging: {} } }
   ← Client sends:    { method: "notifications/initialized" }

   The server advertises `logging: {}` — this tells the client it
   supports the `logging/setLevel` request and will send
   `notifications/message` log events.

5. Client discovers tools:
   ← Client sends:   { method: "tools/list" }
   → Server responds: [ { name: "get_component_tree", ... }, ... ]  (26 tools)

   OpenCode now includes these tools in the LLM's tool list.

6. Server is idle — no Chrome connection yet. Connects lazily on
   first tool call.

7. You ask the agent to debug something. The LLM picks a tool:
   ← Client sends:   { method: "tools/call", params: { name: "get_page_info" } }

   → Server connects to Chrome (CDP_PORT=9222), enables domains,
     attaches network collector (backfills historical requests),
     attaches debugger collector.

   → Server evaluates the snippet in the browser, returns result.

8. Throughout, the server sends log events:
   → { method: "notifications/message",
       params: { level: "info", logger: "react-debug-mcp",
                 data: "connected {\"pageUrl\":\"http://localhost:3000\"}" } }

   These appear in OpenCode's log output and in the MCP Inspector
   logging panel (if running under the Inspector).
```

### MCP Inspector (for debugging the server itself)

The Inspector provides a web UI where you can manually invoke tools, see
request/response JSON, and view structured log messages in real time.

```bash
# Basic — just the server
npx @modelcontextprotocol/inspector \
  -e CDP_PORT=9222 \
  -e CDP_TARGET_URL=localhost:3000 \
  node src/index.mjs

# With Node debugger attached (for stepping through server code)
npx @modelcontextprotocol/inspector \
  -e CDP_PORT=9222 \
  node --inspect=9229 src/index.mjs
```

The Inspector:
1. Spawns your server as a child process (same as OpenCode would)
2. Connects over stdio, performs the MCP handshake
3. Opens a web UI (typically `http://localhost:6274`)
4. You can invoke any tool manually, see the raw JSON-RPC exchange,
   and view `notifications/message` logs in the Notifications tab

Because the server declares `logging: {}` capability, all `log.info()`,
`log.error()`, etc. calls appear as structured entries in the Inspector
— not just raw stderr lines.

### Logging

The server uses dual-mode logging:

| Channel | When | What you see |
|---------|------|-------------|
| **MCP notifications** | After server connects to a client | Structured log entries in Inspector's logging panel or OpenCode's log output. Level controlled by client via `logging/setLevel`. |
| **stderr** | Always (including before connection) | JSON lines. Level controlled by `LOG_LEVEL` env var. |
| **Log file** | When `LOG_FILE` is set | Same as stderr, written to the specified file path. |

Startup messages (before the MCP transport connects) only go to stderr.
Once connected, every log call goes to both channels.

### Environment Variables

| Var | Default | Description |
|-----|---------|-------------|
| `CDP_HOST` | `localhost` | Chrome host |
| `CDP_PORT` | `9222` | Chrome remote debugging port |
| `CDP_TARGET_URL` | _(none)_ | URL substring to match a specific tab |
| `LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error` — controls stderr output |
| `LOG_FILE` | _(none)_ | Path to write logs |

Connects lazily on first tool call. To switch tabs, restart the server with a different `CDP_TARGET_URL`.

## Centralized Limits (`src/limits.mjs`)

All tuneable caps, timeouts, truncation thresholds, and defaults are defined in a single file — `src/limits.mjs`. This makes it easy to review and adjust runtime behaviour without grepping through the codebase.

The file is split into two sections:

**Browser-side constants** are returned by the `browserLimits()` function. Because snippet code runs inside the browser page via CDP `Runtime.evaluate()`, these values must live inside a self-contained function that the bundler can stringify. Every snippet that uses bounded serialization, hook extraction, prop walking, or DOM climbing reads its limits from `browserLimits()`.

| Constant | Default | What it controls |
|----------|---------|-----------------|
| `SERIALIZE_MAX_DEPTH` | 6 | `safeSerialize` max object nesting depth |
| `SERIALIZE_MAX_CHARS` | 2000 | `safeSerialize` approximate char budget |
| `SERIALIZE_STRING_TRUNCATE` | 300 | `safeSerialize` individual string value cap |
| `SERIALIZE_MAX_ARRAY_ITEMS` | 50 | `safeSerialize` max array elements |
| `SERIALIZE_MAX_OBJECT_KEYS` | 30 | `safeSerialize` max keys per object |
| `PROPS_SERIALIZE_DEPTH` | 4 | `safeProps` per-value depth limit |
| `PROPS_SERIALIZE_CHARS` | 500 | `safeProps` per-value char budget |
| `PROPS_MAX_KEYS` | 30 | `safeProps` max prop keys |
| `FUNCTION_BODY_MAX_LENGTH` | 1000 | `describeFn` function body truncation |
| `MAX_HOOKS_PER_FIBER` | 20 | `extractHooks` max hooks per component |
| `SELECTOR_MAX_DOM_STEPS` | 200 | `fiberToSelector` max DOM parents climbed |
| `ERROR_BOUNDARY_MAX_DEPTH` | 50 | Error boundary walk max depth |
| `FIND_COMPONENTS_DEFAULT_MAX` | 20 | `findComponents` default result cap |

**Server-side constants** are standard exports consumed by collectors and tools:

| Constant | Default | What it controls |
|----------|---------|-----------------|
| `MAX_NETWORK_BUFFER` | 500 | Network collector in-memory ring buffer size |
| `NETWORK_BODY_TRUNCATE` | 5000 | Non-JSON response body truncation |
| `BREAKPOINT_SCOPE_MAX_PROPS` | 30 | Auto-fetched scope properties on breakpoint hit |
| `STEP_TIMEOUT_MS` | 10000 | Timeout for step over/into/out re-pause |
| `SOURCE_DEFAULT_LINE_WINDOW` | 200 | Default lines returned by `read_source` |
| `SOURCE_SEARCH_MAX_SCRIPTS` | 50 | Max scripts searched per `search_source` call |
| `SOURCE_SEARCH_MAX_RESULTS` | 100 | Max total matches from `search_source` |
| `LOG_EXPRESSION_TRUNCATE` | 200 | Expression string truncation in log output |
| `TREE_DEFAULT_MAX_DEPTH` | 4 | `get_component_tree` default max depth |
| `FIND_DEFAULT_MAX_RESULTS` | 20 | `find_react_component` default max results |
| `NETWORK_DEFAULT_LIMIT` | 20 | `get_network_responses` default limit |
| `BREAKPOINT_DEFAULT_TIMEOUT_S` | 60 | `wait_for_breakpoint` default timeout (seconds) |

## Project Structure

```
src/
├── index.mjs                  # Entry point
├── limits.mjs                 # Centralized limits & tunables (single source of truth)
├── cdp-client.mjs             # Lazy CDP connection + evaluate()
├── logger.mjs                 # Dual-mode logging (MCP notifications + stderr)
├── collectors/
│   ├── network.mjs            # Captures API requests/responses (live + historical backfill)
│   └── debugger/              # CDP Debugger domain (split into sub-modules)
│       ├── index.mjs          # Barrel: attach() + re-exports
│       ├── state.mjs          # Shared mutable state (CDP client, script map, pause state)
│       ├── scripts.mjs        # Script tracking, source map resolution, URL helpers
│       ├── breakpoints.mjs    # Set/remove breakpoints and logpoints (source map fallback)
│       ├── pause.mjs          # Wait, step, resume, scope inspection
│       └── source-reading.mjs # Read and search bundled script source (parallel search)
├── tools/
│   ├── react.mjs              # React component inspection (8 tools)
│   ├── store.mjs              # State store reading (1 tool)
│   ├── network.mjs            # Network response querying (1 tool)
│   ├── debugger.mjs           # Breakpoints, source reading + logpoints (15 tools)
│   └── general.mjs            # evaluate_in_page (1 tool)
└── snippets/                  # JS code that runs inside the browser page
    ├── index.mjs              # Barrel: bundles functions → CDP-ready strings
    ├── bundle.mjs             # fn.toString() bundler utility
    ├── helpers.mjs            # Shared helpers (fiber lookup, display name, hooks, …)
    ├── page-info.mjs          # get_page_info snippet
    ├── component-tree.mjs     # get_component_tree snippet
    ├── component-path.mjs     # get_react_component_path snippet
    ├── find-components.mjs    # find_react_component snippet
    ├── inspect-by-name.mjs    # inspect_react_component_by_name snippet
    ├── inspect-by-selector.mjs # inspect_react_component snippet
    ├── inspect-context.mjs    # inspect_react_context snippet
    ├── error-boundaries.mjs   # get_react_error_boundaries snippet
    └── store-reader.mjs       # get_store_state snippet
```

## Logpoint Output Format

Logpoints write to console with a structured prefix so the agent can find them:

```
⚡RDM|<label>|<timestamp>|<JSON data>
```

The agent searches for `⚡RDM` in chrome-devtools-mcp's console output. The label helps correlate which logpoint produced which output when multiple logpoints are active.

## License

MIT
