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

The component-inspection tools — `get_component_tree`, `get_react_component_path`, `find_react_component`, `inspect_react_component`, and `inspect_react_component_by_name` — accept `show_function_details` to expand function values to `{functionName, functionBody, paramCount}` instead of `"[function]"`.

### State & Network

| Tool | Purpose |
|------|---------|
| `get_store_state(path?)` | Read Redux/Zustand state with dot-path |
| `get_network_responses(url_pattern?)` | API requests — live ones include full bodies, historical ones (before MCP connected) include URL/status/timing |

`get_store_state` reads a store you expose on `window` (`__REDUX_STORE__`, `__ZUSTAND_STORE__`, or `__STORE__`). In development, drop [`react-debug-helper.ts`](react-debug-helper.ts) into your app's entry point and call `exposeStore(store, 'redux' | 'zustand')`, or set the global yourself. Without it, `get_store_state` reports `{ store: 'none' }`.

### Source inspection (bundled scripts, no pause)

| Tool | Purpose |
|------|---------|
| `list_scripts(filter?)` | Discover loaded bundled scripts when a `set_breakpoint` match is ambiguous |
| `read_source(file)` | Read bundled/generated source from the browser — for vendor code or confirming what's loaded |
| `search_source(query)` | Search loaded bundled scripts to narrow down which files to read from disk |

### Breakpoints (interactive, pauses execution)

| Tool | Purpose |
|------|---------|
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

Line numbers on disk match the browser as long as your dev server emits source 
maps (webpack `devtool: source-map`, Vite, etc.). Read files from the filesystem 
to pick breakpoint lines, then fix bugs by editing the same files.

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

**Requires Node ≥ 20.18** — the run scripts use `node --env-file-if-exists` and `--import tsx` (Node 22+ recommended).

```bash
cd react-debug-mcp
yarn install
```

The server is written in TypeScript and runs directly via [`tsx`](https://github.com/privatenumber/tsx) — no build step, no `dist/`. All four `start*` scripts load `.env` automatically (see [Environment Variables](#environment-variables)).

| Script | Runs |
|--------|------|
| `yarn start` | Normal start |
| `yarn start:debug` | Start with the Node inspector on `:9229` (attach a debugger; breakpoints map to `.ts`) |
| `yarn start:inspect` | Start wrapped in the MCP Inspector web UI |
| `yarn start:inspect:debug` | MCP Inspector **and** the Node inspector on `:9229` |
| `yarn typecheck` | `tsc --noEmit` (type-check only; nothing is emitted) |

### OpenCode config

Add to your project's `opencode.jsonc`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "react-debug": {
      "type": "local",
      "command": ["npx", "tsx", "/path/to/react-debug-mcp/src/index.ts"],
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

3. OpenCode spawns:  npx tsx /path/to/react-debug-mcp/src/index.ts
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

6. Server connects to Chrome eagerly in the background (non-blocking).
   If Chrome isn't ready yet, retries on first tool call.

7. You ask the agent to debug something. The LLM picks a tool:
   ← Client sends:   { method: "tools/call", params: { name: "get_page_info" } }

   → Server evaluates the snippet in the browser, returns result.
   (If eager connect failed, this tool call triggers the retry.)

8. Throughout, the server sends log events:
   → { method: "notifications/message",
       params: { level: "info", logger: "react-debug-mcp",
                 data: "connected {\"pageUrl\":\"http://localhost:3000\"}" } }

   These appear in OpenCode's log output and in the MCP Inspector
   logging panel (if running under the Inspector).
```

### MCP Inspector

The [MCP Inspector](https://github.com/modelcontextprotocol/inspector) is a web UI
for invoking tools manually and watching the raw JSON-RPC exchange and log
notifications in real time — no agent required. The `start:inspect` scripts wrap the
server in it:

```bash
yarn start:inspect         # Inspector UI (config from .env)
yarn start:inspect:debug   # Inspector UI + Node inspector on :9229 (breakpoints map to .ts)
```

Both open the UI at `http://localhost:6274`. To override config without editing
`.env`, pass `-e KEY=value` before the command:

```bash
npx @modelcontextprotocol/inspector -e CDP_TARGET_URL=localhost:3000 \
  node --env-file-if-exists=.env --import tsx src/index.ts
```

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
| `CDP_HOST` | `127.0.0.1` | Chrome host (see IPv4 note below) |
| `CDP_PORT` | `9222` | Chrome remote debugging port |
| `CDP_TARGET_URL` | _(none)_ | URL substring to match a specific tab |
| `LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error` — controls stderr output |
| `LOG_FILE` | _(none)_ | Path to write logs |

All five are parsed once in `src/env.ts` and exposed as a typed `ENV` object.

> **Use `127.0.0.1`, not `localhost`.** Chrome's `--remote-debugging-port` binds to
> the IPv4 loopback (`127.0.0.1`) only. On many systems — notably Windows with
> Node 18+ — `localhost` resolves to the IPv6 loopback (`::1`) *first*, so connecting
> to `localhost` fails with `ECONNREFUSED` even though Chrome is running. The default
> is `127.0.0.1` for this reason; only change it if Chrome is on another host.

**`.env` file (recommended).** Copy `.env.example` to `.env` and edit it — the four
`start*` scripts load it via Node's built-in `node --env-file-if-exists=.env`, so one
edit applies to every run mode. `.env` is gitignored; `.env.example` is the committed
template. A variable already set in your shell/CI **wins** over `.env` (Node doesn't
override existing env), and if `.env` is absent the scripts still run using the defaults
above.

```bash
cp .env.example .env   # then edit values
yarn start             # picks up .env automatically
```

Connects eagerly to Chrome at startup. If Chrome isn't ready, retries on first tool call. To switch tabs, change `CDP_TARGET_URL` in `.env` (or the environment) and restart the server.

## Centralized Limits (`src/limits.ts`)

All tuneable caps, timeouts, truncation thresholds, and defaults are defined in a single file — `src/limits.ts`. This makes it easy to review and adjust runtime behaviour without grepping through the codebase.

The file is split into two sections:

**Browser-side constants** are returned by the `browserLimits()` function. Because snippet code runs inside the browser page via CDP `Runtime.evaluate()`, these values must live inside a self-contained function that the bundler can stringify. (TypeScript type annotations are erased at transpile time, so the stringified output remains clean browser JS — see the note under Project Structure.) Every snippet that uses bounded serialization, hook extraction, prop walking, or DOM climbing reads its limits from `browserLimits()`.

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

**Server-side constants** are returned by the `serverLimits()` function. Unlike `browserLimits()` — which *must* be a function so it can be stringified into browser snippets — `serverLimits()` is a function purely for symmetry and grouping. Consumers destructure what they need at module load, e.g. `const { MAX_NETWORK_BUFFER } = serverLimits();`:

| Constant | Default | What it controls |
|----------|---------|-----------------|
| `MAX_NETWORK_BUFFER` | 500 | Network collector in-memory ring buffer size |
| `NETWORK_BODY_TRUNCATE` | 5000 | Non-JSON response body truncation |
| `BREAKPOINT_SCOPE_MAX_PROPS` | 30 | Auto-fetched scope properties on breakpoint hit |
| `STEP_TIMEOUT_MS` | 10000 | Timeout for step over/into/out re-pause |
| `SOURCE_DEFAULT_LINE_WINDOW` | 200 | Default lines returned by `read_source` |
| `SOURCE_SEARCH_MAX_SCRIPTS` | 100 | Max scripts searched per `search_source` call |
| `SOURCE_SEARCH_MAX_RESULTS` | 100 | Max total matches from `search_source` |
| `LOG_EXPRESSION_TRUNCATE` | 200 | Expression string truncation in log output |
| `TREE_DEFAULT_MAX_DEPTH` | 4 | `get_component_tree` default max depth |
| `FIND_DEFAULT_MAX_RESULTS` | 20 | `find_react_component` default max results |
| `NETWORK_DEFAULT_LIMIT` | 20 | `get_network_responses` default limit |
| `BREAKPOINT_DEFAULT_TIMEOUT_S` | 60 | `wait_for_breakpoint` default timeout (seconds) |

## Project Structure

```
src/
├── index.ts                   # Entry point
├── env.ts                     # Parses all env vars once → typed ENV object
├── limits.ts                  # Centralized limits & tunables (single source of truth)
├── cdp-client.ts              # Lazy CDP connection (memoized) + evaluate()
├── logger.ts                  # Dual-mode logging (MCP notifications + stderr)
├── url-filters.ts             # Shared browser-internal URL-prefix filters
├── types/
│   ├── chrome-remote-interface.d.ts # Type shim (package ships no types)
│   └── globals.d.ts           # Window augmentations for browser-side snippet globals
├── collectors/
│   ├── network.ts             # Captures API requests/responses (live + historical backfill)
│   └── debugger/              # CDP Debugger domain (split into sub-modules)
│       ├── index.ts           # Barrel: attach() + re-exports
│       ├── state.ts           # Shared mutable state (CDP client, script map, pause state)
│       ├── scripts.ts         # Script tracking, source map resolution, URL helpers
│       ├── breakpoints.ts     # Set/remove breakpoints and logpoints (source map fallback)
│       ├── pause.ts           # Wait, step, resume, scope inspection
│       └── source-reading.ts  # Read and search bundled script source (parallel search)
├── tools/
│   ├── react.ts               # React component inspection (8 tools)
│   ├── store.ts               # State store reading (1 tool)
│   ├── network.ts             # Network response querying (1 tool)
│   ├── debugger.ts            # Breakpoints, source reading + logpoints (15 tools)
│   └── general.ts             # evaluate_in_page (1 tool)
└── snippets/                  # Browser-side code that runs inside the page
    ├── index.ts               # Barrel: bundles functions → CDP-ready strings
    ├── bundle.ts              # fn.toString() bundler utility
    ├── helpers.ts             # Shared helpers (fiber lookup, display name, hooks, …)
    ├── page-info.ts           # get_page_info snippet
    ├── component-tree.ts      # get_component_tree snippet
    ├── component-path.ts      # get_react_component_path snippet
    ├── find-components.ts     # find_react_component snippet
    ├── inspect-by-name.ts     # inspect_react_component_by_name snippet
    ├── inspect-by-selector.ts # inspect_react_component snippet
    ├── inspect-context.ts     # inspect_react_context snippet
    ├── error-boundaries.ts    # get_react_error_boundaries snippet
    └── store-reader.ts        # get_store_state snippet
```

### TypeScript & the snippet bundler

The `src/snippets/` functions (and `browserLimits()` in `src/limits.ts`) are
serialized with `fn.toString()` and injected into the page via CDP. Because the
project targets `ES2022` with no downleveling, transpilation strips type
annotations without injecting runtime helpers — so `.toString()` always yields
clean, standalone browser JS. When editing snippet code, keep it free of TS
enums and reference only the helpers listed in each snippet's `deps` array.

## Logpoint Output Format

Logpoints write to console with a structured prefix so the agent can find them:

```
⚡RDM|<label>|<timestamp>|<JSON data>
```

The agent searches for `⚡RDM` in chrome-devtools-mcp's console output. The label helps correlate which logpoint produced which output when multiple logpoints are active.

## License

MIT
