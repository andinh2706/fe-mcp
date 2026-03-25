/**
 * State Store Tool
 *
 * Reads from Redux, Zustand, or any global store exposed on window.
 */

import { z } from "zod";
import { evaluate } from "../cdp-client.mjs";
import { STORE_READER } from "../snippets/index.mjs";
import { log } from "../logger.mjs";

export function register(server) {
  server.tool(
    "get_store_state",
    `Read the current state from Redux, Zustand, MobX, or any global state store.
For Redux: reads from window.__REDUX_STORE__ or window.store. 
For Zustand: reads from window.__ZUSTAND_STORE__. 
Provide a dot-separated path to read a specific slice (e.g. 'cart.items').
Use this when you suspect the issue is in shared/global state rather than 
component-local state.`,
    {
      path: z.string().optional().describe(
        "Dot-separated path into the state tree (e.g. 'user.profile.name', 'cart.items'). Omit to get entire state."
      ),
      store_type: z.enum(["redux", "zustand", "auto"]).optional().describe(
        "Which store to read. Default 'auto' tries to detect."
      ),
    },
    async ({ path, store_type = "auto" }) => {
      log.info("get_store_state", { path, store_type });
      try {
        const result = await evaluate(
          `(${STORE_READER})(${JSON.stringify(store_type)}, ${JSON.stringify(path || null)})`
        );
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
      }
    }
  );
}
