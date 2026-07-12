/**
 * Shared URL-prefix filters for excluding browser-internal resources.
 *
 * Chrome surfaces internal pages, DevTools assets, and extension resources that
 * are never interesting to a React debugger. Three subsystems each need to skip
 * them, with slightly different extras:
 *   - cdp-client.ts (pickTarget)        — which TAB to attach to
 *   - collectors/network.ts (shouldIgnore) — which REQUESTS to capture
 *   - collectors/debugger/source-reading.ts (searchSource) — which SCRIPTS to search
 *
 * The common core lives here so a newly-added internal scheme only has to be
 * declared once; each site spreads it into its own list alongside site-specific
 * additions (see the `IGNORE_*_PREFIXES` constants in those files).
 */

/** Schemes that are always browser-internal (never application content). */
export const INTERNAL_URL_PREFIXES = [
  "devtools://",
  "chrome://",
  "chrome-extension://",
] as const;

/** True if `url` starts with any prefix in `prefixes`. */
export function startsWithAny(url: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => url.startsWith(prefix));
}
