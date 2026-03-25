/**
 * Build the path from root React component down to the component at a CSS selector.
 * Returns an ordered array of { component, key?, props?, hooks? } from outermost to target.
 *
 * Depends on: (transitive via resolveComponentFiber, buildAncestorPath, buildFiberEntry)
 */

/* eslint-disable no-undef -- browser globals + helpers injected by bundle */

import {
  findFiberByElement, getDisplayName,
  browserLimits, safeSerialize, describeFn, classifyHook, extractHooks, safeProps,
  resolveComponentFiber, buildFiberEntry,
} from './helpers.mjs';

export function componentPath(selector, showProps, showHooks, showFunctionDetails) {
  const resolved = resolveComponentFiber(selector);
  if (resolved.error) return resolved;

  const comp = resolved.fiber;
  const targetName = getDisplayName(comp) || 'Unknown';
  const opts = { showProps, showHooks, showFunctionDetails };

  // Collect all named components from this fiber up to root
  const pathFromTarget = [];
  let cur = comp;
  while (cur) {
    const name = getDisplayName(cur);
    if (name) pathFromTarget.push(buildFiberEntry(cur, opts));
    cur = cur.return;
  }

  const path = pathFromTarget.reverse();

  return {
    selector,
    target: targetName,
    depth: path.length,
    path,
  };
}

export const deps = [
  findFiberByElement, getDisplayName,
  browserLimits, safeSerialize, describeFn, classifyHook, extractHooks, safeProps,
  resolveComponentFiber, buildFiberEntry,
];
