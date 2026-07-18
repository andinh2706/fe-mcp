/**
 * Centralized limits and tunables for react-debug-mcp.
 *
 * Every hard-coded cap, timeout, truncation threshold, or default lives here
 * so it can be reviewed and adjusted in one place.
 *
 * ARCHITECTURE NOTE — browser vs server constants
 * ────────────────────────────────────────────────
 * Code in  src/snippets/  runs INSIDE the browser page via CDP
 * Runtime.evaluate().  The bundler (bundle.ts) converts functions to strings,
 * so browser constants must live inside a self-contained function that can be
 * stringified and injected alongside the snippet.  That function is
 * `browserLimits()` below.
 *
 * Server-side constants are exported normally and imported by collectors/tools.
 *
 * ⚠️  When changing a browser constant, update the value inside
 *     `browserLimits()`.  The JSDoc table at the top of that function lists
 *     every key so you can find them quickly.
 */

// ═══════════════════════════════════════════════════════════════════════════
// BROWSER-SIDE CONSTANTS  (injected into CDP evaluate via the bundler)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Returns all tunables used by browser-side snippet helpers.
 *
 * This function is bundled alongside snippet code — it MUST be entirely
 * self-contained (no imports, no closures over module-level variables).
 *
 * ┌─────────────────────────────────┬────────┬──────────────────────────────────────────────────┐
 * │ Key                             │ Value  │ Purpose                                          │
 * ├─────────────────────────────────┼────────┼──────────────────────────────────────────────────┤
 * │ SERIALIZE_MAX_DEPTH             │ 6      │ safeSerialize: max object nesting depth           │
 * │ SERIALIZE_MAX_CHARS             │ 2000   │ safeSerialize: approx char budget before bail     │
 * │ SERIALIZE_STRING_TRUNCATE       │ 300    │ safeSerialize: individual string value cap        │
 * │ SERIALIZE_MAX_ARRAY_ITEMS       │ 50     │ safeSerialize: max elements serialized per array  │
 * │ SERIALIZE_MAX_OBJECT_KEYS       │ 30     │ safeSerialize: max keys serialized per object     │
 * │ PROPS_SERIALIZE_DEPTH           │ 4      │ safeProps: depth limit for each prop value        │
 * │ PROPS_SERIALIZE_CHARS           │ 500    │ safeProps: char budget for each prop value        │
 * │ PROPS_MAX_KEYS                  │ 30     │ safeProps: max prop keys to serialize             │
 * │ FUNCTION_BODY_MAX_LENGTH        │ 1000   │ describeFn: max chars of function body to return  │
 * │ MAX_HOOKS_PER_FIBER             │ 20     │ extractHooks: max hooks walked per component      │
 * │ SELECTOR_MAX_DOM_STEPS          │ 200    │ fiberToSelector: max DOM parents to climb         │
 * │ ERROR_BOUNDARY_MAX_DEPTH        │ 50     │ errorBoundaryChecker: max fiber tree depth        │
 * │ FIND_COMPONENTS_DEFAULT_MAX     │ 20     │ findComponents: default maxResults when omitted   │
 * └─────────────────────────────────┴────────┴──────────────────────────────────────────────────┘
 */
export function browserLimits(): Record<string, number> {
  return {
    // -- safeSerialize defaults -----------------------------------------------
    SERIALIZE_MAX_DEPTH:        6,     // max object nesting depth
    SERIALIZE_MAX_CHARS:        2000,  // approximate char budget before bail
    SERIALIZE_STRING_TRUNCATE:  300,   // individual string value cap
    SERIALIZE_MAX_ARRAY_ITEMS:  50,    // max elements serialized per array
    SERIALIZE_MAX_OBJECT_KEYS:  30,    // max keys serialized per object

    // -- safeProps per-value overrides ----------------------------------------
    PROPS_SERIALIZE_DEPTH:      4,     // shallower depth for individual prop values
    PROPS_SERIALIZE_CHARS:      500,   // smaller char budget per prop value

    // -- safeProps overall caps -----------------------------------------------
    PROPS_MAX_KEYS:             30,    // max prop keys to include

    // -- describeFn -----------------------------------------------------------
    FUNCTION_BODY_MAX_LENGTH:   1000,  // max chars of fn.toString() to return

    // -- extractHooks ---------------------------------------------------------
    MAX_HOOKS_PER_FIBER:        20,    // max hook nodes to walk per fiber

    // -- fiberToSelector ------------------------------------------------------
    SELECTOR_MAX_DOM_STEPS:     200,   // max parent elements to climb for CSS path

    // -- errorBoundaryChecker -------------------------------------------------
    ERROR_BOUNDARY_MAX_DEPTH:   50,    // max fiber tree depth to walk

    // -- findComponents -------------------------------------------------------
    FIND_COMPONENTS_DEFAULT_MAX: 20,   // default maxResults when caller omits it
  };
}


// ═══════════════════════════════════════════════════════════════════════════
// SERVER-SIDE CONSTANTS  (consumed by collectors and tools)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Returns all tunables used by the Node-side server code (collectors, tools,
 * CDP client). Unlike browserLimits() — which MUST be a function so the bundler
 * can stringify it into browser snippets — this is a function purely for
 * symmetry and grouping: a single call site to review every server default.
 *
 * Consumers destructure what they need at module load, e.g.
 *   const { MAX_NETWORK_BUFFER, NETWORK_BODY_TRUNCATE } = serverLimits();
 *
 * ┌──────────────────────────────┬────────┬──────────────────────────────────────────────────┐
 * │ Key                          │ Value  │ What it controls                                 │
 * ├──────────────────────────────┼────────┼──────────────────────────────────────────────────┤
 * │ MAX_NETWORK_BUFFER           │ 500    │ Network collector in-memory ring buffer size      │
 * │ NETWORK_BODY_TRUNCATE        │ 5000   │ Non-JSON response body truncation (chars)         │
 * │ BREAKPOINT_SCOPE_MAX_PROPS   │ 30     │ Auto-fetched scope properties on breakpoint hit   │
 * │ STEP_TIMEOUT_MS              │ 10000  │ Timeout for step over/into/out re-pause (ms)      │
 * │ LOG_EXPRESSION_TRUNCATE      │ 200    │ Expression string truncation in log output        │
 * │ SOURCE_DEFAULT_LINE_WINDOW   │ 200    │ Default lines returned by read_source             │
 * │ SOURCE_SEARCH_MAX_SCRIPTS    │ 100    │ Max scripts searched per search_source call       │
 * │ SOURCE_SEARCH_MAX_RESULTS    │ 100    │ Max total matches from search_source              │
 * │ TREE_DEFAULT_MAX_DEPTH       │ 4      │ get_component_tree default max_depth              │
 * │ FIND_DEFAULT_MAX_RESULTS     │ 20     │ find_react_component default max_results          │
 * │ NETWORK_DEFAULT_LIMIT        │ 20     │ get_network_responses default limit               │
 * │ BREAKPOINT_DEFAULT_TIMEOUT_S │ 60     │ wait_for_breakpoint default timeout (seconds)     │
 * └──────────────────────────────┴────────┴──────────────────────────────────────────────────┘
 */
export function serverLimits() {
  return {
    // -- Network collector ----------------------------------------------------
    MAX_NETWORK_BUFFER:           500,   // max request/response pairs in the ring buffer
    NETWORK_BODY_TRUNCATE:        5000,  // truncation length for non-JSON response bodies

    // -- Debugger collector ---------------------------------------------------
    BREAKPOINT_SCOPE_MAX_PROPS:   30,    // scope properties auto-fetched on breakpoint hit
    STEP_TIMEOUT_MS:              10_000, // step over/into/out re-pause timeout (ms)

    // -- Logging --------------------------------------------------------------
    LOG_EXPRESSION_TRUNCATE:      200,   // CDP expression truncation in log output
    TOOL_RESULT_PREVIEW:          800,   // chars of each tool's result logged on completion

    // -- Source reading (supplementary — agent reads filesystem first) --------
    SOURCE_DEFAULT_LINE_WINDOW:   200,   // default line window for read_source
    SOURCE_SEARCH_MAX_SCRIPTS:    100,   // max scripts searched per search_source call
    SOURCE_SEARCH_MAX_RESULTS:    100,   // max total matches returned across all scripts

    // -- Tool-level defaults (used in zod schemas & destructuring) ------------
    TREE_DEFAULT_MAX_DEPTH:       4,     // get_component_tree default max_depth
    FIND_DEFAULT_MAX_RESULTS:     20,    // find_react_component default max_results
    NETWORK_DEFAULT_LIMIT:        20,    // get_network_responses default limit
    BREAKPOINT_DEFAULT_TIMEOUT_S: 60,    // wait_for_breakpoint default timeout (seconds)
  };
}
