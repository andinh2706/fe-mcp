/**
 * General Purpose Tools
 *
 * Escape hatch for ad-hoc inspection.
 */

import { z } from "zod";
import { evaluate } from "../cdp-client.mjs";
import { log } from "../logger.mjs";
import { LOG_EXPRESSION_TRUNCATE } from "../limits.mjs";

export function register(server) {
  server.tool(
    "evaluate_in_page",
    `Run a JavaScript expression in the browser page context and return the result.
Use this for ad-hoc inspection when the specialized tools don't cover your need —
e.g., checking localStorage, cookies, window variables, or running custom queries.
The expression should return a JSON-serializable value.`,
    {
      expression: z.string().describe(
        "JavaScript expression to evaluate (e.g. 'document.cookie', 'localStorage.getItem(\"token\")', 'window.location.href')"
      ),
    },
    async ({ expression }) => {
      log.info("evaluate_in_page", { expression: expression.slice(0, LOG_EXPRESSION_TRUNCATE) });
      try {
        const result = await evaluate(`
          (function() {
            const result = ${expression};
            try { return JSON.parse(JSON.stringify(result)); }
            catch { return String(result); }
          })()
        `);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error evaluating: ${err.message}` }], isError: true };
      }
    }
  );
}
