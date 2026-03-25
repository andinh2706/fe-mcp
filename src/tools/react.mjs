/**
 * React Debugging Tools
 *
 * Tool naming is designed to match agent reasoning:
 *   - "component renders wrong data"     → inspect_react_component
 *   - "which CartItem has the bug?"      → find_react_component (with prop filter)
 *   - "blank page / error screen"        → get_react_error_boundaries
 *   - "need to understand structure"     → get_component_tree
 *   - "wrong theme/auth data"            → inspect_react_context
 */

import { z } from "zod";
import { evaluate } from "../cdp-client.mjs";
import {
  PAGE_INFO,
  COMPONENT_TREE,
  FIND_COMPONENTS,
  INSPECT_COMPONENT_BY_NAME,
  INSPECT_COMPONENT_BY_SELECTOR,
  INSPECT_CONTEXT,
  ERROR_BOUNDARY_CHECKER,
  COMPONENT_PATH,
} from "../snippets/index.mjs";
import { log } from "../logger.mjs";
import { TREE_DEFAULT_MAX_DEPTH, FIND_DEFAULT_MAX_RESULTS } from "../limits.mjs";

export function register(server) {

  // ---- Orientation ----

  server.tool(
    "get_page_info",
    `Get info about the current page: URL, title, React version, dev/prod mode, 
whether Redux/Zustand stores are present, and whether React DevTools hook is 
available. Good FIRST STEP for orientation.`,
    {},
    async () => {
      log.info("get_page_info");
      try {
        const result = await evaluate(`(${PAGE_INFO})()`);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  // ---- Component Tree ----

  server.tool(
    "get_component_tree",
    `Get the React component tree. Shows component names (resolving memo, forwardRef, 
lazy), React keys, and optionally props and hooks for each component. Use this 
to understand the component structure before drilling into a specific component. 
Uses React DevTools hook when available for reliable root discovery.

If start_selector is provided, the tree starts from the React component that owns 
that DOM element instead of from the root. Uses findFiberByHostInstance (stable) 
with __reactFiber$ fallback.`,
    {
      selector: z.string().optional().describe(
        "CSS selector for root element (default: auto-detected via DevTools hook or #root)"
      ),
      start_selector: z.string().optional().describe(
        "CSS selector for a DOM element to start the tree from. The tree root will be the React component owning this element."
      ),
      max_depth: z.number().optional().describe(`Max depth (default: ${TREE_DEFAULT_MAX_DEPTH})`),
      show_hooks: z.boolean().optional().describe("Include hooks state for each component (default: false, heavier output)"),
      show_props: z.boolean().optional().describe("Include prop values for each component (default: false, heavier output)"),
      show_function_details: z.boolean().optional().describe("Expand function values to {functionName, functionBody, paramCount} instead of '[function]' (default: false)"),
    },
    async ({ selector, start_selector, max_depth = TREE_DEFAULT_MAX_DEPTH, show_hooks = false, show_props = false, show_function_details = false }) => {
      log.info("get_component_tree", { selector, start_selector, max_depth, show_hooks, show_props, show_function_details });
      try {
        const result = await evaluate(
          `(${COMPONENT_TREE})(${JSON.stringify(selector || null)}, ${max_depth}, ${show_hooks}, ${show_props}, ${JSON.stringify(start_selector || null)}, ${show_function_details})`
        );
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  // ---- Component Path ----

  server.tool(
    "get_react_component_path",
    `Get the path from the root React component down to the component at a CSS selector.
Returns an ordered array of component names showing exactly how the target component 
is nested in the tree. Optionally includes props and hooks for each component on the 
path. Uses findFiberByHostInstance (stable) with __reactFiber$ fallback.
Useful for understanding where a component sits in the hierarchy without fetching the 
entire tree.`,
    {
      selector: z.string().describe(
        "CSS selector for a DOM element (e.g. '.checkout-form', '[data-testid=\"cart\"]')"
      ),
      show_props: z.boolean().optional().describe("Include prop values for each component on the path (default: false)"),
      show_hooks: z.boolean().optional().describe("Include hooks state for each component on the path (default: false)"),
      show_function_details: z.boolean().optional().describe("Expand function values to {functionName, functionBody, paramCount} instead of '[function]' (default: false)"),
    },
    async ({ selector, show_props = false, show_hooks = false, show_function_details = false }) => {
      log.info("get_react_component_path", { selector, show_props, show_hooks, show_function_details });
      try {
        const result = await evaluate(
          `(${COMPONENT_PATH})(${JSON.stringify(selector)}, ${show_props}, ${show_hooks}, ${show_function_details})`
        );
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  // ---- Find Components (handles multiple instances) ----

  server.tool(
    "find_react_component",
    `Find all instances of a React component by name. Returns each instance with 
its instanceIndex, React key, props, hooks, full parent path from root, and a 
CSS selector. Use this when there are MULTIPLE instances of the same component 
(e.g. list items) and you need to identify which one has the bug.

You can narrow results with prop_filter to match specific prop values 
(e.g. {"id": 5} to find the CartItem where props.id === 5).

Use start_selector to scope the search to a subtree rooted at that DOM element.
Even with start_selector, parentPath always shows the full path from the React root.

After finding the right instance, use inspect_react_component_by_name with 
instanceIndex, key, or propFilter to get full detail on that specific one.`,
    {
      name: z.string().describe(
        "Component name to search for (case-insensitive substring match, e.g. 'CartItem', 'Header', 'Button')"
      ),
      prop_filter: z.record(z.any()).optional().describe(
        "Filter by prop values to narrow to specific instances (e.g. {\"id\": 5, \"status\": \"error\"})"
      ),
      max_results: z.number().optional().describe(`Max instances to return (default: ${FIND_DEFAULT_MAX_RESULTS})`),
      start_selector: z.string().optional().describe(
        "CSS selector to scope the search. Only components under this element are searched. parentPath still shows the full path from root."
      ),
      show_function_details: z.boolean().optional().describe("Expand function values to {functionName, functionBody, paramCount} instead of '[function]' (default: false)"),
    },
    async ({ name, prop_filter, max_results = FIND_DEFAULT_MAX_RESULTS, start_selector, show_function_details = false }) => {
      log.info("find_react_component", { name, prop_filter, max_results, start_selector, show_function_details });
      try {
        const result = await evaluate(
          `(${FIND_COMPONENTS})(${JSON.stringify(name)}, ${JSON.stringify(prop_filter || null)}, ${max_results}, ${JSON.stringify(start_selector || null)}, ${show_function_details})`
        );
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  // ---- Inspect Specific Instance ----

  server.tool(
    "inspect_react_component_by_name",
    `Inspect a SPECIFIC instance of a React component by name. Returns full detail: 
all props, all hooks (classified as useState/useReducer/useEffect/useMemo/useRef), 
context values flowing in, parent path, and CSS selector.

When multiple instances exist, target the one you want using ONE of:
  - prop_filter: {"id": 5}        — match by prop values (most reliable)
  - key: "item-abc"               — match by React key
  - instance_index: 2             — the Nth instance (0-based, from find_react_component)

If no targeting is provided, returns the first instance with a warning if multiple exist.`,
    {
      name: z.string().describe("Component name (case-insensitive substring match)"),
      prop_filter: z.record(z.any()).optional().describe(
        "Match a specific instance by prop values (e.g. {\"id\": 5})"
      ),
      key: z.string().optional().describe(
        "Match by React key (the key prop used in lists)"
      ),
      instance_index: z.number().optional().describe(
        "Select the Nth instance (0-based). Use find_react_component first to see indices."
      ),
      show_function_details: z.boolean().optional().describe("Expand function values to {functionName, functionBody, paramCount} instead of '[function]' (default: false)"),
    },
    async ({ name, prop_filter, key, instance_index, show_function_details = false }) => {
      const targeting = {};
      if (prop_filter) targeting.propFilter = prop_filter;
      if (key !== undefined) targeting.key = key;
      if (instance_index !== undefined) targeting.instanceIndex = instance_index;

      log.info("inspect_react_component_by_name", { name, targeting, show_function_details });
      try {
        const result = await evaluate(
          `(${INSPECT_COMPONENT_BY_NAME})(${JSON.stringify(name)}, ${JSON.stringify(Object.keys(targeting).length > 0 ? targeting : null)}, ${show_function_details})`
        );
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  // ---- Inspect by CSS Selector (quick path) ----

  server.tool(
    "inspect_react_component",
    `Inspect the React component mounted at a CSS selector. Returns component name, 
props, hooks (classified), and parent hierarchy. Use this when you already know 
which DOM element to target (e.g. from chrome-devtools-mcp's DOM inspection). 
For targeting by component name instead, use find_react_component or 
inspect_react_component_by_name.`,
    {
      selector: z.string().describe(
        "CSS selector for the DOM element (e.g. '.checkout-form', '[data-testid=\"cart\"]')"
      ),
      show_function_details: z.boolean().optional().describe("Expand function values to {functionName, functionBody, paramCount} instead of '[function]' (default: false)"),
    },
    async ({ selector, show_function_details = false }) => {
      log.info("inspect_react_component", { selector, show_function_details });
      try {
        const result = await evaluate(
          `(${INSPECT_COMPONENT_BY_SELECTOR})(${JSON.stringify(selector)}, ${show_function_details})`
        );
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  // ---- Context Inspection ----

  server.tool(
    "inspect_react_context",
    `Inspect all React Context values flowing into a component. Walks UP the fiber 
tree from the given selector and lists every Context.Provider with its current 
value. Use this when a component isn't receiving the expected theme, auth, locale, 
or other context data.`,
    {
      selector: z.string().describe(
        "CSS selector for a DOM element inside the component (e.g. '.user-menu', '#sidebar')"
      ),
    },
    async ({ selector }) => {
      log.info("inspect_react_context", { selector });
      try {
        const result = await evaluate(
          `(${INSPECT_CONTEXT})(${JSON.stringify(selector)})`
        );
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  // ---- Error Boundaries ----

  server.tool(
    "get_react_error_boundaries",
    `Check if any React Error Boundaries have caught errors, or if any Suspense 
boundaries are showing fallback content. Also detects dev mode error overlays 
(webpack, vite). Use this when the page shows blank/broken UI or fallback content.`,
    {},
    async () => {
      log.info("get_react_error_boundaries");
      try {
        const result = await evaluate(`(${ERROR_BOUNDARY_CHECKER})()`);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );
}
