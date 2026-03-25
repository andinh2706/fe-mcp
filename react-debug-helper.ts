/**
 * react-debug-helper.ts
 *
 * Drop this into your React app's entry point (e.g., main.tsx or index.tsx)
 * in development mode. It exposes your state stores on `window` so that
 * react-debug-mcp can read them via the `get_store_state` tool.
 *
 * Usage:
 *   import './react-debug-helper';  // at the top of your entry file
 *
 *   // Then wherever you create your store:
 *   const store = configureStore({ ... });
 *   exposeStore(store, 'redux');     // or 'zustand'
 *
 * In production builds, everything is a no-op.
 */

type StoreType = "redux" | "zustand" | "custom";

interface DebugHelperAPI {
  exposeStore: (store: any, type?: StoreType) => void;
  getComponentState: (selector: string) => any;
  getStoreState: (path?: string) => any;
  listComponents: (selector?: string) => string[];
}

function createDebugHelper(): DebugHelperAPI | null {
  if (process.env.NODE_ENV !== "development") {
    return null;
  }

  const helper: DebugHelperAPI = {
    /**
     * Expose a state store so react-debug-mcp can read it.
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
     * Get React component state from a CSS selector.
     * Useful for manual console debugging too.
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
     * Read from exposed store with optional dot path.
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
     * List all React component names mounted under a root.
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

  // Expose on window for console access too
  (window as any).__REACT_DEBUG__ = helper;
  console.log(
    "[react-debug-helper] Ready. Use window.__REACT_DEBUG__ in console, or connect react-debug-mcp."
  );

  return helper;
}

// Auto-initialize
const debugHelper = createDebugHelper();

/**
 * Export for use in your store setup:
 *
 *   import { exposeStore } from './react-debug-helper';
 *   const store = configureStore({ ... });
 *   exposeStore(store, 'redux');
 */
export const exposeStore = (store: any, type?: StoreType) => {
  debugHelper?.exposeStore(store, type);
};

export default debugHelper;
