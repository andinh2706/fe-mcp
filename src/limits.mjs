/**
 * Centralized limits and tunables for react-debug-mcp.
 *
 * Every hard-coded cap, timeout, truncation threshold, or default lives here
 * so it can be reviewed and adjusted in one place.
 *
 * ARCHITECTURE NOTE — browser vs server constants
 * ────────────────────────────────────────────────
 * Code in  src/snippets/  runs INSIDE the browser page via CDP
 * Runtime.evaluate().  The bundler (bundle.mjs) converts functions to strings,
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
 *
 * @returns {Record<string, number>}
 */
export function browserLimits() {
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
// SERVER-SIDE CONSTANTS  (imported directly by collectors and tools)
// ═══════════════════════════════════════════════════════════════════════════

// -- Network collector -------------------------------------------------------

/** Max request/response pairs kept in the in-memory ring buffer. */
export const MAX_NETWORK_BUFFER = 500;

/** Truncation length for non-JSON response bodies (chars). */
export const NETWORK_BODY_TRUNCATE = 5000;

// -- Debugger collector ------------------------------------------------------

/**
 * Max scope properties to auto-fetch when a breakpoint is hit.
 * Applies to the top-frame scope snapshot returned with pause events.
 */
export const BREAKPOINT_SCOPE_MAX_PROPS = 30;

/**
 * Timeout (ms) used by step_over / step_into / step_out when waiting
 * for the engine to re-pause after a single step.
 */
export const STEP_TIMEOUT_MS = 10_000;

// -- Logging -----------------------------------------------------------------

/**
 * When logging CDP expressions (evaluate, evaluate_at_breakpoint),
 * truncate the expression string to this many chars for readability.
 */
export const LOG_EXPRESSION_TRUNCATE = 200;

// -- Source reading (supplementary — agent reads filesystem first) -----------

/** Default line window when read_source is called without a range. */
export const SOURCE_DEFAULT_LINE_WINDOW = 200;

/** Max scripts to search across in a single search_source call. */
export const SOURCE_SEARCH_MAX_SCRIPTS = 100;

/** Max total search matches returned across all scripts. */
export const SOURCE_SEARCH_MAX_RESULTS = 100;

// -- Tool-level defaults (user-facing, used in zod schemas & destructuring) --

/** Default max_depth for get_component_tree tool. */
export const TREE_DEFAULT_MAX_DEPTH = 4;

/** Default max_results for find_react_component tool. */
export const FIND_DEFAULT_MAX_RESULTS = 20;

/** Default limit for get_network_responses tool. */
export const NETWORK_DEFAULT_LIMIT = 20;

/** Default timeout (seconds) for wait_for_breakpoint tool. */
export const BREAKPOINT_DEFAULT_TIMEOUT_S = 60;
