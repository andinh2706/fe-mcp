/**
 * Script tracking and source map resolution.
 *
 * Manages the URL-keyed script map, source map fetching/caching,
 * and mapping original source locations to generated (bundled) locations.
 */

import { log } from "../../logger.mjs";
import { SourceMapConsumer } from "source-map-js";
import { scripts, scriptIdToUrl, sourceMapCache, requireCdp } from "./state.mjs";

// ---------------------------------------------------------------------------
// Script tracking (called from attach)
// ---------------------------------------------------------------------------

/**
 * Handle a Debugger.scriptParsed event.
 * Updates the URL-keyed script map, clearing stale entries.
 */
export function onScriptParsed(params) {
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
export function listScripts(urlFilter) {
  let results = Array.from(scripts.entries()).map(([url, info]) => ({
    scriptId: info.scriptId,
    url,
    hasSourceMap: !!info.sourceMapURL,
  }));

  if (urlFilter) {
    const lower = urlFilter.toLowerCase();
    results = results.filter(s => s.url.toLowerCase().includes(lower));
  }

  return results;
}

/**
 * Find a script by URL pattern (substring match against bundled script URLs).
 * Prefers exact filename matches over partial path matches.
 */
export function findScriptByPattern(pattern) {
  const lower = pattern.toLowerCase();
  let best = null;

  for (const [url, info] of scripts) {
    if (!url.toLowerCase().includes(lower)) continue;

    const candidate = {
      scriptId: info.scriptId,
      url,
      hasSourceMap: !!info.sourceMapURL,
    };

    const filename = url.split("/").pop().toLowerCase();
    if (filename === lower || filename === lower.replace(/\//g, "")) {
      return candidate;
    }

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
export function locToEntry(loc) {
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
export function urlPatternToRegex(pattern) {
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
 * @param {string} originalPattern — filename or path fragment (original source)
 * @param {number} line — 1-based line in the original source
 * @param {number} column — 1-based column in the original source
 * @returns {{ scriptId, scriptUrl, generatedLine, generatedColumn, originalSource } | null}
 */
export async function resolveViaSourceMap(originalPattern, line, column) {
  for (const [scriptUrl, info] of scripts) {
    if (!info.sourceMapURL) continue;

    let cached;
    try {
      cached = await getSourceMapConsumer(scriptUrl, info.sourceMapURL);
    } catch (err) {
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
async function getSourceMapConsumer(scriptUrl, sourceMapURL) {
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
    sources: new Set(consumer.sources || []),
  };
  sourceMapCache.set(scriptUrl, cached);
  return cached;
}

function resolveSourceMapUrl(scriptUrl, sourceMapURL) {
  if (sourceMapURL.startsWith("data:")) return sourceMapURL;
  if (sourceMapURL.startsWith("http://") || sourceMapURL.startsWith("https://")) return sourceMapURL;
  const base = scriptUrl.substring(0, scriptUrl.lastIndexOf("/") + 1);
  return base + sourceMapURL;
}

/**
 * Find the source entry in a source map that best matches a pattern.
 * (e.g. "MultipleNestedForms.tsx" matching "webpack://common-ui/.../MultipleNestedForms.tsx")
 */
function findMatchingSource(sources, pattern) {
  const lower = pattern.toLowerCase();

  for (const src of sources) {
    const filename = src.split("/").pop().toLowerCase();
    if (filename === lower) return src;
  }

  for (const src of sources) {
    if (src.toLowerCase().includes(lower)) return src;
  }

  return null;
}
