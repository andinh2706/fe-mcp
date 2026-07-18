/**
 * react-debug-helper.ts — OPTIONAL, and it belongs in YOUR APP, not in this server.
 *
 * This file is not part of the react-debug-mcp package and is never imported by it.
 * **Copy it into your React app's source tree** (e.g. `src/react-debug-helper.ts`) and
 * import it from there.
 *
 * ── Why you'd want it ───────────────────────────────────────────────────────
 * react-debug-mcp reads React components straight out of the fiber tree, so most of
 * its 26 tools need nothing from your app. There are exactly TWO things the runtime
 * cannot recover on its own, and this file supplies both:
 *
 *   exposeStore()          — a Redux/Zustand store is a closure variable with no DOM
 *                            presence. Unless your app parks it on a `window` global,
 *                            `get_store_state` can only answer `{ store: 'none' }`.
 *
 *   nameLibraryComponents() — a component built with `forwardRef`/`memo` and no
 *                            `displayName` has NO name at runtime, so it shows up as
 *                            `forwardRef(Anonymous)` in the component tree (and in
 *                            React DevTools). The export name is the missing name.
 *
 * ── Usage: import, then two calls ───────────────────────────────────────────
 * Importing the module is what activates it, so there is no separate side-effect
 * import to add:
 *
 *   import { exposeStore, nameLibraryComponents } from './react-debug-helper';
 *
 *   const store = configureStore({ reducer });   // Redux
 *   exposeStore(store, 'redux');
 *
 *   // Zustand — pass the HOOK ITSELF, not the result of calling it. `create()`
 *   // returns a hook that also carries .getState(); `useCartStore()` returns plain
 *   // state with no .getState(), which the server cannot read.
 *   export const useCartStore = create(...);
 *   exposeStore(useCartStore, 'zustand');
 *
 *   // Name a design system whose components are anonymous forwardRefs:
 *   import * as Ids from 'ids-wc/dist/react/components';
 *   nameLibraryComponents(Ids);
 *
 * Then ask the agent for store state; `store_type: 'auto'` probes every global, so it
 * is the safe default if you used `'custom'`.
 *
 * ── Two things that will bite you ───────────────────────────────────────────
 * 1. The store object must expose `.getState()` — that is exactly what the server
 *    calls (see src/snippets/store-reader.ts).
 * 2. State is returned via `JSON.parse(JSON.stringify(...))`. Map, Set, class
 *    instances, functions and circular refs survive as `[non-serializable]`. Keep the
 *    slices you want to debug JSON-clean, or read a narrower dot-path.
 *
 * ── Gating ──────────────────────────────────────────────────────────────────
 * Everything is a no-op unless `process.env.NODE_ENV === "development"`, so shipping
 * this to production exposes nothing. Bundlers (Vite, webpack, Next) substitute that
 * expression at build time; in a no-bundler ESM setup `process` is undefined and this
 * would throw, so only use it in a bundled app.
 *
 * The `window.__REACT_DEBUG__` console API below is a separate, purely-manual
 * convenience — react-debug-mcp does not use it. See the note above it.
 */

type StoreType = "redux" | "zustand" | "custom";

interface DebugHelperAPI {
  exposeStore: (store: any, type?: StoreType) => void;
  nameLibraryComponents: (namespace: Record<string, any>, prefix?: string) => string[];
  getComponentState: (selector: string) => any;
  getStoreState: (path?: string) => any;
  listComponents: (selector?: string) => string[];
}

function createDebugHelper(): DebugHelperAPI | null {
  if ((process.env as any).NODE_ENV !== "development") {
    return null;
  }

  const helper: DebugHelperAPI = {
    /**
     * SERVER-FACING (1 of 2).
     *
     * Parks `store` on the `window` global that react-debug-mcp's `get_store_state`
     * looks for. `store` must have a `.getState()` method (Redux stores and Zustand
     * hooks both do).
     *
     * The type argument only picks which global is written:
     *   redux   → window.__REDUX_STORE__
     *   zustand → window.__ZUSTAND_STORE__
     *   custom  → window.__STORE__
     *
     * Match it to `get_store_state({ store_type })`, or just use `'auto'` there —
     * note that a `'custom'` store is NOT found by `store_type: 'redux'`.
     */
    exposeStore(store: any, type: StoreType = "redux") {
      if (type === "redux") {
        (window as any).__REDUX_STORE__ = store;
      } else if (type === "zustand") {
        (window as any).__ZUSTAND_STORE__ = store;
      } else {
        (window as any).__STORE__ = store;
      }
      console.log(`[react-debug-helper] Exposed ${type} store for MCP debugging`);
    },

    /**
     * SERVER-FACING (2 of 2).
     *
     * Give names to a component library whose components render as
     * `forwardRef(Anonymous)` / `memo(Anonymous)` in the component tree.
     *
     * WHY THEY HAVE NO NAME. `forwardRef()` returns an exotic OBJECT, not a function.
     * The identifier in `export const MdcButton = forwardRef((props, ref) => …)` is
     * just a module binding — React never sees it. It can only read a name from
     * `Component.displayName` or `Component.render.name`, and a library that passes an
     * arrow straight into `forwardRef()` sets neither: JavaScript infers a function's
     * `.name` only when it is *assigned* to a binding, never when it is passed as a
     * call argument. So both fields are empty and every consumer — this server AND
     * React DevTools, which read the same fields — can only print "Anonymous".
     *
     * WHAT THIS DOES. The export name is the name React is missing, so we copy it onto
     * `displayName`. react-debug-mcp checks `displayName` first, so the tree goes from
     * `forwardRef(Anonymous)` to `MdcButton`. React DevTools picks it up too.
     *
     * Usage — either pass a namespace object:
     *
     *   import * as Ids from 'ids-wc/dist/react/components';
     *   nameLibraryComponents(Ids);
     *
     * or, if you already import the components by name, hand over an object literal
     * (shorthand keys mean the key IS the export name):
     *
     *   import { MdcButton, MdcCard, MdcGrid } from 'ids-wc/dist/react/components';
     *   nameLibraryComponents({ MdcButton, MdcCard, MdcGrid });
     *
     * `prefix` (optional) is prepended to each name, useful when several libraries
     * collide on generic names: nameLibraryComponents(Ids, 'Ids.') → "Ids.MdcButton".
     *
     * Only fills in blanks: a component that already has a `displayName` is left alone,
     * and non-component exports (strings, config objects, hooks) are skipped. Frozen
     * components are skipped rather than throwing. Returns the names it actually set.
     */
    nameLibraryComponents(namespace: Record<string, any>, prefix = "") {
      const named: string[] = [];

      for (const [exportName, component] of Object.entries(namespace ?? {})) {
        // Components are either functions (plain/class) or exotic objects carrying a
        // React $$typeof (forwardRef, memo, lazy). Anything else is not a component.
        const isComponent =
          typeof component === "function" ||
          (component !== null && typeof component === "object" && "$$typeof" in component);
        if (!isComponent) continue;

        // Never clobber a name the library set deliberately.
        if (component.displayName) continue;

        try {
          component.displayName = prefix + exportName;
          named.push(component.displayName);
        } catch {
          // Object.freeze'd export — nothing we can do, and it must not break the app.
        }
      }

      console.log(
        `[react-debug-helper] Named ${named.length} component(s) for MCP debugging`,
        named
      );
      return named;
    },

    // ── Below here: DevTools-console conveniences only. ──────────────────────
    // react-debug-mcp never calls these — it injects its own snippets over CDP and
    // has better versions of all three (inspect_by_selector, get_store_state,
    // get_component_tree). They exist so you can poke at the same data by hand from
    // the browser console without an agent in the loop. Deleting them costs you
    // nothing on the MCP side.

    /**
     * Console equivalent of the `inspect_by_selector` tool: props + hook values of the
     * nearest function component at or above `selector`.
     */
    getComponentState(selector: string) {
      const el = document.querySelector(selector);
      if (!el) return { error: `Element not found: ${selector}` };

      const fiberKey = Object.keys(el).find(
        (k) => k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$")
      );
      if (!fiberKey) return { error: "No React fiber found" };

      const fiber = (el as any)[fiberKey];
      let comp = fiber;
      while (comp && typeof comp.type !== "function") {
        comp = comp.return;
      }
      if (!comp) return { error: "No React component found" };

      const hooks: any[] = [];
      let hook = comp.memoizedState;
      while (hook) {
        hooks.push(hook.memoizedState);
        hook = hook.next;
      }

      return {
        component: comp.type?.displayName || comp.type?.name || "Anonymous",
        props: comp.memoizedProps,
        hooks,
      };
    },

    /**
     * Console equivalent of the `get_store_state` tool. Reads whichever store
     * exposeStore() published, with an optional dot path ("cart.items.0.price").
     */
    getStoreState(path?: string) {
      const store =
        (window as any).__REDUX_STORE__ ||
        (window as any).__ZUSTAND_STORE__ ||
        (window as any).__STORE__;
      if (!store) return { error: "No store exposed" };

      let state = store.getState();
      if (path) {
        for (const key of path.split(".")) {
          state = state?.[key];
        }
      }
      return state;
    },

    /**
     * Console equivalent of the `get_component_tree` tool, flattened: the deduplicated
     * names of every function component currently mounted. `selector` is the app root
     * (defaults to "#root"); the walk climbs to the fiber root from there.
     */
    listComponents(selector?: string) {
      const root = document.querySelector(selector || "#root");
      if (!root) return [];

      const fiberKey = Object.keys(root).find((k) =>
        k.startsWith("__reactFiber$")
      );
      if (!fiberKey) return [];

      const names: string[] = [];
      function walk(node: any, depth: number) {
        if (!node || depth > 20) return;
        if (typeof node.type === "function") {
          const name = node.type.displayName || node.type.name;
          if (name) names.push(name);
        }
        walk(node.child, depth + 1);
        walk(node.sibling, depth);
      }

      let fiberRoot = (root as any)[fiberKey];
      while (fiberRoot.return) fiberRoot = fiberRoot.return;
      walk(fiberRoot, 0);

      return [...new Set(names)];
    },
  };

  // Hand the console API to the human. react-debug-mcp does NOT read this global —
  // it only ever reads the store globals written by exposeStore().
  (window as any).__REACT_DEBUG__ = helper;
  console.log(
    "[react-debug-helper] Ready. Use window.__REACT_DEBUG__ in console, or connect react-debug-mcp."
  );

  return helper;
}

// Runs on import — which is why importing `exposeStore` is all the setup there is.
const debugHelper = createDebugHelper();

/**
 * Publish a Redux/Zustand store so `get_store_state` can read it.
 *
 * Safe to call unconditionally: outside development `debugHelper` is null and this
 * does nothing, so you can leave the call in your store setup permanently rather than
 * wrapping it in an `if (import.meta.env.DEV)`.
 */
export const exposeStore = (store: any, type?: StoreType) => {
  debugHelper?.exposeStore(store, type);
};

/**
 * Turn a library's `forwardRef(Anonymous)` components into named ones by copying each
 * export name onto `displayName`. See the method above for why the name is missing.
 *
 *   import * as Ids from 'ids-wc/dist/react/components';
 *   nameLibraryComponents(Ids);
 *
 * Also a no-op outside development, so it is safe to leave in place.
 */
export const nameLibraryComponents = (namespace: Record<string, any>, prefix?: string): string[] =>
  debugHelper?.nameLibraryComponents(namespace, prefix) ?? [];

/** The console API, or null outside development. Rarely needed — prefer the MCP tools. */
export default debugHelper;
