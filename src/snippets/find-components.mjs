/**
 * Find all instances of a component by name.
 * Supports prop filtering, scoped searching via startSelector, and function detail expansion.
 *
 * Depends on: (transitive via resolveFiber, buildAncestorPath)
 */

/* eslint-disable no-undef -- browser globals + helpers injected by bundle */

import {
  getHookAccess, findFiberByElement, getFiberRoot,
  getDisplayName, browserLimits, safeSerialize, describeFn, classifyHook, extractHooks, safeProps, fiberToSelector,
  resolveComponentFiber, resolveRootFiber, resolveFiber, buildAncestorPath,
} from './helpers.mjs';

export function findComponents(targetName, propFilter, maxResults, startSelector, showFunctionDetails) {
  maxResults = maxResults || browserLimits().FIND_COMPONENTS_DEFAULT_MAX;

  const resolved = resolveFiber(startSelector);
  if (resolved.error) return resolved;

  const walkRoot = resolved.fiber;
  const source = resolved.source;
  const prefixPath = startSelector ? buildAncestorPath(walkRoot) : [];

  const results = [];
  const searchLower = targetName.toLowerCase();
  const visited = new Set();

  function matchesFilter(fiber) {
    if (!propFilter) return true;
    const props = fiber.memoizedProps || {};
    for (const [k, v] of Object.entries(propFilter)) {
      try {
        if (JSON.stringify(props[k]) !== JSON.stringify(v)) return false;
      } catch {
        return false;
      }
    }
    return true;
  }

  function walk(fiber, parentPath) {
    if (!fiber || results.length >= maxResults) return;
    if (visited.has(fiber)) return;  // cycle guard
    visited.add(fiber);

    const name = getDisplayName(fiber);

    if (name && name.toLowerCase().includes(searchLower) && matchesFilter(fiber)) {
      results.push({
        instanceIndex: results.length,
        component: name,
        key: fiber.key || null,
        parentPath: parentPath,
        props: safeProps(fiber, showFunctionDetails),
        hooks: extractHooks(fiber, showFunctionDetails),
        domSelector: fiberToSelector(fiber),
      });
    }

    const nextPath = name ? [...parentPath, name] : parentPath;
    let child = fiber.child;
    while (child) {
      walk(child, nextPath);
      child = child.sibling;
    }
  }

  walk(walkRoot, prefixPath);

  const output = { query: targetName, propFilter: propFilter || null, found: results.length, source, results };
  if (startSelector) output.startSelector = startSelector;
  return output;
}

export const deps = [
  getHookAccess, findFiberByElement, getFiberRoot,
  getDisplayName, browserLimits, safeSerialize, describeFn, classifyHook, extractHooks, safeProps, fiberToSelector,
  resolveComponentFiber, resolveRootFiber, resolveFiber, buildAncestorPath,
];
