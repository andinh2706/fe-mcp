/**
 * Network Tool
 *
 * Queries the network collector for captured request/response pairs.
 */

import { z } from "zod";
import * as networkCollector from "../collectors/network.mjs";
import { log } from "../logger.mjs";
import { NETWORK_DEFAULT_LIMIT } from "../limits.mjs";

export function register(server) {
  server.tool(
    "get_network_responses",
    `Get captured API requests (XHR, Fetch) and their response data. Static 
resource requests (images, scripts, stylesheets, fonts, HTML) are excluded.

Two data sources:
  - LIVE requests (captured after MCP connected): full response bodies included
  - HISTORICAL requests (happened before MCP connected): URL, status, timing, 
    and size only — no response bodies. If you need the body, ask the user to 
    reproduce the action so it's captured live.

Each result includes a "source" field ("live" or "historical") so you know 
which have full bodies. Use this when the UI shows wrong data to check what 
the API actually returned.`,
    {
      url_pattern: z.string().optional().describe(
        "Substring to match against request URLs (e.g. '/api/cart', 'graphql', '/users'). Omit to get all."
      ),
      method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "any"]).optional().describe(
        "Filter by HTTP method. Default 'any'."
      ),
      status_filter: z.enum(["all", "errors_only", "success_only"]).optional().describe(
        "Filter: 'errors_only' for 4xx/5xx, 'success_only' for 2xx. Default 'all'."
      ),
      limit: z.number().optional().describe(`Max requests to return (default: ${NETWORK_DEFAULT_LIMIT})`),
      include_historical: z.boolean().optional().describe("Include requests from before MCP connected (metadata only, no bodies). Default: true"),
    },
    async ({ url_pattern, method = "any", status_filter = "all", limit = NETWORK_DEFAULT_LIMIT, include_historical = true }) => {
      log.info("get_network_responses", { url_pattern, method, status_filter });

      const results = networkCollector.query({
        urlPattern: url_pattern,
        method,
        statusFilter: status_filter,
        limit,
        includeHistorical: include_historical,
      });

      return {
        content: [{
          type: "text",
          text: results.length > 0
            ? JSON.stringify(results, null, 2)
            : `No network requests found matching "${url_pattern || "*"}". The page may need refreshing, or requests haven't fired yet.`,
        }],
      };
    }
  );
}
