/**
 * Script tracking and source map resolution.
 *
 * Manages the URL-keyed script map, source map fetching/caching,
 * and mapping original source locations to generated (bundled) locations.
 */

import { log } from "../../logger.js";
import { SourceMapConsumer } from "source-map-js";
import { scripts, scriptIdToUrl, sourceMapCache } from "./state.js";

// ---------------------------------------------------------------------------
// Script tracking (called from attach)
// ---------------------------------------------------------------------------

/**
 * Handle a Debugger.scriptParsed event by recording the script in the URL-keyed
 * map (plus the scriptId→url reverse map).
 *
 * On a page reload the same URL reappears with a NEW scriptId; when that
 * happens we evict the previous scriptId's reverse-map entry and its cached
 * source map, so lookups always resolve to the currently-loaded script.
 * (Anonymous eval scripts with no url are ignored.)
 */
export function onScriptParsed(params: any): void {
  if (!params.url) return;

  const existing = scripts.get(params.url);
  if (existing && existing.scriptId !== params.scriptId) {
    sourceMapCache.delete(params.url);
    scriptIdToUrl.delete(existing.scriptId);
  }

  scripts.set(params.url, {
    scriptId: params.scriptId,
    sourceMapURL: params.sourceMapURL || null,
  });
  scriptIdToUrl.set(params.scriptId, params.url);
}

// ---------------------------------------------------------------------------
// Script lookup
// ---------------------------------------------------------------------------

/**
 * List loaded scripts, optionally filtered by a URL pattern.
 * Returns bundled script URLs as they appear in the browser, not original
 * source file names.
 */
export function listScripts(urlFilter?: string) {
  let results = Array.from(scripts.entries()).map(([url, info]) => ({
    scriptId: info.scriptId,
    url,
    hasSourceMap: !!info.sourceMapURL,
  }));

  if (urlFilter) {
    const lower = urlFilter.toLowerCase();
    results = results.filter((s) => s.url.toLowerCase().includes(lower));
  }

  return results;
}

/**
 * Find the single best script matching a URL pattern (substring match).
 * Preference order: an exact filename match wins immediately; otherwise the
 * shortest matching URL is kept (shortest ≈ least-nested / most-specific),
 * which avoids returning a deep vendor path when a top-level bundle also matches.
 */
export function findScriptByPattern(pattern: string) {
  const lower = pattern.toLowerCase();
  let best: { scriptId: string; url: string; hasSourceMap: boolean } | null = null;

  for (const [url, info] of scripts) {
    if (!url.toLowerCase().includes(lower)) continue;

    const candidate = {
      scriptId: info.scriptId,
      url,
      hasSourceMap: !!info.sourceMapURL,
    };

    // Exact filename hit — can't do better, return now.
    const filename = (url.split("/").pop() || "").toLowerCase();
    if (filename === lower || filename === lower.replace(/\//g, "")) {
      return candidate;
    }

    // Otherwise keep the shortest matching URL seen so far.
    if (!best || url.length < best.url.length) {
      best = candidate;
    }
  }

  return best;
}

// ---------------------------------------------------------------------------
// CDP location helpers
// ---------------------------------------------------------------------------

/**
 * Convert a CDP breakpoint location to our standard entry format.
 */
export function locToEntry(loc: any) {
  return {
    scriptId: loc.scriptId,
    url: scriptIdToUrl.get(loc.scriptId) || "unknown",
    line: loc.lineNumber + 1,
    column: loc.columnNumber + 1,
  };
}

/**
 * Escape a user-friendly file pattern into a regex for CDP setBreakpointByUrl.
 */
export function urlPatternToRegex(pattern: string): string {
  return pattern
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");
}

// ---------------------------------------------------------------------------
// Source map resolution
// ---------------------------------------------------------------------------

/**
 * Resolve an original source file (e.g. "MultipleNestedForms.tsx") to a
 * generated location in a loaded bundled script, by parsing source maps.
 *
 * @param originalPattern — filename or path fragment (original source)
 * @param line — 1-based line in the original source
 * @param column — 1-based column in the original source
 */
export async function resolveViaSourceMap(originalPattern: string, line: number, column?: number) {
  // Scan every source-mapped bundle; the first whose map contains a matching
  // original source (and yields a generated position) wins.
  for (const [scriptUrl, info] of scripts) {
    if (!info.sourceMapURL) continue;

    let cached;
    try {
      cached = await getSourceMapConsumer(scriptUrl, info.sourceMapURL);
    } catch (err: any) {
      log.debug("source map fetch failed", { scriptUrl, error: err.message });
      continue;
    }

    const matchingSource = findMatchingSource(cached.sources, originalPattern);
    if (!matchingSource) continue;

    // source-map-js: line is 1-based, column is 0-based
    const generated = cached.consumer.generatedPositionFor({
      source: matchingSource,
      line,
      column: (column || 1) - 1,
    });

    if (generated.line !== null) {
      log.info("source map resolved", {
        original: `${matchingSource}:${line}`,
        generated: `${scriptUrl}:${generated.line}:${generated.column}`,
      });
      return {
        scriptId: info.scriptId,
        scriptUrl,
        generatedLine: generated.line,        // 1-based
        generatedColumn: generated.column || 0, // 0-based
        originalSource: matchingSource,
      };
    }
  }

  return null;
}

/**
 * Get or create a cached SourceMapConsumer for a script.
 * Fetches the source map via HTTP from the dev server.
 */
async function getSourceMapConsumer(scriptUrl: string, sourceMapURL: string) {
  if (sourceMapCache.has(scriptUrl)) {
    return sourceMapCache.get(scriptUrl);
  }

  const mapUrl = resolveSourceMapUrl(scriptUrl, sourceMapURL);
  log.debug("fetching source map", { mapUrl });

  const response = await fetch(mapUrl);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} fetching ${mapUrl}`);
  }

  const rawMap = await response.json();
  const consumer = new SourceMapConsumer(rawMap);

  const cached = {
    consumer,
    // Use the consumer's normalized sources, NOT rawMap.sources.
    // The consumer resolves relative path segments (e.g. ../../../../common-ui/...)
    // to absolute paths (e.g. common-ui/...). We must match against the same
    // normalized names that generatedPositionFor() expects.
    sources: new Set<string>(consumer.sources || []),
  };
  sourceMapCache.set(scriptUrl, cached);
  return cached;
}

function resolveSourceMapUrl(scriptUrl: string, sourceMapURL: string): string {
  if (sourceMapURL.startsWith("data:")) return sourceMapURL;
  if (sourceMapURL.startsWith("http://") || sourceMapURL.startsWith("https://")) return sourceMapURL;
  const base = scriptUrl.substring(0, scriptUrl.lastIndexOf("/") + 1);
  return base + sourceMapURL;
}

/**
 * Find the source entry in a source map that best matches a pattern.
 * (e.g. "MultipleNestedForms.tsx" matching "webpack://common-ui/.../MultipleNestedForms.tsx")
 */
function findMatchingSource(sources: Set<string>, pattern: string): string | null {
  const lower = pattern.toLowerCase();

  for (const src of sources) {
    const filename = (src.split("/").pop() || "").toLowerCase();
    if (filename === lower) return src;
  }

  for (const src of sources) {
    if (src.toLowerCase().includes(lower)) return src;
  }

  return null;
}
