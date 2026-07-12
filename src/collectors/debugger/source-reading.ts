/**
 * Source reading and searching against bundled scripts loaded in the browser.
 *
 * These operate on the BUNDLED (generated) scripts, not original source files.
 * For reading original source files, the agent should use the filesystem directly.
 *
 * searchSource runs searches in parallel across scripts for better performance.
 */

import { serverLimits } from "../../limits.js";
import { INTERNAL_URL_PREFIXES, startsWithAny } from "../../url-filters.js";
import { requireCdp, scripts } from "./state.js";
import { findScriptByPattern, listScripts } from "./scripts.js";

const { SOURCE_DEFAULT_LINE_WINDOW, SOURCE_SEARCH_MAX_SCRIPTS, SOURCE_SEARCH_MAX_RESULTS } = serverLimits();

/**
 * Scripts to exclude from search — the shared browser-internal core plus the
 * legacy `extensions::` scheme. (This also skips `chrome://` scripts, which are
 * browser-internal and never application source.)
 */
const IGNORE_SCRIPT_PREFIXES = [...INTERNAL_URL_PREFIXES, "extensions::"];

/**
 * Read the source code of a loaded bundled script by URL pattern.
 * Returns the bundled/generated code as the browser sees it, not the
 * original source. Useful for inspecting vendor code or verifying
 * what the browser is actually executing.
 */
export async function getSource(urlPattern: string, startLine?: number, endLine?: number): Promise<any> {
  const cdp = requireCdp();

  const match = findScriptByPattern(urlPattern);
  if (!match) {
    const available = listScripts(urlPattern);
    return {
      error: `No bundled script found matching "${urlPattern}"`,
      suggestion: available.length > 0
        ? "Partial matches: " + available.slice(0, 5).map((s) => s.url).join(", ")
        : "Use list_scripts to see loaded bundled scripts.",
    };
  }

  const { scriptSource } = await cdp.Debugger.getScriptSource({ scriptId: match.scriptId });

  const allLines = scriptSource.split("\n");
  const totalLines = allLines.length;

  const from = Math.max(0, (startLine || 1) - 1);
  const to = endLine ? Math.min(totalLines, endLine) : Math.min(totalLines, from + SOURCE_DEFAULT_LINE_WINDOW);
  const lines = allLines.slice(from, to);

  const padWidth = String(to).length;
  const numbered = lines.map((line: string, i: number) => {
    const num = String(from + i + 1).padStart(padWidth, " ");
    return `${num} │ ${line}`;
  });

  return {
    url: match.url,
    scriptId: match.scriptId,
    hasSourceMap: match.hasSourceMap,
    totalLines,
    showing: { from: from + 1, to },
    source: numbered.join("\n"),
  };
}

/**
 * Search for a text pattern across loaded bundled scripts in parallel.
 * Returns matches with bundled script URLs and line numbers.
 *
 * Searches are dispatched concurrently via Promise.allSettled, then
 * results are gathered and capped.
 */
export async function searchSource(query: string, urlFilter?: string, isRegex?: boolean, caseSensitive?: boolean): Promise<any> {
  const cdp = requireCdp();

  let targets = Array.from(scripts.entries()).map(([url, info]) => ({
    scriptId: info.scriptId,
    url,
  }));

  targets = targets.filter((s) => s.url && !startsWithAny(s.url, IGNORE_SCRIPT_PREFIXES));

  if (urlFilter) {
    const lower = urlFilter.toLowerCase();
    targets = targets.filter((s) => s.url.toLowerCase().includes(lower));
  }

  if (targets.length > SOURCE_SEARCH_MAX_SCRIPTS) {
    targets = targets.slice(0, SOURCE_SEARCH_MAX_SCRIPTS);
  }

  // Search all scripts in parallel
  const searchPromises = targets.map((script) =>
    cdp.Debugger.searchInContent({
      scriptId: script.scriptId,
      query,
      isRegex: isRegex || false,
      caseSensitive: caseSensitive !== undefined ? caseSensitive : false,
    })
      .then(({ result: matches }: any) =>
        matches.map((m: any) => ({
          url: script.url,
          line: m.lineNumber + 1,
          content: m.lineContent.trim(),
        }))
      )
      .catch(() => [])  // Some scripts may not support search (e.g., wasm)
  );

  const settled = await Promise.all(searchPromises);

  // Flatten and cap
  const results: any[] = [];
  for (const matches of settled) {
    for (const match of matches) {
      if (results.length >= SOURCE_SEARCH_MAX_RESULTS) break;
      results.push(match);
    }
    if (results.length >= SOURCE_SEARCH_MAX_RESULTS) break;
  }

  return {
    query,
    urlFilter: urlFilter || null,
    totalMatches: results.length,
    capped: results.length >= SOURCE_SEARCH_MAX_RESULTS,
    matches: results,
  };
}
